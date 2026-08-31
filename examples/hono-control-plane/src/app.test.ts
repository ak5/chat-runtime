import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, SIGNATURE_HEADERS, canonicalRequest, signRequest, type ActionPlan, type ActionReceipt, type RuntimeEvent } from "@chat-runtime/protocol";
import { createApp } from "./app.js";
import type { RuntimeRepository } from "./repository.js";

class MemoryRepository implements RuntimeRepository {
  nonces = new Set<string>(); events = new Map<string, RuntimeEvent>(); plans: ActionPlan[] = []; receipts: ActionReceipt[] = []; health: unknown;
  async claimNonce(installation: string, nonce: string): Promise<boolean> { const key = `${installation}:${nonce}`; if (this.nonces.has(key)) return false; this.nonces.add(key); return true; }
  async storeEvent(event: RuntimeEvent): Promise<boolean> { if (this.events.has(event.eventId)) return false; this.events.set(event.eventId, event); return true; }
  async enqueuePlan(plan: ActionPlan): Promise<void> { this.plans.push(plan); }
  async claimPlans(installation: string, platforms: Array<"discord" | "telegram">): Promise<ActionPlan[]> { return this.plans.filter((plan) => plan.installationId === installation && plan.actions.every((action) => platforms.includes(action.platform))); }
  async storeReceipt(receipt: ActionReceipt): Promise<void> { this.receipts.push(receipt); }
  async storeHealth(_installation: string, _observedAt: string, health: unknown): Promise<void> { this.health = health; }
  async cleanup(): Promise<number> { return 0; }
}

const secret = "test-shared-secret-that-is-at-least-32-characters";
const env = { CHAT_RUNTIME_INSTALLATION_ID: "install", CHAT_RUNTIME_SHARED_SECRET: secret } as any;

async function signed(path: string, body: unknown, nonce: string = crypto.randomUUID()): Promise<Request> {
  const text = body === undefined ? "" : JSON.stringify(body);
  const timestamp = new Date().toISOString();
  const url = new URL(path, "https://control.example");
  const signature = await signRequest(secret, canonicalRequest(body === undefined ? "GET" : "POST", url.pathname, timestamp, nonce, text));
  return new Request(url, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", [SIGNATURE_HEADERS.installation]: "install", [SIGNATURE_HEADERS.timestamp]: timestamp, [SIGNATURE_HEADERS.nonce]: nonce, [SIGNATURE_HEADERS.signature]: signature }, ...(text ? { body: text } : {}) });
}

function command(name: string): RuntimeEvent {
  return { protocolVersion: PROTOCOL_VERSION, eventId: crypto.randomUUID(), installationId: "install", platform: "discord", occurredAt: new Date().toISOString(), type: "interaction.command", metadata: {}, payload: { interactionId: "interaction", conversationId: "channel", userId: "user", name, arguments: {} } };
}

describe("Hono control plane", () => {
  it("rejects unsigned and replayed requests", async () => {
    const repo = new MemoryRepository(); const app = createApp({ repository: repo });
    expect((await app.request("/v1/events", { method: "POST", body: "{}" }, env)).status).toBe(401);
    const request = await signed("/v1/events", command("ping"), "same-nonce");
    expect((await app.fetch(request.clone() as any, env)).status).toBe(200);
    expect((await app.fetch(request.clone() as any, env)).status).toBe(409);
  });

  it("persists events and returns an immediate command action", async () => {
    const repo = new MemoryRepository(); const app = createApp({ repository: repo });
    const response = await app.fetch(await signed("/v1/events", command("ping")), env);
    const body = await response.json() as { plans: ActionPlan[] };
    expect(body.plans[0]?.actions[0]?.type).toBe("interaction.acknowledge");
    expect(repo.events.size).toBe(1);
    expect(repo.plans).toHaveLength(1);
  });

  it("queues and leases deferred work", async () => {
    const repo = new MemoryRepository(); const app = createApp({ repository: repo });
    await app.fetch(await signed("/v1/events", command("deferred")), env);
    const response = await app.fetch(await signed("/v1/actions?platforms=discord", undefined), env);
    const body = await response.json() as { plans: ActionPlan[] };
    expect(body.plans[0]?.actions[0]?.type).toBe("message.send");
  });

  it("rejects stale signatures", async () => {
    const repo = new MemoryRepository(); const app = createApp({ repository: repo });
    const body = JSON.stringify(command("ping")); const timestamp = new Date(0).toISOString(); const nonce = "old";
    const signature = await signRequest(secret, canonicalRequest("POST", "/v1/events", timestamp, nonce, body));
    const response = await app.fetch(new Request("https://control.example/v1/events", { method: "POST", body, headers: { [SIGNATURE_HEADERS.installation]: "install", [SIGNATURE_HEADERS.timestamp]: timestamp, [SIGNATURE_HEADERS.nonce]: nonce, [SIGNATURE_HEADERS.signature]: signature } }), env);
    expect(response.status).toBe(401);
  });
});

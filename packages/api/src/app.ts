import { PROTOCOL_VERSION, actionPlanSchema, actionReceiptSchema, newProtocolId, runtimeEventSchema, type ActionPlan, type RuntimeAction, type RuntimeEvent } from "@chat-runtime/protocol";
import { Hono } from "hono";
import { authenticateRuntime } from "./auth.js";
import { D1RuntimeRepository, type RuntimeRepository } from "./repository.js";
import type { Bindings, Variables } from "./types.js";

type AppOptions = { repository?: RuntimeRepository };

export function createApp(options: AppOptions = {}) {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  app.use("/v1/*", async (c, next) => {
    c.set("repository", options.repository ?? new D1RuntimeRepository(c.env.DB, retentionDays(c.env.CHAT_RUNTIME_RETENTION_DAYS)));
    await next();
  });
  app.use("/v1/*", authenticateRuntime());

  app.get("/", (c) => c.json({ service: "chat-runtime-control-plane", protocolVersion: PROTOCOL_VERSION }));

  app.post("/v1/events", async (c) => {
    const parsed = runtimeEventSchema.safeParse(parseBody(c.get("rawBody")));
    if (!parsed.success) return c.json({ error: "invalid_event", issues: parsed.error.issues }, 400);
    if (parsed.data.installationId !== c.env.CHAT_RUNTIME_INSTALLATION_ID) return c.json({ error: "installation_mismatch" }, 400);
    const fresh = await c.get("repository").storeEvent(parsed.data);
    if (!fresh) return c.json({ plans: [] });
    const plans = immediatePlans(parsed.data);
    for (const plan of plans) await c.get("repository").enqueuePlan(plan, parsed.data.platform, undefined, true);
    if (parsed.data.type === "interaction.command" && parsed.data.payload.name === "deferred") {
      const deferred = planFor(parsed.data, [{ actionId: newProtocolId("action"), platform: parsed.data.platform, type: "message.send", conversationId: parsed.data.payload.conversationId, content: content("This response came from the D1-backed action outbox.") }]);
      await c.get("repository").enqueuePlan(deferred, parsed.data.platform);
    }
    return c.json({ plans });
  });

  app.get("/v1/actions", async (c) => {
    const requested = (c.req.query("platforms") ?? "").split(",").filter((value): value is "discord" | "telegram" | "slack" => value === "discord" || value === "telegram" || value === "slack");
    const leaseId = newProtocolId("lease");
    const now = new Date();
    const plans = await c.get("repository").claimPlans(c.env.CHAT_RUNTIME_INSTALLATION_ID, requested, leaseId, now.toISOString(), new Date(now.getTime() + 30_000).toISOString());
    return c.json({ plans, ...(plans.length ? { leaseId } : {}) });
  });

  app.post("/v1/receipts", async (c) => {
    const parsed = actionReceiptSchema.safeParse(parseBody(c.get("rawBody")));
    if (!parsed.success) return c.json({ error: "invalid_receipt", issues: parsed.error.issues }, 400);
    if (parsed.data.installationId !== c.env.CHAT_RUNTIME_INSTALLATION_ID) return c.json({ error: "installation_mismatch" }, 400);
    await c.get("repository").storeReceipt(parsed.data);
    return c.body(null, 204);
  });

  app.post("/v1/health", async (c) => {
    const body = parseBody(c.get("rawBody"));
    if (!body || typeof body !== "object" || (body as Record<string, unknown>).installationId !== c.env.CHAT_RUNTIME_INSTALLATION_ID) return c.json({ error: "invalid_health" }, 400);
    const observedAt = (body as Record<string, unknown>).observedAt;
    if (typeof observedAt !== "string" || !Number.isFinite(Date.parse(observedAt))) return c.json({ error: "invalid_health" }, 400);
    await c.get("repository").storeHealth(c.env.CHAT_RUNTIME_INSTALLATION_ID, observedAt, body);
    return c.body(null, 204);
  });

  app.post("/v1/cleanup", async (c) => c.json({ deleted: await c.get("repository").cleanup(new Date().toISOString()) }));
  app.notFound((c) => c.json({ error: "not_found" }, 404));
  return app;
}

function immediatePlans(event: RuntimeEvent): ActionPlan[] {
  if (event.type === "interaction.command") {
    if (event.payload.name === "ping") return [planFor(event, [{ actionId: newProtocolId("action"), platform: event.platform, type: "interaction.acknowledge", interactionId: event.payload.interactionId, token: event.payload.token, ephemeral: true, content: content("pong") }])];
    if (event.payload.name === "form" && event.platform !== "telegram") return [planFor(event, [{ actionId: newProtocolId("action"), platform: event.platform, type: "interaction.open-modal", interactionId: event.payload.interactionId, token: event.payload.token, modal: { title: "Example form", customId: "example-form", fields: [{ customId: "answer", label: "Your answer", style: "paragraph", required: true }] } }])];
    if (event.payload.name === "button") return [planFor(event, [{ actionId: newProtocolId("action"), platform: event.platform, type: "interaction.acknowledge", interactionId: event.payload.interactionId, token: event.payload.token, ephemeral: true, content: { ...content("Choose an action"), components: [{ type: "button", customId: "example-button", label: "Continue", style: "primary" }] } }])];
  }
  if (event.type === "interaction.component") return [planFor(event, [{ actionId: newProtocolId("action"), platform: event.platform, type: "interaction.acknowledge", interactionId: event.payload.interactionId, token: event.payload.token, ephemeral: true, content: content(`Component ${event.payload.customId} received.`) }])];
  if (event.type === "interaction.modal") return [planFor(event, [{ actionId: newProtocolId("action"), platform: event.platform, type: "interaction.acknowledge", interactionId: event.payload.interactionId, token: event.payload.token, ephemeral: true, content: content("Form received.") }])];
  if (event.type === "message.created" && event.payload.text?.trim().toLowerCase() === "runtime: remove this message") return [planFor(event, [{ actionId: newProtocolId("action"), platform: event.platform, type: "message.delete", conversationId: event.payload.conversationId, messageId: event.payload.messageId, ownMessage: false }])];
  return [];
}

function content(text: string): Extract<RuntimeAction, { type: "message.send" }>["content"] {
  return { text, fields: [], images: [], components: [], suppressNotifications: true };
}
function planFor(event: RuntimeEvent, actions: RuntimeAction[]): ActionPlan {
  return actionPlanSchema.parse({ protocolVersion: PROTOCOL_VERSION, planId: newProtocolId("plan"), installationId: event.installationId, eventId: event.eventId, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), actions });
}
function parseBody(raw: string): unknown { try { return JSON.parse(raw); } catch { return undefined; } }
function retentionDays(value: string | undefined): number {
  const parsed = Number(value ?? "30");
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 3650 ? parsed : 30;
}

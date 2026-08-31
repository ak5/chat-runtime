import { describe, expect, it } from "vitest";
import { ADMIN_ACTIONS, PROTOCOL_VERSION, actionPlanSchema, canonicalRequest, runtimeEventSchema, signRequest, verifyRequestSignature } from "./index.js";

describe("protocol v1", () => {
  it("accepts a normalized message event", () => {
    expect(runtimeEventSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      eventId: "evt_1", installationId: "install_1", platform: "discord",
      occurredAt: new Date().toISOString(), type: "message.created", metadata: {},
      payload: { messageId: "1", conversationId: "2", authorId: "3", text: "hello", attachments: [], isFromRuntime: false },
    }).type).toBe("message.created");
  });

  it("rejects unknown actions and protocol versions", () => {
    expect(() => actionPlanSchema.parse({ protocolVersion: "2", planId: "p", installationId: "i", createdAt: new Date().toISOString(), actions: [] })).toThrow();
    expect(() => actionPlanSchema.parse({ protocolVersion: PROTOCOL_VERSION, planId: "p", installationId: "i", createdAt: new Date().toISOString(), actions: [{ actionId: "a", platform: "discord", type: "system.shell" }] })).toThrow();
  });

  it("signs and verifies canonical requests", async () => {
    const canonical = canonicalRequest("post", "/v1/events", "123", "nonce", "{}");
    const signature = await signRequest("a sufficiently long shared secret", canonical);
    await expect(verifyRequestSignature("a sufficiently long shared secret", canonical, signature)).resolves.toBe(true);
    await expect(verifyRequestSignature("another sufficiently long secret", canonical, signature)).resolves.toBe(false);
  });

  it("classifies administrative actions", () => {
    expect(ADMIN_ACTIONS.has("member.role.add")).toBe(true);
    expect(ADMIN_ACTIONS.has("message.send")).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION, type ActionPlan, type RuntimeAction } from "@chat-runtime/protocol";
import { parseConfig } from "./config.js";
import type { ControlPlaneClient } from "./control-plane.js";
import type { PlatformAdapter } from "./platform.js";
import { actionDenial, platformError } from "./policy.js";
import { ChatRuntime } from "./runtime.js";

const baseEnv = { CHAT_RUNTIME_INSTALLATION_ID: "install", CHAT_RUNTIME_CONTROL_PLANE_URL: "https://example.com", CHAT_RUNTIME_SHARED_SECRET: "x".repeat(32) };
const action = (overrides: Partial<RuntimeAction> = {}): RuntimeAction => ({ actionId: "a1", platform: "discord", type: "message.send", conversationId: "c1", content: { text: "hello", fields: [], images: [], components: [], suppressNotifications: true }, ...overrides } as RuntimeAction);

describe("runtime configuration and policy", () => {
  it("starts with all platforms disabled and no tokens", () => {
    const config = parseConfig(baseEnv);
    expect(config.CHAT_RUNTIME_DISCORD_ENABLED).toBe(false);
    expect(config.CHAT_RUNTIME_TELEGRAM_ENABLED).toBe(false);
    expect(config.CHAT_RUNTIME_SLACK_ENABLED).toBe(false);
  });
  it("requires credentials only for enabled platforms", () => {
    expect(() => parseConfig({ ...baseEnv, CHAT_RUNTIME_DISCORD_ENABLED: "true" })).toThrow(/DISCORD_TOKEN/);
    expect(parseConfig({ ...baseEnv, CHAT_RUNTIME_DISCORD_ENABLED: "true", DISCORD_TOKEN: "token" }).CHAT_RUNTIME_DISCORD_ENABLED).toBe(true);
    expect(parseConfig({ ...baseEnv, CHAT_RUNTIME_TELEGRAM_ENABLED: "true", TELEGRAM_TOKEN: "token" }).CHAT_RUNTIME_TELEGRAM_ENABLED).toBe(true);
    expect(() => parseConfig({ ...baseEnv, CHAT_RUNTIME_SLACK_ENABLED: "true", SLACK_BOT_TOKEN: "xoxb-token" })).toThrow(/SLACK_APP_TOKEN/);
    expect(parseConfig({ ...baseEnv, CHAT_RUNTIME_SLACK_ENABLED: "true", SLACK_BOT_TOKEN: "xoxb-token", SLACK_APP_TOKEN: "xapp-token" }).CHAT_RUNTIME_SLACK_ENABLED).toBe(true);
    const combined = parseConfig({ ...baseEnv, CHAT_RUNTIME_DISCORD_ENABLED: "true", DISCORD_TOKEN: "discord", CHAT_RUNTIME_TELEGRAM_ENABLED: "true", TELEGRAM_TOKEN: "telegram", CHAT_RUNTIME_SLACK_ENABLED: "true", SLACK_BOT_TOKEN: "xoxb", SLACK_APP_TOKEN: "xapp" });
    expect([combined.CHAT_RUNTIME_DISCORD_ENABLED, combined.CHAT_RUNTIME_TELEGRAM_ENABLED, combined.CHAT_RUNTIME_SLACK_ENABLED]).toEqual([true, true, true]);
  });
  it("enforces platform, capability, and admin ceilings", () => {
    const disabled = parseConfig(baseEnv);
    expect(actionDenial(action(), disabled)?.code).toBe("platform_disabled");
    const enabled = parseConfig({ ...baseEnv, CHAT_RUNTIME_DISCORD_ENABLED: "true", DISCORD_TOKEN: "token", CHAT_RUNTIME_CAPABILITIES: "message.send" });
    expect(actionDenial(action(), enabled)).toBeUndefined();
    expect(actionDenial(action({ type: "member.role.add", guildId: "g", userId: "u", roleId: "r" } as Partial<RuntimeAction>), enabled)?.code).toBe("capability_denied");
    const adminDisabled = parseConfig({ ...baseEnv, CHAT_RUNTIME_DISCORD_ENABLED: "true", DISCORD_TOKEN: "token", CHAT_RUNTIME_CAPABILITIES: "member.role.add" });
    expect(actionDenial({ actionId: "role", platform: "discord", type: "member.role.add", guildId: "g", userId: "u", roleId: "r" }, adminDisabled)?.code).toBe("admin_mode_disabled");
    const telegram = parseConfig({ ...baseEnv, CHAT_RUNTIME_TELEGRAM_ENABLED: "true", TELEGRAM_TOKEN: "token", CHAT_RUNTIME_CAPABILITIES: "interaction.open-modal" });
    expect(actionDenial({ actionId: "modal", platform: "telegram", type: "interaction.open-modal", interactionId: "i", modal: { title: "Form", customId: "form", fields: [{ customId: "answer", label: "Answer", style: "short", required: true }] } }, telegram)?.code).toBe("platform_unsupported");
    const slack = parseConfig({ ...baseEnv, CHAT_RUNTIME_SLACK_ENABLED: "true", SLACK_BOT_TOKEN: "xoxb", SLACK_APP_TOKEN: "xapp", CHAT_RUNTIME_CAPABILITIES: "member.role.add,message.delete" });
    expect(actionDenial({ actionId: "role", platform: "slack", type: "member.role.add", guildId: "g", userId: "u", roleId: "r" }, slack)?.code).toBe("platform_unsupported");
    expect(actionDenial({ actionId: "delete", platform: "slack", type: "message.delete", conversationId: "c", messageId: "m", ownMessage: false }, slack)?.code).toBe("platform_unsupported");
  });
  it("classifies provider rate limits as retryable without retrying", () => {
    expect(platformError({ status: 429, retry_after: 2 })).toEqual({ status: "retryable", code: "platform_rate_limited", message: "[object Object]", retryAfterMs: 2000 });
    expect(platformError(new Error("permission denied")).status).toBe("failed");
  });
});

describe("action execution", () => {
  it("suppresses events attributed to the runtime identity", async () => {
    const config = parseConfig(baseEnv);
    let deliveries = 0;
    const control = { deliverEvent: async () => { deliveries += 1; return []; }, pollActions: async () => [], deliverReceipt: async () => {}, reportHealth: async () => {} } as unknown as ControlPlaneClient;
    const runtime = new ChatRuntime(config, control, []);
    await runtime.onEvent({ protocolVersion: PROTOCOL_VERSION, eventId: "self", installationId: "install", platform: "telegram", occurredAt: new Date().toISOString(), type: "message.created", metadata: {}, payload: { messageId: "m", conversationId: "c", authorId: "bot", attachments: [], isFromRuntime: true } });
    expect(deliveries).toBe(0);
  });

  it("executes once and emits receipts", async () => {
    const config = parseConfig({ ...baseEnv, CHAT_RUNTIME_DISCORD_ENABLED: "true", DISCORD_TOKEN: "token", CHAT_RUNTIME_CAPABILITIES: "message.send" });
    const execute = vi.fn(async () => ({ externalId: "m1" }));
    const adapter: PlatformAdapter = { platform: "discord", start: async () => ({ identityId: "bot" }), execute, stop: async () => {}, isReady: () => true };
    const deliverReceipt = vi.fn(async () => {});
    const control = { deliverEvent: async () => [], pollActions: async () => [], deliverReceipt, reportHealth: async () => {} } as unknown as ControlPlaneClient;
    const runtime = new ChatRuntime(config, control, [adapter]);
    const plan: ActionPlan = { protocolVersion: PROTOCOL_VERSION, planId: "p1", installationId: "install", createdAt: new Date().toISOString(), actions: [action()] };
    expect((await runtime.executePlan(plan))[0]?.status).toBe("executed");
    expect((await runtime.executePlan(plan))[0]?.status).toBe("rejected");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(deliverReceipt).toHaveBeenCalledTimes(2);
  });
});

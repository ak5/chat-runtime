import { ADMIN_ACTIONS, type RuntimeAction } from "@chat-runtime/protocol";
import type { RuntimeConfig } from "./config.js";

export function actionDenial(action: RuntimeAction, config: RuntimeConfig): { code: string; message: string } | undefined {
  const enabled = action.platform === "discord" ? config.CHAT_RUNTIME_DISCORD_ENABLED : config.CHAT_RUNTIME_TELEGRAM_ENABLED;
  if (!enabled) return { code: "platform_disabled", message: `${action.platform} is disabled` };
  if (!config.CHAT_RUNTIME_CAPABILITIES.includes(action.type)) return { code: "capability_denied", message: `${action.type} is not allowlisted` };
  if (action.platform === "telegram" && ["interaction.open-modal", "member.role.add", "member.role.remove"].includes(action.type)) return { code: "platform_unsupported", message: `${action.type} is unsupported on Telegram` };
  if (ADMIN_ACTIONS.has(action.type) && !config.CHAT_RUNTIME_ADMIN_MODE) return { code: "admin_mode_disabled", message: `${action.type} requires administrator mode` };
  if (action.type === "message.delete" && !action.ownMessage && !config.CHAT_RUNTIME_ADMIN_MODE) return { code: "admin_mode_disabled", message: "Deleting another user's message requires administrator mode" };
  return undefined;
}

export function effectiveCapabilities(platform: "discord" | "telegram", config: RuntimeConfig): string[] {
  const unsupported = platform === "telegram" ? new Set(["interaction.open-modal", "member.role.add", "member.role.remove"]) : new Set<string>();
  return config.CHAT_RUNTIME_CAPABILITIES.filter((capability) => !unsupported.has(capability) && (config.CHAT_RUNTIME_ADMIN_MODE || !ADMIN_ACTIONS.has(capability)));
}

export function platformError(error: unknown): { status: "retryable" | "failed"; code: string; message: string; retryAfterMs?: number } {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const retryAfterSeconds = typeof value.retry_after === "number" ? value.retry_after : undefined;
  const retryAfterMs = typeof value.retryAfter === "number" ? value.retryAfter : retryAfterSeconds === undefined ? undefined : retryAfterSeconds * 1000;
  const retryable = value.status === 429 || value.code === 429 || retryAfterMs !== undefined;
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
  return { status: retryable ? "retryable" : "failed", code: retryable ? "platform_rate_limited" : "platform_error", message, ...(retryAfterMs && retryAfterMs > 0 ? { retryAfterMs: Math.round(retryAfterMs) } : {}) };
}

export class IdCache {
  private readonly ids = new Set<string>();
  constructor(private readonly limit = 10_000) {}
  has(id: string): boolean { return this.ids.has(id); }
  add(id: string): void {
    this.ids.add(id);
    if (this.ids.size > this.limit) this.ids.delete(this.ids.values().next().value!);
  }
}

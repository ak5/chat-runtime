import { z } from "zod";
import { actionSchema, type RuntimeAction } from "@chat-runtime/protocol";

const boolean = z.enum(["true", "false"]).default("false").transform((value) => value === "true");
const csv = z.string().default("").transform((value) => value.split(",").map((item) => item.trim()).filter(Boolean));
const schema = z.object({
  CHAT_RUNTIME_INSTALLATION_ID: z.string().min(1),
  CHAT_RUNTIME_CONTROL_PLANE_URL: z.url(),
  CHAT_RUNTIME_SHARED_SECRET: z.string().min(32),
  CHAT_RUNTIME_ADMIN_MODE: boolean,
  CHAT_RUNTIME_DISCORD_ENABLED: boolean,
  CHAT_RUNTIME_TELEGRAM_ENABLED: boolean,
  CHAT_RUNTIME_CAPABILITIES: csv,
  CHAT_RUNTIME_ACTION_POLL_MS: z.coerce.number().int().min(250).max(60_000).default(2000),
  DISCORD_TOKEN: z.string().optional(),
  DISCORD_GUILD_IDS: csv,
  DISCORD_INTENTS: csv,
  TELEGRAM_TOKEN: z.string().optional(),
  TELEGRAM_ALLOWED_CHAT_IDS: csv,
}).superRefine((value, ctx) => {
  if (value.CHAT_RUNTIME_DISCORD_ENABLED && !value.DISCORD_TOKEN) ctx.addIssue({ code: "custom", path: ["DISCORD_TOKEN"], message: "DISCORD_TOKEN is required when Discord is enabled" });
  if (value.CHAT_RUNTIME_TELEGRAM_ENABLED && !value.TELEGRAM_TOKEN) ctx.addIssue({ code: "custom", path: ["TELEGRAM_TOKEN"], message: "TELEGRAM_TOKEN is required when Telegram is enabled" });
});

export type RuntimeConfig = z.infer<typeof schema>;
export function parseConfig(env: Record<string, string | undefined>): RuntimeConfig {
  return schema.parse(env);
}

export function actionCapability(action: RuntimeAction): string {
  return actionSchema.parse(action).type;
}

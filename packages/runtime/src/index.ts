import { parseConfig } from "./config.js";
import { ControlPlaneClient } from "./control-plane.js";
import { DiscordAdapter } from "./discord.js";
import type { PlatformAdapter } from "./platform.js";
import { ChatRuntime } from "./runtime.js";
import { TelegramAdapter } from "./telegram.js";

export * from "./config.js";
export * from "./control-plane.js";
export * from "./platform.js";
export * from "./policy.js";
export * from "./render.js";
export * from "./runtime.js";

async function main(): Promise<void> {
  const config = parseConfig(process.env);
  const adapters: PlatformAdapter[] = [];
  if (config.CHAT_RUNTIME_DISCORD_ENABLED) adapters.push(new DiscordAdapter(config));
  if (config.CHAT_RUNTIME_TELEGRAM_ENABLED) adapters.push(new TelegramAdapter(config));
  const runtime = new ChatRuntime(config, new ControlPlaneClient(config), adapters);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void runtime.stop().finally(() => process.exit(0)));
  await runtime.start();
  console.log(JSON.stringify({ level: "info", event: "chat_runtime_ready", enabledPlatforms: adapters.map((adapter) => adapter.platform), adminMode: config.CHAT_RUNTIME_ADMIN_MODE }));
}

const isEntrypoint = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isEntrypoint) void main().catch((error) => { console.error(JSON.stringify({ level: "error", event: "chat_runtime_failed", error: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; });

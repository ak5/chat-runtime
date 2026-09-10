import type { RuntimeAction, RuntimeEvent } from "@chat-runtime/protocol";

export type ExecutionResult = { externalId?: string };
export interface PlatformAdapter {
  readonly platform: "discord" | "telegram" | "slack";
  start(onEvent: (event: RuntimeEvent) => Promise<void>): Promise<{ identityId: string }>;
  execute(action: RuntimeAction): Promise<ExecutionResult>;
  stop(): Promise<void>;
  isReady(): boolean;
}

import { PROTOCOL_VERSION, actionPlanSchema, actionReceiptSchema, newProtocolId } from "@chat-runtime/protocol";
import type { ActionPlan, ActionReceipt, RuntimeAction, RuntimeEvent } from "@chat-runtime/protocol";
import type { RuntimeConfig } from "./config.js";
import type { ControlPlaneClient } from "./control-plane.js";
import type { PlatformAdapter } from "./platform.js";
import { actionDenial, effectiveCapabilities, IdCache, platformError } from "./policy.js";

export class ChatRuntime {
  private readonly executed = new IdCache();
  private timer?: ReturnType<typeof setInterval>;
  private polling = false;
  private lastHealthReport = 0;

  constructor(private readonly config: RuntimeConfig, private readonly controlPlane: ControlPlaneClient, private readonly adapters: PlatformAdapter[]) {}

  async start(): Promise<void> {
    for (const adapter of this.adapters) {
      const identity = await adapter.start((event) => this.onEvent(event));
      await this.onEvent({
        protocolVersion: PROTOCOL_VERSION, eventId: newProtocolId("evt"), installationId: this.config.CHAT_RUNTIME_INSTALLATION_ID,
        platform: adapter.platform, botIdentityId: identity.identityId, occurredAt: new Date().toISOString(), type: "runtime.ready", metadata: {},
        payload: { runtimeVersion: "0.1.0", adminMode: this.config.CHAT_RUNTIME_ADMIN_MODE, enabledPlatforms: this.adapters.map((item) => item.platform), capabilities: effectiveCapabilities(adapter.platform, this.config) },
      });
    }
    await this.reportHealth(true);
    this.timer = setInterval(() => void this.poll(), this.config.CHAT_RUNTIME_ACTION_POLL_MS);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled(this.adapters.map((adapter) => adapter.stop()));
    await this.reportHealth(true);
  }

  async onEvent(event: RuntimeEvent): Promise<void> {
    if (event.type.startsWith("message.") && "isFromRuntime" in event.payload && event.payload.isFromRuntime) return;
    const plans = await this.controlPlane.deliverEvent(event);
    for (const plan of plans) await this.executePlan(plan);
  }

  async executePlan(input: ActionPlan): Promise<ActionReceipt[]> {
    const plan = actionPlanSchema.parse(input);
    const receipts: ActionReceipt[] = [];
    for (const action of plan.actions) {
      const receipt = await this.executeAction(plan, action);
      receipts.push(receipt);
      await this.controlPlane.deliverReceipt(receipt);
    }
    return receipts;
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const plans = await this.controlPlane.pollActions(this.adapters.map((adapter) => adapter.platform));
      for (const plan of plans) await this.executePlan(plan);
      await this.reportHealth();
    } catch (error) {
      console.error(JSON.stringify({ level: "error", event: "action_poll_failed", error: error instanceof Error ? error.message : String(error) }));
    } finally { this.polling = false; }
  }

  private async executeAction(plan: ActionPlan, action: RuntimeAction): Promise<ActionReceipt> {
    const base = { protocolVersion: PROTOCOL_VERSION, receiptId: newProtocolId("receipt"), installationId: this.config.CHAT_RUNTIME_INSTALLATION_ID, planId: plan.planId, actionId: action.actionId, platform: action.platform, occurredAt: new Date().toISOString() } as const;
    const reject = (code: string, message: string): ActionReceipt => actionReceiptSchema.parse({ ...base, status: "rejected", error: { code, message } });
    if (plan.installationId !== this.config.CHAT_RUNTIME_INSTALLATION_ID) return reject("installation_mismatch", "Action plan targets another installation");
    if (plan.expiresAt && Date.parse(plan.expiresAt) < Date.now()) return reject("plan_expired", "Action plan has expired");
    if (this.executed.has(action.actionId)) return reject("duplicate_action", "Action was already executed by this runtime process");
    const denial = actionDenial(action, this.config);
    if (denial) return reject(denial.code, denial.message);
    const adapter = this.adapters.find((candidate) => candidate.platform === action.platform);
    if (!adapter) return reject("platform_disabled", `${action.platform} is disabled`);
    try {
      const result = await adapter.execute(action);
      this.executed.add(action.actionId);
      return actionReceiptSchema.parse({ ...base, status: "executed", ...result });
    } catch (error) {
      const classified = platformError(error);
      return actionReceiptSchema.parse({ ...base, status: classified.status, error: { code: classified.code, message: classified.message, ...(classified.retryAfterMs ? { retryAfterMs: classified.retryAfterMs } : {}) } });
    }
  }

  private async reportHealth(force = false): Promise<void> {
    if (!force && Date.now() - this.lastHealthReport < 60_000) return;
    await this.controlPlane.reportHealth({
      protocolVersion: PROTOCOL_VERSION, installationId: this.config.CHAT_RUNTIME_INSTALLATION_ID,
      observedAt: new Date().toISOString(), adminMode: this.config.CHAT_RUNTIME_ADMIN_MODE,
      platforms: { discord: this.adapters.find((item) => item.platform === "discord")?.isReady() ?? false, telegram: this.adapters.find((item) => item.platform === "telegram")?.isReady() ?? false, slack: this.adapters.find((item) => item.platform === "slack")?.isReady() ?? false },
      effectiveCapabilities: {
        discord: this.config.CHAT_RUNTIME_DISCORD_ENABLED ? effectiveCapabilities("discord", this.config) : [],
        telegram: this.config.CHAT_RUNTIME_TELEGRAM_ENABLED ? effectiveCapabilities("telegram", this.config) : [],
        slack: this.config.CHAT_RUNTIME_SLACK_ENABLED ? effectiveCapabilities("slack", this.config) : [],
      },
    });
    this.lastHealthReport = Date.now();
  }
}

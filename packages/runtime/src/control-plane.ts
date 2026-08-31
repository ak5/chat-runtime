import { SIGNATURE_HEADERS, actionPlanSchema, canonicalRequest, immediateResponseSchema, newProtocolId, outboxResponseSchema, signRequest, type ActionPlan, type ActionReceipt, type RuntimeEvent } from "@chat-runtime/protocol";
import type { RuntimeConfig } from "./config.js";

export class ControlPlaneClient {
  constructor(private readonly config: RuntimeConfig, private readonly fetcher: typeof fetch = fetch) {}

  async deliverEvent(event: RuntimeEvent): Promise<ActionPlan[]> {
    return immediateResponseSchema.parse(await this.request("POST", "/v1/events", event)).plans;
  }

  async pollActions(platforms: string[]): Promise<ActionPlan[]> {
    if (platforms.length === 0) return [];
    const query = new URLSearchParams({ platforms: platforms.join(",") });
    return outboxResponseSchema.parse(await this.request("GET", `/v1/actions?${query}`, undefined)).plans;
  }

  async deliverReceipt(receipt: ActionReceipt): Promise<void> {
    await this.request("POST", "/v1/receipts", receipt);
  }

  async reportHealth(body: unknown): Promise<void> {
    await this.request("POST", "/v1/health", body);
  }

  private async request(method: string, pathAndQuery: string, value: unknown): Promise<unknown> {
    const url = new URL(pathAndQuery, this.config.CHAT_RUNTIME_CONTROL_PLANE_URL);
    const body = value === undefined ? "" : JSON.stringify(value);
    const timestamp = new Date().toISOString();
    const nonce = newProtocolId("nonce");
    const signature = await signRequest(this.config.CHAT_RUNTIME_SHARED_SECRET, canonicalRequest(method, url.pathname, timestamp, nonce, body));
    const response = await this.fetcher(url, {
      method,
      headers: {
        "content-type": "application/json",
        [SIGNATURE_HEADERS.installation]: this.config.CHAT_RUNTIME_INSTALLATION_ID,
        [SIGNATURE_HEADERS.timestamp]: timestamp,
        [SIGNATURE_HEADERS.nonce]: nonce,
        [SIGNATURE_HEADERS.signature]: signature,
      },
      ...(body ? { body } : {}),
    });
    if (!response.ok) throw new Error(`Control plane ${method} ${url.pathname} returned ${response.status}`);
    if (response.status === 204) return undefined;
    return response.json();
  }
}

export function parsePlan(value: unknown): ActionPlan {
  return actionPlanSchema.parse(value);
}

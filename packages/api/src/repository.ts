import type { ActionPlan, ActionReceipt, RuntimeEvent } from "@chat-runtime/protocol";

export interface RuntimeRepository {
  claimNonce(installationId: string, nonce: string, requestTimestamp: string, expiresAt: string): Promise<boolean>;
  storeEvent(event: RuntimeEvent): Promise<boolean>;
  enqueuePlan(plan: ActionPlan, platform: "discord" | "telegram" | "slack", availableAt?: string, delivered?: boolean): Promise<void>;
  claimPlans(installationId: string, platforms: Array<"discord" | "telegram" | "slack">, leaseId: string, now: string, leaseExpiresAt: string): Promise<ActionPlan[]>;
  storeReceipt(receipt: ActionReceipt): Promise<void>;
  storeHealth(installationId: string, observedAt: string, health: unknown): Promise<void>;
  cleanup(now: string): Promise<number>;
}

export class D1RuntimeRepository implements RuntimeRepository {
  constructor(private readonly db: D1Database, private readonly retentionDays = 30) {}

  private retainUntil(now = Date.now()): string { return new Date(now + this.retentionDays * 86_400_000).toISOString(); }

  async claimNonce(installationId: string, nonce: string, requestTimestamp: string, expiresAt: string): Promise<boolean> {
    const result = await this.db.prepare("INSERT OR IGNORE INTO request_nonces (installation_id, nonce, request_timestamp, received_at, expires_at) VALUES (?, ?, ?, ?, ?)").bind(installationId, nonce, requestTimestamp, new Date().toISOString(), expiresAt).run();
    return result.meta.changes === 1;
  }

  async storeEvent(event: RuntimeEvent): Promise<boolean> {
    const now = new Date().toISOString();
    const retainUntil = this.retainUntil();
    const inserted = await this.db.prepare("INSERT OR IGNORE INTO runtime_events (event_id, installation_id, platform, event_type, occurred_at, received_at, bot_identity_id, payload_json, metadata_json, processing_status, retain_until) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'processed', ?)")
      .bind(event.eventId, event.installationId, event.platform, event.type, event.occurredAt, now, event.botIdentityId ?? null, JSON.stringify(event.payload), JSON.stringify(event.metadata), retainUntil).run();
    await this.db.prepare("INSERT INTO event_deliveries (event_id, attempted_at, result, idempotent_replay, retain_until) VALUES (?, ?, 'accepted', ?, ?)").bind(event.eventId, now, inserted.meta.changes === 0 ? 1 : 0, retainUntil).run();
    if (inserted.meta.changes === 0) return false;
    if (event.type === "message.created" || event.type === "message.updated") {
      const p = event.payload;
      await this.db.prepare(`INSERT INTO messages (platform, conversation_id, message_id, author_id, author_display_name, reply_to_message_id, thread_id, text_content, attachments_json, occurred_at, updated_at, source_event_id, retain_until)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(platform, conversation_id, message_id) DO UPDATE SET author_id=excluded.author_id, author_display_name=excluded.author_display_name, reply_to_message_id=excluded.reply_to_message_id, thread_id=excluded.thread_id, text_content=excluded.text_content, attachments_json=excluded.attachments_json, updated_at=excluded.updated_at, source_event_id=excluded.source_event_id, retain_until=excluded.retain_until, deleted_at=NULL`)
        .bind(event.platform, p.conversationId, p.messageId, p.authorId, p.authorDisplayName ?? null, p.replyToMessageId ?? null, p.threadId ?? null, p.text ?? null, JSON.stringify(p.attachments), event.occurredAt, now, event.eventId, retainUntil).run();
    } else if (event.type === "message.deleted") {
      await this.db.prepare("UPDATE messages SET deleted_at=?, updated_at=?, source_event_id=? WHERE platform=? AND conversation_id=? AND message_id=?").bind(event.occurredAt, now, event.eventId, event.platform, event.payload.conversationId, event.payload.messageId).run();
    }
    return true;
  }

  async enqueuePlan(plan: ActionPlan, platform: "discord" | "telegram" | "slack", availableAt = new Date().toISOString(), delivered = false): Promise<void> {
    await this.db.prepare("INSERT OR IGNORE INTO action_plans (plan_id, installation_id, platform, event_id, plan_json, status, available_at, expires_at, created_at, retain_until) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(plan.planId, plan.installationId, platform, plan.eventId ?? null, JSON.stringify(plan), delivered ? "delivered" : "pending", availableAt, plan.expiresAt ?? null, plan.createdAt, this.retainUntil()).run();
  }

  async claimPlans(installationId: string, platforms: Array<"discord" | "telegram" | "slack">, leaseId: string, now: string, leaseExpiresAt: string): Promise<ActionPlan[]> {
    if (platforms.length === 0) return [];
    const placeholders = platforms.map(() => "?").join(",");
    const rows = await this.db.prepare(`SELECT plan_id, plan_json FROM action_plans WHERE installation_id=? AND platform IN (${placeholders}) AND available_at<=? AND (expires_at IS NULL OR expires_at>?) AND (status='pending' OR (status='leased' AND lease_expires_at<=?)) ORDER BY created_at LIMIT 25`).bind(installationId, ...platforms, now, now, now).all<{ plan_id: string; plan_json: string }>();
    if (!rows.results.length) return [];
    const statements = rows.results.map((row) => this.db.prepare("UPDATE action_plans SET status='leased', lease_id=?, lease_expires_at=?, attempt_count=attempt_count+1 WHERE plan_id=? AND (status='pending' OR lease_expires_at<=?)").bind(leaseId, leaseExpiresAt, row.plan_id, now));
    const outcomes = await this.db.batch(statements);
    return rows.results.filter((_, index) => outcomes[index]?.meta.changes === 1).map((row) => JSON.parse(row.plan_json) as ActionPlan);
  }

  async storeReceipt(receipt: ActionReceipt): Promise<void> {
    await this.db.batch([
      this.db.prepare("INSERT OR IGNORE INTO action_receipts (receipt_id, plan_id, action_id, installation_id, platform, status, occurred_at, external_id, error_json, receipt_json, received_at, retain_until) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(receipt.receiptId, receipt.planId, receipt.actionId, receipt.installationId, receipt.platform, receipt.status, receipt.occurredAt, receipt.externalId ?? null, receipt.error ? JSON.stringify(receipt.error) : null, JSON.stringify(receipt), new Date().toISOString(), this.retainUntil()),
      this.db.prepare("UPDATE action_plans SET status=CASE WHEN NOT EXISTS (SELECT 1 FROM json_each(plan_json, '$.actions') a WHERE json_extract(a.value, '$.actionId') NOT IN (SELECT action_id FROM action_receipts WHERE plan_id=?)) THEN 'completed' ELSE status END, completed_at=CASE WHEN NOT EXISTS (SELECT 1 FROM json_each(plan_json, '$.actions') a WHERE json_extract(a.value, '$.actionId') NOT IN (SELECT action_id FROM action_receipts WHERE plan_id=?)) THEN ? ELSE completed_at END WHERE plan_id=?").bind(receipt.planId, receipt.planId, new Date().toISOString(), receipt.planId),
    ]);
  }

  async storeHealth(installationId: string, observedAt: string, health: unknown): Promise<void> {
    await this.db.prepare("INSERT INTO runtime_health (installation_id, observed_at, received_at, health_json) VALUES (?, ?, ?, ?) ON CONFLICT(installation_id) DO UPDATE SET observed_at=excluded.observed_at, received_at=excluded.received_at, health_json=excluded.health_json").bind(installationId, observedAt, new Date().toISOString(), JSON.stringify(health)).run();
  }

  async cleanup(now: string): Promise<number> {
    const results = await this.db.batch([
      this.db.prepare("DELETE FROM request_nonces WHERE expires_at < ?").bind(now),
      this.db.prepare("DELETE FROM action_receipts WHERE retain_until IS NOT NULL AND retain_until < ?").bind(now),
      this.db.prepare("DELETE FROM action_plans WHERE retain_until IS NOT NULL AND retain_until < ?").bind(now),
      this.db.prepare("DELETE FROM event_deliveries WHERE retain_until IS NOT NULL AND retain_until < ?").bind(now),
      this.db.prepare("DELETE FROM messages WHERE retain_until IS NOT NULL AND retain_until < ?").bind(now),
      this.db.prepare("DELETE FROM runtime_events WHERE retain_until IS NOT NULL AND retain_until < ?").bind(now),
    ]);
    return results.reduce((sum, result) => sum + (result.meta.changes ?? 0), 0);
  }
}

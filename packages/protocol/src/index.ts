import { z } from "zod";

export const PROTOCOL_VERSION = "1" as const;
export const platformSchema = z.enum(["discord", "telegram", "slack"]);
export type Platform = z.infer<typeof platformSchema>;

const id = z.string().min(1).max(200);
const isoDate = z.iso.datetime({ offset: true });
const jsonPrimitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type JsonValue = z.infer<typeof jsonPrimitive> | JsonValue[] | { [key: string]: JsonValue };
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([jsonPrimitive, z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
);

export const attachmentSchema = z.object({
  id,
  url: z.url(),
  filename: z.string().max(512),
  contentType: z.string().max(200).optional(),
  size: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export const messagePayloadSchema = z.object({
  messageId: id,
  conversationId: id,
  authorId: id,
  authorDisplayName: z.string().max(256).optional(),
  text: z.string().max(100_000).optional(),
  replyToMessageId: id.optional(),
  threadId: id.optional(),
  attachments: z.array(attachmentSchema).max(25).default([]),
  isFromRuntime: z.boolean().default(false),
});

const baseEvent = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  eventId: id,
  installationId: id,
  platform: platformSchema,
  occurredAt: isoDate,
  botIdentityId: id.optional(),
  metadata: z.record(z.string(), jsonValueSchema).default({}),
});

const messageEvent = (type: "message.created" | "message.updated") =>
  baseEvent.extend({ type: z.literal(type), payload: messagePayloadSchema });

export const runtimeEventSchema = z.discriminatedUnion("type", [
  baseEvent.extend({
    type: z.literal("runtime.ready"),
    payload: z.object({
      runtimeVersion: z.string(),
      adminMode: z.boolean(),
      enabledPlatforms: z.array(platformSchema),
      capabilities: z.array(z.string()),
    }),
  }),
  messageEvent("message.created"),
  messageEvent("message.updated"),
  baseEvent.extend({
    type: z.literal("message.deleted"),
    payload: z.object({ messageId: id, conversationId: id, threadId: id.optional() }),
  }),
  baseEvent.extend({
    type: z.literal("interaction.command"),
    payload: z.object({ interactionId: id, conversationId: id, userId: id, name: id, arguments: z.record(z.string(), jsonValueSchema).default({}), token: id.optional() }),
  }),
  baseEvent.extend({
    type: z.literal("interaction.component"),
    payload: z.object({ interactionId: id, conversationId: id, userId: id, customId: id, values: z.array(z.string()).default([]), token: id.optional() }),
  }),
  baseEvent.extend({
    type: z.literal("interaction.modal"),
    payload: z.object({ interactionId: id, conversationId: id, userId: id, customId: id, fields: z.record(z.string(), z.string()), token: id.optional() }),
  }),
  baseEvent.extend({
    type: z.enum(["reaction.added", "reaction.removed"]),
    payload: z.object({ messageId: id, conversationId: id, userId: id, emoji: z.string().min(1).max(100) }),
  }),
  baseEvent.extend({
    type: z.literal("member.joined"),
    payload: z.object({ guildId: id, userId: id, displayName: z.string().max(256).optional() }),
  }),
  baseEvent.extend({
    type: z.literal("member.updated"),
    payload: z.object({ guildId: id, userId: id, roleIds: z.array(id), displayName: z.string().max(256).optional() }),
  }),
]);
export type RuntimeEvent = z.infer<typeof runtimeEventSchema>;

const buttonSchema = z.object({ type: z.literal("button"), customId: id.optional(), label: z.string().min(1).max(80), url: z.url().optional(), style: z.enum(["primary", "secondary", "success", "danger", "link"]).default("secondary") }).refine((v) => Boolean(v.customId) !== Boolean(v.url), "A button needs exactly one of customId or url");
const selectSchema = z.object({ type: z.literal("select"), customId: id, placeholder: z.string().max(150).optional(), minValues: z.number().int().min(0).max(25).default(1), maxValues: z.number().int().min(1).max(25).default(1), choices: z.array(z.object({ label: z.string().min(1).max(100), value: z.string().min(1).max(100), description: z.string().max(100).optional() })).min(1).max(25) });
export const messageContentSchema = z.object({
  text: z.string().max(100_000).optional(),
  fields: z.array(z.object({ name: z.string().max(256), value: z.string().max(1024), inline: z.boolean().default(false) })).max(25).default([]),
  images: z.array(z.object({ url: z.url(), alt: z.string().max(256).optional() })).max(10).default([]),
  components: z.array(z.union([buttonSchema, selectSchema])).max(25).default([]),
  suppressNotifications: z.boolean().default(true),
}).refine((v) => Boolean(v.text) || v.fields.length > 0 || v.images.length > 0 || v.components.length > 0, "Message content cannot be empty");

const modalSchema = z.object({ title: z.string().min(1).max(45), customId: id, fields: z.array(z.object({ customId: id, label: z.string().min(1).max(45), style: z.enum(["short", "paragraph"]).default("short"), required: z.boolean().default(true), minLength: z.number().int().nonnegative().optional(), maxLength: z.number().int().positive().optional(), placeholder: z.string().max(100).optional() })).min(1).max(5) });
const baseAction = z.object({ actionId: id, platform: platformSchema });
export const actionSchema = z.discriminatedUnion("type", [
  baseAction.extend({ type: z.literal("interaction.acknowledge"), interactionId: id, token: id.optional(), ephemeral: z.boolean().default(false), content: messageContentSchema.optional() }),
  baseAction.extend({ type: z.literal("interaction.defer"), interactionId: id, token: id.optional(), ephemeral: z.boolean().default(false) }),
  baseAction.extend({ type: z.literal("interaction.open-modal"), interactionId: id, token: id.optional(), modal: modalSchema }),
  baseAction.extend({ type: z.literal("message.send"), conversationId: id, content: messageContentSchema }),
  baseAction.extend({ type: z.literal("message.reply"), conversationId: id, messageId: id, content: messageContentSchema }),
  baseAction.extend({ type: z.literal("message.edit"), conversationId: id, messageId: id, content: messageContentSchema }),
  baseAction.extend({ type: z.literal("message.delete"), conversationId: id, messageId: id, ownMessage: z.boolean().default(true) }),
  baseAction.extend({ type: z.enum(["reaction.add", "reaction.remove"]), conversationId: id, messageId: id, emoji: z.string().min(1).max(100) }),
  baseAction.extend({ type: z.enum(["member.role.add", "member.role.remove"]), guildId: id, userId: id, roleId: id }),
]);
export type RuntimeAction = z.infer<typeof actionSchema>;

export const actionPlanSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  planId: id,
  installationId: id,
  eventId: id.optional(),
  createdAt: isoDate,
  expiresAt: isoDate.optional(),
  actions: z.array(actionSchema).max(100),
});
export type ActionPlan = z.infer<typeof actionPlanSchema>;

export const actionReceiptSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  receiptId: id,
  installationId: id,
  planId: id,
  actionId: id,
  platform: platformSchema,
  status: z.enum(["executed", "rejected", "retryable", "failed"]),
  occurredAt: isoDate,
  externalId: id.optional(),
  error: z.object({ code: id, message: z.string().max(1000), retryAfterMs: z.number().int().positive().optional() }).optional(),
});
export type ActionReceipt = z.infer<typeof actionReceiptSchema>;

export const runtimeCapabilitiesSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  installationId: id,
  adminMode: z.boolean(),
  platforms: z.object({ discord: z.boolean(), telegram: z.boolean(), slack: z.boolean() }),
  actions: z.array(z.string()),
});
export type RuntimeCapabilities = z.infer<typeof runtimeCapabilitiesSchema>;

export const installationConfigurationSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  installationId: id,
  capabilities: z.array(z.string()),
  adminMode: z.boolean(),
});
export type InstallationConfiguration = z.infer<typeof installationConfigurationSchema>;

export const protocolErrorSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  error: z.object({ code: id, message: z.string().max(1000), retryable: z.boolean().default(false) }),
});
export type ProtocolError = z.infer<typeof protocolErrorSchema>;

export const immediateResponseSchema = z.object({ plans: z.array(actionPlanSchema).default([]) });
export const outboxResponseSchema = z.object({ plans: z.array(actionPlanSchema).default([]), leaseId: id.optional() });

export const ADMIN_ACTIONS = new Set<string>(["member.role.add", "member.role.remove"]);

export function newProtocolId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export const SIGNATURE_HEADERS = {
  installation: "x-chat-runtime-installation",
  timestamp: "x-chat-runtime-timestamp",
  nonce: "x-chat-runtime-nonce",
  signature: "x-chat-runtime-signature",
} as const;

export function canonicalRequest(method: string, pathname: string, timestamp: string, nonce: string, body: string): string {
  return [method.toUpperCase(), pathname, timestamp, nonce, body].join("\n");
}

async function hmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usages);
}

export async function signRequest(secret: string, canonical: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret, ["sign"]), new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyRequestSignature(secret: string, canonical: string, signature: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const bytes = new Uint8Array(signature.match(/.{2}/g)!.map((value) => Number.parseInt(value, 16)));
  return crypto.subtle.verify("HMAC", await hmacKey(secret, ["verify"]), bytes, new TextEncoder().encode(canonical));
}

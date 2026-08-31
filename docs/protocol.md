# Protocol v1

All envelopes carry `protocolVersion: "1"`, an installation ID, stable IDs, ISO timestamps, and a platform. The schemas in `@chat-runtime/protocol` are authoritative.

## Events

Supported events are `runtime.ready`, message create/update/delete, command/component/modal interactions, reaction add/remove, and member join/update. Message events normalize conversation, author, reply, thread, text, and attachment metadata. Self-authored events are suppressed.

Events are delivered at least once. The control plane records duplicate deliveries but processes a stable event ID once.

## Actions

Supported actions acknowledge/defer/open Discord interactions; send/reply/edit/delete messages; add/remove reactions; and add/remove Discord roles. Every action is schema-validated and must be included in the runtime capability allowlist. Administrative mode is an additional ceiling for role changes and deleting messages not authored by the runtime.

Portable message content supports text, fields, image URLs, buttons, and select choices. Discord receives native components and embeds. Telegram renders text, fields, image links, and buttons; commands and button callbacks become interaction events, while selects and modals fail explicitly.

## Receipts

Each action produces `executed`, `rejected`, `retryable`, or `failed`. Rejections describe policy or routing failures; failures contain bounded platform error summaries. Successful receipts can contain the platform message ID.

## Authentication

Requests include installation, timestamp, nonce, and HMAC-SHA256 signature headers. The canonical string is method, path, timestamp, nonce, and exact body joined by newlines. Query parameters are not signed; endpoints validate their values independently. Requests outside the five-minute clock window or with a used nonce fail.

# Security

## Capability ceilings

An action executes only when its platform is enabled, its action type is allowlisted, its schema is valid, the plan targets this installation, and platform credentials permit it. Role changes and deletion of another user's message additionally require `CHAT_RUNTIME_ADMIN_MODE=true`. Administrator mode never grants Discord or Telegram permissions.

## Secrets

Use a random `CHAT_RUNTIME_SHARED_SECRET` of at least 32 characters. Runtime tokens and the shared secret belong in an uncommitted `.env` or container secret. The Worker secret is configured with Wrangler:

```sh
pnpm --filter @chat-runtime/hono-control-plane exec wrangler secret put CHAT_RUNTIME_SHARED_SECRET
```

Do not put tokens in URLs, compose files, Wrangler variables, logs, D1, metadata, or committed examples. Logs contain stable event names and bounded error messages only.

## Replay and retention

D1 atomically claims signed-request nonces. Messages, events, delivery attempts, plans, and receipts default to 30 days through `CHAT_RUNTIME_RETENTION_DAYS`; accepted values are 1–3650 days. Expired nonces and rows whose `retain_until` has elapsed are removed through the authenticated cleanup endpoint. Adopters must choose retention appropriate to their content, privacy obligations, and incident-response needs before production use.

Attachment binaries are not copied into D1. External URLs can still be sensitive and should receive the same retention review as message text.

Report vulnerabilities according to [SECURITY.md](../SECURITY.md).

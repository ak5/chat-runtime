# Architecture

## Boundary

The Docker runtime is an outbound-only transport executor. It maintains at most one Discord bot through the Gateway and at most one Telegram bot through continuous `getUpdates` long polling. Either can be disabled. The runtime normalizes events, signs requests, enforces capabilities, renders portable content, executes actions, and returns receipts.

The Hono Cloudflare Worker is the example control plane. It authenticates the runtime, persists state in D1, applies consumer policy, returns immediate plans, and leases deferred plans. Product-specific commands, authorization, moderation, models, and storage integrations belong here or in another consumer control plane.

```text
Discord Gateway ─┐                         ┌─ immediate action plan
                 ├─ Node/Docker runtime ──┤
Telegram polling ┘       signed HTTPS      └─ Hono Worker ─ D1 outbox/state
```

The container needs outbound HTTPS only. The Worker has no route into the container; the runtime polls its action outbox.

## Lifecycle

`CHAT_RUNTIME_DISCORD_ENABLED` and `CHAT_RUNTIME_TELEGRAM_ENABLED` default to false. Enabled platforms require their token and start independently in one process. A platform failure is reported without exposing credentials. Enablement changes take effect on process restart.

## Storage

D1 owns normalized messages, events, delivery attempts, action plans and leases, receipts, request nonces, and latest health. Stable protocol and platform IDs make writes idempotent. Attachment metadata and external URLs are stored, but binaries and credentials are not.

A lease prevents concurrent workers from claiming an action plan. It does not create impossible exactly-once semantics: a platform can accept an action immediately before the runtime loses the receipt. Non-idempotent operations are not blindly retried after this ambiguous window.

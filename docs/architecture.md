# Architecture

## Boundary

The Docker runtime is an outbound-only transport executor. It maintains at most one bot connection for each enabled platform: Discord through the Gateway, Telegram through continuous `getUpdates` long polling, and Slack through Socket Mode. Each can be disabled. The runtime normalizes events, signs requests, enforces capabilities, renders portable content, executes actions, and returns receipts.

The Hono Cloudflare Worker is the API and control plane. It authenticates the runtime, persists state in D1, applies policy, returns immediate plans, and leases deferred plans. Product-specific commands, authorization, moderation, models, and additional storage integrations belong in API extensions or a replacement consumer control plane.

```text
Discord Gateway ─┐
Telegram polling ├─ Node/Docker runtime ── signed HTTPS ── Hono Worker ─ D1 outbox/state
Slack Socket Mode┘
```

The container needs outbound HTTPS only. The Worker has no route into the container; the runtime polls its action outbox.

## Lifecycle

The Discord, Telegram, and Slack enablement variables default to false. Enabled platforms require their credentials and start independently in one process. Slack uses a bot token and an app-level Socket Mode token. A platform failure is reported without exposing credentials. Enablement changes take effect on process restart.

## Storage

D1 owns normalized messages, events, delivery attempts, action plans and leases, receipts, request nonces, and latest health. Stable protocol and platform IDs make writes idempotent. Attachment metadata and external URLs are stored, but binaries and credentials are not.

A lease prevents concurrent workers from claiming an action plan. It does not create impossible exactly-once semantics: a platform can accept an action immediately before the runtime loses the receipt. Non-idempotent operations are not blindly retried after this ambiguous window.

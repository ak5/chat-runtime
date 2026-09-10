# Chat Runtime

Chat Runtime is a project-agnostic transport layer for Discord, Telegram, and Slack bots. It connects each platform to a shared control plane through a small, versioned protocol, so application behavior can be written once instead of being embedded in three separate bot implementations.

The included control plane runs as a Cloudflare Worker and uses D1 for durable operational state. The platform runtime runs in Docker, makes outbound connections only, and executes explicitly allowlisted actions returned by the control plane.

> [!IMPORTANT]
> This repository is an early-stage foundation. Its included commands demonstrate the protocol and delivery flow; they are not a finished bot product.

## Why this exists

Bot projects often mix platform SDK code, business rules, credentials, storage, and AI integrations in one process. That makes additional platforms difficult to support and gives product code unnecessary access to bot tokens.

Chat Runtime separates those responsibilities:

- The runtime owns platform connections, event normalization, capability enforcement, and action execution.
- The control plane owns application behavior, authorization, moderation rules, prompts, model calls, and product data.
- A shared protocol keeps behavior portable across supported platforms.
- D1 records events, normalized messages, action plans, leases, receipts, nonces, and runtime health.

## Architecture

```text
Discord Gateway ─┐
Telegram polling ├─▶ Node.js runtime ── signed HTTPS ──▶ Cloudflare Worker ──▶ D1
Slack Socket Mode┘          ▲                                  │
                            └──────── action plans ─────────────┘
```

The runtime never accepts inbound network connections. Discord Gateway, Telegram long polling, Slack Socket Mode, and control-plane requests are all initiated from the runtime.

An incoming platform event is normalized and signed before it is sent to the Worker. The control plane can return an immediate action plan or place one in the D1 outbox. The runtime validates and executes each action, then sends a receipt back to the Worker.

## Features

- Discord, Telegram, and Slack adapters in one Node.js process.
- Independently enabled platform connections.
- Shared Zod schemas for protocol-v1 events, actions, plans, and receipts.
- HMAC-SHA256 request authentication with timestamps and replay-resistant nonces.
- Immediate responses and a leased D1 action outbox for deferred work.
- Capability allowlists and an additional administrator-mode ceiling.
- Normalized message, interaction, reaction, and membership events.
- Portable text, fields, images, buttons, selects, and modal content where supported.
- Durable delivery state, receipts, health reports, and configurable retention.
- Project-agnostic Docker image with no application policy or model provider embedded in it.

## Supported actions

| Action | Discord | Telegram | Slack |
| --- | :---: | :---: | :---: |
| Send, reply, edit, and delete own messages | ✓ | ✓ | ✓ |
| Add and remove reactions | ✓ | ✓ | ✓ |
| Acknowledge or defer interactions | ✓ | ✓ | ✓ |
| Buttons | ✓ | ✓ | ✓ |
| Select controls | ✓ | — | ✓ |
| Open modals | ✓ | — | ✓ |
| Add and remove member roles | ✓ | — | — |

Platform enablement, configured capabilities, administrator mode, and protocol schema validation are all checked before an action executes.

## Repository layout

```text
packages/
  protocol/   Shared schemas, types, identifiers, and request signing
  runtime/    Discord, Telegram, and Slack adapters and action executor
  api/        Cloudflare Worker control plane and D1 migrations
docs/         Architecture, protocol, security, development, and publishing guides
```

## Requirements

- Node.js 22 or later
- pnpm 10
- A Cloudflare account when deploying the included Worker and D1 database
- Docker when building the runtime image
- Credentials for each platform you enable

## Local development

Install dependencies and create a local environment file:

```sh
pnpm install
cp .env.example .env
```

Replace the installation ID and shared secret in `.env`. The shared secret must contain at least 32 characters and must match the secret configured for the Worker.

Apply D1 migrations locally:

```sh
pnpm --filter @chat-runtime/api exec wrangler d1 migrations apply DB --local
```

Start the Worker and runtime in separate terminals:

```sh
pnpm dev:api
```

```sh
pnpm dev:runtime
```

All platforms are disabled by default. Enable only the adapters you intend to use:

| Platform | Enablement | Required credentials |
| --- | --- | --- |
| Discord | `CHAT_RUNTIME_DISCORD_ENABLED=true` | `DISCORD_TOKEN` |
| Telegram | `CHAT_RUNTIME_TELEGRAM_ENABLED=true` | `TELEGRAM_TOKEN` |
| Slack | `CHAT_RUNTIME_SLACK_ENABLED=true` | `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN` |

Optional Discord guild, Telegram chat, and Slack channel allowlists are documented in [.env.example](.env.example).

### Slack setup

The Slack adapter uses Socket Mode, so it does not need a public request URL.

1. Create a Slack app and enable Socket Mode.
2. Generate an app-level token with `connections:write` and use it as `SLACK_APP_TOKEN`.
3. Install the app to the workspace and use its bot token as `SLACK_BOT_TOKEN`.
4. Grant only the scopes required by your enabled capabilities. The full adapter uses `chat:write`, `reactions:read`, `reactions:write`, `files:read`, `commands`, and the applicable conversation-history scopes.
5. Subscribe to the required message events plus `reaction_added` and `reaction_removed`.
6. Configure any slash commands that your control plane handles.

See [Publishing and deployment](docs/publishing.md) for complete deployment notes.

## Adding behavior

Application behavior belongs in the control plane, not in a platform adapter. The included Worker contains small examples for ping responses, buttons, modals, deferred messages, and deletion policy.

The basic flow is:

```text
normalized event → application policy → action plan → validated execution → receipt
```

For a small experiment, extend `immediatePlans()` in `packages/api/src/app.ts`. For a real product, replace the reference behavior with your own control-plane modules or implement a separate control plane against the schemas in `@chat-runtime/protocol`.

An action plan can contain multiple ordered actions and can be returned immediately or queued for polling. Product authorization must happen before a plan is issued; the runtime's capability checks are a final execution boundary, not a replacement for application authorization.

## Example behaviors

The reference control plane currently demonstrates:

- `ping` — acknowledge with `pong`.
- `button` — return a portable interactive button.
- `form` — open a Discord or Slack modal.
- `deferred` — enqueue a message in the D1 action outbox.
- Component and modal submission acknowledgements.

These examples are intentionally small and should be replaced or extended by consumers.

## Verification

Run the complete code verification suite:

```sh
pnpm verify
```

Build the production runtime image:

```sh
pnpm image:build
```

Code changes must pass `pnpm verify`. Runtime, dependency, workspace, and Docker changes must also pass `pnpm image:build`.

## Security model

- Bot credentials stay in the runtime environment and are never sent to the control plane.
- Secrets must not be stored in Git, URLs, logs, metadata, Compose files, Wrangler variables, or D1.
- Runtime/control-plane requests are signed and protected against replay.
- Every action must pass platform enablement, capability, administrator-mode, and schema checks.
- The runtime exposes no unrestricted platform proxy or shell execution surface.
- Product authorization and policy remain the responsibility of the consuming control plane.

Read [Security](docs/security.md) before deploying the runtime.

## Documentation

- [Architecture](docs/architecture.md)
- [Protocol](docs/protocol.md)
- [Security](docs/security.md)
- [Development](docs/development.md)
- [Publishing and deployment](docs/publishing.md)

## Contributing

Issues and pull requests are welcome. Keep the runtime generic, use the shared protocol schemas instead of adapter-specific copies, and place product-specific behavior in consumer control planes. See [Development](docs/development.md) for repository conventions and verification commands.

## License

Apache-2.0. See [LICENSE](LICENSE).

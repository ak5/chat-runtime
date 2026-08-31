# Generic Discord and Telegram Bot Runtime Plan

## Project profile

Build a maintained, public, project-agnostic runtime image with a reusable protocol and a small Hono control-plane example that can run locally or as a Cloudflare Worker.

Initial local path: `~/Projects/generic-discord-tg-bot`

Technical baseline:

- TypeScript
- Node.js 22
- pnpm workspace
- Apache-2.0 license
- No references to existing consumer projects

## Repository policy

- `main` is the only long-lived branch.
- Contributors create short-lived feature branches.
- Pull requests target `main` directly.
- Do not create a `dev` or staging branch.
- Once hosted, protect `main` and require pull requests.
- Do not create a GitHub repository, remote, push, or image publication during the initial local scaffold.

## Repository shape

```text
generic-discord-tg-bot/
├── packages/
│   ├── protocol/
│   └── runtime/
├── examples/
│   └── hono-control-plane/
│       ├── migrations/
│       ├── src/
│       ├── package.json
│       ├── tsconfig.json
│       └── wrangler.jsonc
├── docs/
│   ├── index.md
│   ├── architecture.md
│   ├── protocol.md
│   ├── security.md
│   ├── development.md
│   └── publishing.md
├── .github/
│   ├── workflows/ci.yml
│   ├── ISSUE_TEMPLATE/
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── CODEOWNERS
│   └── dependabot.yml
├── AGENTS.md
├── CLAUDE.md
├── CONTRIBUTING.md
├── SECURITY.md
├── CODE_OF_CONDUCT.md
├── LICENSE
├── README.md
├── Dockerfile
├── compose.example.yaml
├── .env.example
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.json
├── eslint.config.js
├── mise.toml
└── .gitignore
```

## Runtime boundary

The image is a project-agnostic transport runtime. It knows how to:

- Maintain one optional Discord Gateway connection.
- Receive updates for one optional Telegram bot through long polling.
- Normalize platform events into versioned protocol envelopes.
- Authenticate requests to a configured control plane.
- Acknowledge or defer time-sensitive Discord interactions.
- Validate action plans against strict schemas.
- Enforce installation capabilities and platform limits.
- Execute an allowlisted set of Discord and Telegram actions.
- Deduplicate events and actions.
- Respect platform rate limits.
- Return structured execution receipts.
- Refuse unsupported protocol versions.
- Ignore events emitted by its own platform identity.

## Platform enablement

A single Node.js process in the Docker image supports at most one Discord bot and one Telegram bot. Each platform is independently optional and configuration-driven at startup.

Supported configurations are:

- Neither bot enabled, for configuration and control-plane health verification.
- Discord only.
- Telegram only.
- Discord and Telegram together.

When a platform is disabled, the runtime does not require its token, connect to it, consume its events, poll actions for it, or execute actions addressed to it. An action addressed to a disabled platform is rejected with a structured receipt. Enabling or disabling a platform requires a process restart; live runtime reconfiguration is outside v1 scope.

Every event, action, receipt, structured log, and health record identifies its platform. The runtime also records the platform-provided bot identity after a successful connection so the control plane can audit which Discord or Telegram bot produced an event.

The image contains no:

- Product or community terminology.
- Project-specific channel or role names.
- Business authorization rules.
- Moderation policy.
- Model providers, prompts, or tools.
- Database clients.
- Arbitrary Discord or Telegram API proxy.
- Project-specific commands or workflows.

## Administrator mode

The runtime has an explicit environment setting:

```text
CHAT_RUNTIME_ADMIN_MODE=false
```

The default is `false`.

When disabled, the runtime rejects administrative action families even when the control plane requests them.

Admin-gated actions include:

- Delete another user's message.
- Add or remove member roles.
- Timeout, kick, or ban a member.
- Change channel permissions.
- Create, update, or delete channels.
- Manage registered commands when supported.

Ordinary actions remain subject to the installation capability allowlist and can include:

- Send and reply.
- Edit the runtime's own messages.
- Delete the runtime's own messages.
- Add or remove reactions.
- Render buttons and selects.
- Open modals.
- Acknowledge and defer interactions.

Administrator mode is a capability ceiling, not a way to grant platform privileges. An administrative action executes only when all conditions hold:

```text
Environment permits the administrative action
        AND
Platform credentials possess the required permission
        AND
Installation capability allowlist permits the action
        AND
The authenticated action plan is valid
```

Health output reports the mode and effective capabilities without exposing credentials.

## Protocol v1

`packages/protocol` defines Zod schemas and TypeScript types for:

- `RuntimeEvent`
- `ActionPlan`
- `ActionReceipt`
- `RuntimeCapabilities`
- `InstallationConfiguration`
- `ProtocolError`

Initial event types:

- `runtime.ready`
- `message.created`
- `message.updated`
- `message.deleted`
- `interaction.command`
- `interaction.component`
- `interaction.modal`
- `reaction.added`
- `reaction.removed`
- `member.joined`
- `member.updated`

Initial action types:

- `interaction.acknowledge`
- `interaction.defer`
- `interaction.open-modal`
- `message.send`
- `message.reply`
- `message.edit`
- `message.delete`
- `reaction.add`
- `reaction.remove`
- `member.role.add`
- `member.role.remove`

Portable UI primitives:

- Text
- Fields
- Images
- Buttons
- Select choices
- Modal fields

Platform renderers reject unsupported shapes or apply documented deterministic degradation. The protocol does not silently grant additional capabilities.

## Delivery model

Support immediate and deferred work.

```text
Immediate:
event → control plane → action plan → execute → receipt

Deferred:
event → control plane → acknowledge or defer
runtime polls control-plane action outbox
action plan → execute → receipt
```

The runtime remains outbound-only. A consumer does not need network access to the container.

Delivery semantics:

- Events are delivered at least once.
- Events and actions have stable IDs.
- Control planes treat duplicate events idempotently.
- The runtime does not blindly retry non-idempotent actions.
- Receipts distinguish `executed`, `rejected`, `retryable`, and `failed`.
- Protocol or capability incompatibility fails safely.
- Requests and responses use authenticated integrity checks, timestamps, nonces, and replay protection.

## Hono control-plane example

`examples/hono-control-plane` demonstrates:

- Authenticating runtime requests.
- Validating event envelopes.
- Returning no actions for ordinary observations.
- Replying to a simple command.
- Rendering a button.
- Handling the resulting component event.
- Opening and processing a modal.
- Applying deterministic moderation.
- Returning deferred actions through an outbox endpoint.
- Receiving execution receipts.
- Accepting or rejecting an administrative action according to runtime mode.
- Persisting normalized platform messages, event delivery state, deferred actions, execution receipts, nonces, and replay-protection records in Cloudflare D1.

The example does not include a user system, model integration, or automatic production deployment.

The example is a Cloudflare Worker-compatible Hono application. It must:

- Run locally with Wrangler.
- Build and type-check as part of the pnpm workspace.
- Export the standard Worker `fetch` handler.
- Avoid Node-only APIs so the same application code remains portable across Cloudflare Workers and other standards-based runtimes.
- Include a checked-in `wrangler.jsonc` with explicit placeholders instead of real account or deployment values.
- Include checked-in, forward-only D1 migrations and a typed repository layer used by every route.
- Keep secrets out of `wrangler.jsonc`; local secrets belong in an ignored `.dev.vars` file and deployed secrets are configured with Wrangler or the Cloudflare dashboard.
- Remain deployable by an adopter after replacing the placeholders, but do not deploy during the initial scaffold.

The checked-in Wrangler configuration uses visibly non-production placeholders such as:

```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "replace-with-control-plane-worker-name",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-31",
  "account_id": "replace-with-cloudflare-account-id",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "replace-with-d1-database-name",
      "database_id": "replace-with-d1-database-id",
      "migrations_dir": "migrations"
    }
  ],
  "vars": {
    "CHAT_RUNTIME_INSTALLATION_ID": "replace-with-installation-id",
    "CHAT_RUNTIME_RETENTION_DAYS": "30"
  }
}
```

Document optional custom-domain and route configuration as commented examples or publishing instructions using placeholders such as:

```text
https://replace-with-control-plane-host.example.com
replace-with-control-plane-host.example.com/*
```

The shared secret is never a plain-text Wrangler variable. Document these setup commands with placeholder values:

```sh
pnpm --filter @chat-runtime/hono-control-plane exec wrangler secret put CHAT_RUNTIME_SHARED_SECRET
pnpm --filter @chat-runtime/hono-control-plane exec wrangler deploy
```

Deployment remains an explicit adopter action. CI builds and tests the Worker but does not deploy it.

## D1 storage

The Hono control plane uses D1 as its canonical runtime store. It persists:

- Normalized Discord and Telegram messages, including platform message, conversation, author, reply, and thread identifiers; timestamps; text; attachment metadata; and the raw normalized event payload needed for audit and replay.
- All received runtime events and their processing status.
- Event delivery attempts and idempotency results.
- Deferred action plans and claim, lease, retry, expiry, and completion state.
- Execution receipts and platform error summaries.
- Request nonces and timestamps used for replay protection.
- Runtime and platform health observations.

Credentials, shared secrets, and full attachment binaries never go into D1. Message rows store attachment metadata and external references only. The schema defines explicit retention and cleanup fields, with a configurable 30-day example default, so adopters can choose how long message bodies, raw event payloads, receipts, and replay records remain available.

All writes are idempotent around stable protocol IDs and platform message IDs. Deferred action polling uses D1-backed leases to prevent concurrent claims. The protocol documents the unavoidable platform-success/receipt-failure window and does not automatically retry a non-idempotent action unless the platform operation has a safe idempotency mechanism. The example includes local D1 migrations, seed-free smoke fixtures, repository tests, and cleanup procedures.

## Configuration

Use neutral environment variables such as:

```text
CHAT_RUNTIME_INSTALLATION_ID
CHAT_RUNTIME_CONTROL_PLANE_URL
CHAT_RUNTIME_SHARED_SECRET
CHAT_RUNTIME_ADMIN_MODE
CHAT_RUNTIME_DISCORD_ENABLED
CHAT_RUNTIME_TELEGRAM_ENABLED

DISCORD_TOKEN
DISCORD_GUILD_IDS
DISCORD_INTENTS

TELEGRAM_TOKEN
TELEGRAM_ALLOWED_CHAT_IDS
```

The two enablement settings default to `false`. Tokens and platform-specific settings are required only when their platform is enabled. The capability allowlist remains part of the installation configuration exchanged with the control plane rather than introducing per-bot configuration in v1.

The Hono Worker example receives `CHAT_RUNTIME_INSTALLATION_ID` as a non-secret binding and `CHAT_RUNTIME_SHARED_SECRET` as a Cloudflare secret. Its public URL becomes the runtime's `CHAT_RUNTIME_CONTROL_PLANE_URL`.

Document the final names in `.env.example`. Never place secrets in compose files, logs, URLs, metadata, or committed examples.

## Verification

Root commands:

```sh
pnpm check
pnpm lint
pnpm test
pnpm build
pnpm example:smoke
pnpm image:build
pnpm verify
```

Test coverage includes:

- Schema compatibility.
- Unknown-action rejection.
- Capability denial.
- Administrative mode enforcement.
- Startup with neither platform enabled.
- Discord-only, Telegram-only, and combined operation.
- Per-platform enablement, isolation, routing, and health reporting.
- Rejection of actions for disabled platforms.
- Credential requirements for enabled versus disabled platforms.
- D1 message and event persistence.
- D1-backed idempotency, replay protection, action leases, retries, and receipts.
- Self-message suppression.
- Event and action deduplication.
- Signature, timestamp, nonce, and replay validation.
- Discord and Telegram rendering limits.
- Immediate and deferred action paths.
- Receipt behavior.
- Hono example integration.
- Cloudflare Worker configuration validation and local Wrangler smoke coverage.

CI verifies the repository and builds the Docker image without publishing it.

## Repository capabilities

Include:

- README and indexed documentation.
- Protocol and architecture documentation.
- Security and contribution policies.
- Byte-identical `AGENTS.md` and `CLAUDE.md` contracts.
- A thin Copilot instruction adapter.
- Pull request and issue templates.
- CI and dependency automation.
- A root-ignored `/tmp/` scratch workspace convention.

Defer until justified:

- GitHub repository creation and configuration.
- Container registry ownership.
- Package and image publication.
- Automated releases.
- Deployment targets.
- Consumer migrations.
- ADRs until architectural decisions begin accumulating.
- Teaching and Vibe Session workflows.

## Initial local scaffold operation

After explicit approval to scaffold:

1. Create the listed files and working packages.
2. Install and lock dependencies.
3. Run applicable verification.
4. Initialize local Git with `main` as the only long-lived branch.
5. Inspect the complete initial diff and ignored files for secrets.
6. Create one local initial commit.

Do not create a GitHub repository, add a remote, push code, publish packages, or publish an image without separate explicit approval.

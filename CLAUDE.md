# Agent instructions

Read `docs/index.md`, `docs/architecture.md`, and the nearest package source and tests before editing.

This is a pnpm TypeScript monorepo targeting Node.js 22 and Cloudflare Workers. Use shared protocol schemas instead of adapter-specific copies. Keep the Docker runtime project-agnostic: product policy, authorization, models, prompts, and database access belong in consumer control planes.

Preserve these invariants:

- The runtime is outbound-only and supports at most one optional Discord bot and one optional Telegram bot.
- All runtime/control-plane traffic uses protocol v1 schemas and signed requests.
- Every action passes platform enablement, capability, administrator-mode, and schema checks.
- D1 is canonical for messages, events, delivery state, action leases, receipts, nonces, and health.
- Secrets never enter Git, URLs, logs, metadata, compose files, Wrangler variables, or D1.
- Do not add compatibility aliases, tombstones, or product-specific terminology.

Run `pnpm verify` for code changes. Run `pnpm image:build` for runtime, workspace, dependency, or Docker changes. Add forward-only migrations for D1 changes.

`main` is the only long-lived branch. Do not create remotes, push, publish, or deploy unless the owner explicitly requests it.

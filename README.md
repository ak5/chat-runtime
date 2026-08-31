# Chat Runtime

A project-agnostic Discord and Telegram transport runtime. A Node.js process maintains one optional Discord Gateway connection and one optional Telegram long-polling bot, converts platform activity into a versioned protocol, and asks an authenticated control plane what to do. The included Hono control plane runs on Cloudflare Workers and persists operational state in D1.

The runtime deliberately contains no product policy, database client, model provider, prompts, or unrestricted platform proxy. Consumers own authorization and behavior in their control plane; the runtime validates and executes only allowlisted protocol actions.

## Workspace

- `packages/protocol` — Zod schemas, types, IDs, and HMAC request signing.
- `packages/runtime` — Discord and Telegram adapters, policy enforcement, delivery, receipts, and lifecycle.
- `examples/hono-control-plane` — Cloudflare Worker, D1 migrations, authenticated routes, and example actions.
- `docs` — architecture, protocol, security, development, and publishing guidance.

## Start locally

Requirements: Node.js 22, pnpm 10, and Docker for image verification.

```sh
pnpm install
cp .env.example .env
pnpm --filter @chat-runtime/hono-control-plane exec wrangler d1 migrations apply DB --local
pnpm dev:control-plane
pnpm dev:runtime
```

Set `CHAT_RUNTIME_DISCORD_ENABLED=true` or `CHAT_RUNTIME_TELEGRAM_ENABLED=true` and provide the corresponding token only when that platform should connect. Both default to false.

```sh
pnpm verify
pnpm image:build
```

Read [the documentation index](docs/index.md) before adopting or deploying the runtime.

## License

Apache-2.0. See [LICENSE](LICENSE).

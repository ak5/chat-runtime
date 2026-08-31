# Development

## Setup

Install Node.js 22 and pnpm 10, then run `pnpm install`. Copy `.env.example` to the ignored `.env` and replace the shared-secret placeholder. Both platform bots remain disabled unless explicitly enabled.

Initialize local D1 and run the Worker:

```sh
pnpm --filter @chat-runtime/hono-control-plane exec wrangler d1 migrations apply DB --local
pnpm dev:control-plane
```

Run the transport in another terminal with environment variables loaded:

```sh
pnpm dev:runtime
```

Wrangler stores local D1 state under `.wrangler`, which is ignored.

## Verification

```sh
pnpm check
pnpm lint
pnpm test
pnpm build
pnpm example:smoke
pnpm image:build
pnpm verify
```

Protocol changes require schema compatibility tests. Runtime changes require policy and adapter tests. D1 changes require a forward-only migration and repository coverage. Never edit an applied migration; add the next numbered file.

Scratch files belong in ignored `tmp/`. Generated `dist` and Wrangler state are not committed.

# Publishing and deployment

No publication or deployment is automatic. Replace placeholders and review security and retention before adopting the example.

## Cloudflare Worker

In `packages/api/wrangler.jsonc`, replace the Worker name, Cloudflare account ID, D1 database name, D1 database ID, and installation ID. A custom domain can be configured with a route such as `replace-with-control-plane-host.example.com/*`. The resulting `https://replace-with-control-plane-host.example.com` is `CHAT_RUNTIME_CONTROL_PLANE_URL`.

```sh
pnpm --filter @chat-runtime/api exec wrangler d1 migrations apply DB --remote
pnpm --filter @chat-runtime/api exec wrangler secret put CHAT_RUNTIME_SHARED_SECRET
pnpm --filter @chat-runtime/api exec wrangler deploy
```

## Container

Build locally with `pnpm image:build`. Supply environment variables through the deployment platform, not image layers or command-line URLs. The compose example demonstrates variable names without embedding values.

Package registries, container registries, release automation, and deployment targets are intentionally unconfigured. Adopters choose ownership before publishing.

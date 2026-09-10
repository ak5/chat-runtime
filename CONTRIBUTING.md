# Contributing

Create a short-lived branch from `main` and open a pull request back to `main`. Keep changes focused and update documentation when behavior, protocol, configuration, storage, or operations change.

A pull request is a proposal until a maintainer accepts it. Submit merge-ready changes: complete the implementation, tests, documentation, and migration work that the change requires. Maintainers may ask contributors to revise, split, or replace incomplete changes, but they will not silently rewrite a contributor-owned branch. Material maintainer rewrites require fresh verification and review, and the resulting commit or pull request must preserve appropriate author or co-author attribution.

Before submitting:

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm image:build
```

Protocol changes need compatibility coverage. D1 changes use new forward-only migrations. Never commit tokens, shared secrets, local Worker state, message exports, or `.env` files.

By participating, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Security reports follow [SECURITY.md](SECURITY.md), not public issues.

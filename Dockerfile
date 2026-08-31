FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/runtime/package.json packages/runtime/package.json
COPY packages/api/package.json packages/api/package.json
RUN pnpm install --frozen-lockfile
COPY packages ./packages
RUN pnpm --filter @chat-runtime/runtime... build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY --from=build /workspace/package.json /workspace/pnpm-lock.yaml /workspace/pnpm-workspace.yaml ./
COPY --from=build /workspace/packages/protocol/package.json packages/protocol/package.json
COPY --from=build /workspace/packages/protocol/dist packages/protocol/dist
COPY --from=build /workspace/packages/runtime/package.json packages/runtime/package.json
COPY --from=build /workspace/packages/runtime/dist packages/runtime/dist
RUN pnpm install --prod --frozen-lockfile
USER node
CMD ["node", "packages/runtime/dist/index.js"]

import type { RuntimeRepository } from "./repository.js";

export type Bindings = { DB: D1Database; CHAT_RUNTIME_INSTALLATION_ID: string; CHAT_RUNTIME_SHARED_SECRET: string; CHAT_RUNTIME_RETENTION_DAYS?: string };
export type Variables = { repository: RuntimeRepository; rawBody: string };

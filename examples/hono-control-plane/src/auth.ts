import { SIGNATURE_HEADERS, canonicalRequest, verifyRequestSignature } from "@chat-runtime/protocol";
import type { MiddlewareHandler } from "hono";
import type { Bindings, Variables } from "./types.js";

const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const NONCE_TTL_MS = 10 * 60_000;

export function authenticateRuntime(): MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> {
  return async (c, next) => {
    const installation = c.req.header(SIGNATURE_HEADERS.installation) ?? "";
    const timestamp = c.req.header(SIGNATURE_HEADERS.timestamp) ?? "";
    const nonce = c.req.header(SIGNATURE_HEADERS.nonce) ?? "";
    const signature = c.req.header(SIGNATURE_HEADERS.signature) ?? "";
    if (!installation || installation !== c.env.CHAT_RUNTIME_INSTALLATION_ID) return c.json({ error: "invalid_installation" }, 401);
    const parsedTime = Date.parse(timestamp);
    if (!Number.isFinite(parsedTime) || Math.abs(Date.now() - parsedTime) > MAX_CLOCK_SKEW_MS) return c.json({ error: "stale_request" }, 401);
    if (!nonce || nonce.length > 200) return c.json({ error: "invalid_nonce" }, 401);
    const body = c.req.method === "GET" ? "" : await c.req.text();
    const valid = await verifyRequestSignature(c.env.CHAT_RUNTIME_SHARED_SECRET, canonicalRequest(c.req.method, new URL(c.req.url).pathname, timestamp, nonce, body), signature);
    if (!valid) return c.json({ error: "invalid_signature" }, 401);
    const claimed = await c.get("repository").claimNonce(installation, nonce, timestamp, new Date(Date.now() + NONCE_TTL_MS).toISOString());
    if (!claimed) return c.json({ error: "replayed_request" }, 409);
    c.set("rawBody", body);
    await next();
  };
}

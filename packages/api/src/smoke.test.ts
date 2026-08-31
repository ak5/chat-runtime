import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";

it("ships the complete D1 migration", async () => {
  const sql = await readFile(new URL("../migrations/0001_runtime.sql", import.meta.url), "utf8");
  for (const table of ["runtime_events", "messages", "event_deliveries", "action_plans", "action_receipts", "request_nonces", "runtime_health"]) expect(sql).toContain(`CREATE TABLE ${table}`);
});

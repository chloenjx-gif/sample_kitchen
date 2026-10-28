import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { db } from "../src/lib/db";

async function main() {
  const password = readFileSync(".env", "utf8").match(/^IMPORT_ADMIN_PASSWORD=(.*)$/m)?.[1]?.trim();
  if (!password) throw new Error("The private import password is missing.");
  const before = await db.agentRun.count();
  const origin = "http://127.0.0.1:3000";
  assert.equal((await fetch(`${origin}/api/agents`)).status, 401);
  assert.equal((await fetch(`${origin}/api/agents`, { method: "POST" })).status, 401);
  const login = await fetch(`${origin}/api/import-auth`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("No import session was issued.");
  const response = await fetch(`${origin}/api/agents`, { headers: { cookie } });
  assert.equal(response.status, 200);
  const data = await response.json() as { status?: string; model?: string; keyConfigured?: boolean; verified?: { eligibleOrders?: number; totalUnits?: number } };
  assert.equal(data.status, "ready");
  assert.equal(data.model, "gpt-6-luna");
  assert.equal(data.verified?.eligibleOrders, 15);
  assert.equal(data.verified?.totalUnits, 5280);
  assert.equal(await db.agentRun.count(), before, "reading the agent panel created a model run");
  console.log("PASS: agent GET showed the saved numeric plan without creating a run; unsigned GET/POST were denied.");
  console.log(`INFO: server-side OpenAI key ${data.keyConfigured ? "is configured" : "is not configured"}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Agent read check failed.");
  process.exitCode = 1;
}).finally(async () => db.$disconnect());

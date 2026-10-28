import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { db } from "../src/lib/db";
import { loadVerifiedPlan } from "../src/lib/planning/load";
import { validateManpower, validatePurchasing, validateSales } from "../src/lib/agents/validate";
import type { Handoff } from "../src/lib/agents/schema";

async function main() {
  const snapshot = await loadVerifiedPlan();
  assert.equal(snapshot.status, "ready");
  if (snapshot.status !== "ready") return;
  const run = await db.agentRun.findFirst({
    where: { importVersion: snapshot.importVersion, status: "completed" },
    orderBy: { finishedAt: "desc" }, include: { recommendations: true },
  });
  assert.ok(run, "No completed OpenAI run was saved for the current imports.");
  assert.equal(run.model, "gpt-6-luna");
  assert.equal(run.recommendations.length, 3);
  const results = new Map(run.recommendations.map((item) => [item.agent, item.result]));
  assert.deepEqual([...results.keys()].sort(), ["manpower", "purchasing", "sales"]);
  validateSales(results.get("sales"), snapshot.plan);
  validateManpower(results.get("manpower"), snapshot.plan);
  validatePurchasing(results.get("purchasing"), snapshot.plan, snapshot.supporting.supplier.default_draft_to);
  const trace = run.handoffTrace as unknown as Handoff[];
  assert.deepEqual(trace.map((step) => [step.from, step.to]), [
    ["verified_plan", "sales"], ["sales", "manpower"], ["sales", "purchasing"],
  ]);
  assert.ok(trace.every((step) => step.importVersion === snapshot.importVersion));
  assert.equal(snapshot.plan.eligibleOrders.length, 15);
  assert.equal(snapshot.plan.excludedOrders.length, 1);
  assert.equal(snapshot.plan.totalUnits, 5280);

  const password = readFileSync(".env", "utf8").match(/^IMPORT_ADMIN_PASSWORD=(.*)$/m)?.[1]?.trim();
  if (!password) throw new Error("The private import password is missing.");
  const origin = "http://127.0.0.1:3000";
  const login = await fetch(`${origin}/api/import-auth`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("No import session was issued.");
  const response = await fetch(`${origin}/api/agents`, { headers: { cookie, "cache-control": "no-cache" } });
  assert.equal(response.status, 200);
  const body = await response.json() as { latestRun?: { id?: string; recommendations?: Record<string, unknown> } };
  assert.equal(body.latestRun?.id, run.id);
  assert.deepEqual(Object.keys(body.latestRun?.recommendations ?? {}).sort(), ["manpower", "purchasing", "sales"]);
  console.log("PASS: a real gpt-6-luna run saved three validated recommendations and the Sales-to-Manpower/Purchasing handoff trace.");
  console.log("PASS: a fresh authenticated app request returned that run; verified numeric plan still has 15 eligible, 1 excluded, 5,280 units.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Saved-agent check failed.");
  process.exitCode = 1;
}).finally(async () => db.$disconnect());

import assert from "node:assert/strict";
import { db } from "../src/lib/db";
import { runPlanningAgents } from "../src/lib/agents/run";
import type { ModelCaller, ModelRequest } from "../src/lib/agents/openai";
import { AgentOutputError } from "../src/lib/agents/validate";
import { loadVerifiedPlan } from "../src/lib/planning/load";

async function main() {
  const snapshot = await loadVerifiedPlan();
  assert.equal(snapshot.status, "ready");
  if (snapshot.status !== "ready") return;
  const originalPlan = JSON.stringify(snapshot.plan);
  const called: string[] = [];
  const fake: ModelCaller = async (request: ModelRequest) => {
    called.push(request.agent);
    const facts = request.facts as Record<string, unknown>;
    assert.equal(facts.importVersion, snapshot.importVersion);
    if (request.agent !== "sales") {
      const sales = facts.salesResult as { lateOrderIds?: string[] } | undefined;
      assert.deepEqual(sales?.lateOrderIds, ["ORD-016"], `${request.agent} did not receive the Sales handoff`);
    }
    if (request.agent === "sales") return {
      summary: "One late order needs manager review.", lateOrderIds: ["ORD-016"],
      lateOrderExplanation: "ORD-016 arrived after the noon cutoff and is outside the baseline.",
      actions: [{ date: "2026-11-06", finding: "Late order", humanAction: "Manager decides whether to accept it." }],
    };
    if (request.agent === "manpower") return {
      summary: "Tuesday has an uncovered gap.",
      gaps: [{ date: "2026-11-03", uncoveredHours: 2, shiftsToRequest: 1, requestText: "Ask for one four-hour part-time shift; nobody is booked." }],
      actions: [{ date: "2026-11-03", finding: "Two hours uncovered", humanAction: "Request cover and review roster." }],
    };
    return {
      summary: "Three ingredients need whole packs.",
      requests: snapshot.plan.stockRequests.filter((item) => item.packsToRequest > 0).map((item) => ({
        ingredientId: item.ingredientId, shortage: item.shortage, unit: item.unit,
        packsToRequest: item.packsToRequest, packName: item.packName, explanation: "Review this shortage.",
      })),
      supplierDraft: { to: snapshot.supporting.supplier.default_draft_to, subject: "Draft stock request", body: "Please review these requested packs. This is an unsent draft." },
      actions: [{ date: "2026-10-28", finding: "Stock shortage", humanAction: "Review the supplier draft before any email action." }],
    };
  };
  const result = await runPlanningAgents(snapshot, fake);
  assert.deepEqual(called, ["sales", "manpower", "purchasing"]);
  assert.deepEqual(result.handoffTrace.map((step) => [step.from, step.to]), [
    ["verified_plan", "sales"], ["sales", "manpower"], ["sales", "purchasing"],
  ]);
  assert.equal(result.results.manpower.gaps[0].uncoveredHours, 2);
  assert.equal(result.results.purchasing.requests.length, 3);
  assert.equal(JSON.stringify(snapshot.plan), originalPlan, "the verified plan was changed by an agent");
  const tampered: ModelCaller = async (request) => {
    const value = await fake(request);
    if (request.agent !== "purchasing") return value;
    const output = value as { requests: Array<{ packsToRequest: number }> };
    output.requests[0].packsToRequest += 1;
    return output;
  };
  await assert.rejects(runPlanningAgents(snapshot, tampered), AgentOutputError);
  console.log("PASS: Sales ran first; its checked result reached Manpower and Purchasing; three handoffs were recorded.");
  console.log("PASS: verified plan was unchanged, and a fabricated pack count was rejected.");
  console.log("Mock check only: no OpenAI call was made and no recommendation was saved.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Agent handoff check failed.");
  process.exitCode = 1;
}).finally(async () => db.$disconnect());

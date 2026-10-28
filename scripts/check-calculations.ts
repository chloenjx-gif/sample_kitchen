import assert from "node:assert/strict";
import { db } from "../src/lib/db";
import { calculatePlan, type PlanningInput } from "../src/lib/planning/calculate";
import { loadVerifiedPlan } from "../src/lib/planning/load";

async function main() {
  const loaded = await loadVerifiedPlan();
  assert.equal(loaded.status, "ready", "all five saved imports and three references are required");
  if (loaded.status !== "ready") return;
  const { plan } = loaded;
  assert.equal(plan.eligibleOrders.length, 15);
  assert.deepEqual(plan.excludedOrders.map((order) => [order.id, order.reason]), [["ORD-016", "after_cutoff"]]);
  assert.deepEqual(plan.dailyProduction.map((day) => day.totalUnits), [530, 1600, 1000, 700, 1450]);
  assert.deepEqual(plan.dailyProduction.map((day) => day.labourHours), [10.6, 32, 20, 14, 29]);
  assert.equal(plan.totalUnits, 5280);
  assert.equal(plan.totalLabourHours, 105.6);
  const request = Object.fromEntries(plan.stockRequests.map((item) => [item.ingredientId, item]));
  assert.deepEqual([request.BREAD.demand, request.BREAD.usableStock, request.BREAD.shortage, request.BREAD.packsToRequest], [10560, 10160, 400, 20]);
  assert.deepEqual([request.CHEESE.demand, request.CHEESE.shortage, request.CHEESE.packsToRequest], [55500, 1000, 2]);
  assert.deepEqual([request.EGG.demand, request.EGG.shortage, request.EGG.packsToRequest], [82500, 0, 0]);
  assert.deepEqual([request.CHICKEN.demand, request.CHICKEN.shortage, request.CHICKEN.packsToRequest], [106800, 1800, 2]);
  const tuesday = plan.roster.find((day) => day.date === "2026-11-03")!;
  const friday = plan.roster.find((day) => day.date === "2026-11-06")!;
  assert.equal(tuesday.requiredHours, 32);
  assert.equal(tuesday.assignedHours, 30);
  assert.equal(tuesday.uncoveredHours, 2);
  assert.equal(tuesday.additionalPartTimeShiftsToRequest, 1);
  assert.equal(tuesday.assignments.some((shift) => shift.staffId === "S04"), false, "Daniel is on approved leave Tuesday");
  assert.equal(friday.assignments.some((shift) => shift.staffId === "S02"), false, "Mei Lin is on approved leave Friday");
  assert.equal(plan.roster.every((day) => day.supervisorCovered), true);
  for (const day of plan.roster) assert.equal(new Set(day.assignments.map((shift) => shift.staffId)).size, day.assignments.length, "one shift per person per day");
  console.log("Saved plan: 15 eligible, 1 late; daily units 530/1600/1000/700/1450; total labour 105.6 hours.");
  console.log("Stock requests: bread 20 loaves, cheese 2 packs, egg 0, chicken 2 packs.");
  console.log("Roster: Tuesday gap 2 hours, request 1 additional part-time shift; approved leave excluded; supervisor present daily.");

  const scenario = (await db.referenceData.findUniqueOrThrow({ where: { key: "scenario" } })).value as unknown as PlanningInput["scenario"];
  const recipes = (await db.referenceData.findUniqueOrThrow({ where: { key: "products_and_recipes" } })).value as unknown as PlanningInput["recipes"];
  const boundaryInput: PlanningInput = {
    scenario, recipes,
    orders: [
      { id: "AT-CUTOFF", productionDate: "2026-11-02", customer: "Boundary test", productId: "CHEESE", quantity: 1, status: "Confirmed", receivedAt: "2026-10-28T12:00:00+08:00" },
      { id: "AFTER-CUTOFF", productionDate: "2026-11-02", customer: "Boundary test", productId: "CHEESE", quantity: 1, status: "Confirmed", receivedAt: "2026-10-28T12:00:01+08:00" },
    ],
    staff: [{ id: "LEAD", name: "Test Lead", role: "Kitchen lead", employmentType: "Permanent", skills: ["production", "supervisor"] }],
    leave: [{ id: "PENDING", staffId: "LEAD", date: "2026-11-02", status: "Pending", reason: "Manager review" }],
    availability: [],
    stock: [
      { ingredientId: "BREAD", name: "Bread", unit: "slice", onHand: 0, committed: 0, packSize: 20, packName: "loaf", checkedAt: "2026-10-28T00:00:00Z" },
      { ingredientId: "CHEESE", name: "Cheese", unit: "g", onHand: 0, committed: 0, packSize: 500, packName: "pack", checkedAt: "2026-10-28T00:00:00Z" },
      { ingredientId: "EGG", name: "Egg", unit: "g", onHand: 0, committed: 0, packSize: 1000, packName: "pack", checkedAt: "2026-10-28T00:00:00Z" },
      { ingredientId: "CHICKEN", name: "Chicken", unit: "g", onHand: 0, committed: 0, packSize: 1000, packName: "pack", checkedAt: "2026-10-28T00:00:00Z" },
    ],
  };
  const boundary = calculatePlan(boundaryInput);
  assert.deepEqual(boundary.eligibleOrders.map((order) => order.id), ["AT-CUTOFF"]);
  assert.deepEqual(boundary.excludedOrders.map((order) => order.id), ["AFTER-CUTOFF"]);
  assert.equal(boundary.roster[0].supervisorCovered, true, "pending leave must not remove the lead");
  assert.equal(boundary.roster[0].pendingLeaveAlerts.length, 1);
  console.log("Boundary: noon order included, one second later excluded; pending leave alerts without removing staff.");
  console.log("PASS: deterministic calculations match the supplied rules and saved Postgres imports.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Calculation check failed.");
  process.exitCode = 1;
}).finally(async () => db.$disconnect());

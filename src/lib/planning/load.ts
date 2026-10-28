import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { calculatePlan, type Recipes, type Scenario, type PlanningInput } from "./calculate";

const kinds = ["stock", "staff", "leave", "availability", "crm"] as const;

export async function loadVerifiedPlan() {
  return db.$transaction(async (tx) => {
    const [references, batches, orders, staff, leave, availability, stock] = await Promise.all([
      tx.referenceData.findMany(), tx.importBatch.findMany({ orderBy: { importedAt: "desc" } }),
      tx.orderLine.findMany(), tx.staffMember.findMany(), tx.leaveRecord.findMany(),
      tx.availabilityRecord.findMany(), tx.inventoryItem.findMany(),
    ]);
    const latest = new Map<string, typeof batches[number]>();
    for (const batch of batches) if (!latest.has(batch.kind)) latest.set(batch.kind, batch);
    const missingImports = kinds.filter((kind) => !latest.has(kind));
    const referenceByKey = new Map(references.map((item) => [item.key, item.value]));
    const missingReferences = ["scenario", "products_and_recipes", "supplier"].filter((key) => !referenceByKey.has(key));
    if (missingImports.length || missingReferences.length) {
      return { status: "missing" as const, missingImports, missingReferences };
    }
    const scenario = referenceByKey.get("scenario") as unknown as Scenario;
    const recipes = referenceByKey.get("products_and_recipes") as unknown as Recipes;
    if (!scenario?.settings || !scenario.week_start || !scenario.week_end || !Array.isArray(recipes?.products) || !Array.isArray(recipes?.recipes)) {
      throw new Error("Saved planning reference data is invalid.");
    }
    const input: PlanningInput = {
      scenario, recipes,
      orders: orders.map((item) => ({ ...item, productionDate: item.productionDate.toISOString().slice(0, 10), receivedAt: item.receivedAt.toISOString() })),
      staff: staff.map((item) => ({ id: item.id, name: item.name, employmentType: item.employmentType, role: item.role, skills: item.skills })),
      leave: leave.map((item) => ({ id: item.id, staffId: item.staffId, date: item.date.toISOString().slice(0, 10), status: item.status, reason: item.reason })),
      availability: availability.map((item) => ({ staffId: item.staffId, date: item.date.toISOString().slice(0, 10), start: item.start, end: item.end, status: item.status })),
      stock: stock.map((item) => ({ ingredientId: item.ingredientId, name: item.name, unit: item.unit, onHand: item.onHand, committed: item.committed, packSize: item.packSize, packName: item.packName, checkedAt: item.checkedAt.toISOString() })),
    };
    const sources = kinds.map((kind) => {
      const batch = latest.get(kind)!;
      return { kind, exportId: batch.exportId, source: batch.source, rowCount: batch.rowCount, importedAt: batch.importedAt.toISOString() };
    });
    const importVersion = createHash("sha256").update(JSON.stringify({
      batches: kinds.map((kind) => latest.get(kind)!.id),
      references: ["scenario", "products_and_recipes", "supplier"].map((key) => referenceByKey.get(key)),
    })).digest("hex");
    const supplier = referenceByKey.get("supplier") as unknown as { supplier_id: string; display_name: string; default_draft_to: string; classroom_placeholder: boolean };
    if (!supplier?.default_draft_to || !supplier?.display_name) throw new Error("Saved supplier reference data is invalid.");
    return { status: "ready" as const, importVersion, sources, plan: calculatePlan(input),
      supporting: { staff: input.staff, leave: input.leave, availability: input.availability, supplier,
        scenarioSettings: input.scenario.settings } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

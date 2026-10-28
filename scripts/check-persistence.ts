import { db } from "../src/lib/db";

async function main() {
  const expected = [
    ["stock", 4, () => db.inventoryItem.count()],
    ["staff", 7, () => db.staffMember.count()],
    ["leave", 2, () => db.leaveRecord.count()],
    ["availability", 6, () => db.availabilityRecord.count()],
    ["crm", 16, () => db.orderLine.count()],
  ] as const;
  const [referenceCount, batches] = await Promise.all([
    db.referenceData.count(),
    db.importBatch.findMany({ where: { kind: { in: expected.map(([kind]) => kind) } }, orderBy: { importedAt: "desc" } }),
  ]);
  const latest = new Map<string, typeof batches[number]>();
  for (const batch of batches) if (!latest.has(batch.kind)) latest.set(batch.kind, batch);
  const failures: string[] = [];
  if (referenceCount !== 3) failures.push(`Expected 3 seeded reference datasets; found ${referenceCount}.`);

  for (const [kind, expectedRows, countRows] of expected) {
    const batch = latest.get(kind);
    const actualRows = await countRows();
    const batchCount = batches.filter((candidate) => candidate.kind === kind).length;
    if (!batch) failures.push(`No saved ${kind} import batch found.`);
    else if (batch.rowCount !== expectedRows || actualRows !== expectedRows) failures.push(`${kind}: expected ${expectedRows} saved rows, batch records ${batch.rowCount}, table records ${actualRows}.`);
    if (batchCount !== 1) failures.push(`${kind}: expected one import batch for the classroom fixture, found ${batchCount}.`);
    if (batch && batch.rowCount === actualRows && batchCount === 1) console.log(`${kind}: ${actualRows} records persisted in one import batch`);
  }

  if (failures.length) throw new Error(failures.join(" "));
  console.log("reference data: 3 datasets seeded");
  console.log("PASS: saved database row counts match the five classroom imports.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Persistence check failed.");
  process.exitCode = 1;
}).finally(async () => db.$disconnect());


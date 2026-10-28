import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { IMPORT_SESSION_COOKIE, isImportSessionValid } from "@/lib/import-auth";
import { ImportValidationError, type ImportKind } from "@/lib/imports/types";
import { validateImport } from "@/lib/imports/validate";

export const runtime = "nodejs";
const kinds = new Set<ImportKind>(["stock", "staff", "leave", "availability", "crm"]);
const maxBytes = 2 * 1024 * 1024;

export async function POST(request: NextRequest, context: { params: Promise<{ kind: string }> }) {
  if (!isImportSessionValid(request.cookies.get(IMPORT_SESSION_COOKIE)?.value)) return NextResponse.json({ error: "Sign in before importing files." }, { status: 401 });
  const { kind: rawKind } = await context.params;
  if (!kinds.has(rawKind as ImportKind)) return NextResponse.json({ error: "Unknown import type." }, { status: 404 });
  const kind = rawKind as ImportKind;
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to import." }, { status: 400 });
  if (file.size === 0 || file.size > maxBytes) return NextResponse.json({ error: "The file must be between 1 byte and 2 MB." }, { status: 400 });
  const expected = kind === "crm" ? ".csv" : ".json";
  if (!file.name.toLowerCase().endsWith(expected)) return NextResponse.json({ error: `Choose a ${expected} file for this import.` }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  try {
    const input = kind === "crm" ? bytes.toString("utf8") : JSON.parse(bytes.toString("utf8"));
    const validation = validateImport(kind, input);
    if (kind === "leave" || kind === "availability") {
      const knownStaff = new Set((await db.staffMember.findMany({ select: { id: true } })).map((staff) => staff.id));
      const unknown = (validation.rows as Array<{ staffId: string }>).map((row) => row.staffId).filter((staffId) => !knownStaff.has(staffId));
      if (unknown.length) throw new ImportValidationError([`Unknown staff ID${unknown.length === 1 ? "" : "s"}: ${[...new Set(unknown)].join(", ")}. Import the staff master first.`]);
    }

    const oldBatch = await db.importBatch.findUnique({ where: { kind_contentHash: { kind, contentHash } } });
    if (oldBatch) return NextResponse.json({ ok: true, duplicate: true, message: "This exact file was already imported; saved records were left unchanged.", batch: oldBatch });
    if (validation.exportId) {
      const sameExportId = await db.importBatch.findUnique({ where: { kind_exportId: { kind, exportId: validation.exportId } } });
      if (sameExportId) return NextResponse.json({ error: `Export ID ${validation.exportId} already exists with different file contents. The saved import was left unchanged.` }, { status: 409 });
    }

    const batch = await db.$transaction(async (tx) => {
      const created = await tx.importBatch.create({ data: { kind, source: validation.sourceSystem, exportId: validation.exportId, contentHash, rowCount: validation.rows.length, details: validation.details as Prisma.InputJsonValue } });
      switch (kind) {
        case "stock": {
          await tx.inventoryItem.deleteMany();
          await tx.inventoryItem.createMany({ data: (validation.rows as Array<{ ingredientId: string; name: string; unit: string; onHand: number; committed: number; packSize: number; packName: string; checkedAt: string }>).map((row) => ({ ingredientId: row.ingredientId, name: row.name, unit: row.unit, onHand: row.onHand, committed: row.committed, packSize: row.packSize, packName: row.packName, checkedAt: new Date(row.checkedAt), importId: created.id })) });
          break;
        }
        case "staff": {
          await tx.staffMember.deleteMany();
          await tx.staffMember.createMany({ data: (validation.rows as Array<{ id: string; name: string; employmentType: string; role: string; skills: string[] }>).map((row) => ({ ...row, importId: created.id })) });
          break;
        }
        case "leave": {
          await tx.leaveRecord.deleteMany();
          await tx.leaveRecord.createMany({ data: (validation.rows as Array<{ id: string; staffId: string; date: string; status: string; reason: string | null }>).map((row) => ({ ...row, date: new Date(`${row.date}T00:00:00.000Z`), importId: created.id })) });
          break;
        }
        case "availability": {
          await tx.availabilityRecord.deleteMany();
          await tx.availabilityRecord.createMany({ data: (validation.rows as Array<{ staffId: string; date: string; start: string; end: string; status: string }>).map((row) => ({ id: randomUUID(), ...row, date: new Date(`${row.date}T00:00:00.000Z`), importId: created.id })) });
          break;
        }
        case "crm": {
          await tx.orderLine.deleteMany();
          await tx.orderLine.createMany({ data: (validation.rows as Array<{ id: string; productionDate: string; customer: string; productId: string; quantity: number; status: string; receivedAt: string }>).map((row) => ({ ...row, productionDate: new Date(`${row.productionDate}T00:00:00.000Z`), receivedAt: new Date(row.receivedAt), importId: created.id })) });
          break;
        }
      }
      return created;
    });

    return NextResponse.json({ ok: true, duplicate: false, message: `${validation.rows.length} records imported successfully.`, batch });
  } catch (error) {
    if (error instanceof ImportValidationError) return NextResponse.json({ error: error.message, issues: error.issues }, { status: 422 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "The JSON file could not be parsed." }, { status: 422 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "That export has already been imported. Saved data was left unchanged." }, { status: 409 });
    return NextResponse.json({ error: "Import could not be saved. Check the database connection and try again." }, { status: 503 });
  }
}


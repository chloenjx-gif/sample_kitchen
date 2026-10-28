import recipes from "../../../reference-data/products_and_recipes.json";
import { parseCsv } from "./csv";
import { ImportValidationError, type ImportKind, type ImportValidation } from "./types";

type StockRow = { ingredientId: string; name: string; unit: string; onHand: number; committed: number; packSize: number; packName: string; checkedAt: string };
type StaffRow = { id: string; name: string; employmentType: string; role: string; skills: string[] };
type LeaveRow = { id: string; staffId: string; date: string; status: string; reason: string | null };
type AvailabilityRow = { staffId: string; date: string; start: string; end: string; status: string };
type OrderRow = { id: string; productionDate: string; customer: string; productId: string; quantity: number; status: string; receivedAt: string };

const CRM_HEADERS = ["export_id", "exported_at", "export_status", "id", "production_date", "customer", "product_id", "quantity", "status", "received_at"];

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ImportValidationError([`${label} must be an object.`]);
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new ImportValidationError([`${label} must be a non-empty string.`]);
  return value.trim();
}

function validDate(value: unknown, label: string): string {
  const date = nonEmptyString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00.000Z`)) || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) {
    throw new ImportValidationError([`${label} must be a real date in YYYY-MM-DD format.`]);
  }
  return date;
}

function timestamp(value: unknown, label: string): string {
  const text = nonEmptyString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new ImportValidationError([`${label} must be a valid ISO timestamp with a time zone.`]);
  }
  validDate(text.slice(0, 10), label);
  return text;
}

function amount(value: unknown, label: string, positive = false): number {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(number) || number < 0 || (positive && number <= 0)) {
    throw new ImportValidationError([`${label} must be ${positive ? "greater than zero" : "zero or greater"}.`]);
  }
  return number;
}

function unique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new ImportValidationError([`${label} must not contain duplicates.`]);
}

function consistent(values: string[], label: string) {
  if (new Set(values).size !== 1) throw new ImportValidationError([`${label} must be consistent across all rows.`]);
}

function hrEnvelope(data: unknown, label: string) {
  const envelope = object(data, label);
  const sourceSystem = nonEmptyString(envelope.source_system, `${label}.source_system`);
  const exportId = nonEmptyString(envelope.export_id, `${label}.export_id`);
  const exportedAt = timestamp(envelope.exported_at, `${label}.exported_at`);
  const effectiveMonth = nonEmptyString(envelope.effective_month, `${label}.effective_month`);
  if (!/^\d{4}-\d{2}$/.test(effectiveMonth)) throw new ImportValidationError([`${label}.effective_month must use YYYY-MM format.`]);
  if (!Array.isArray(envelope.records) || envelope.records.length === 0) throw new ImportValidationError([`${label}.records must contain at least one record.`]);
  return { sourceSystem, exportId, details: { sourceSystem, exportedAt, effectiveMonth } as Record<string, unknown>, records: envelope.records };
}

function validateStock(data: unknown): ImportValidation<StockRow> {
  if (!Array.isArray(data) || data.length === 0) throw new ImportValidationError(["Stock count must be a non-empty array."]);
  const rows = data.map((value, index) => {
    const row = object(value, `Stock row ${index + 1}`);
    return {
      ingredientId: nonEmptyString(row.ingredient_id, `Stock row ${index + 1} ingredient_id`),
      name: nonEmptyString(row.name, `Stock row ${index + 1} name`),
      unit: nonEmptyString(row.unit, `Stock row ${index + 1} unit`),
      onHand: amount(row.on_hand, `Stock row ${index + 1} on_hand`),
      committed: amount(row.committed, `Stock row ${index + 1} committed`),
      packSize: amount(row.pack_size, `Stock row ${index + 1} pack_size`, true),
      packName: nonEmptyString(row.pack_name, `Stock row ${index + 1} pack_name`),
      checkedAt: timestamp(row.checked_at, `Stock row ${index + 1} checked_at`),
    };
  });
  unique(rows.map((row) => row.ingredientId), "Stock ingredient IDs");
  consistent(rows.map((row) => row.checkedAt), "Stock checked_at values");
  return { rows, exportId: null, sourceSystem: "Stock count", details: { checkedAt: rows[0].checkedAt } };
}

function validateStaff(data: unknown): ImportValidation<StaffRow> {
  const envelope = hrEnvelope(data, "HR staff export");
  const rows = envelope.records.map((value: unknown, index: number) => {
    const row = object(value, `Staff row ${index + 1}`);
    const employmentType = nonEmptyString(row.employment_type, `Staff row ${index + 1} employment_type`);
    if (!["Permanent", "Part-time"].includes(employmentType)) throw new ImportValidationError([`Staff row ${index + 1} has an unsupported employment_type.`]);
    if (!Array.isArray(row.skills) || row.skills.some((skill) => typeof skill !== "string" || skill.trim() === "")) throw new ImportValidationError([`Staff row ${index + 1} skills must be an array of names.`]);
    return { id: nonEmptyString(row.id, `Staff row ${index + 1} id`), name: nonEmptyString(row.name, `Staff row ${index + 1} name`), employmentType, role: nonEmptyString(row.role, `Staff row ${index + 1} role`), skills: row.skills.map((skill: string) => skill.trim()) };
  });
  unique(rows.map((row) => row.id), "HR staff IDs");
  return { rows, exportId: envelope.exportId, sourceSystem: envelope.sourceSystem, details: envelope.details };
}

function validateLeave(data: unknown): ImportValidation<LeaveRow> {
  const envelope = hrEnvelope(data, "HR leave export");
  const rows = envelope.records.map((value: unknown, index: number) => {
    const row = object(value, `Leave row ${index + 1}`);
    const status = nonEmptyString(row.status, `Leave row ${index + 1} status`);
    if (!["Approved", "Pending", "Declined"].includes(status)) throw new ImportValidationError([`Leave row ${index + 1} status must be Approved, Pending or Declined.`]);
    return { id: nonEmptyString(row.id, `Leave row ${index + 1} id`), staffId: nonEmptyString(row.staff_id, `Leave row ${index + 1} staff_id`), date: validDate(row.date, `Leave row ${index + 1} date`), status, reason: typeof row.reason === "string" ? row.reason : null };
  });
  unique(rows.map((row) => row.id), "HR leave IDs");
  return { rows, exportId: envelope.exportId, sourceSystem: envelope.sourceSystem, details: envelope.details };
}

function validateAvailability(data: unknown): ImportValidation<AvailabilityRow> {
  const envelope = hrEnvelope(data, "HR availability export");
  const rows = envelope.records.map((value: unknown, index: number) => {
    const row = object(value, `Availability row ${index + 1}`);
    const start = nonEmptyString(row.start, `Availability row ${index + 1} start`);
    const end = nonEmptyString(row.end, `Availability row ${index + 1} end`);
    const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
    if (!timePattern.test(start) || !timePattern.test(end) || start >= end) throw new ImportValidationError([`Availability row ${index + 1} must have valid 24-hour times with end after start.`]);
    const status = nonEmptyString(row.status, `Availability row ${index + 1} status`);
    if (!["Confirmed", "Pending"].includes(status)) throw new ImportValidationError([`Availability row ${index + 1} status must be Confirmed or Pending.`]);
    return { staffId: nonEmptyString(row.staff_id, `Availability row ${index + 1} staff_id`), date: validDate(row.date, `Availability row ${index + 1} date`), start, end, status };
  });
  unique(rows.map((row) => `${row.staffId}:${row.date}`), "HR availability staff/date pairs");
  return { rows, exportId: envelope.exportId, sourceSystem: envelope.sourceSystem, details: envelope.details };
}

function validateCrm(data: string): ImportValidation<OrderRow> {
  const parsed = parseCsv(data);
  if (parsed.length < 2) throw new ImportValidationError(["CRM CSV must contain a header and at least one order line."]);
  const headers = parsed[0].map((header) => header.trim());
  unique(headers, "CRM column names");
  const missing = CRM_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) throw new ImportValidationError([`CRM CSV is missing required columns: ${missing.join(", ")}.`]);
  const indexes = Object.fromEntries(CRM_HEADERS.map((header) => [header, headers.indexOf(header)]));
  const products = new Set(recipes.products.map((product) => product.id));
  const exportIds = new Set<string>();
  const exportedAts = new Set<string>();
  const exportStatuses = new Set<string>();
  const ids: string[] = [];
  const rows = parsed.slice(1).map((line, index) => {
    if (line.length !== headers.length) throw new ImportValidationError([`CRM row ${index + 2} has ${line.length} fields; expected ${headers.length}.`]);
    const get = (name: string) => line[indexes[name]]?.trim() ?? "";
    const exportId = nonEmptyString(get("export_id"), `CRM row ${index + 2} export_id`);
    const exportedAt = timestamp(get("exported_at"), `CRM row ${index + 2} exported_at`);
    const exportStatus = nonEmptyString(get("export_status"), `CRM row ${index + 2} export_status`);
    exportIds.add(exportId); exportedAts.add(exportedAt); exportStatuses.add(exportStatus);
    const id = nonEmptyString(get("id"), `CRM row ${index + 2} id`);
    ids.push(id);
    const productId = nonEmptyString(get("product_id"), `CRM row ${index + 2} product_id`);
    if (!products.has(productId)) throw new ImportValidationError([`CRM row ${index + 2} contains unknown product ID ${productId}.`]);
    const quantity = amount(get("quantity"), `CRM row ${index + 2} quantity`, true);
    if (!Number.isInteger(quantity)) throw new ImportValidationError([`CRM row ${index + 2} quantity must be a whole number.`]);
    return { id, productionDate: validDate(get("production_date"), `CRM row ${index + 2} production_date`), customer: nonEmptyString(get("customer"), `CRM row ${index + 2} customer`), productId, quantity, status: nonEmptyString(get("status"), `CRM row ${index + 2} status`), receivedAt: timestamp(get("received_at"), `CRM row ${index + 2} received_at`) };
  });
  unique(ids, "CRM order IDs");
  if (exportIds.size !== 1 || exportedAts.size !== 1 || exportStatuses.size !== 1) throw new ImportValidationError(["All CRM rows must belong to one consistent export ID, export time and export status."]);
  return { rows, exportId: [...exportIds][0], sourceSystem: "CRM weekly sales orders", details: { exportedAt: [...exportedAts][0], exportStatus: [...exportStatuses][0] } };
}

export function validateImport(kind: ImportKind, input: unknown): ImportValidation<StockRow | StaffRow | LeaveRow | AvailabilityRow | OrderRow> {
  switch (kind) {
    case "stock": return validateStock(input);
    case "staff": return validateStaff(input);
    case "leave": return validateLeave(input);
    case "availability": return validateAvailability(input);
    case "crm": return validateCrm(String(input));
  }
}


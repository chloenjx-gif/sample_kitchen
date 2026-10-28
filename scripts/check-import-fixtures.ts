import { readFileSync } from "node:fs";
import { validateImport } from "../src/lib/imports/validate";

const root = "operating-data/";
const fixtures = [
  ["stock", "current_inventory.json", "json"],
  ["staff", "HR_Staff_Master_2026-11.json", "json"],
  ["leave", "HR_Leave_2026-11.json", "json"],
  ["availability", "HR_Part_Time_Availability_2026-11.json", "json"],
  ["crm", "CRM_Weekly_Sales_Orders_2026-10-28.csv", "csv"],
] as const;

for (const [kind, filename, format] of fixtures) {
  const raw = readFileSync(root + filename, "utf8");
  const input = format === "json" ? JSON.parse(raw) : raw;
  const result = validateImport(kind, input);
  console.log(`${kind}: accepted ${result.rows.length} rows`);
}

const crm = readFileSync(root + "CRM_Weekly_Sales_Orders_2026-10-28.csv", "utf8");
const invalidCrm = crm.replace(",CHEESE,200,", ",UNKNOWN,200,");
try {
  validateImport("crm", invalidCrm);
  throw new Error("Invalid CRM product was accepted.");
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("unknown product ID")) throw error;
  console.log("invalid CRM product: rejected as expected");
}


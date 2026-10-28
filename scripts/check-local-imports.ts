import { readFileSync } from "node:fs";

const env = readFileSync(".env", "utf8");
const password = env.match(/^IMPORT_ADMIN_PASSWORD=(.*)$/m)?.[1]?.trim();
if (!password) throw new Error("IMPORT_ADMIN_PASSWORD is missing from .env.");

const origin = "http://127.0.0.1:3000";
const files = [
  ["stock", "current_inventory.json", 4],
  ["staff", "HR_Staff_Master_2026-11.json", 7],
  ["leave", "HR_Leave_2026-11.json", 2],
  ["availability", "HR_Part_Time_Availability_2026-11.json", 6],
  ["crm", "CRM_Weekly_Sales_Orders_2026-10-28.csv", 16],
] as const;

async function main() {
  const login = await fetch(`${origin}/api/import-auth`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }),
  });
  if (login.status !== 200) throw new Error(`Import sign-in failed: HTTP ${login.status}`);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Import sign-in did not set a session cookie.");

  for (const [kind, filename, expectedCount] of files) {
    const bytes = readFileSync(`operating-data/${filename}`);
    const upload = async () => {
      const form = new FormData();
      form.set("file", new File([bytes], filename));
      const response = await fetch(`${origin}/api/imports/${kind}`, { method: "POST", headers: { cookie }, body: form });
      const body = await response.json() as { duplicate?: boolean; batch?: { rowCount: number }; error?: string };
      if (response.status !== 200 || body.batch?.rowCount !== expectedCount) throw new Error(`${kind} import failed: HTTP ${response.status}; ${body.error ?? "unexpected row count"}`);
      return body;
    };
    await upload();
    const second = await upload();
    if (!second.duplicate) throw new Error(`${kind} repeat upload was not detected as a duplicate.`);
    console.log(`${kind}: ${expectedCount} rows saved; repeat upload detected as duplicate`);
  }

  const refreshed = await fetch(`${origin}/api/imports`, { headers: { cookie, "cache-control": "no-cache" } });
  const body = await refreshed.json() as { imports?: Record<string, { rowCount: number }> };
  if (refreshed.status !== 200) throw new Error(`Reloaded import status failed: HTTP ${refreshed.status}`);
  for (const [kind, , expectedCount] of files) {
    if (body.imports?.[kind]?.rowCount !== expectedCount) throw new Error(`${kind} row count did not survive a fresh status request.`);
  }
  console.log("PASS: all five imports survived a fresh server read.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Local import check failed.");
  process.exitCode = 1;
});

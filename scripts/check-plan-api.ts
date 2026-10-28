import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

async function main() {
  const env = readFileSync(".env", "utf8");
  const password = env.match(/^IMPORT_ADMIN_PASSWORD=(.*)$/m)?.[1]?.trim();
  if (!password) throw new Error("The local import password is missing.");
  const origin = "http://127.0.0.1:3000";
  const unauthorized = await fetch(`${origin}/api/plan`);
  assert.equal(unauthorized.status, 401);
  const login = await fetch(`${origin}/api/import-auth`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("The import session cookie was not set.");
  const response = await fetch(`${origin}/api/plan`, { headers: { cookie, "cache-control": "no-cache" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json() as { status?: string; importVersion?: string; plan?: { eligibleOrders?: unknown[]; excludedOrders?: unknown[]; totalUnits?: number } };
  assert.equal(data.status, "ready");
  assert.equal(data.importVersion?.length, 64);
  assert.equal(data.plan?.eligibleOrders?.length, 15);
  assert.equal(data.plan?.excludedOrders?.length, 1);
  assert.equal(data.plan?.totalUnits, 5280);
  console.log("PASS: /api/plan rejects unsigned requests and returns the saved 15/1 order plan to an authenticated request.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Plan API check failed.");
  process.exitCode = 1;
});

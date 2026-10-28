import { existsSync, readFileSync } from "node:fs";

const path = ".env";
if (!existsSync(path)) {
  console.error("FAIL: the project-root .env file is missing.");
  process.exit(1);
}

const lines = readFileSync(path, "utf8").split(/\r?\n/);
const values = new Map<string, string[]>();
for (const line of lines) {
  const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
  if (!match) continue;
  const value = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  values.set(match[1], [...(values.get(match[1]) ?? []), value]);
}

let failed = false;
function report(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name} ${detail}`);
  if (!ok) failed = true;
}

for (const name of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"]) {
  const entries = values.get(name) ?? [];
  const value = entries[0] ?? "";
  report(name, entries.length === 1, entries.length === 1 ? "appears once" : `appears ${entries.length} times; keep one entry`);
  let valid = false;
  try {
    const url = new URL(value);
    valid = ["postgres:", "postgresql:"].includes(url.protocol)
      && Boolean(url.hostname && url.username && url.password && url.pathname !== "/")
      && !/[\*<>]/.test(value)
      && !/^(HOST|DATABASE)$/i.test(url.hostname);
  } catch { /* A missing or malformed URL fails below. */ }
  report(name, valid, valid ? "has a usable Postgres URL shape" : "needs a real Postgres connection URL");
}

const importPassword = values.get("IMPORT_ADMIN_PASSWORD") ?? [];
report("IMPORT_ADMIN_PASSWORD", importPassword.length === 1 && importPassword[0].length >= 12, "must appear once and contain at least 12 characters");

const openAiKey = values.get("OPENAI_API_KEY") ?? [];
console.log(`INFO: OPENAI_API_KEY ${openAiKey.length === 1 && openAiKey[0] ? "is set" : "is empty; needed at the later agent step"}.`);
if (existsSync(".env.txt")) console.log("INFO: .env.txt exists but is ignored by the app; use .env.");
process.exitCode = failed ? 1 : 0;


import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const root = process.cwd();
const envPath = path.join(root, ".env");
const dataDir = path.join(root, ".local-postgres", "data");
const port = 55432;
const user = "kitchen_local";
const database = "postgres";
const urlPattern = /^\s*(DATABASE_URL|DATABASE_URL_UNPOOLED|IMPORT_ADMIN_PASSWORD)\s*=\s*(.*)\s*$/gm;

function readValues(contents: string) {
  const values = new Map<string, string>();
  for (const match of contents.matchAll(urlPattern)) values.set(match[1], match[2].trim().replace(/^(['"])(.*)\1$/, "$2"));
  return values;
}

function updateEnv(contents: string, updates: Record<string, string>) {
  const lines = contents.split(/\r?\n/).filter((line) => !/^\s*(DATABASE_URL|DATABASE_URL_UNPOOLED|IMPORT_ADMIN_PASSWORD)\s*=/.test(line));
  return [...lines.filter((line, index) => line || index < lines.length - 1), ...Object.entries(updates).map(([key, value]) => `${key}=${value}`), ""].join("\n");
}

const original = existsSync(envPath) ? readFileSync(envPath, "utf8") : "OPENAI_API_KEY=\n";
const current = readValues(original);
const existingUrl = current.get("DATABASE_URL") ?? "";
if (existingUrl && !existingUrl.includes("127.0.0.1:55432")) {
  throw new Error("This .env points to another database. Local setup stopped to avoid changing it.");
}
const localPassword = existingUrl ? new URL(existingUrl).password : randomBytes(24).toString("hex");
const importPassword = current.get("IMPORT_ADMIN_PASSWORD") || randomBytes(24).toString("hex");
const localUrl = `postgresql://${user}:${localPassword}@127.0.0.1:${port}/${database}`;
if (existingUrl !== localUrl || current.get("DATABASE_URL_UNPOOLED") !== localUrl || !current.get("IMPORT_ADMIN_PASSWORD")) {
  writeFileSync(envPath, updateEnv(original, {
    DATABASE_URL: localUrl,
    DATABASE_URL_UNPOOLED: localUrl,
    IMPORT_ADMIN_PASSWORD: importPassword,
  }), { encoding: "utf8", mode: 0o600 });
  console.log("Local database and import sign-in settings were saved in the private .env file.");
}

mkdirSync(path.dirname(dataDir), { recursive: true });
const require = createRequire(import.meta.url);
const packageRequire = createRequire(require.resolve("embedded-postgres"));
const platformEntry = packageRequire.resolve("@embedded-postgres/windows-x64");
const sourceRuntime = path.resolve(path.dirname(platformEntry), "..", "native");
const runtime = path.join(root, ".local-postgres", "runtime");
const pgBin = path.join(runtime, "bin");
const pgCtl = path.join(pgBin, "pg_ctl.exe");
const initdb = path.join(pgBin, "initdb.exe");

function pgCommand(executable: string, args: string[], options?: { input?: string }) {
  const result = spawnSync(executable, args, { cwd: root, encoding: "utf8", input: options?.input, stdio: executable === pgCtl ? "ignore" : "pipe", timeout: 30000 });
  if (result.status !== 0) throw new Error(`${path.basename(executable)} failed: ${(result.stderr || result.stdout || "unknown error").trim()}`);
}

function run(command: string) {
  const result = spawnSync("cmd.exe", ["/d", "/s", "/c", `pnpm ${command}`], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: localUrl, DATABASE_URL_UNPOOLED: localUrl },
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status ?? "unknown"}).`);
}

async function main() {
  if (!existsSync(path.join(runtime, "share", "extension", "plpgsql--1.0.sql"))) {
    console.log("Preparing PostgreSQL runtime in a shorter local path...");
    cpSync(sourceRuntime, runtime, { recursive: true, dereference: true });
  }
  if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
    console.log("Creating the local PostgreSQL data directory...");
    const passwordFile = path.join(root, ".local-postgres", "init-password");
    writeFileSync(passwordFile, `${localPassword}\n`, { mode: 0o600 });
    try {
      pgCommand(initdb, ["--pgdata", dataDir, "--auth", "scram-sha-256", "--username", user, "--pwfile", passwordFile]);
    } finally {
      rmSync(passwordFile, { force: true });
    }
  }
  pgCommand(pgCtl, ["start", "-D", dataDir, "-o", `-p ${port} -c listen_addresses=127.0.0.1`, "-l", path.join(root, ".local-postgres", "server.log"), "-w"]);
  try {
    console.log("Local PostgreSQL is ready. Applying schema and reference data...");
    run("db:push");
    run("db:seed");
    console.log("Starting Kitchen Planner at http://127.0.0.1:3000");
    const web = spawn("cmd.exe", ["/d", "/s", "/c", "pnpm exec next dev -H 127.0.0.1"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: localUrl, DATABASE_URL_UNPOOLED: localUrl },
      stdio: "inherit",
    });
    await new Promise<void>((resolve) => web.on("exit", resolve));
  } finally {
    pgCommand(pgCtl, ["stop", "-D", dataDir, "-m", "fast", "-w"]);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Local startup failed.");
  process.exitCode = 1;
});

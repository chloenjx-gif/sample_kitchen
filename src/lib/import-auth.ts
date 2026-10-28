import { createHmac, timingSafeEqual } from "node:crypto";

export const IMPORT_SESSION_COOKIE = "kitchen_import_session";
const SESSION_SECONDS = 12 * 60 * 60;

function secret() {
  return process.env.IMPORT_ADMIN_PASSWORD;
}

function signature(expiresAt: string, password: string) {
  return createHmac("sha256", password).update(`v1:${expiresAt}`).digest("hex");
}

function equal(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function importPasswordConfigured() {
  return Boolean(secret());
}

export function matchesImportPassword(candidate: unknown) {
  const configured = secret();
  return typeof candidate === "string" && Boolean(configured) && equal(candidate, configured!);
}

export function createImportSession() {
  const configured = secret();
  if (!configured) throw new Error("IMPORT_ADMIN_PASSWORD is not configured.");
  const expiresAt = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
  return { value: `v1.${expiresAt}.${signature(expiresAt, configured)}`, maxAge: SESSION_SECONDS };
}

export function isImportSessionValid(value: string | undefined) {
  const configured = secret();
  if (!configured || !value) return false;
  const [version, expiresAt, suppliedSignature, extra] = value.split(".");
  if (version !== "v1" || !expiresAt || !suppliedSignature || extra || !/^\d+$/.test(expiresAt)) return false;
  if (Number(expiresAt) <= Math.floor(Date.now() / 1000)) return false;
  return equal(suppliedSignature, signature(expiresAt, configured));
}


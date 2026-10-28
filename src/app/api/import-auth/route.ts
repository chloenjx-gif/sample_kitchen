import { NextRequest, NextResponse } from "next/server";
import { createImportSession, importPasswordConfigured, IMPORT_SESSION_COOKIE, isImportSessionValid, matchesImportPassword } from "@/lib/import-auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return NextResponse.json({ authenticated: isImportSessionValid(request.cookies.get(IMPORT_SESSION_COOKIE)?.value), passwordConfigured: importPasswordConfigured() });
}

export async function POST(request: NextRequest) {
  if (!importPasswordConfigured()) return NextResponse.json({ error: "Set IMPORT_ADMIN_PASSWORD in the server environment before enabling imports." }, { status: 503 });
  let body: { password?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Send a valid JSON login request." }, { status: 400 }); }
  if (!matchesImportPassword(body.password)) return NextResponse.json({ error: "That import password did not match." }, { status: 401 });
  const session = createImportSession();
  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(IMPORT_SESSION_COOKIE, session.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: session.maxAge });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(IMPORT_SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}


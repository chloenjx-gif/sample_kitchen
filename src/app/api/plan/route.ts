import { NextRequest, NextResponse } from "next/server";
import { IMPORT_SESSION_COOKIE, isImportSessionValid } from "@/lib/import-auth";
import { loadVerifiedPlan } from "@/lib/planning/load";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isImportSessionValid(request.cookies.get(IMPORT_SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: "Sign in to view the saved plan." }, { status: 401 });
  }
  try {
    return NextResponse.json(await loadVerifiedPlan(), { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The saved plan could not be calculated. Check the database and reference data." }, { status: 503 });
  }
}

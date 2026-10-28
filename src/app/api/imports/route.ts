import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { IMPORT_SESSION_COOKIE, isImportSessionValid } from "@/lib/import-auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isImportSessionValid(request.cookies.get(IMPORT_SESSION_COOKIE)?.value)) return NextResponse.json({ error: "Sign in to view import status." }, { status: 401 });
  try {
    const batches = await db.importBatch.findMany({ orderBy: [{ importedAt: "desc" }], take: 100 });
    const latest = new Map<string, typeof batches[number]>();
    for (const batch of batches) if (!latest.has(batch.kind)) latest.set(batch.kind, batch);
    return NextResponse.json({ imports: Object.fromEntries(latest) });
  } catch {
    return NextResponse.json({ error: "The database is not ready. Check the server-side DATABASE_URL and apply the schema." }, { status: 503 });
  }
}


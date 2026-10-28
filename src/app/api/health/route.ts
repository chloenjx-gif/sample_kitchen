import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const referenceDataCount = await db.referenceData.count();
    if (referenceDataCount < 3) {
      return NextResponse.json({ status: "not_ready", app: "kitchen-planner", referenceDataCount }, { status: 503 });
    }
    return NextResponse.json({ status: "ok", app: "kitchen-planner", referenceDataCount });
  } catch {
    return NextResponse.json({ status: "database_unavailable", app: "kitchen-planner" }, { status: 503 });
  }
}



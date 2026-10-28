import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { IMPORT_SESSION_COOKIE, isImportSessionValid } from "@/lib/import-auth";
import { loadVerifiedPlan } from "@/lib/planning/load";
import { AGENT_MODEL, AgentServiceError, callOpenAI } from "@/lib/agents/openai";
import { runPlanningAgents } from "@/lib/agents/run";
import { AgentOutputError } from "@/lib/agents/validate";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: NextRequest) {
  return isImportSessionValid(request.cookies.get(IMPORT_SESSION_COOKIE)?.value);
}
function noStore(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}
function verifiedSummary(plan: { eligibleOrders: unknown[]; excludedOrders: unknown[]; totalUnits: number; totalLabourHours: number }) {
  return { eligibleOrders: plan.eligibleOrders.length, excludedOrders: plan.excludedOrders.length,
    totalUnits: plan.totalUnits, totalLabourHours: plan.totalLabourHours };
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return noStore({ error: "Sign in to view planning agents." }, 401);
  try {
    const snapshot = await loadVerifiedPlan();
    if (snapshot.status === "missing") return noStore(snapshot);
    const latest = await db.agentRun.findFirst({
      where: { importVersion: snapshot.importVersion, status: "completed" },
      orderBy: { finishedAt: "desc" }, include: { recommendations: true },
    });
    return noStore({ status: "ready", model: AGENT_MODEL, keyConfigured: Boolean(process.env.OPENAI_API_KEY),
      importVersion: snapshot.importVersion, verified: verifiedSummary(snapshot.plan),
      latestRun: latest ? {
        id: latest.id, model: latest.model, finishedAt: latest.finishedAt,
        handoffTrace: latest.handoffTrace,
        recommendations: Object.fromEntries(latest.recommendations.map((item) => [item.agent, item.result])),
      } : null });
  } catch {
    return noStore({ error: "The saved plan or agent results could not be loaded." }, 503);
  }
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return noStore({ error: "Sign in before running planning agents." }, 401);
  let snapshot: Awaited<ReturnType<typeof loadVerifiedPlan>>;
  try { snapshot = await loadVerifiedPlan(); }
  catch { return noStore({ error: "The verified plan could not be loaded." }, 503); }
  if (snapshot.status === "missing") return noStore({ error: "Import all five operating files before running planning agents.", ...snapshot }, 409);
  if (!process.env.OPENAI_API_KEY) return noStore({ error: "Set a private OPENAI_API_KEY on the server, then restart the app before running agents." }, 503);
  const run = await db.agentRun.create({ data: { importVersion: snapshot.importVersion, model: AGENT_MODEL, status: "running" } });
  try {
    const { results, handoffTrace } = await runPlanningAgents(snapshot, callOpenAI);
    const current = await loadVerifiedPlan();
    if (current.status !== "ready" || current.importVersion !== snapshot.importVersion) {
      throw new AgentServiceError("Imports changed during the agent run. Run the agents again for the current saved data.");
    }
    await db.$transaction(async (tx) => {
      await tx.agentRecommendation.createMany({ data: (
        ["sales", "manpower", "purchasing"] as const
      ).map((agent) => ({ runId: run.id, agent, result: results[agent] as unknown as Prisma.InputJsonValue })) });
      await tx.agentRun.update({ where: { id: run.id }, data: {
        status: "completed", finishedAt: new Date(), handoffTrace: handoffTrace as unknown as Prisma.InputJsonValue,
      } });
    });
    return noStore({ ok: true, runId: run.id, importVersion: snapshot.importVersion });
  } catch (error) {
    await db.agentRun.update({ where: { id: run.id }, data: { status: "failed", finishedAt: new Date() } }).catch(() => undefined);
    const message = error instanceof AgentServiceError || error instanceof AgentOutputError ? error.message :
      "Planning agents failed. The verified numeric plan is still available.";
    return noStore({ error: message }, 502);
  }
}

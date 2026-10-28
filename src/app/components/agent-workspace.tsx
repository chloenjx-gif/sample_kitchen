"use client";

import { useCallback, useEffect, useState } from "react";
import type { AgentResults, DatedAction, Handoff } from "@/lib/agents/schema";

type AgentView = {
  status: "ready" | "missing";
  missingImports?: string[];
  model?: string;
  keyConfigured?: boolean;
  verified?: { eligibleOrders: number; excludedOrders: number; totalUnits: number; totalLabourHours: number };
  latestRun?: { model: string; finishedAt: string; handoffTrace: Handoff[]; recommendations: AgentResults } | null;
};

function singaporeTime(value: string) {
  return new Intl.DateTimeFormat("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" }).format(new Date(value));
}
function ActionList({ actions }: { actions: DatedAction[] }) {
  return <ul className="agent-actions">{actions.map((action, index) =>
    <li key={`${action.date}-${index}`}><strong>{action.date}</strong> · {action.finding}<br /><span>Human action: {action.humanAction}</span></li>)}</ul>;
}

export function AgentWorkspace() {
  const [signedIn, setSignedIn] = useState(false);
  const [data, setData] = useState<AgentView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/agents", { cache: "no-store" });
      if (response.status === 401) { setSignedIn(false); setData(null); return; }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Agent status could not be loaded.");
      setSignedIn(true); setData(result as AgentView);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Agent status could not be loaded."); }
  }, []);
  useEffect(() => {
    void refresh();
    window.addEventListener("kitchen-auth-changed", refresh);
    window.addEventListener("kitchen-import-changed", refresh);
    return () => { window.removeEventListener("kitchen-auth-changed", refresh); window.removeEventListener("kitchen-import-changed", refresh); };
  }, [refresh]);

  async function run() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/agents", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Planning agents failed.");
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Planning agents failed."); }
    finally { setBusy(false); }
  }

  const runResult = data?.latestRun;
  const recommendations = runResult?.recommendations;
  return <section className="imports-card" aria-labelledby="agents-title">
    <div className="imports-heading"><div><p className="eyebrow">Planning specialists</p><h3 id="agents-title">Run planning agents</h3></div></div>
    <p className="imports-intro">The verified numbers come from code. The agents add explanations and draft actions only when you press the button. Their results are saved with this import version.</p>
    {!signedIn ? <p className="setup-note">Sign in above to view the plan and run the agents.</p> : data?.status === "missing" ?
      <p className="setup-note">Import the remaining files first: {(data.missingImports ?? []).join(", ")}.</p> : <>
      {data?.verified && <div className="verified-summary"><strong>Verified plan</strong><span>{data.verified.eligibleOrders} eligible orders · {data.verified.excludedOrders} exceptions</span><span>{data.verified.totalUnits.toLocaleString("en-SG")} sandwiches · {data.verified.totalLabourHours} labour hours</span></div>}
      <div className="agent-run-row"><button className="upload-button" type="button" onClick={run} disabled={busy || !data?.keyConfigured}>{busy ? "Running three agents…" : "Run planning agents"}</button><span>Model: {data?.model ?? "gpt-6-luna"}</span></div>
      {!data?.keyConfigured && <p className="setup-note">A private server-side OpenAI API key is needed for this step. Save a replacement in the project-root .env and restart the local app.</p>}
      {runResult && recommendations && <div className="agent-results">
        <p className="agent-run-meta">Saved {singaporeTime(runResult.finishedAt)} Singapore time · {runResult.model} · unsent drafts</p>
        <article><h4>Sales & production</h4><p>{recommendations.sales.summary}</p><p>{recommendations.sales.lateOrderExplanation}</p><ActionList actions={recommendations.sales.actions} /></article>
        <article><h4>Manpower</h4><p>{recommendations.manpower.summary}</p>{recommendations.manpower.gaps.map((gap) => <p key={gap.date}><strong>{gap.date}:</strong> {gap.uncoveredHours} hours uncovered; request {gap.shiftsToRequest} part-time shift. {gap.requestText}</p>)}<ActionList actions={recommendations.manpower.actions} /></article>
        <article><h4>Purchasing</h4><p>{recommendations.purchasing.summary}</p><ul className="agent-actions">{recommendations.purchasing.requests.map((item) => <li key={item.ingredientId}>{item.ingredientId}: {item.packsToRequest} × {item.packName} · {item.explanation}</li>)}</ul><div className="supplier-preview"><strong>Unsent supplier draft</strong><span>To: {recommendations.purchasing.supplierDraft.to}</span><span>Subject: {recommendations.purchasing.supplierDraft.subject}</span><p>{recommendations.purchasing.supplierDraft.body}</p></div><ActionList actions={recommendations.purchasing.actions} /></article>
        <div className="handoff-trace"><strong>Handoff trace</strong><ol>{runResult.handoffTrace.map((step, index) => <li key={index}>{step.from === "verified_plan" ? "Verified plan" : "Sales agent"} → {step.to} · {step.passed.join(", ")}</li>)}</ol></div>
      </div>}
      {!runResult && data?.keyConfigured && <p className="setup-note">No recommendations have been run for the current saved imports.</p>}
    </>}
    {error && <p className="feedback error" role="alert">{error} The verified numeric plan above remains available.</p>}
  </section>;
}

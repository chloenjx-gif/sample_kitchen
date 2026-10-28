import type { CalculatedPlan } from "@/lib/planning/calculate";
import type { DatedAction, ManpowerResult, PurchasingResult, SalesResult } from "./schema";

export class AgentOutputError extends Error {
  constructor(message: string) { super(message); this.name = "AgentOutputError"; }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AgentOutputError(`${label} was not an object.`);
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, names: string[], label: string) {
  if (Object.keys(value).length !== names.length || names.some((name) => !(name in value))) throw new AgentOutputError(`${label} did not match the expected fields.`);
}
function text(value: unknown, label: string, max = 2000) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new AgentOutputError(`${label} was empty or too long.`);
  return value.trim();
}
function actions(value: unknown, plan: CalculatedPlan, label: string): DatedAction[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10) throw new AgentOutputError(`${label} actions were missing or too many.`);
  const allowedDates = new Set([plan.orderCutoff.slice(0, 10), ...plan.dailyProduction.map((day) => day.date)]);
  return value.map((entry: unknown) => {
    const action = object(entry, `${label} action`);
    fields(action, ["date", "finding", "humanAction"], `${label} action`);
    if (typeof action.date !== "string" || !allowedDates.has(action.date)) throw new AgentOutputError(`${label} action used a date outside the planning period.`);
    return { date: action.date, finding: text(action.finding, `${label} finding`), humanAction: text(action.humanAction, `${label} human action`) };
  });
}

export function validateSales(value: unknown, plan: CalculatedPlan): SalesResult {
  const result = object(value, "Sales result");
  fields(result, ["summary", "lateOrderIds", "lateOrderExplanation", "actions"], "Sales result");
  if (!Array.isArray(result.lateOrderIds) || result.lateOrderIds.some((id) => typeof id !== "string")) throw new AgentOutputError("Sales late order IDs were invalid.");
  const actual = plan.excludedOrders.filter((order) => order.reason === "after_cutoff").map((order) => order.id).sort();
  const claimed = [...result.lateOrderIds].sort();
  if (JSON.stringify(claimed) !== JSON.stringify(actual)) throw new AgentOutputError("Sales late order IDs did not match the verified plan.");
  return { summary: text(result.summary, "Sales summary"), lateOrderIds: claimed,
    lateOrderExplanation: text(result.lateOrderExplanation, "Sales late-order explanation"),
    actions: actions(result.actions, plan, "Sales") };
}

export function validateManpower(value: unknown, plan: CalculatedPlan): ManpowerResult {
  const result = object(value, "Manpower result");
  fields(result, ["summary", "gaps", "actions"], "Manpower result");
  if (!Array.isArray(result.gaps)) throw new AgentOutputError("Manpower gaps were invalid.");
  const expected = plan.roster.filter((day) => day.uncoveredHours > 0);
  if (result.gaps.length !== expected.length) throw new AgentOutputError("Manpower gap count did not match the verified roster.");
  const gaps = result.gaps.map((entry: unknown) => {
    const gap = object(entry, "Manpower gap");
    fields(gap, ["date", "uncoveredHours", "shiftsToRequest", "requestText"], "Manpower gap");
    const actual = expected.find((day) => day.date === gap.date);
    if (!actual || gap.uncoveredHours !== actual.uncoveredHours || gap.shiftsToRequest !== actual.additionalPartTimeShiftsToRequest) {
      throw new AgentOutputError("Manpower gap numbers did not match the verified roster.");
    }
    return { date: actual.date, uncoveredHours: actual.uncoveredHours, shiftsToRequest: actual.additionalPartTimeShiftsToRequest,
      requestText: text(gap.requestText, "Manpower cover request") };
  });
  if (new Set(gaps.map((gap) => gap.date)).size !== gaps.length) throw new AgentOutputError("Manpower repeated a gap date.");
  return { summary: text(result.summary, "Manpower summary"), gaps, actions: actions(result.actions, plan, "Manpower") };
}

export function validatePurchasing(value: unknown, plan: CalculatedPlan, draftTo: string): PurchasingResult {
  const result = object(value, "Purchasing result");
  fields(result, ["summary", "requests", "supplierDraft", "actions"], "Purchasing result");
  if (!Array.isArray(result.requests)) throw new AgentOutputError("Purchasing requests were invalid.");
  const expected = plan.stockRequests.filter((item) => item.packsToRequest > 0);
  if (result.requests.length !== expected.length) throw new AgentOutputError("Purchasing request count did not match the verified stock plan.");
  const requests = result.requests.map((entry: unknown) => {
    const request = object(entry, "Purchasing request");
    fields(request, ["ingredientId", "shortage", "unit", "packsToRequest", "packName", "explanation"], "Purchasing request");
    const actual = expected.find((item) => item.ingredientId === request.ingredientId);
    if (!actual || request.shortage !== actual.shortage || request.unit !== actual.unit ||
      request.packsToRequest !== actual.packsToRequest || request.packName !== actual.packName) {
      throw new AgentOutputError("Purchasing numbers did not match the verified stock plan.");
    }
    return { ingredientId: actual.ingredientId, shortage: actual.shortage, unit: actual.unit,
      packsToRequest: actual.packsToRequest, packName: actual.packName,
      explanation: text(request.explanation, "Purchasing explanation") };
  });
  if (new Set(requests.map((request) => request.ingredientId)).size !== requests.length) throw new AgentOutputError("Purchasing repeated an ingredient.");
  const draft = object(result.supplierDraft, "Supplier draft");
  fields(draft, ["to", "subject", "body"], "Supplier draft");
  if (draft.to !== draftTo) throw new AgentOutputError("Supplier draft recipient did not match the saved supplier reference.");
  return { summary: text(result.summary, "Purchasing summary"), requests,
    supplierDraft: { to: draftTo, subject: text(draft.subject, "Supplier draft subject", 200), body: text(draft.body, "Supplier draft body", 6000) },
    actions: actions(result.actions, plan, "Purchasing") };
}

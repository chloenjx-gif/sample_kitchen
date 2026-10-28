export type AgentName = "sales" | "manpower" | "purchasing";
export type DatedAction = { date: string; finding: string; humanAction: string };
export type SalesResult = { summary: string; lateOrderIds: string[]; lateOrderExplanation: string; actions: DatedAction[] };
export type ManpowerResult = {
  summary: string;
  gaps: Array<{ date: string; uncoveredHours: number; shiftsToRequest: number; requestText: string }>;
  actions: DatedAction[];
};
export type PurchasingResult = {
  summary: string;
  requests: Array<{ ingredientId: string; shortage: number; unit: string; packsToRequest: number; packName: string; explanation: string }>;
  supplierDraft: { to: string; subject: string; body: string };
  actions: DatedAction[];
};

const action = {
  type: "object", additionalProperties: false,
  properties: { date: { type: "string" }, finding: { type: "string" }, humanAction: { type: "string" } },
  required: ["date", "finding", "humanAction"],
} as const;

export const schemas = {
  sales: {
    type: "object", additionalProperties: false,
    properties: {
      summary: { type: "string" }, lateOrderIds: { type: "array", items: { type: "string" } },
      lateOrderExplanation: { type: "string" }, actions: { type: "array", items: action },
    }, required: ["summary", "lateOrderIds", "lateOrderExplanation", "actions"],
  },
  manpower: {
    type: "object", additionalProperties: false,
    properties: {
      summary: { type: "string" },
      gaps: { type: "array", items: { type: "object", additionalProperties: false,
        properties: { date: { type: "string" }, uncoveredHours: { type: "number" }, shiftsToRequest: { type: "integer" }, requestText: { type: "string" } },
        required: ["date", "uncoveredHours", "shiftsToRequest", "requestText"] } },
      actions: { type: "array", items: action },
    }, required: ["summary", "gaps", "actions"],
  },
  purchasing: {
    type: "object", additionalProperties: false,
    properties: {
      summary: { type: "string" },
      requests: { type: "array", items: { type: "object", additionalProperties: false,
        properties: { ingredientId: { type: "string" }, shortage: { type: "number" }, unit: { type: "string" }, packsToRequest: { type: "integer" }, packName: { type: "string" }, explanation: { type: "string" } },
        required: ["ingredientId", "shortage", "unit", "packsToRequest", "packName", "explanation"] } },
      supplierDraft: { type: "object", additionalProperties: false,
        properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } },
        required: ["to", "subject", "body"] },
      actions: { type: "array", items: action },
    }, required: ["summary", "requests", "supplierDraft", "actions"],
  },
} as const;

export type AgentResults = { sales: SalesResult; manpower: ManpowerResult; purchasing: PurchasingResult };
export type Handoff = { from: "verified_plan" | "sales"; to: AgentName; importVersion: string; passed: string[] };

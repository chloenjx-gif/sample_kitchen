export type ImportKind = "stock" | "staff" | "leave" | "availability" | "crm";

export type ImportValidation<T> = {
  rows: T[];
  exportId: string | null;
  sourceSystem: string;
  details: Record<string, unknown>;
};

export class ImportValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join(" "));
    this.name = "ImportValidationError";
  }
}


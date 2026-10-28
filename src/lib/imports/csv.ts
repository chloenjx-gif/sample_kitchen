import { ImportValidationError } from "./types";

export function parseCsv(input: string): string[][] {
  const source = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') {
      if (cell.length > 0) throw new ImportValidationError(["CSV has a quote inside an unquoted value."]);
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      cell = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
    } else {
      cell += character;
    }
  }

  if (quoted) throw new ImportValidationError(["CSV ends inside a quoted value."]);
  row.push(cell);
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}


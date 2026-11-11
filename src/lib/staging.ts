import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

type Row = Record<string, unknown>;
const record = (value: unknown): value is Row => value !== null && typeof value === "object" && !Array.isArray(value);
const projected = (value: Row, path: string): Row => ({
  ...Object.fromEntries(Object.entries(value).filter(([key]) => key !== "_rowid").map(([key, cell]) =>
    [key, cell !== null && typeof cell === "object" ? JSON.stringify(cell) : cell])),
  native_json: JSON.stringify(value), source_path: path,
});

/** Keep exact source values alongside queryable rows and complete response context. */
export function partdTables(value: unknown) {
  const data = record(value) && Array.isArray(value.content) && record(value.structuredContent) && "data" in value.structuredContent
    ? value.structuredContent.data : value;
  const tables: Record<string, Row[]> = {};
  collect(data, "", tables, Array.isArray(data));
  tables.response_context = [{ native_json: JSON.stringify(data) ?? "null" }];
  return tables;
}

function collect(value: unknown, path: string, tables: Record<string, Row[]>, resultRows = false) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => { collect(item, `${path}/${index}`, tables, resultRows); });
    return;
  }
  if (!record(value)) return;
  const table = typeof value.Prscrbr_NPI === "string" ? "prescriber_data"
    : typeof value.Mftr_Name === "string" && typeof value.Brnd_Name === "string" ? "drug_spending"
    : typeof value.dataset_id === "string" && typeof value.url === "string" && typeof value.rolling_latest === "boolean" ? "api_distributions"
    : value["@type"] === "DatasetSeries" ? "dataset_series"
    : value["@type"] === "Dataset" ? "dataset_releases"
    : resultRows ? "results" : undefined;
  if (table) {
    tables[table] ??= [];
    tables[table].push(projected(value, path));
    return;
  }
  if (typeof value.sql === "string" && Array.isArray(value.rows)) {
    tables.query_rows = value.rows.filter(record).map((item, index) => projected(item, `${path}/rows/${index}`));
    return;
  }
  for (const [key, child] of Object.entries(value)) collect(child, `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, tables,
    ["results", "data", "native"].includes(key) && Array.isArray(child));
}

export function partdSchemaHints(value: unknown): SchemaHints {
  const columnTypes: Record<string, string> = { native_json: "TEXT", source_path: "TEXT" };
  for (const rows of Object.values(partdTables(value))) for (const row of rows) {
    for (const [key, cell] of Object.entries(row)) if (typeof cell === "string") columnTypes[key] = "TEXT";
  }
  return { columnTypes };
}

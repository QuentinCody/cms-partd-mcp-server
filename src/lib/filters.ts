import { fail, hash, readReleaseJson, readReleaseResponse, urlFor } from "./release-http";

type Condition = { path: string; operator: string; values: unknown[]; scalar: boolean; memberOf?: string };
type Group = { conjunction?: string; memberOf?: string };
const operators = ["=", "<>", ">", ">=", "<", "<=", "STARTS_WITH", "CONTAINS", "ENDS_WITH", "IN", "NOT IN", "BETWEEN", "NOT BETWEEN", "IS NULL", "IS NOT NULL"];
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function integer(value: unknown, name: string, minimum: number, maximum: number) {
  if ((typeof value !== "number" && typeof value !== "string") || !/^\d+$/.test(String(value))) fail(`Invalid CMS ${name}`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) fail(`Invalid CMS ${name}`);
  return number;
}

function validateCondition(condition: Condition) {
  if (!operators.includes(condition.operator)) fail(`Unsupported CMS filter operator: ${condition.operator}`);
  const count = condition.values.length;
  if (["IS NULL", "IS NOT NULL"].includes(condition.operator)) {
    if (count) fail("Null filter operators do not accept a value");
  } else if (["IN", "NOT IN", "BETWEEN", "NOT BETWEEN"].includes(condition.operator)) {
    if (condition.scalar || !count || (condition.operator.includes("BETWEEN") && count !== 2)) fail("CMS set/range filters require indexed value[0], value[1], ... parameters");
  } else if (!condition.scalar || count !== 1) fail("CMS scalar filter requires exactly one value");
}

function validateGroups(conditions: Map<string, Condition>, groups: Map<string, Group>) {
  for (const [label, group] of groups) {
    if (conditions.has(label) || !["AND", "OR"].includes(group.conjunction ?? "")) fail("CMS groups need a distinct label and AND/OR conjunction");
  }
  for (const [label, item] of [...conditions, ...groups]) {
    const seen = new Set([label]);
    let parent = item.memberOf;
    while (parent !== undefined) {
      if (!groups.has(parent) || seen.has(parent)) fail("CMS filter group is missing or cyclic");
      seen.add(parent); parent = groups.get(parent)?.memberOf;
    }
  }
  if (groups.size && !conditions.size) fail("CMS filter groups require conditions");
}

/** Validate documented flat JSON:API syntax before CMS can silently ignore it. */
export function filterFields(params: Record<string, unknown>): string[] {
  const conditions = new Map<string, Condition>();
  const groups = new Map<string, Group>();
  collectFilterConditions(params, groups, conditions);
  for (const condition of conditions.values()) validateCondition(condition);
  validateGroups(conditions, groups);
  const fields = [...conditions.values()].map(item => item.path);
  if (params.sort !== undefined) {
    if (typeof params.sort !== "string" || !params.sort || params.sort.split(",").some(field => !/^-?[A-Za-z][A-Za-z0-9_]*$/.test(field))) fail("CMS sort must name columns, optionally prefixed with - for descending order");
    fields.push(...params.sort.split(",").map(field => field.replace(/^-/, "")));
  }
  return [...new Set(fields)];
}

function collectFilterConditions(params: Record<string, unknown>, groups: Map<string, Group>, conditions: Map<string, Condition>) {
  for (const [key, value] of Object.entries(params)) {
    if (!key.startsWith("filter[")) continue;
    const match = /^filter\[([^\[\]]+)\](.*)$/.exec(key);
    if (!match) fail("Malformed CMS filter parameter");
    const [, label, suffix] = match;
    const group = /^\[group\]\[(conjunction|memberOf)\]$/.exec(suffix);
    if (group) {
      const item = groups.get(label) ?? {};
      if (group[1] === "conjunction") item.conjunction = String(value); else item.memberOf = String(value);
      groups.set(label, item); continue;
    }
    const field = suffix === "" ? ["", "value", undefined] : /^(?:\[condition\])?\[(path|operator|value|memberOf)\](?:\[(\d+)\])?$/.exec(suffix);
    if (!field || (field[2] !== undefined && field[1] !== "value")) fail(`Malformed CMS filter parameter: ${key}`);
    const item: Condition = conditions.get(label) ?? { path: label, operator: "=", values: [], scalar: false };
    const property = field[1];
    if (property === "value") {
      if ((item.values.length && field[2] === undefined) || (item.scalar && field[2] !== undefined)) fail("Conflicting CMS filter values");
      item.values.push(value); item.scalar = field[2] === undefined;
    } else if (property === "path") item.path = String(value);
    else if (property === "operator") item.operator = String(value);
    else item.memberOf = String(value);
    conditions.set(label, item);
  }
}

/** Verify referenced columns against the selected dataset's native viewer metadata. */
async function verifyFields(path: string, fields: string[], deadline: number) {
  if (!fields.length) return;
  const id = /^\/data-api\/v1\/dataset\/([a-f0-9-]+)\/data$/.exec(path)?.[1];
  if (!id) fail("Filtered CMS reads require a dataset data endpoint");
  const url = urlFor(path.replace(/\/data$/, "/data-viewer"), { size: 1 });
  const native = await readReleaseJson(url, deadline);
  const meta = record(native) && record(native.meta) ? native.meta : undefined;
  if (!meta || meta.success !== true || meta.datset_uuid !== id || !Array.isArray(meta.headers) || !meta.headers.length || meta.headers.some(field => typeof field !== "string")) fail("CMS column metadata identity/schema mismatch", 502);
  const headers = meta.headers;
  const missing = fields.filter(field => !headers.includes(field));
  if (missing.length) fail("CMS request names columns absent from the selected dataset", 400, {
    error: { code: "UNKNOWN_CMS_COLUMNS", fields: missing }, schema_evidence: { native, source_url: url.href, response_sha256: await hash(native) },
  });
}

export async function readDataPage(path: string, params: Record<string, unknown>, deadline: number) {
  const query = { ...params, size: integer(params.size ?? 100, "size", 1, 5000), offset: integer(params.offset ?? 0, "offset", 0, 10000000) };
  const url = urlFor(path, query);
  const fields = filterFields(query);
  await verifyFields(path, fields, deadline);
  return readReleaseResponse(url, deadline);
}

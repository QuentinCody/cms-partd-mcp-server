import { candidates, discover, familyInfo, record } from "./releases";
import { fail, hash, urlFor } from "./release-http";
import { filterFields, readDataPage } from "./filters";

function integer(value: unknown, name: string, min: number, max: number): number {
  if ((typeof value !== "string" && typeof value !== "number") || !/^\d+$/.test(String(value))) fail(`Invalid ${name}`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) fail(`Invalid ${name}`);
  return result;
}

function pageControls(params: Record<string, unknown>) {
  const { family, dataset_id: id, expected_metadata_sha256: expected, ...query } = params;
  familyInfo(family);
  if (typeof id !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) fail("dataset_id must be a canonical UUID from discovery");
  if (expected !== undefined && (typeof expected !== "string" || !/^[a-f0-9]{64}$/i.test(expected))) fail("Expected metadata SHA-256 must have 64 hex characters");
  const output: Record<string, unknown> = { size: integer(query.size ?? 100, "size", 1, 5000), offset: integer(query.offset ?? 0, "offset", 0, 10000000) };
  for (const [key, value] of Object.entries(query)) {
    if (key === "size" || key === "offset") continue;
    if (key === "keyword" || key === "sort" || key.startsWith("filter[")) output[key] = value;
    else if (/^[A-Za-z][A-Za-z0-9_]*$/.test(key) && !["keys", "fields", "year", "sort"].includes(key)) output[`filter[${key}]`] = value;
    else fail(`Unsupported page parameter: ${key}; use native filter syntax and preserve full rows`);
  }
  const url = urlFor(`/data-api/v1/dataset/${id}/data`, output);
  filterFields(output);
  return { family, id, expected, query: output, url };
}

function rowCount(native: unknown): number {
  if (Array.isArray(native)) return native.length;
  const envelope = record(native);
  if (Array.isArray(envelope.data)) return envelope.data.length;
  if (Array.isArray(envelope.results)) return envelope.results.length;
  fail("CMS response has no native row array", 502);
}

export async function releasePage(params: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const selection = pageControls(params);
  const deadline = Date.now() + 30000;
  const before = await discover(selection.family, deadline);
  const observation = record(before._partd);
  if (selection.expected !== undefined && String(selection.expected).toLowerCase() !== observation.metadata_sha256) fail("CMS metadata changed from requested version", 409);
  const distribution = candidates(record(before.metadata)).find(item => item.dataset_id === selection.id);
  if (!distribution) fail("Dataset ID is not an advertised API distribution for this family", 409);
  const { data: native } = await readDataPage(selection.url.pathname, selection.query, deadline);
  const count = rowCount(native);
  const after = await discover(selection.family, deadline);
  const end = record(after._partd);
  if (observation.metadata_sha256 !== end.metadata_sha256) fail("CMS metadata changed during the page read; discard and retry", 409);
  return { status: 200, data: { native, metadata: before.metadata, distribution, _partd: {
    ...observation, family: selection.family, dataset_id: selection.id, source_url: selection.url.href, request: selection.query,
    observed_after: end.observed_at, catalog_url_after: end.catalog_url, rows_returned: count, complete: false, atomic_snapshot: false,
    response_sha256: await hash(native),
    hash_scope: "Complete parsed native data response with recursively sorted object keys; distinct from metadata_sha256.",
    next_offset_candidate: count === selection.query.size ? Number(selection.query.offset) + count : null,
    interpretation: "Preserve native Year labels, suppression markers and manufacturer rollups. Quarterly observations may be cumulative and revised; annual final-action claims are not an immutable snapshot. Do not sum overlapping periods or overall/manufacturer rows. Gross spending excludes rebates and is not net spending.",
  } } };
}

export async function releaseDiscovery(params: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  const { family, ...unknown } = params;
  if (Object.keys(unknown).length) fail("Discovery accepts only family");
  return { status: 200, data: await discover(family, Date.now() + 30000) };
}

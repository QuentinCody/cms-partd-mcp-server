import type { ApiCatalog, ParamDef } from "@bio-mcp/shared/codemode/catalog";

const family: ParamDef = { name: "family", type: "string", required: true, enum: ["spending-annual", "spending-quarterly", "prescriber"], description: "Exact CMS dataset family; maturity is separate from its native reporting period." };
export const nativeQueryParams: ParamDef[] = [
  { name: "sort", type: "string", required: false, description: "Native column order, e.g. -Brnd_Name for descending. Columns are checked against the selected dataset's viewer metadata." },
  { name: "filter[example][condition][path]", type: "string", required: false, description: "Native column name for a labeled condition. All requested columns must exist in this dataset's viewer headers." },
  { name: "filter[example][condition][operator]", type: "string", required: false, description: "Documented native operator; case-sensitive. Unsupported values fail locally because CMS may silently ignore them.", enum: ["=", "<>", ">", ">=", "<", "<=", "STARTS_WITH", "CONTAINS", "ENDS_WITH", "IN", "NOT IN", "BETWEEN", "NOT BETWEEN", "IS NULL", "IS NOT NULL"] },
  { name: "filter[example][condition][value]", type: "string", required: false, description: "Scalar comparison value. IN/NOT IN and BETWEEN/NOT BETWEEN require indexed value[0], value[1], etc.; null operators omit values." },
  { name: "filter[example][condition][value][0]", type: "string", required: false, description: "First native set/range value; use consecutive indexed parameters for additional values." },
  { name: "filter[example][condition][value][1]", type: "string", required: false, description: "Second native set/range value." },
];
export const releaseEndpoints: ApiCatalog["endpoints"] = [
  { method: "GET", path: "/datasets/discover", category: "releases", summary: "Discover native CMS family metadata and API distributions, including rolling-latest labels, temporal/modified fields and a metadata hash. Reads current DCAT-US 3.0 series and linked releases; retains 1.1 compatibility. Series IDs are rolling aliases, not fixed releases.", queryParams: [family] },
  { method: "GET", path: "/datasets/page", category: "releases", summary: "Read full native rows from an explicitly selected advertised dataset ID, bracketed by metadata checks. Keeps preliminary versus annual final-action claims, source periods, suppression and manufacturer context separate.", queryParams: [family,
    { name: "dataset_id", type: "string", required: true, description: "UUID from /datasets/discover candidates. Membership in that family is checked before querying." },
    { name: "expected_metadata_sha256", type: "string", required: false, description: "Optional discovery hash; rejects changed metadata. Not an immutable data/content hash." },
    { name: "size", type: "number", required: false, description: "1–5000 rows, default 100; 4 MiB response cap may require smaller pages." },
    { name: "offset", type: "number", required: false, description: "0–10000000, default 0. Page consistency is not atomic." },
    { name: "Brnd_Name", type: "string", required: false, description: "Exact native brand filter. Other simple field names become filter[field]; native filter[...] syntax also accepted." },
    { name: "keyword", type: "string", required: false, description: "Native free-text keyword search." },
    ...nativeQueryParams,
  ] },
];

export const releaseWorkflows: ApiCatalog["workflows"] = [{
  title: "Discover annual and preliminary Part D releases separately",
  keywords: ["release", "annual", "quarterly", "preliminary", "final", "metadata"],
  description: "Return separate source metadata; do not merge periods or sum annual and overlapping cumulative quarterly values. Native modified dates are publication metadata, not observation periods.",
  code: 'const annual = await api.get("/datasets/discover", {family: "spending-annual"});\nconst quarterly = await api.get("/datasets/discover", {family: "spending-quarterly"});\nreturn {annual, quarterly};',
}, {
  title: "Read a discovered preliminary distribution with a metadata guard",
  keywords: ["quarterly", "version", "distribution", "claims lag", "suppression"],
  description: "Select the single rolling alias explicitly and return its native metadata. To use a dated distribution, select its exact dataset_id from discovery instead. Neither selection establishes immutability. Return staged metadata unchanged.",
  code: 'const discovery = await api.get("/datasets/discover", {family: "spending-quarterly"});\nif (discovery.__staged || discovery.__api_error) return discovery;\nconst latest = discovery.candidates.filter(item => item.rolling_latest);\nif (latest.length !== 1) throw new Error("Select an exact dataset_id from discovery; latest alias is missing or ambiguous");\nreturn await api.get("/datasets/page", {family: "spending-quarterly", dataset_id: latest[0].dataset_id, expected_metadata_sha256: discovery._partd.metadata_sha256, size: 50});',
}];

export const releaseNotes = "\n- Quarterly spending is preliminary and may be revised as claims mature. Year labels can be cumulative (Q1-Q4); this is not necessarily one independent row per quarter. Annual data uses final-action claims, not immutable final values.\n- Starting July 2026 CMS says the latest quarterly PDE extraction uses a three-month run-out; preserve the source period and metadata instead of inferring maturity from a page update date.\n- Gross spending excludes rebates/price concessions. Keep suppressed values unknown; do not sum Overall manufacturer rollups with component manufacturers.\n- CMS launched DCAT-US 3.0 on September 29, 2026. Discovery reads /data.json and falls back to /v1-1-data.json only on 404/410; CMS retires that compatibility endpoint March 31, 2027. In 3.0, metadata.series is the native family and metadata.releases preserves linked datasets, their temporal values and distributions. The metadata hash covers both; neither a dated endpoint nor the series last pointer proves immutable rows.\n- Raw legacy routes retain their UUID maps. Use discovery and /datasets/page to select current advertised versions explicitly; metadata hashes do not pin mutable row content.";

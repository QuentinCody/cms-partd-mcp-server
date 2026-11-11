import { fail } from "./release-http";

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Invalid CMS catalog record", 502);
  // SAFETY: JSON object validated above; values remain unknown until checked.
  return value as Record<string, unknown>;
}

export function catalogEntry(data: unknown, title: string): { metadata: Record<string, unknown>; catalog: Record<string, unknown>; format: string } {
  const root = record(data);
  if (Array.isArray(root.datasetSeries)) return seriesEntry(root, title);
  const standard = String(root.conformsTo ?? root["@context"] ?? "");
  if (!/\/v1\.1\//.test(standard) || !Array.isArray(root.dataset)) fail("Unsupported CMS catalog format; DCAT-US 1.1 compatibility catalog required", 502);
  const entries = root.dataset.filter(item => item && typeof item === "object" && typeof item.title === "string" && item.title.trim().toLowerCase() === title.toLowerCase());
  if (entries.length !== 1) fail("CMS catalog family missing or ambiguous", 502);
  const metadata = record(entries[0]);
  if (!Array.isArray(metadata.distribution)) fail("CMS catalog distributions missing", 502);
  const { dataset: _datasets, ...catalog } = root;
  return { metadata, catalog, format: "DCAT-US 1.1" };
}

export interface Candidate { dataset_id: string; url: string; rolling_latest: boolean; native: Record<string, unknown>; release_metadata?: Record<string, unknown> }

function apiUrl(raw: unknown): { dataset_id: string; url: string } | undefined {
  if (typeof raw !== "string") return;
  let url: URL;
  try { url = new URL(raw); } catch { return; }
  const match = /^\/data-api\/v1\/dataset\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/data$/.exec(url.pathname);
  if (url.origin !== "https://data.cms.gov" || url.username || url.password || url.search || url.hash || !match) return;
  return { dataset_id: match[1], url: url.href };
}

export function candidates(metadata: Record<string, unknown>): Candidate[] {
  if (metadata.series !== undefined) return seriesCandidates(metadata);
  if (!Array.isArray(metadata.distribution)) fail("CMS distributions missing", 502);
  const found: Candidate[] = [];
  for (const value of metadata.distribution) {
    const native = record(value);
    for (const field of ["downloadURL", "accessURL"]) {
      const endpoint = apiUrl(native[field]);
      if (!endpoint || found.some(item => item.url === endpoint.url)) continue;
      found.push({ ...endpoint, rolling_latest: native.description === "latest", native });
    }
  }
  return found;
}

/** CMS FAQ 1.7: series @id is rolling; dataset inSeries links identify releases. */
function seriesEntry(root: Record<string, unknown>, title: string) {
  if (!Array.isArray(root.dataset) || !Array.isArray(root.datasetSeries)) fail("Invalid CMS dataset-series catalog", 502);
  const seriesList = root.datasetSeries.map(record).filter(item => typeof item.title === "string" && item.title.trim().toLowerCase() === title.toLowerCase());
  if (seriesList.length !== 1) fail("CMS catalog family missing or ambiguous", 502);
  const series = seriesList[0];
  if (typeof series["@id"] !== "string" || !series["@id"]) fail("CMS series identifier missing", 502);
  const releases = root.dataset.map(record).filter(item => {
    if (!Array.isArray(item.inSeries)) return false;
    return item.inSeries.some(value => {
      const link = record(value);
      // An explicit different identity never matches merely by title.
      return link["@id"] !== undefined ? link["@id"] === series["@id"] : link.title === series.title;
    });
  });
  const ids = releases.map(item => item["@id"]);
  if (!releases.length) fail("CMS series has no linked releases in this catalog", 502);
  if (ids.some(id => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) fail("CMS release identifiers missing or ambiguous", 502);
  for (const item of releases) if (!Array.isArray(item.distribution)) fail("CMS release distributions missing", 502);
  const { dataset: _datasets, datasetSeries: _series, ...catalog } = root;
  return { metadata: { series, releases }, catalog, format: "DCAT-US 3.0" };
}

function seriesCandidates(metadata: Record<string, unknown>): Candidate[] {
  const series = record(metadata.series);
  if (!Array.isArray(metadata.releases)) fail("CMS series releases missing", 502);
  const rolling = apiUrl(series["@id"]);
  const found: Candidate[] = rolling ? [{ ...rolling, rolling_latest: true, native: series }] : [];
  for (const value of metadata.releases) {
    const release = record(value);
    for (const candidate of candidates(release)) {
      // A release whose URL is the series alias remains mutable/rolling.
      if (rolling?.url === candidate.url) continue;
      if (found.some(item => item.url === candidate.url)) fail("CMS API distribution belongs to multiple releases", 502);
      found.push({ ...candidate, rolling_latest: false, release_metadata: release });
    }
  }
  return found;
}

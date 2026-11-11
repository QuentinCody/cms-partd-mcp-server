import { fail, hash, readReleaseJson, urlFor } from "./release-http";
import { candidates, catalogEntry } from "./release-catalog";
export { candidates, catalogEntry, record } from "./release-catalog";

const FAMILIES = {
  "spending-annual": { title: "Medicare Part D Spending by Drug", maturity: "annual_final_action_claims", source: "https://data.cms.gov/summary-statistics-on-use-and-payments/medicare-medicaid-spending-by-drug/medicare-part-d-spending-by-drug" },
  "spending-quarterly": { title: "Medicare Quarterly Part D Spending by Drug", maturity: "preliminary", source: "https://data.cms.gov/summary-statistics-on-use-and-payments/medicare-medicaid-spending-by-drug/medicare-quarterly-part-d-spending-by-drug" },
  prescriber: { title: "Medicare Part D Prescribers - by Provider and Drug", maturity: "annual_final_action_claims", source: "https://data.cms.gov/tools/medicare-part-d-prescriber-look-up-tool" },
} as const;

export function familyInfo(value: unknown): (typeof FAMILIES)[keyof typeof FAMILIES] {
  if (typeof value !== "string" || !Object.prototype.hasOwnProperty.call(FAMILIES, value)) fail("family must be spending-annual, spending-quarterly or prescriber");
  // SAFETY: own-property check establishes membership in the fixed family map.
  return FAMILIES[value as keyof typeof FAMILIES];
}

export async function discover(family: unknown, deadline: number): Promise<Record<string, unknown>> {
  const info = familyInfo(family);
  let catalogUrl = urlFor("/data.json");
  let data: unknown;
  // The observed October 2026 catalog is 17.7 MB, above the former 16 MiB cap.
  try { data = await readReleaseJson(catalogUrl, deadline, 24 * 1024 * 1024); }
  catch (error) {
    if (!error || typeof error !== "object" || !("status" in error) || ![404, 410].includes(Number(error.status))) throw error;
    catalogUrl = urlFor("/v1-1-data.json");
    data = await readReleaseJson(catalogUrl, deadline, 24 * 1024 * 1024);
  }
  const { metadata, catalog, format } = catalogEntry(data, info.title);
  return { family, metadata, catalog, candidates: candidates(metadata), _partd: {
    catalog_url: catalogUrl.href, catalog_format: format, metadata_sha256: await hash(metadata), observed_at: new Date().toISOString(),
    maturity: info.maturity, maturity_source: info.source, historical_snapshot: false,
  } };
}

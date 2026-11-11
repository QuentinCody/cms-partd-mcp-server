import { afterEach, expect, it, vi } from "vitest";
import { candidates, catalogEntry, discover } from "./releases";
import { releasePage } from "./release-page";
import { hash } from "./release-http";

// Synthetic records following CMS FAQ 1.7, not a captured live catalog.
const title = "Medicare Quarterly Part D Spending by Drug";
const rolling = "https://data.cms.gov/data-api/v1/dataset/4ff7c618-4e40-483a-b390-c8a58c94fa15/data";
const dated = "https://data.cms.gov/data-api/v1/dataset/43ed210a-bf5d-49ba-baa4-5713a5a5ded1/data";
const series = { "@id": rolling, "@type": "DatasetSeries", title, last: { "@id": "https://data.cms.gov/releases/quarterly-2026-q1" }, modified: { "@value": "2026-09-29" } };
const release = { "@id": series.last["@id"], title: "2026 Q1", inSeries: [{ "@id": rolling, title }], temporal: [{ startDate: "2026-01-01", endDate: "2026-03-31" }], modified: { "@value": "2026-07-23" }, distribution: [{ format: "API", accessURL: dated }, { mediaType: "text/csv", downloadURL: "https://data.cms.gov/files/fixture.csv" }], future: { preserve: true } };
const catalog = { "@type": "Catalog", conformsTo: { title: "DCAT-US 3.0" }, datasetSeries: [series], dataset: [release] };
const metadata = { series, releases: [release] };
afterEach(() => vi.unstubAllGlobals());
function mock(...values: unknown[]) {
  const fetcher = vi.fn(); for (const value of values) fetcher.mockResolvedValueOnce(Response.json(value));
  vi.stubGlobal("fetch", fetcher); return fetcher;
}

it("preserves native series/release context and separates rolling and dated API endpoints", () => {
  expect(catalogEntry(catalog, title)).toEqual({ metadata, catalog: { "@type": "Catalog", conformsTo: { title: "DCAT-US 3.0" } }, format: "DCAT-US 3.0" });
  expect(candidates(metadata)).toEqual([
    { dataset_id: rolling.split("/")[6], url: rolling, rolling_latest: true, native: series },
    { dataset_id: dated.split("/")[6], url: dated, rolling_latest: false, native: release.distribution[0], release_metadata: release },
  ]);
});

it("uses series identity ahead of title and also supports the documented title-only link", () => {
  const titleOnly = { ...release, inSeries: [{ title }] };
  const impostor = { ...release, "@id": "different", inSeries: [{ "@id": "different", title }] };
  expect(catalogEntry({ ...catalog, dataset: [titleOnly, impostor] }, title).metadata).toEqual({ series, releases: [titleOnly] });
});

it("does not merge unrelated releases with the same dataset title", () => {
  const unrelated = { ...release, "@id": "different", inSeries: [{ title: "Other family" }] };
  expect(catalogEntry({ ...catalog, dataset: [release, unrelated] }, title).metadata).toEqual(metadata);
});

it("reads current catalog and fingerprints complete family metadata", async () => {
  const fetcher = mock(catalog);
  expect(await discover("spending-quarterly", Date.now() + 1000)).toMatchObject({ metadata, _partd: { catalog_format: "DCAT-US 3.0", metadata_sha256: await hash(metadata), maturity: "preliminary", historical_snapshot: false } });
  expect(String(fetcher.mock.calls[0][0])).toBe("https://data.cms.gov/data.json");
});

it.each([rolling, dated])("keeps selected distribution context and full rows for %s", async url => {
  const row = { Year: "2026 (Q1)", Tot_Benes: "*", Tot_Spndng: "001.2300" };
  mock(catalog, [row], catalog);
  expect(await releasePage({ family: "spending-quarterly", dataset_id: url.split("/")[6], expected_metadata_sha256: await hash(metadata) })).toMatchObject({ data: { metadata, native: [row], distribution: { url, rolling_latest: url === rolling }, _partd: { catalog_format: "DCAT-US 3.0", complete: false, atomic_snapshot: false } } });
});

it("rejects a changed series last pointer during paging", async () => {
  mock(catalog, [], { ...catalog, datasetSeries: [{ ...series, last: { "@id": "new-release" } }] });
  await expect(releasePage({ family: "spending-quarterly", dataset_id: dated.split("/")[6] })).rejects.toMatchObject({ status: 409 });
});

it("rejects changed release metadata during paging", async () => {
  mock(catalog, [], { ...catalog, dataset: [{ ...release, modified: "changed" }] });
  await expect(releasePage({ family: "spending-quarterly", dataset_id: dated.split("/")[6] })).rejects.toMatchObject({ status: 409 });
});

it.each([
  { ...catalog, datasetSeries: [] },
  { ...catalog, datasetSeries: [series, series] },
  { ...catalog, datasetSeries: [{ ...series, "@id": null }] },
  { ...catalog, dataset: [release, release] },
  { ...catalog, dataset: [{ ...release, "@id": null }] },
  { ...catalog, dataset: [{ ...release, distribution: null }] },
  { ...catalog, dataset: null },
  { ...catalog, dataset: [] },
])("rejects missing or ambiguous series/release identity %#", value => {
  expect(() => catalogEntry(value, title)).toThrow();
});

it("rejects one API endpoint assigned to multiple releases", () => {
  expect(() => candidates({ series, releases: [release, { ...release, "@id": "second-release" }] })).toThrow("multiple releases");
});

it("does not promote release descriptions to rolling aliases", () => {
  const selected = { ...release, distribution: [{ accessURL: dated, description: "latest" }, { accessURL: rolling }] };
  expect(candidates({ series, releases: [selected] }).map(item => item.rolling_latest)).toEqual([true, false]);
});

it("preserves non-API distribution evidence without following external links", () => {
  const external = { ...release, distribution: [{ accessURL: dated.replace("data.cms.gov", "example.com") }] };
  expect(candidates({ series, releases: [external] })).toHaveLength(1);
  expect(catalogEntry({ ...catalog, dataset: [external] }, title).metadata).toEqual({ series, releases: [external] });
});

it("does not hide a malformed current catalog behind a compatibility request", async () => {
  const fetcher = mock({ ...catalog, datasetSeries: [] });
  await expect(discover("spending-quarterly", Date.now() + 1000)).rejects.toMatchObject({ status: 502 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

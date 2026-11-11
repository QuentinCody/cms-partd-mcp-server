import { afterEach, expect, it, vi } from "vitest";
import { candidates, catalogEntry, discover, familyInfo } from "./releases";

// Provider-published distribution example: catalog.data.gov/dataset/medicare-quarterly-part-d-spending-by-drug (September 29, 2026).
const title = "Medicare Quarterly Part D Spending by Drug";
const latest = "https://data.cms.gov/data-api/v1/dataset/4ff7c618-4e40-483a-b390-c8a58c94fa15/data";
const dated = "https://data.cms.gov/data-api/v1/dataset/43ed210a-bf5d-49ba-baa4-5713a5a5ded1/data";
const metadata = { title, temporal: "2026-01-01/2026-03-31", modified: "2026-07-23", distribution: [
  { title: `${title} : 2026-01-01`, description: "latest", downloadURL: latest },
  { title: `${title} : 2026-01-01`, downloadURL: dated },
  { downloadURL: "https://data.cms.gov/sites/default/files/2026-07/QDD_PTD_RQ2603_P01_V10_DQT2601_20260708.csv" },
] };
const catalog = { conformsTo: "https://project-open-data.cio.gov/v1.1/schema", dataset: [metadata] };
afterEach(() => vi.unstubAllGlobals());

it("retains native metadata and distinguishes a rolling alias from a dated distribution", () => {
  expect(catalogEntry(catalog, title).metadata).toEqual(metadata);
  expect(candidates(metadata)).toEqual([
    { dataset_id: "4ff7c618-4e40-483a-b390-c8a58c94fa15", url: latest, rolling_latest: true, native: metadata.distribution[0] },
    { dataset_id: "43ed210a-bf5d-49ba-baa4-5713a5a5ded1", url: dated, rolling_latest: false, native: metadata.distribution[1] },
  ]);
});

it("uses the current catalog with legacy-shape compatibility and preserves preliminary maturity separately from period", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(catalog)); vi.stubGlobal("fetch", fetcher);
  const result = await discover("spending-quarterly", Date.now() + 1000);
  expect(result).toMatchObject({ metadata, _partd: { maturity: "preliminary", catalog_format: "DCAT-US 1.1", historical_snapshot: false } });
  expect(String(fetcher.mock.calls[0][0])).toBe("https://data.cms.gov/data.json");
});

it("falls back to the compatibility catalog only on missing current endpoint", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("", { status: 404 })).mockResolvedValueOnce(Response.json(catalog)); vi.stubGlobal("fetch", fetcher);
  expect(await discover("spending-quarterly", Date.now() + 1000)).toMatchObject({ _partd: { catalog_url: "https://data.cms.gov/v1-1-data.json" } });
});

it.each([429, 500])("does not conceal upstream HTTP %i with a fallback", async status => {
  const fetcher = vi.fn().mockResolvedValue(new Response("", { status })); vi.stubGlobal("fetch", fetcher);
  await expect(discover("spending-quarterly", Date.now() + 1000)).rejects.toMatchObject({ status });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([
  { ...catalog, conformsTo: "https://example.gov/v3.0/schema" },
  { ...catalog, dataset: [] },
  { ...catalog, dataset: [metadata, metadata] },
  { ...catalog, dataset: [{ ...metadata, distribution: null }] },
])("rejects unqualified catalog format or ambiguous/missing family %#", value => {
  expect(() => catalogEntry(value, title)).toThrow();
});

it("never follows external, credential-bearing, query-bearing or CSV distribution URLs", () => {
  expect(candidates({ distribution: [
    { downloadURL: latest.replace("data.cms.gov", "evil.example") },
    { downloadURL: latest.replace("https://", "https://user@") },
    { downloadURL: latest + "?redirect=1" },
    { accessURL: dated },
    { downloadURL: "https://data.cms.gov/file.csv" },
  ] })).toEqual([{ dataset_id: "43ed210a-bf5d-49ba-baa4-5713a5a5ded1", url: dated, rolling_latest: false, native: { accessURL: dated } }]);
});

it("labels annual claims separately and rejects prototype/unknown family names", () => {
  expect(familyInfo("spending-annual").maturity).toBe("annual_final_action_claims");
  expect(() => familyInfo("constructor")).toThrow();
  expect(() => familyInfo("unrelated")).toThrow();
});

it("accepts the observed catalog size above 16 MiB while preserving an explicit ceiling", async () => {
  const large = { ...catalog, description: "x".repeat(17 * 1024 * 1024) };
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(large)); vi.stubGlobal("fetch", fetcher);
  expect(await discover("spending-quarterly", Date.now() + 5000)).toMatchObject({ metadata });
  fetcher.mockResolvedValueOnce(new Response("x".repeat(24 * 1024 * 1024 + 1)));
  await expect(discover("spending-quarterly", Date.now() + 5000)).rejects.toMatchObject({ status: 502 });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

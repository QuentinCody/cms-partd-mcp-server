import { afterEach, expect, it, vi } from "vitest";
import { createPartdApiFetch } from "./api-adapter";
import { releasePage } from "./release-page";
import { hash } from "./release-http";

const id = "43ed210a-bf5d-49ba-baa4-5713a5a5ded1";
const metadata = { title: "Medicare Quarterly Part D Spending by Drug", temporal: "2026-01-01/2026-03-31", modified: "2026-07-23", distribution: [{ title: "Quarterly : 2026-01-01", downloadURL: `https://data.cms.gov/data-api/v1/dataset/${id}/data` }] };
const catalog = { conformsTo: "https://project-open-data.cio.gov/v1.1/schema", dataset: [metadata] };
const params = { family: "spending-quarterly", dataset_id: id };
const viewer = (dataset = id) => ({ meta: { success: true, datset_uuid: dataset, headers: ["Brnd_Name", "Prscrbr_NPI"] } });
const row = { Year: "2025 (Q1-Q4)", Brnd_Name: "FIXTURE", Mftr_Name: "Overall", Tot_Spndng: "1234.500", Tot_Benes: "*", future_column: "retain" };
function mock(...responses: unknown[]) {
  const fetcher = vi.fn(); for (const response of responses) fetcher.mockResolvedValueOnce(Response.json(response));
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
afterEach(() => vi.unstubAllGlobals());

it("preserves cumulative labels, precision, suppression, rollups and metadata separately", async () => {
  const fetcher = mock(catalog, [row], catalog);
  const result = await releasePage({ ...params, size: 1 });
  expect(result.data).toMatchObject({ native: [row], metadata, distribution: { dataset_id: id, rolling_latest: false }, _partd: { maturity: "preliminary", dataset_id: id, complete: false, atomic_snapshot: false, historical_snapshot: false, rows_returned: 1, next_offset_candidate: 1 } });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(result.data._partd).toMatchObject({ response_sha256: await hash([row]) });
});

it("accepts expected metadata hash and passes exact and complex filters once", async () => {
  const fetcher = mock(catalog, viewer(), { results: [row], total: 500 }, catalog);
  const result = await releasePage({ ...params, expected_metadata_sha256: await hash(metadata), Brnd_Name: "A+B", "filter[example][condition][path]": "Brnd_Name", "filter[example][condition][operator]": "CONTAINS", "filter[example][condition][value]": "A", size: 50 });
  const url = new URL(fetcher.mock.calls[2][0]);
  expect(url.searchParams.get("filter[Brnd_Name]")).toBe("A+B");
  expect(url.searchParams.get("filter[example][condition][operator]")).toBe("CONTAINS");
  expect(url.searchParams.has("expected_metadata_sha256")).toBe(false);
  expect(result.data).toMatchObject({ native: { results: [row], total: 500 }, _partd: { next_offset_candidate: null } });
});

it("rejects a stale metadata hash before reading rows", async () => {
  const fetcher = mock(catalog);
  await expect(releasePage({ ...params, expected_metadata_sha256: "0".repeat(64) })).rejects.toMatchObject({ status: 409, data: { error: { status: 409, code: "CMS_REQUEST_ERROR" } } });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("rejects changed metadata after a read", async () => {
  mock(catalog, [row], { ...catalog, dataset: [{ ...metadata, modified: "2026-09-01" }] });
  await expect(releasePage(params)).rejects.toMatchObject({ status: 409 });
});

it("requires membership in the selected family, even for a valid CMS UUID", async () => {
  const fetcher = mock(catalog);
  await expect(releasePage({ ...params, dataset_id: "9552739e-3d05-4c1b-8eff-ecabf391e2e5" })).rejects.toMatchObject({ status: 409 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([{ size: 5001 }, { size: 0 }, { offset: -1 }, { keys: "Year" }, { family: "other" }, { dataset_id: "../x" }, { expected_metadata_sha256: "bad" }, { Brnd_Name: {} }])("rejects invalid page controls before network access %#", async invalid => {
  const fetcher = mock();
  await expect(releasePage({ ...params, ...invalid })).rejects.toMatchObject({ status: 400 });
  expect(fetcher).not.toHaveBeenCalled();
});

it("rejects a non-row success envelope", async () => {
  mock(catalog, { notice: "try later" });
  await expect(releasePage(params)).rejects.toMatchObject({ status: 502 });
});

it("preserves raw annual/quarterly routes and the caller's prescriber year", async () => {
  const fetcher = mock([row], [row], viewer("d5aa71a8-dcc0-4570-8bcf-bd39deac69fe"), [{ Prscrbr_NPI: "0123456789" }]);
  const api = createPartdApiFetch();
  expect(await api({ method: "GET", path: "/spending/annual" })).toEqual({ status: 200, data: [row] });
  await api({ method: "GET", path: "/spending/quarterly" });
  const query = { year: "2024", Prscrbr_NPI: "0123456789" };
  await api({ method: "GET", path: "/prescriber/search", params: query });
  expect(query.year).toBe("2024");
  expect(String(fetcher.mock.calls[0][0])).toContain("7e0b4365-fd63-4a29-8f5e-e0ac9f66a81b");
  expect(String(fetcher.mock.calls[1][0])).toContain("4ff7c618-4e40-483a-b390-c8a58c94fa15");
  expect(String(fetcher.mock.calls[2][0])).toContain("d5aa71a8-dcc0-4570-8bcf-bd39deac69fe");
});

it("retains the existing filtered-prescriber empty-result guard", async () => {
  const fetcher = mock(viewer("9552739e-3d05-4c1b-8eff-ecabf391e2e5"), [], [{ Prscrbr_NPI: "other" }]);
  const result = await createPartdApiFetch()({ method: "GET", path: "/prescriber/search", params: { Prscrbr_NPI: "0123456789" } });
  expect(result.data).toMatchObject({ data: [], __guard: expect.any(Object) });
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("routes discovery locally and rejects unsupported method/body", async () => {
  mock(catalog);
  const api = createPartdApiFetch();
  expect(await api({ method: "GET", path: "/datasets/discover", params: { family: "spending-quarterly" } })).toMatchObject({ data: { metadata } });
  await expect(api({ method: "POST", path: "/datasets/page" })).rejects.toMatchObject({ status: 405 });
  await expect(api({ method: "GET", path: "/spending/annual", body: {} })).rejects.toMatchObject({ status: 405 });
});

it.each(["constructor", "toString", "__proto__"])("rejects inherited prescriber year %s before fetching", async year => {
  const fetcher = mock();
  await expect(createPartdApiFetch()({ method: "GET", path: "/prescriber/search", params: { year } })).rejects.toMatchObject({ status: 400 });
  expect(fetcher).not.toHaveBeenCalled();
});

it("preserves native complex filters on raw routes without double wrapping", async () => {
  const fetcher = mock(viewer("4ff7c618-4e40-483a-b390-c8a58c94fa15"), [row]);
  const params = { "filter[brand][condition][path]": "Brnd_Name", "filter[brand][condition][operator]": "CONTAINS", "filter[brand][condition][value]": "A+B", offset: 0, size: 1 };
  await createPartdApiFetch()({ method: "GET", path: "/spending/quarterly", params });
  const url = new URL(fetcher.mock.calls[1][0]);
  for (const [key, value] of Object.entries(params)) expect(url.searchParams.get(key)).toBe(String(value));
  expect(url.searchParams.has("filter[filter[brand][condition][path]]")).toBe(false);
});

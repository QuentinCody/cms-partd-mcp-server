import { afterEach, expect, it, vi } from "vitest";
import { filterFields, readDataPage } from "./filters";
import { hash } from "./release-http";

const id = "9552739e-3d05-4c1b-8eff-ecabf391e2e5";
const path = `/data-api/v1/dataset/${id}/data`;
const viewer = { meta: { success: true, datset_uuid: id, headers: ["Prscrbr_NPI", "Brnd_Name", "Tot_Clms"] } };
afterEach(() => vi.unstubAllGlobals());

it("rejects a silently ignored native column using the actual dataset header evidence", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(viewer)); vi.stubGlobal("fetch", fetcher);
  const expected = await hash(viewer);
  await expect(readDataPage(path, { "filter[typo]": "x" }, Date.now() + 1000)).rejects.toMatchObject({ status: 400, data: {
    error: { code: "UNKNOWN_CMS_COLUMNS", fields: ["typo"] }, schema_evidence: { native: viewer, response_sha256: expected },
  } });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(new URL(fetcher.mock.calls[0][0]).pathname).toBe(path.replace(/data$/, "data-viewer"));
});

it("preserves supported filters/sorting once and accepts genuine empty results", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(viewer)).mockResolvedValueOnce(Response.json([])); vi.stubGlobal("fetch", fetcher);
  const query = { "filter[Prscrbr_NPI]": "0123456789", sort: "-Tot_Clms", size: 50, offset: 10 };
  expect(await readDataPage(path, query, Date.now() + 1000)).toEqual({ status: 200, data: [] });
  const url = new URL(fetcher.mock.calls[1][0]);
  for (const [key, value] of Object.entries(query)) expect(url.searchParams.get(key)).toBe(String(value));
});

it("retains supported nested groups, indexed set values and null conditions", () => {
  expect(filterFields({ "filter[group][group][conjunction]": "OR",
    "filter[a][condition][path]": "Prscrbr_NPI", "filter[a][condition][operator]": "IN", "filter[a][condition][value][0]": "0123456789", "filter[a][condition][value][1]": "1234567890", "filter[a][condition][memberOf]": "group",
    "filter[b][condition][path]": "Tot_Clms", "filter[b][condition][operator]": "IS NULL", "filter[b][condition][memberOf]": "group",
  })).toEqual(["Prscrbr_NPI", "Tot_Clms"]);
});

it.each([
  { "filter[x][condition][operator]": "UNSUPPORTED", "filter[x][condition][value]": "1" },
  { "filter[x][condition][operator]": "contains", "filter[x][condition][value]": "x" },
  { "filter[x][condition][path]": "Brnd_Name" },
  { "filter[x][condition][operator]": "BETWEEN", "filter[x][condition][value][0]": "1" },
  { "filter[x][condition][operator]": "IN", "filter[x][condition][value]": "a,b" },
  { "filter[x]": "a", "filter[x][value][0]": "b" },
  { "filter[x][condition][operator]": "IS NULL", "filter[x][condition][value]": "a" },
  { "filter[x][condition][typo]": "a" },
  { "filter[x][group][conjunction]": "AND", "filter[x][group][memberOf]": "x", "filter[y]": "a" },
  { "filter[x][value]": "a", "filter[x][memberOf]": "absent" },
  { sort: "-missing field" },
])("rejects malformed or silently ignored filter controls before network access %#", async query => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(readDataPage(path, query, Date.now() + 1000)).rejects.toMatchObject({ status: 400 });
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([{ size: -1 }, { size: 0 }, { size: 5001 }, { offset: -1 }])("rejects native paging controls that could return misleading empty data %#", async query => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(readDataPage(path, query, Date.now() + 1000)).rejects.toMatchObject({ status: 400 });
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([{ ...viewer, meta: { ...viewer.meta, datset_uuid: "other" } }, { meta: { success: true, datset_uuid: id, headers: [] } }])("rejects mismatched or missing column schema %#", async native => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(native)); vi.stubGlobal("fetch", fetcher);
  await expect(readDataPage(path, { "filter[Prscrbr_NPI]": "1" }, Date.now() + 1000)).rejects.toMatchObject({ status: 502 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

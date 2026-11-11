import { afterEach, expect, it, vi } from "vitest";
import { releaseWorkflows } from "./releases";
import { partdCatalog } from "./catalog";
import { createPartdApiFetch } from "../lib/api-adapter";

const id = "4ff7c618-4e40-483a-b390-c8a58c94fa15";
const catalog = { conformsTo: "https://project-open-data.cio.gov/v1.1/schema", dataset: ["Medicare Part D Spending by Drug", "Medicare Quarterly Part D Spending by Drug"].map(title => ({ title, distribution: [{ description: "latest", downloadURL: `https://data.cms.gov/data-api/v1/dataset/${id}/data` }] })) };
afterEach(() => vi.unstubAllGlobals());

it.each((releaseWorkflows ?? []).flatMap(workflow => ["1.1", "3.0"].map(format => ({ ...workflow, format }))))("executes documented workflow: $title ($format)", async workflow => {
  const series = catalog.dataset.map(item => ({ title: item.title, "@id": item.distribution[0].downloadURL }));
  const current = { datasetSeries: series, dataset: series.map(item => ({ "@id": `${item["@id"]}/${encodeURIComponent(item.title)}`, inSeries: [{ title: item.title }], distribution: [{ format: "API", accessURL: item["@id"] }] })) };
  const source = workflow.format === "1.1" ? catalog : current;
  vi.stubGlobal("fetch", vi.fn(async (url: URL) => Response.json(url.pathname.endsWith(".json") ? source : [{ Year: "2025 (Q1-Q4)", Tot_Benes: "*" }])));
  const fetcher = createPartdApiFetch();
  const api = { get: async (path: string, params: Record<string, unknown>) => (await fetcher({ method: "GET", path, params })).data };
  // SAFETY: execute checked-in workflow text against the local mocked adapter only.
  const run = new Function("api", `return (async () => {${workflow.code}})()`);
  const result = await run(api);
  if (workflow.title.includes("separately")) {
    expect(result).toMatchObject({ annual: { _partd: { maturity: "annual_final_action_claims" } }, quarterly: { _partd: { maturity: "preliminary" } } });
  } else {
    expect(result).toMatchObject({ native: [{ Year: "2025 (Q1-Q4)", Tot_Benes: "*" }], _partd: { maturity: "preliminary", complete: false } });
  }
  expect(partdCatalog.endpointCount).toBe(partdCatalog.endpoints.length);
});

it("returns a staged discovery handle without dereferencing missing metadata", async () => {
  const handle = { __staged: true, data_access_id: "fixture" };
  const api = { get: vi.fn().mockResolvedValue(handle) };
  const workflow = releaseWorkflows?.[1]; if (!workflow) throw new Error("Missing recipe");
  // SAFETY: checked-in workflow with a fixture staging handle.
  const run = new Function("api", `return (async () => {${workflow.code}})()`);
  expect(await run(api)).toBe(handle);
  expect(api.get).toHaveBeenCalledTimes(1);
});

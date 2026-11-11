import { afterEach, expect, it, vi } from "vitest";
import { McpServer } from "@bio-mcp/shared/mcp";
import { createApiProxyTool } from "@bio-mcp/shared/tools/api-proxy";
import { registerCodeMode } from "./code-mode";
import { registerQueryData } from "./query-data";
import { registerGetSchema } from "./get-schema";
import { partdCatalog } from "../spec/catalog";
import { createPartdApiFetch } from "../lib/api-adapter";

afterEach(() => vi.unstubAllGlobals());
it("registers both names for all tools with success/error response fields", async () => {
  const server = new McpServer({ name: "fixture", version: "1" });
  // SAFETY: invalid execution never invokes loader or DO.
  registerCodeMode(server, { CODE_MODE_LOADER: { get: () => ({}) } } as unknown as Parameters<typeof registerCodeMode>[1]);
  registerQueryData(server, {}); registerGetSchema(server, {});
  // SAFETY: inspect actual SDK callbacks solely for the registration contract test.
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<unknown> }> })._registeredTools;
  expect(Object.keys(tools)).toHaveLength(8);
  for (const prefix of ["", "mcp_"]) {
    expect(await tools[prefix + "partd_search"].handler({ query: "preliminary", max_results: 5 }, {})).toMatchObject({ content: expect.any(Array), structuredContent: { success: true } });
    for (const [name, args] of [["execute", { code: "" }], ["query_data", { data_access_id: "fixture", sql: "SELECT 1" }], ["get_schema", { data_access_id: "fixture" }]] as const) {
      expect(await tools[prefix + "partd_" + name].handler(args, {})).toMatchObject({ content: expect.any(Array), structuredContent: expect.any(Object), isError: true });
    }
  }
});

it("stages full release context and native rows without converting suppression or dates", async () => {
  const id = "4ff7c618-4e40-483a-b390-c8a58c94fa15";
  const series = { title: "Medicare Quarterly Part D Spending by Drug", "@id": `https://data.cms.gov/data-api/v1/dataset/${id}/data` };
  const release = { "@id": "https://data.cms.gov/releases/fixture", inSeries: [{ "@id": series["@id"] }], temporal: [{ startDate: "2026-01-01", endDate: "2026-03-31" }], distribution: [{ format: "API", accessURL: series["@id"] }] };
  const metadata = { series, releases: [release] };
  const catalog = { conformsTo: { title: "DCAT-US 3.0" }, datasetSeries: [series], dataset: [release] };
  const row = { Year: "2025 (Q1-Q4)", Tot_Benes: "*", notes: "α".repeat(20000) };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(catalog)).mockResolvedValueOnce(Response.json([row])).mockResolvedValueOnce(Response.json(catalog)));
  const stored: unknown[] = [];
  // SAFETY: fixture implements the two DO methods used by shared staging.
  const namespace = { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/process") {
      // SAFETY: payload comes from shared staging under test.
      const payload = await request.json() as { data: unknown }; stored.push(payload.data);
      return Response.json({ success: true, tables_created: ["payloads"], total_rows: 1 });
    }
    return Response.json({ success: true, schema: { tables: { payloads: { columns: [{ name: "root_json" }] } } } });
  } }) } as unknown as DurableObjectNamespace;
  const proxy = createApiProxyTool({ apiFetch: createPartdApiFetch(), catalog: partdCatalog, doNamespace: namespace, stagingPrefix: "partd", maxInlineBytes: 30 * 1024 });
  const result = await proxy.handler({ method: "GET", path: "/datasets/page", params: { family: "spending-quarterly", dataset_id: id } }, { sql: () => [] });
  expect(result).toMatchObject({ __staged: true, data_access_id: expect.any(String) });
  expect(stored.map(value => typeof value === "string" ? JSON.parse(value) : value)).toEqual(expect.arrayContaining([expect.objectContaining({ native: [row], metadata, _partd: expect.objectContaining({ maturity: "preliminary" }) })]));
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(100000);
});

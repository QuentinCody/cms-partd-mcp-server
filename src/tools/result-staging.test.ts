import { afterEach, expect, it, vi } from "vitest";
import { McpServer } from "@bio-mcp/shared/mcp";
import { hashCanonicalJson } from "@bio-mcp/shared";
import { DynamicWorkerExecutor } from "@bio-mcp/shared/codemode/execute-tool";
import { registerCodeMode } from "./code-mode";
import { registerQueryData } from "./query-data";
import { registerGetSchema } from "./get-schema";
import { partdResponse } from "../lib/tool-result";

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const stored: unknown[] = [];
  const namespace = { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path === "/process") {
      const { data } = await request.json() as { data: unknown };
      stored.push(typeof data === "string" ? JSON.parse(data) : data);
      return Response.json({ success: true, tables_created: ["payloads"], total_rows: 1 });
    }
    if (path === "/query") return Response.json({ success: true, results: [{ native_text: "α".repeat(22000) }], row_count: 1 });
    return Response.json({ success: true, schema: { tables: { rows: { columns: [{ name: "text", description: "α".repeat(22000) }] } } } });
  } }) };
  const env = { PARTD_DATA_DO: namespace, CODE_MODE_LOADER: { get: () => ({}) } } as unknown as Parameters<typeof registerCodeMode>[1];
  const server = new McpServer({ name: "fixture", version: "1" });
  registerCodeMode(server, env); registerQueryData(server, env); registerGetSchema(server, env);
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<Record<string, unknown>> }> })._registeredTools;
  return { stored, env, tools };
}

it("registers all eight aliases and discovers dataset-series operations with both search names", async () => {
  const { tools } = fixture();
  expect(Object.keys(tools).sort()).toEqual(["search", "execute", "get_schema", "query_data"].flatMap(name => [`partd_${name}`, `mcp_partd_${name}`]).sort());
  for (const prefix of ["", "mcp_"]) {
    const result = await tools[`${prefix}partd_search`].handler({ query: "releases", max_results: 25 }, {});
    expect(result).toMatchObject({ content: expect.any(Array), structuredContent: { success: true } });
    expect(JSON.stringify(result)).toContain("/datasets/discover");
    expect(JSON.stringify(result)).toContain("/datasets/page");
  }
});

it.each([ ["", 22000], ["mcp_", 22000], ["", 60000], ["mcp_", 60000] ] as const)("stages composed release evidence through %s execution (%i characters)", async (prefix, length) => {
  const { tools, stored } = fixture();
  const native = { observations: [{ temporal: [{ startDate: "2026-01-01", endDate: "2026-03-31" }], text: "α".repeat(length), values: [0, null, "0001"] }], rows: [{ Year: "2026 (Q1)", Tot_Benes: "*" }] };
  // Only V8 is replaced; final result handling, citation, registration and staging are real.
  vi.spyOn(DynamicWorkerExecutor.prototype, "execute").mockResolvedValue({ result: native });
  const result = await tools[`${prefix}partd_execute`].handler({ code: "return composed;" }, {});
  expect(result).toMatchObject({ content: expect.any(Array), structuredContent: { success: true, staged: true, _staging: expect.any(Object), _meta: { citation: { result_hash: expect.any(String) } } } });
  expect(stored).toContainEqual(expect.objectContaining({ structuredContent: expect.objectContaining({ data: native }) }));
  const complete = stored.find(value => (value as { structuredContent?: { data?: unknown } }).structuredContent?.data !== undefined);
  expect(result).toMatchObject({ structuredContent: { _meta: { citation: { result_scope: "staged:full_result", result_hash: await hashCanonicalJson(complete) } } } });
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(30000);
});

it.each(["partd_query_data", "mcp_partd_query_data", "partd_get_schema", "mcp_partd_get_schema"])("keeps complete large SQL/schema output recoverable through %s", async name => {
  const { tools, stored } = fixture();
  const result = await tools[name].handler({ data_access_id: "fixture", sql: "SELECT native_text FROM rows" }, {});
  expect(result).toMatchObject({ content: expect.any(Array), structuredContent: { success: true, staged: true, _staging: expect.any(Object) } });
  expect(JSON.stringify(stored)).toContain("α".repeat(22000));
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(30000);
});

it("retains failure state and full error evidence when staging", async () => {
  const { env, stored } = fixture();
  const original = { content: [{ type: "text" as const, text: "error evidence" }], structuredContent: { success: false, error: { message: "α".repeat(22000) } } };
  expect(await partdResponse(async () => original, env, "partd_execute", {})).toMatchObject({ isError: true, structuredContent: { success: false, staged: true } });
  expect(stored).toContainEqual(expect.objectContaining({ ...original, structuredContent: expect.objectContaining(original.structuredContent), isError: true }));
});

it("fails explicitly when an oversized response cannot be staged", async () => {
  expect(await partdResponse(async () => ({ content: [{ type: "text", text: "α".repeat(22000) }] }), {}, "partd_execute", {})).toMatchObject({ isError: true, content: expect.any(Array), structuredContent: { success: false, error: { code: "RESPONSE_ERROR" } } });
});

it.each(["", "mcp_"])("preserves small results and both error fields through %s execution", async prefix => {
  const { tools, stored } = fixture();
  const native = { rows: [{ Year: "2026 (Q1)", Tot_Benes: "*" }] };
  const execute = vi.spyOn(DynamicWorkerExecutor.prototype, "execute").mockResolvedValue({ result: native });
  const tool = tools[`${prefix}partd_execute`];
  const result = await tool.handler({ code: "return lookup;" }, {});
  expect(result).toMatchObject({ content: expect.any(Array), structuredContent: { success: true, data: native, _meta: { citation: { result_hash: await hashCanonicalJson(native) } } } });
  expect(stored).toHaveLength(0);
  execute.mockResolvedValue({ error: "HTTP 409: CMS metadata changed" });
  expect(await tool.handler({ code: "return lookup;" }, {})).toMatchObject({ isError: true, content: expect.any(Array), structuredContent: { success: false, error: { message: expect.stringContaining("409") } } });
});

it("returns a bounded MCP error when storage rejects the complete result", async () => {
  const namespace = { idFromName: (name: string) => name, get: () => ({ fetch: async () => { throw new Error("storage unavailable"); } }) };
  const result = await partdResponse(async () => ({ content: [{ type: "text", text: "large" }], structuredContent: { success: true, data: "α".repeat(60000) } }), { PARTD_DATA_DO: namespace }, "partd_execute", {});
  expect(result).toMatchObject({ isError: true, content: expect.any(Array), structuredContent: { success: false, error: { code: "RESPONSE_ERROR" } } });
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(30000);
});

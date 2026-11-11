import { expect, it, vi } from "vitest";
vi.mock("@bio-mcp/shared/staging/rest-staging-do", () => ({ RestStagingDO: class {} }));
import { PartdDataDO } from "./do";

class Probe extends PartdDataDO {
  project(value: unknown) { return this.getTabularData(value); }
}

it("keeps canonical evidence scalar so the inherited payload store remains lossless", () => {
  const probe = Object.create(Probe.prototype) as Probe;
  for (const value of ['{"entries":[{"id":"example"}]}', null, 0, false]) expect(probe.project(value)).toBe(value);
  expect(probe.project({ rows: [], sql: "SELECT 1" })).toMatchObject({ query_rows: [], response_context: expect.any(Array) });
});

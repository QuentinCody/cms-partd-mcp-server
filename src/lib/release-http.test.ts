import { afterEach, expect, it, vi } from "vitest";
import { hash, readReleaseJson, urlFor } from "./release-http";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("preserves native filter syntax, NPI strings and special characters exactly once", () => {
  const url = urlFor("/data-api/v1/dataset/test/data", { "filter[Prscrbr_NPI]": "0123456789", "filter[Brnd_Name]": "A+B & C%", size: 50 });
  expect(url.searchParams.get("filter[Prscrbr_NPI]")).toBe("0123456789");
  expect(url.searchParams.get("filter[Brnd_Name]")).toBe("A+B & C%");
});
it.each([{}, [], null, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid parameter values %#", value => {
  expect(() => urlFor("/", { value })).toThrow();
});
it("rejects non-CMS origins and hashes records deterministically", async () => {
  expect(() => urlFor("https://evil.example/data")).toThrow();
  expect(await hash({ b: [1, 2], a: "0" })).toBe(await hash({ a: "0", b: [1, 2] }));
  expect(await hash([1, 2])).not.toBe(await hash([2, 1]));
});
it.each([
  [() => new Response("private error", { status: 503 }), 503],
  [() => new Response("<html>bad</html>"), 502],
  [() => Response.json({ error: "bad" }), 502],
  [() => new Response("x".repeat(1025)), 502],
] as const)("bounds and validates provider payloads %#", async (response, status) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
  await expect(readReleaseJson(urlFor("/"), Date.now() + 1000, 1024)).rejects.toMatchObject({ status });
});
it.each(["headers", "body"])("times out stalled %s even if the mock ignores abort", async phase => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", phase === "headers" ? vi.fn(() => new Promise(() => {})) : vi.fn().mockResolvedValue(new Response(new ReadableStream({ start() {} }))));
  const result = expect(readReleaseJson(urlFor("/"), Date.now() + 100)).rejects.toMatchObject({ status: 504 });
  await vi.advanceTimersByTimeAsync(101); await result;
});

it.each([400, 404, 429, 500])("retains complete native HTTP %i evidence and its canonical hash", async status => {
  const native = { errors: [{ detail: "α".repeat(20000) }], status, future: "retain" };
  const expected = await hash(native);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(native, { status })));
  await expect(readReleaseJson(urlFor("/fixture"), Date.now() + 1000)).rejects.toMatchObject({ status, data: {
    native_error: native, response_evidence: { source_url: "https://data.cms.gov/fixture", upstream_status: status, response_sha256: expected },
  } });
});

it("validates the destination even when the bounded reader is called directly", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(readReleaseJson(new URL("https://other.example/data"), Date.now() + 1000)).rejects.toMatchObject({ status: 400, data: { error: { code: "CMS_REQUEST_ERROR" } } });
  expect(fetcher).not.toHaveBeenCalled();
});

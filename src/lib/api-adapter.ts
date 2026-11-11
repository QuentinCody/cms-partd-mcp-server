import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import {
    EmptyDatasetError,
    guardEmptyResult,
} from "@bio-mcp/shared/codemode/empty-result-guard";
import { releaseDiscovery, releasePage } from "./release-page";
import { fail } from "./release-http";
import { readDataPage } from "./filters";

/**
 * Dataset IDs for CMS Part D data.
 * Prescriber data uses annual dataset IDs (one per year).
 * Drug spending has separate annual and quarterly endpoints.
 *
 * CMS retires/reissues these UUIDs across releases. Refresh the map from
 * https://data.cms.gov/data.json → dataset "Medicare Part D Prescribers - by
 * Provider and Drug" → distribution accessURLs (the entry whose description is
 * "latest" is a rolling alias CMS repoints to each new annual release).
 */
const PRESCRIBER_DATASETS: Record<string, string> = {
    latest: "9552739e-3d05-4c1b-8eff-ecabf391e2e5",
    "2024": "d5aa71a8-dcc0-4570-8bcf-bd39deac69fe",
    "2023": "e54db557-cd82-4e91-a0fe-61aad5865d69",
    "2022": "b101b457-ffa4-49bb-8fd9-27c1266086e2",
    "2021": "f68114ed-f854-4ffc-9c6e-ed78b5e2f8d0",
    "2020": "7795fe20-e80e-435a-a9ed-d2d65e05feeb",
    "2019": "2a6705e6-7a1e-460c-ba22-35249a531918",
    "2018": "802fe556-311f-4962-8d75-d5f4ff405884",
    "2017": "05f108dd-76c4-49f4-9fdc-788d8f4251ec",
    "2016": "25106f9d-0eb8-4ba7-b237-486ee87d910a",
    "2015": "1d650894-8afe-4056-ba31-a85cb0e3cee6",
    "2014": "0779bc8d-18dd-40b8-9d61-7addc8b0daf1",
    "2013": "c6905d43-45de-470d-897c-9ed8e75e256d",
};

const DATASET_IDS: Record<string, string> = {
    // Part D Drug Spending
    "spending-annual": "7e0b4365-fd63-4a29-8f5e-e0ac9f66a81b",
    "spending-quarterly": "4ff7c618-4e40-483a-b390-c8a58c94fa15",
};

/**
 * Build query parameters for CMS data API.
 * Converts a flat param map into CMS filter syntax: filter[FieldName]=value
 */
function buildCmsParams(
    params?: Record<string, unknown>,
): Record<string, unknown> {
    if (!params) return {};

    const out: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;

        // Pass through pagination / keyword params directly
        if (key === "size" || key === "offset" || key === "keyword" || key === "sort" || key.startsWith("filter[")) {
            out[key] = value;
            continue;
        }

        // Everything else becomes a CMS filter
        out[`filter[${key}]`] = value;
    }

    return out;
}

/** True when the CMS params carry at least one column filter (not just paging). */
function hasCmsFilters(cmsParams: Record<string, unknown>): boolean {
    return Object.keys(cmsParams).some((k) => k.startsWith("filter["));
}

/** True when a CMS data-API payload is an empty row set (bare array or {data|results:[]}). */
function isEmptyRows(data: unknown): boolean {
    if (Array.isArray(data)) return data.length === 0;
    if (data && typeof data === "object") {
        const d = data as Record<string, unknown>;
        if (Array.isArray(d.data)) return d.data.length === 0;
        if (Array.isArray(d.results)) return d.results.length === 0;
    }
    return false;
}

/** Bound the complete native response, including error evidence. */
async function fetchParsed(
    apiPath: string,
    cmsParams: Record<string, unknown>,
    timeout = 30000,
): Promise<{ status: number; data: unknown }> {
    return readDataPage(apiPath, cmsParams, Date.now() + timeout);
}

/**
 * Verify a filtered CMS query that came back empty before trusting it as absence.
 * See {@link guardEmptyResult}: probes the dataset unfiltered (probe-only, no
 * retry) and certifies stable empties, throws when the dataset itself looks
 * empty/unreachable, and degrades gracefully if the probe can't complete. On a
 * certified empty the payload is wrapped as `{ __guard, data }` so the
 * annotation reaches the citation layer.
 */
async function verifyEmpty(
    first: { status: number; data: unknown },
    apiPath: string,
    describe: string,
): Promise<{ status: number; data: unknown }> {
    // Probe-only (no retry): a tight, retry-free unfiltered probe so the guard
    // can never itself blow the isolate execution budget on a slow upstream.
    const outcome = await guardEmptyResult(first.data, {
        isEmpty: isEmptyRows,
        probe: async () =>
            (await fetchParsed(apiPath, { size: 1 }, 6000))
                .data,
        describe,
        log: (m) => console.warn(`[empty-guard] ${m}`),
    });
    if (outcome.guard) {
        return {
            status: first.status,
            data: { __guard: outcome.guard, data: outcome.data },
        };
    }
    return { status: first.status, data: outcome.data };
}

function resolvePrescriberPath(request: {
    params?: Record<string, unknown>;
}): string {
    const rawYear = request.params?.year;
    delete request.params?.year;
    const year =
        rawYear === undefined || rawYear === null || rawYear === ""
            ? "latest"
            : String(rawYear);
    const datasetId = Object.prototype.hasOwnProperty.call(PRESCRIBER_DATASETS, year) ? PRESCRIBER_DATASETS[year] : undefined;
    if (!datasetId) {
        const years = Object.keys(PRESCRIBER_DATASETS).join(", ");
        const error = new Error(
            `Unknown prescriber data year "${year}". Available: ${years}. ` +
                `"latest" (the default) tracks the newest CMS release, currently 2024.`,
        ) as Error & { status: number; data: unknown };
        error.status = 400;
        error.data = { available_years: Object.keys(PRESCRIBER_DATASETS) };
        throw error;
    }
    return `/data-api/v1/dataset/${datasetId}/data`;
}

export function createPartdApiFetch(): ApiFetchFn {
    return async (request) => {
        if (request.method !== "GET" || request.body !== undefined) fail("CMS Part D supports bodyless GET requests only", 405);
        if (request.path === "/datasets/discover") return releaseDiscovery(request.params ?? {});
        if (request.path === "/datasets/page") return releasePage(request.params ?? {});
        // Preserve the caller's selection when the legacy resolver removes year.
        const legacyRequest = { ...request, params: { ...request.params } };
        const path = request.path;
        const isPrescriber = path.startsWith("/prescriber/");
        let apiPath: string;

        // Route: /prescriber/search → prescriber dataset (annual releases)
        if (isPrescriber) {
            apiPath = resolvePrescriberPath(legacyRequest);
        }
        // Route: /spending/annual → annual spending dataset
        else if (path === "/spending/annual" || path.startsWith("/spending/annual?")) {
            apiPath = `/data-api/v1/dataset/${DATASET_IDS["spending-annual"]}/data`;
        }
        // Route: /spending/quarterly → quarterly spending dataset
        else if (path === "/spending/quarterly" || path.startsWith("/spending/quarterly?")) {
            apiPath = `/data-api/v1/dataset/${DATASET_IDS["spending-quarterly"]}/data`;
        }
        // Fallback: pass path through directly
        else {
            apiPath = path;
        }

        const cmsParams = buildCmsParams(legacyRequest.params);

        // Default page size if not specified
        if (cmsParams.size === undefined) {
            cmsParams.size = 100;
        }

        const result = await fetchParsed(apiPath, cmsParams);

        // Guard against silent transient empties on FILTERED prescriber lookups —
        // the failure mode where a real NPI-year returns 0 rows during CDN blips
        // or dataset-UUID churn, misreading as "no data exists". Unfiltered or
        // non-prescriber queries with legitimately-empty results are left alone.
        if (isPrescriber && hasCmsFilters(cmsParams) && isEmptyRows(result.data)) {
            return await verifyEmpty(result, apiPath, `CMS ${path} (${apiPath})`);
        }

        return result;
    };
}

export { EmptyDatasetError };

import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { partdFetch } from "./http";

/**
 * Dataset IDs for CMS Part D data.
 * Prescriber data uses annual dataset IDs (one per year).
 * Drug spending has separate annual and quarterly endpoints.
 */
const DATASET_IDS: Record<string, string> = {
    // Part D Prescriber — most recent years
    "prescriber-2022": "34f63cd4-3f80-4a69-82f1-528e9e1e099e",
    "prescriber-2021": "b09a7e03-f2d3-4a5b-8297-472e23cd1a1c",

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
        if (key === "size" || key === "offset" || key === "keyword") {
            out[key] = value;
            continue;
        }

        // Everything else becomes a CMS filter
        out[`filter[${key}]`] = value;
    }

    return out;
}

export function createPartdApiFetch(): ApiFetchFn {
    return async (request) => {
        const path = request.path;
        let datasetId: string | undefined;
        let apiPath: string;

        // Route: /prescriber/search → prescriber dataset
        if (path.startsWith("/prescriber/")) {
            // Default to most recent year; allow year param override
            const year = request.params?.year ?? "2022";
            delete request.params?.year;
            datasetId = DATASET_IDS[`prescriber-${year}`];
            if (!datasetId) {
                // Fallback to 2022 if unrecognized year
                datasetId = DATASET_IDS["prescriber-2022"];
            }
            apiPath = `/data-api/v1/dataset/${datasetId}/data`;
        }
        // Route: /spending/annual → annual spending dataset
        else if (path === "/spending/annual" || path.startsWith("/spending/annual?")) {
            datasetId = DATASET_IDS["spending-annual"];
            apiPath = `/data-api/v1/dataset/${datasetId}/data`;
        }
        // Route: /spending/quarterly → quarterly spending dataset
        else if (path === "/spending/quarterly" || path.startsWith("/spending/quarterly?")) {
            datasetId = DATASET_IDS["spending-quarterly"];
            apiPath = `/data-api/v1/dataset/${datasetId}/data`;
        }
        // Fallback: pass path through directly
        else {
            apiPath = path;
        }

        const cmsParams = buildCmsParams(request.params);

        // Default page size if not specified
        if (!cmsParams.size) {
            cmsParams.size = 100;
        }

        const response = await partdFetch(apiPath, cmsParams);

        if (!response.ok) {
            let errorBody: string;
            try {
                errorBody = await response.text();
            } catch {
                errorBody = response.statusText;
            }
            const error = new Error(`HTTP ${response.status}: ${errorBody.slice(0, 200)}`) as Error & {
                status: number;
                data: unknown;
            };
            error.status = response.status;
            error.data = errorBody;
            throw error;
        }

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("json")) {
            const text = await response.text();
            return { status: response.status, data: text };
        }

        const data = await response.json();
        return { status: response.status, data };
    };
}

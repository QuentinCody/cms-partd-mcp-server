import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

export const partdCatalog: ApiCatalog = {
    name: "CMS Medicare Part D",
    baseUrl: "https://data.cms.gov",
    version: "1.0",
    auth: "none",
    endpointCount: 3,
    notes:
        "- CMS Data API uses filter syntax: pass field names as params, adapter converts to filter[FieldName]=value\n" +
        "- Pagination: size (max 50000) and offset params\n" +
        "- Keyword search: keyword=X searches across all text fields\n" +
        "- Prescriber data: search by NPI, prescriber name, state, drug name, specialty\n" +
        "- Drug spending data: search by brand name, generic name, manufacturer\n" +
        "- Year selection for prescriber data: pass year param — '2013' through '2024', or 'latest' (the default, currently 2024). CMS publishes this dataset annually with a ~17-month lag\n" +
        "- Key prescriber fields: Prscrbr_NPI, Prscrbr_Last_Org_Name, Prscrbr_First_Name, Prscrbr_City, Prscrbr_State_Abrvtn, Prscrbr_Type, Brnd_Name, Gnrc_Name, Tot_Clms, Tot_30day_Fills, Tot_Day_Suply, Tot_Drug_Cst, Tot_Benes (suppressed/blank when <11)\n" +
        "- Annual spending is WIDE format: one row per drug+manufacturer (Mftr_Name 'Overall' = all-manufacturer rollup) with year-suffixed columns: Tot_Spndng_2020..Tot_Spndng_2024, Tot_Dsg_Unts_<yr>, Tot_Clms_<yr>, Tot_Benes_<yr>, Avg_Spnd_Per_Dsg_Unt_Wghtd_<yr>, Avg_Spnd_Per_Clm_<yr>, Avg_Spnd_Per_Bene_<yr>, Outlier_Flag_<yr>, plus Chg_Avg_Spnd_Per_Dsg_Unt_23_24 and CAGR_Avg_Spnd_Per_Dsg_Unt_20_24\n" +
        "- Quarterly spending fields: Year (e.g. '2024 (Q1-Q4)'), Tot_Spndng, Tot_Clms, Tot_Benes, Avg_Spnd_Per_Clm, Avg_Spnd_Per_Bene",
    endpoints: [
        {
            method: "GET",
            path: "/prescriber/search",
            summary: "Search Medicare Part D prescriber-level data by NPI, prescriber name, state, drug name, or specialty type",
            category: "prescriber",
            queryParams: [
                { name: "Prscrbr_NPI", type: "string", required: false, description: "National Provider Identifier (10-digit NPI number)" },
                { name: "Prscrbr_Last_Org_Name", type: "string", required: false, description: "Prescriber last name or organization name" },
                { name: "Prscrbr_First_Name", type: "string", required: false, description: "Prescriber first name" },
                { name: "Prscrbr_State_Abrvtn", type: "string", required: false, description: "Two-letter state abbreviation (e.g. CA, NY, TX)" },
                { name: "Prscrbr_Type", type: "string", required: false, description: "Provider specialty type (e.g. Internal Medicine, Family Practice)" },
                { name: "Brnd_Name", type: "string", required: false, description: "Brand name of the drug" },
                { name: "Gnrc_Name", type: "string", required: false, description: "Generic name of the drug" },
                { name: "keyword", type: "string", required: false, description: "Free-text keyword search across all fields" },
                { name: "year", type: "string", required: false, description: "Prescriber data year: '2013' through '2024', or 'latest' (default) — tracks the newest CMS annual release (currently 2024)" },
                { name: "size", type: "number", required: false, description: "Number of records to return (default: 100, max: 50000)" },
                { name: "offset", type: "number", required: false, description: "Number of records to skip for pagination" },
            ],
        },
        {
            method: "GET",
            path: "/spending/annual",
            summary: "Get annual Medicare Part D drug spending data with costs, utilization, and year-over-year changes by drug",
            category: "spending",
            queryParams: [
                { name: "Brnd_Name", type: "string", required: false, description: "Brand name of the drug" },
                { name: "Gnrc_Name", type: "string", required: false, description: "Generic name of the drug" },
                { name: "Mftr_Name", type: "string", required: false, description: "Manufacturer name" },
                { name: "keyword", type: "string", required: false, description: "Free-text keyword search across all fields" },
                { name: "size", type: "number", required: false, description: "Number of records to return (default: 100, max: 50000)" },
                { name: "offset", type: "number", required: false, description: "Number of records to skip for pagination" },
            ],
        },
        {
            method: "GET",
            path: "/spending/quarterly",
            summary: "Get quarterly Medicare Part D drug spending data with per-quarter breakdowns of costs and utilization",
            category: "spending",
            queryParams: [
                { name: "Brnd_Name", type: "string", required: false, description: "Brand name of the drug" },
                { name: "Gnrc_Name", type: "string", required: false, description: "Generic name of the drug" },
                { name: "Mftr_Name", type: "string", required: false, description: "Manufacturer name" },
                { name: "keyword", type: "string", required: false, description: "Free-text keyword search across all fields" },
                { name: "size", type: "number", required: false, description: "Number of records to return (default: 100, max: 50000)" },
                { name: "offset", type: "number", required: false, description: "Number of records to skip for pagination" },
            ],
        },
    ],
};

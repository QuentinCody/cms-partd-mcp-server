import { expect, it } from "vitest";
import { partdSchemaHints, partdTables } from "./staging";

it("retains wide annual values and cumulative quarterly labels without numeric coercion", () => {
  const annual = { Brnd_Name: "Fixture", Mftr_Name: "Overall", Tot_Spndng_2024: "001.23000", Tot_Benes_2024: "", Outlier_Flag_2024: "0", future: { keep: true } };
  const quarterly = { Brnd_Name: "Fixture", Mftr_Name: "Company", Year: "2025 (Q1-Q4)", Tot_Benes: "*", Tot_Spndng: "0.00" };
  const data = { native: [annual, quarterly], metadata: { period: "2026-Q1" } };
  const tables = partdTables(data);
  expect(tables.drug_spending.map(row => JSON.parse(String(row.native_json)))).toEqual([annual, quarterly]);
  expect(tables.drug_spending[0]).toMatchObject({ source_path: "/native/0", future: JSON.stringify(annual.future) });
  expect(JSON.parse(String(tables.response_context[0].native_json))).toEqual(data);
  expect(partdSchemaHints(data).columnTypes).toMatchObject({ Tot_Spndng_2024: "TEXT", Tot_Benes_2024: "TEXT", Outlier_Flag_2024: "TEXT", Tot_Spndng: "TEXT" });
});

it("preserves prescriber identifiers, FIPS, suppression blanks and flags through composed results", () => {
  const row = { Prscrbr_NPI: "0123456789", Prscrbr_State_FIPS: "01", Tot_Benes: "", GE65_Sprsn_Flag: "#", GE65_Tot_Clms: "", Tot_Clms: "11" };
  const payload = { content: [], structuredContent: { data: { observations: [{ native: [row] }] } } };
  expect(partdTables(payload).prescriber_data[0]).toMatchObject({ ...row, source_path: "/observations/0/native/0", native_json: JSON.stringify(row) });
  expect(partdSchemaHints(payload).columnTypes).toMatchObject({ Prscrbr_NPI: "TEXT", Prscrbr_State_FIPS: "TEXT", Tot_Benes: "TEXT", GE65_Sprsn_Flag: "TEXT" });
});

it("keeps series, release and candidate identities separate without duplicating embedded references", () => {
  const release = { "@type": "Dataset", "@id": "release", temporal: [{ startDate: "2024-01-01" }] };
  const series = { "@type": "DatasetSeries", "@id": "rolling", last: release };
  const candidate = { dataset_id: "fixture", url: "https://data.cms.gov/data", rolling_latest: false, release_metadata: release };
  const tables = partdTables({ metadata: { series, releases: [release] }, candidates: [candidate] });
  expect(tables.dataset_series).toHaveLength(1);
  expect(tables.dataset_releases).toHaveLength(1);
  expect(tables.api_distributions).toHaveLength(1);
  expect(JSON.parse(String(tables.api_distributions[0].native_json))).toEqual(candidate);
});

it("projects SQL results and unknown rows while retaining reserved native fields in JSON", () => {
  const row = { _rowid: 7, future: "0001" };
  const tables = partdTables({ sql: "SELECT * FROM fixture", rows: [row] });
  expect(tables.query_rows[0]._rowid).toBeUndefined();
  expect(JSON.parse(String(tables.query_rows[0].native_json))).toEqual(row);
  expect(partdTables({ native: [{ future: "keep" }] }).results[0]).toMatchObject({ future: "keep" });
});

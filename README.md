# CMS Partd MCP Server

This is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server. It lets MCP clients (Claude Desktop, Claude Code, Continue, etc.) query the upstream CMS Partd API in natural language. It is one of 100+ servers in the [Bio MCP](../../README.md) monorepo.

## Connect

The server is deployed and ready at:

```
https://cms-partd-mcp-server.quentincody.workers.dev/mcp
```

Add it to your MCP client (Claude Desktop → Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "cms-partd": {
      "command": "npx",
      "args": ["mcp-remote", "https://cms-partd-mcp-server.quentincody.workers.dev/mcp"]
    }
  }
}
```

For local development the server runs at `http://localhost:8848/mcp` (start it with `./scripts/dev-servers.sh cms-partd`):

```json
{
  "mcpServers": {
    "cms-partd-local": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:8848/mcp"]
    }
  }
}
```

## Tools

- `partd_search` — discover available API operations (Code Mode catalog search, 5 endpoints)
- `partd_execute` — **Code Mode**: write JavaScript in a V8 isolate (`api.get()` / `api.post()` / `searchSpec()`) instead of issuing tool calls one by one
- `partd_query_data` — run SQL over large responses auto-staged into a per-session SQLite database
- `partd_get_schema` — inspect the inferred schema of a staged dataset

Large responses (>30KB) are auto-staged into a queryable SQLite database; the tools return a `data_access_id` you can query with SQL.

Every tool returns both a human-readable `content` summary and a structured `structuredContent` payload.

All four tools also register an `mcp_`-prefixed alias.

## Dataset versions and maturity

`GET /datasets/discover` accepts `family: "spending-annual"`, `"spending-quarterly"` or `"prescriber"`. It returns the complete native family metadata, catalog header, advertised API distributions, rolling-latest labels and a canonical metadata hash. CSV and other native distribution links remain in metadata; only exact HTTPS data.cms.gov API URLs become query candidates. No distribution is selected implicitly.

`GET /datasets/page` requires the family and an advertised `dataset_id`; optional `expected_metadata_sha256` rejects a changed release description. The helper reads metadata before and after the native data page, rejecting drift or cross-family IDs. Full native rows and metadata survive staging. Size is 1–5000 (default 100), offset 0–10000000; simple field filters, native `filter[...]` conditions/groups and native `sort` are accepted. Projection is rejected. Reads have a 30-second overall deadline, 24 MiB catalog cap and 4 MiB row-response cap. The October 4 native catalog is 17,699,965 bytes, exceeding the previous 16 MiB cap.

Filtered or sorted reads validate syntax and referenced columns against the selected dataset's native `/data-viewer` metadata before forwarding the unchanged query. Unsupported operators, absent columns, invalid grouping and negative/zero page sizes fail explicitly: native CMS probes otherwise returned HTTP 200 while silently ignoring bad fields/operators. This validates request structure and column membership; it cannot certify every upstream predicate. Native IN/range conditions use indexed values. Raw data aliases now share a single bounded 30-second read, replacing the old automatic retries.

Metadata hashes do not pin data content. A dated UUID does not establish an immutable archive. `complete` and `atomic_snapshot` remain false, and `next_offset_candidate` is only a continuation hint. Raw annual, quarterly and prescriber routes retain their existing UUID maps and response shapes; use discovery for explicit current-distribution selection.

[CMS API documentation](https://data.cms.gov/api-docs), checked October 1, 2026,
confirms the September 29 DCAT-US 3.0 launch and March 31, 2027 retirement of
the 1.1 compatibility catalog. Discovery now starts at `/data.json`; only
HTTP 404/410 triggers fallback to `/v1-1-data.json`. Both documented catalog
structures are supported. HTTP errors and malformed metadata are not hidden
by fallback. This is a CMS structure parser, not a complete DCAT validator.

For 3.0, `metadata.series` retains the native family record and
`metadata.releases` retains its linked datasets, including temporal arrays,
distributions and future fields. The series `@id` identifies the rolling
endpoint. Release API distributions include `release_metadata` in discovery
candidates. Explicit `inSeries` identities take precedence over titles;
title-only links follow the provider's documented example. Duplicate identities
and ambiguous release endpoints fail rather than selecting an arbitrary record.
The metadata hash includes both the series and its releases, so page guards
detect changes to either. The [CMS FAQ 1.7](https://data.cms.gov/sites/default/files/2026-09/e5bb2f9f-313c-4943-8705-69bc21b8ec42/api-faq-1-7.txt)
documents this transition; data-row API parameters remain unchanged.

All four tool families retain both aliases and Code Mode execution. Complete
responses above 30 KiB stage through the existing Durable Object, including
composed discoveries and SQL/schema results. The `payloads` table preserves
the original response; its outer citation hashes the complete staged envelope.
Unavailable storage produces an explicit MCP error.

[Quarterly spending](https://data.cms.gov/summary-statistics-on-use-and-payments/medicare-medicaid-spending-by-drug/medicare-quarterly-part-d-spending-by-drug) is preliminary and subject to claims lag. CMS describes a three-month run-out for the latest PDE quarter starting July 2026. Preserve native `Year` labels: values such as `2025 (Q1-Q4)` describe cumulative periods. [Annual spending](https://data.cms.gov/summary-statistics-on-use-and-payments/medicare-medicaid-spending-by-drug/medicare-part-d-spending-by-drug) uses final-action claims. Neither label means values cannot be revised. Keep reporting periods separate from metadata publication dates, retain suppressed values as unknown, and avoid adding Overall manufacturer rollups to their components. Gross spending excludes rebates and price concessions.

October 4 native qualification covers all 17 advertised API candidates across three families: annual rolling/2024, quarterly rolling/2026 and prescriber rolling/2013–2024. Each has a native 100-row sample, checked through both MCP aliases and staged SQL. This is sampled row acceptance, not a complete download of each dataset. Full native catalog headers, three series and 14 linked release records independently match discovery. Quarterly rows retain both `2025 (Q1-Q4)` and `2026 (Q1)` periods separately from release metadata.

Staging retains complete native JSON, source paths, response context and canonical payloads. Native string values stay SQL TEXT, including identifiers, leading zeros, decimal precision and suppressed blanks. The `*`/`#` flags remain source values, not numeric zero. Full-envelope staging reserves 1 KiB for SDK metadata. Success, native/local errors and partial execution failures retain canonical citations and the error flag through either alias.

The [October 4 review](../../docs/audits/2026-10-04-partd-review.md) records native receipts, constraints and verification. The accepted local Worker completes 4,428 MCP calls, 4,460 SQL row comparisons and 105,462 cell comparisons; a further four query calls verify all 30 staged candidate boolean cells as exact SQL integers. Metadata guards do not establish immutable or atomic data snapshots. Production was not deployed or certified by this local run.

## Development

October 4 focused validation passes 120 server tests plus 207 catalog checks, direct TypeScript and lint. Full repository Vitest passes 14,027 tests (109 skipped). `check:affected` exits 0, including 14,025 root tests (73 skipped) under its explicit two-file exclusion. Terminal gate and manual scan receipts are recorded in `scratch/2026-10-04-partd/verification.json`; manual findings are reviewed separately from test results. No hooks or daemon configuration changed.

```bash
./scripts/dev-servers.sh cms-partd            # run locally (port 8848)
pnpm --filter cms-partd-mcp-server run deploy   # deploy to Cloudflare Workers
```

See [`docs/adding-mcp-servers.md`](../../docs/adding-mcp-servers.md) and the root [README](../../README.md) for the full architecture (Code Mode, staging, portals).

---

*Auto-generated baseline README — refine with server-specific detail as needed.*

<!-- license-and-data-terms:start -->
## License and data terms

The code in this repository is licensed under the Apache License 2.0 (see `LICENSE`).
If you use it in your work, please cite it (see `CITATION.cff`). Citation is requested, not required.

The license covers the code only. Data that this server returns comes from CMS Part D and stays under the terms of that source: US public domain.
You are responsible for your use of the data under those terms.
<!-- license-and-data-terms:end -->

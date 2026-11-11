import { partdResponse } from "../lib/tool-result";
import type { McpServer } from "@bio-mcp/shared/mcp";
import { z } from "zod";
import { createQueryDataHandler } from "@bio-mcp/shared/staging/utils";

interface QueryDataArgs {
    data_access_id: string;
    sql: string;
    limit?: number;
}

interface QueryEnv {
    PARTD_DATA_DO?: unknown;
}

export function registerQueryData(server: McpServer, env?: QueryEnv): void {
    const handler = createQueryDataHandler("PARTD_DATA_DO", "partd");

    for (const name of ["partd_query_data", "mcp_partd_query_data"]) server.registerTool(
        name,
        {
            title: "Query Staged Part D Data",
            description:
                "Query staged CMS Medicare Part D data using SQL. Use this when responses are too large and have been staged with a data_access_id.",
            inputSchema: {
                data_access_id: z.string().min(1).describe("Data access ID for the staged dataset"),
                sql: z.string().min(1).describe("SQL query to execute against the staged data"),
                limit: z.number().int().positive().max(10000).optional().describe("Maximum number of rows to return (default: 100)"),
            },
        },
        async (args: QueryDataArgs, extra) => {
            const runtimeEnv = env ?? (extra as { env?: QueryEnv })?.env ?? {};
            const handlerArgs: Record<string, unknown> = {
                data_access_id: args.data_access_id,
                sql: args.sql,
                limit: args.limit,
            };
            const handlerEnv: Record<string, unknown> = { ...runtimeEnv };
            return partdResponse(() => handler(handlerArgs, handlerEnv), runtimeEnv, name, extra, args);
        },
    );
}

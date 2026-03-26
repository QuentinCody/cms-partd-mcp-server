import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createGetSchemaHandler } from "@bio-mcp/shared/staging/utils";

interface GetSchemaArgs {
    data_access_id?: string;
}

interface SchemaEnv {
    PARTD_DATA_DO?: unknown;
}

export function registerGetSchema(server: McpServer, env?: SchemaEnv): void {
    const handler = createGetSchemaHandler("PARTD_DATA_DO", "partd");

    server.registerTool(
        "partd_get_schema",
        {
            title: "Get Staged Data Schema",
            description:
                "Get schema information for staged CMS Part D data. Shows table structures and row counts. " +
                "If called without a data_access_id, lists all staged datasets available in this session.",
            inputSchema: {
                data_access_id: z.string().min(1).optional().describe(
                    "Data access ID for the staged dataset. If omitted, lists all staged datasets in this session.",
                ),
            },
        },
        async (args: GetSchemaArgs, extra) => {
            const runtimeEnv = env ?? (extra as { env?: SchemaEnv })?.env ?? {};
            const handlerArgs: Record<string, unknown> = {
                data_access_id: args.data_access_id,
            };
            const handlerEnv: Record<string, unknown> = { ...runtimeEnv };
            return handler(
                handlerArgs,
                handlerEnv,
                (extra as { sessionId?: string })?.sessionId,
            );
        },
    );
}

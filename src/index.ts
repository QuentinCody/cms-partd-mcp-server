import { buildHealthResponse, configureCitationSigning } from "@bio-mcp/shared";
// CMS Part D MCP Server — prescriber-level drug data + spending via data.cms.gov
// Code Mode only: partd_search, partd_execute, query_data, get_schema
import { StatelessMcpWorker } from "@bio-mcp/shared/mcp";
import { McpServer } from "@bio-mcp/shared/mcp";
import { registerQueryData } from "./tools/query-data";
import { registerGetSchema } from "./tools/get-schema";
import { registerCodeMode } from "./tools/code-mode";
import { PartdDataDO } from "./do";

export { PartdDataDO };

export class MyMCP extends StatelessMcpWorker<Env> {
    server = new McpServer({
        name: "partd",
        version: "0.1.0",
    });

    async init() {

    	configureCitationSigning(this.env);
        const env = this.env;
        registerQueryData(this.server, env);
        registerGetSchema(this.server, env);
        registerCodeMode(this.server, env);
    }
}

export default {
    fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const url = new URL(request.url);

        if (url.pathname === "/health") {
            return buildHealthResponse("cms-partd");
        }

        if (url.pathname === "/mcp") {
            return MyMCP.serve("/mcp").fetch(request, env, ctx);
        }

        return new Response("Not found", { status: 404 });
    },
};

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { partdCatalog } from "../spec/catalog";
import { createPartdApiFetch } from "../lib/api-adapter";

/** Interface matching the register() signature expected by shared codemode tools */
interface ToolRegistrar {
    tool: (...args: unknown[]) => void;
}

export function registerCodeMode(
    server: McpServer,
    env: Pick<Env, "PARTD_DATA_DO" | "CODE_MODE_LOADER">,
): void {
    const apiFetch = createPartdApiFetch();

    // McpServer implements tool() which satisfies ToolRegistrar at runtime
    const registrar: ToolRegistrar = server as ToolRegistrar;

    const searchTool = createSearchTool({
        prefix: "partd",
        catalog: partdCatalog,
    });
    searchTool.register(registrar);

    const executeTool = createExecuteTool({
        prefix: "partd",
        catalog: partdCatalog,
        apiFetch,
        doNamespace: env.PARTD_DATA_DO,
        loader: env.CODE_MODE_LOADER,
    });
    executeTool.register(registrar);
}

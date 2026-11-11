import type { McpServer } from "@bio-mcp/shared/mcp";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { partdCatalog } from "../spec/catalog";
import { createPartdApiFetch } from "../lib/api-adapter";
import { partdResponse } from "../lib/tool-result";

/** Interface matching the register() signature expected by shared codemode tools */
interface ToolRegistrar {
    tool: (...args: unknown[]) => void;
}

export function registerCodeMode(
    server: McpServer,
    env: Pick<Env, "PARTD_DATA_DO" | "CODE_MODE_LOADER">,
): void {
    const apiFetch = createPartdApiFetch();

    const registrar: ToolRegistrar = { tool: (...args: unknown[]) => {
        const [name, ...rest] = args;
        const handler = rest.pop() as (input: unknown, extra: unknown) => ReturnType<typeof partdResponse>;
        const respond = (input: unknown, extra: unknown) => partdResponse(() => handler(input, extra), env, String(name), extra, input);
        const register = server.tool.bind(server) as (...values: unknown[]) => void;
        register(name, ...rest, respond); register(`mcp_${String(name)}`, ...rest, respond);
    } };

    const searchTool = createSearchTool({
        prefix: "partd",
        catalog: partdCatalog,
    });
    searchTool.register(registrar);

    const executeTool = createExecuteTool({
        prefix: "partd",
        // Verifiable provenance: partd_execute results carry a _meta.citation.
        source: { id: "partd", name: "CMS Medicare Part D", url: "https://data.cms.gov", license: "U.S. Public Domain" },
        catalog: partdCatalog,
        apiFetch,
        preserveApiErrors: true,
        maxInlineBytes: 30 * 1024,
        stagingThreshold: 30 * 1024,
        timeout: 60000,
        doNamespace: env.PARTD_DATA_DO,
        loader: env.CODE_MODE_LOADER,
    });
    executeTool.register(registrar);
}

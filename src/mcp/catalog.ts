import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CatalogError, type Catalog, type CatalogClient } from "../catalog/catalog.ts";
import { catalogConfig, readCatalog } from "../catalog/session.ts";

export function createCatalogServer(read: (client?: CatalogClient) => Promise<Catalog>): McpServer {
  const server = new McpServer({ name: "merovingian-catalog", version: "1.0.0" });
  type Register = (name: string, config: { description: string; inputSchema: unknown },
    callback: (args: { client?: CatalogClient }) => Promise<{ isError?: boolean; content: { type: "text"; text: string }[] }>) => void;
  const register = server.registerTool.bind(server) as unknown as Register;
  for (const name of ["identity", "catalog"] as const) {
    register(name, {
      description: name === "identity" ? "Read your authenticated tenant identity. No identity override is accepted."
        : "Read your authorized catalog and tenant instructions, without building a workspace. Installation and effective GitHub access are not verified.",
      inputSchema: z.object(name === "catalog" ? { client: z.enum(["claude", "codex"]).optional() } : {}).strict(),
    }, async args => {
      try {
        const result = await read(args.client);
        const data = name === "identity" ? { apiVersion: result.apiVersion, tenant: result.tenant, identity: result.identity, assignments: result.assignments } : result;
        return { content: [{ type: "text", text: JSON.stringify(data) }] };
      } catch (error) {
        const known = error instanceof CatalogError;
        return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: {
          code: known ? error.code : "unavailable", message: known ? error.message : "Catalog unavailable; no state was inferred.",
        } }) }] };
      }
    });
  }
  return server;
}
export async function serveStdio(): Promise<void> {
  const config = catalogConfig();
  await createCatalogServer(client => readCatalog(config, client)).connect(new StdioServerTransport());
}

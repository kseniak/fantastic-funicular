#!/usr/bin/env node
/**
 * Stdio entrypoint. Runs the MCP server over stdio so it works inside Claude
 * Desktop / Claude Code with zero infrastructure. The HTTP entrypoint
 * (`http.ts`) exposes the same server over a remote transport.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Engine } from "./proposals.js";
import { seedScene } from "./seed.js";
import { buildServer } from "./mcpServer.js";

async function main(): Promise<void> {
  const server = buildServer(new Engine(seedScene()));
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr only; stdout is the MCP transport channel.
  process.stderr.write("agentic-authoring-mcp running on stdio\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`Fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

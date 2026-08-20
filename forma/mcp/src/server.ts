#!/usr/bin/env node
/**
 * Stdio entrypoint. Runs the MCP server over stdio so it works inside Claude
 * Desktop / Claude Code with zero infrastructure. It loads the site from the
 * offline mock file by default (FORMA_SITE_PATH overrides), which is the
 * license-free path through the whole loop. The HTTP entrypoint (http.ts) is
 * the live-Forma path.
 */

import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ComplianceEngine } from "./proposals.js";
import { MockBridge } from "./bridge.js";
import { providerFromEnv } from "./zoning/index.js";
import { buildServer } from "./mcpServer.js";

function sitePath(): string {
  return process.env.FORMA_SITE_PATH ?? fileURLToPath(new URL("../../mock/site.json", import.meta.url));
}

async function main(): Promise<void> {
  const bridge = new MockBridge(sitePath());
  const site = await bridge.loadSite();
  const engine = new ComplianceEngine(site, providerFromEnv(), bridge);
  const server = buildServer(engine);
  await server.connect(new StdioServerTransport());
  // stdout is the MCP channel; logs go to stderr only.
  process.stderr.write(`forma-compliance-mcp running on stdio (parcel ${site.parcelId})\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

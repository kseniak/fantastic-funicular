#!/usr/bin/env node
/**
 * HTTP entrypoint — the live-Forma path. It does two things:
 *
 *   1. Exposes the MCP server over Streamable HTTP so an agent (Claude Desktop's
 *      custom-connector dialog, or any HTTP MCP client) can drive the tools.
 *   2. Runs the live bridge endpoints the Forma extension talks to:
 *        POST /bridge/scene  — the extension uploads the massing it read from Forma
 *        GET  /bridge/ops    — the extension polls for approved edits to draw back
 *
 * One shared engine backs both, so an agent and the extension see the same site
 * and the same op log. State is in-memory and single-tenant — persistence, auth,
 * and per-session isolation are the production follow-ups in the README. CORS is
 * wide open here because this is a local dev bridge for one user.
 */

import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response, type NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { ComplianceEngine } from "./proposals.js";
import { LiveBridge, MockBridge } from "./bridge.js";
import { providerFromEnv } from "./zoning/index.js";
import { buildServer } from "./mcpServer.js";

const MCP_PATH = "/mcp";
const PORT = Number(process.env.PORT ?? 3939);

function sitePath(): string {
  return process.env.FORMA_SITE_PATH ?? fileURLToPath(new URL("../../mock/site.json", import.meta.url));
}

async function main(): Promise<void> {
  const bridge = new LiveBridge();
  // Seed from the mock so the tools work before the extension pushes a live
  // scene; the first POST /bridge/scene replaces it with real Forma geometry.
  const seed = await new MockBridge(sitePath()).loadSite();
  const engine = new ComplianceEngine(seed, providerFromEnv(), bridge);

  const app = express();
  app.use(express.json({ limit: "4mb" }));
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    next();
  });
  app.options("*", (_req: Request, res: Response) => res.sendStatus(204));

  app.get("/", (_req: Request, res: Response) => {
    res.json({ name: "forma-compliance-mcp", status: "ok", mcpEndpoint: MCP_PATH, bridge: bridge.mode });
  });

  // ── Live bridge endpoints (spoken by the Forma extension) ──────────────────
  app.post("/bridge/scene", (req: Request, res: Response) => {
    try {
      const site = bridge.receiveScene(req.body);
      engine.resetSite(site);
      res.json({ accepted: true, parcelId: site.parcelId, buildings: site.buildings.length });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/bridge/ops", (_req: Request, res: Response) => {
    res.json({ ops: bridge.drainOutbox() });
  });

  // ── MCP over Streamable HTTP (one shared engine across sessions) ───────────
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post(MCP_PATH, async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      if (sessionId || !isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: no valid session; send an initialize request first." },
          id: null,
        });
        return;
      }
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports.set(sid, transport!);
        },
      });
      transport.onclose = () => {
        if (transport!.sessionId) transports.delete(transport!.sessionId);
      };
      await buildServer(engine).connect(transport);
    }
    await transport.handleRequest(req, res, req.body);
  });

  const handleSessionRequest = async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(400).send("Invalid or missing session id.");
      return;
    }
    await transport.handleRequest(req, res);
  };
  app.get(MCP_PATH, handleSessionRequest);
  app.delete(MCP_PATH, handleSessionRequest);

  app.listen(PORT, () => {
    process.stdout.write(`forma-compliance-mcp listening on http://0.0.0.0:${PORT} (MCP at ${MCP_PATH}, bridge live)\n`);
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`Fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * HTTP entrypoint. Exposes the same MCP server over the Streamable HTTP
 * transport so it can be reached at a public URL and added to Claude's
 * "custom connector" dialog (which accepts remote HTTPS servers).
 *
 * Session model: each MCP session (one `initialize` handshake) gets its own
 * freshly seeded `Engine`, so connections are isolated and a session's
 * propose/commit/undo state persists across its requests. State is in-memory
 * and ephemeral — a restart or a new session starts from the seed. Persistence
 * and auth are the "next steps" called out in the README.
 */

import { randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { Engine } from "./proposals.js";
import { seedScene } from "./seed.js";
import { buildServer } from "./mcpServer.js";

const MCP_PATH = "/mcp";
const PORT = Number(process.env.PORT ?? 3000);

/** Live transports keyed by MCP session id. */
const transports = new Map<string, StreamableHTTPServerTransport>();

const app = express();
app.use(express.json());

// Simple health check so hosting platforms can verify the service is up.
app.get("/", (_req: Request, res: Response) => {
  res.json({ name: "agentic-authoring-mcp", status: "ok", mcpEndpoint: MCP_PATH });
});

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
    // New session: seed a fresh engine and wire up a server for it.
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports.set(sid, transport!);
      },
    });
    transport.onclose = () => {
      if (transport!.sessionId) transports.delete(transport!.sessionId);
    };
    const server = buildServer(new Engine(seedScene()));
    await server.connect(transport);
  }

  await transport.handleRequest(req, res, req.body);
});

// GET (server-sent events) and DELETE (session teardown) reuse the transport.
async function handleSessionRequest(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send("Invalid or missing session id.");
    return;
  }
  await transport.handleRequest(req, res);
}

app.get(MCP_PATH, handleSessionRequest);
app.delete(MCP_PATH, handleSessionRequest);

app.listen(PORT, () => {
  process.stdout.write(`agentic-authoring-mcp listening on http://0.0.0.0:${PORT}${MCP_PATH}\n`);
});

#!/usr/bin/env node
/**
 * MCP server wiring. Registers the read / act / commit tool families over
 * stdio so the engine runs inside Claude Desktop with zero infrastructure.
 *
 * The split is the whole point:
 *   - read tools   execute immediately, never mutate;
 *   - act tools    return a *proposal* (id + diff + policy decision), no mutation;
 *   - commit tools disposition proposals (commit / reject / undo / list).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { Engine, makeAddWallOp } from "./proposals.js";
import { findRoom } from "./scene.js";
import { queryDaylight } from "./daylight.js";
import { GRID_MAX, GRID_MIN } from "./types.js";
import type { Room, Scene } from "./types.js";
import { seedScene } from "./seed.js";

const engine = new Engine(seedScene());

/** Wrap any value as a single JSON text-content block. */
function json(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/** A wall is "adjacent" to a room if it runs along one of the room's edges. */
function adjacentWalls(scene: Scene, room: Room): string[] {
  const left = room.x;
  const right = room.x + room.width;
  const bottom = room.y;
  const top = room.y + room.height;
  return scene.walls
    .filter((w) => {
      const onVerticalEdge =
        w.x1 === w.x2 && (w.x1 === left || w.x1 === right) &&
        Math.min(w.y1, w.y2) <= top && Math.max(w.y1, w.y2) >= bottom;
      const onHorizontalEdge =
        w.y1 === w.y2 && (w.y1 === bottom || w.y1 === top) &&
        Math.min(w.x1, w.x2) <= right && Math.max(w.x1, w.x2) >= left;
      return onVerticalEdge || onHorizontalEdge;
    })
    .map((w) => w.id);
}

const server = new McpServer({ name: "agentic-authoring-mcp", version: "0.1.0" });

// ── Read tools ────────────────────────────────────────────────────────────

server.tool("get_scene", "Return the full current scene graph (walls and rooms).", {}, async () =>
  json(engine.getScene()),
);

server.tool(
  "describe_room",
  "Return one room's details: dimensions, area, and adjacent walls.",
  { roomId: z.string().describe("Id of the room to describe.") },
  async ({ roomId }) => {
    const room = findRoom(engine.getScene(), roomId);
    if (!room) return json({ error: `No room with id '${roomId}' exists.` });
    return json({
      id: room.id,
      name: room.name,
      position: { x: room.x, y: room.y },
      dimensions: { width: room.width, height: room.height },
      area: room.width * room.height,
      adjacentWalls: adjacentWalls(engine.getScene(), room),
    });
  },
);

server.tool(
  "query_daylight",
  "Return a TOY daylight score for a room (heuristic stub, not real analysis).",
  { roomId: z.string().describe("Id of the room to analyse.") },
  async ({ roomId }) => {
    const room = findRoom(engine.getScene(), roomId);
    if (!room) return json({ error: `No room with id '${roomId}' exists.` });
    return json(queryDaylight(engine.getScene(), room));
  },
);

// ── Act tools (propose only; never mutate) ─────────────────────────────────

const coord = z.number().int().min(GRID_MIN).max(GRID_MAX);

server.tool(
  "add_wall",
  "Propose adding a wall. Returns a proposal (id + diff + policy decision); does not mutate.",
  {
    x1: coord.describe("Start x."),
    y1: coord.describe("Start y."),
    x2: coord.describe("End x."),
    y2: coord.describe("End y."),
    structural: z.boolean().describe("Whether the wall is load-bearing."),
  },
  async (input) => json(engine.propose(makeAddWallOp(input))),
);

server.tool(
  "move_room",
  "Propose moving a room by (dx, dy). Returns a proposal; does not mutate.",
  {
    roomId: z.string().describe("Id of the room to move."),
    dx: z.number().int().describe("Displacement along x."),
    dy: z.number().int().describe("Displacement along y."),
  },
  async ({ roomId, dx, dy }) => json(engine.propose({ kind: "move_room", roomId, dx, dy })),
);

server.tool(
  "delete_element",
  "Propose deleting a wall or room by id. Returns a proposal; does not mutate.",
  { elementId: z.string().describe("Id of the wall or room to delete.") },
  async ({ elementId }) => json(engine.propose({ kind: "delete_element", elementId })),
);

// ── Commit tools (disposition) ─────────────────────────────────────────────

server.tool(
  "commit",
  "Apply a pending proposal, append it to the op log, and return the new scene.",
  { proposalId: z.string().describe("Id of the proposal to commit.") },
  async ({ proposalId }) => {
    const result = engine.commit(proposalId);
    return result.ok ? json({ committed: proposalId, scene: result.value }) : json({ error: result.error });
  },
);

server.tool(
  "reject",
  "Discard a pending proposal without applying it.",
  { proposalId: z.string().describe("Id of the proposal to reject.") },
  async ({ proposalId }) => {
    const result = engine.reject(proposalId);
    return result.ok ? json(result.value) : json({ error: result.error });
  },
);

server.tool("undo", "Reverse the most recently committed op, restoring prior state.", {}, async () => {
  const result = engine.undo();
  return result.ok ? json({ undone: true, scene: result.value }) : json({ error: result.error });
});

server.tool("list_proposals", "List pending proposals and their policy decisions.", {}, async () =>
  json(engine.listProposals()),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr only; stdout is the MCP transport channel.
  process.stderr.write("agentic-authoring-mcp running on stdio\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`Fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

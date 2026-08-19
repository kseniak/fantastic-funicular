/**
 * Domain invariants — the engine's self-defense against the agent.
 *
 * These run before a proposal is ever created. A violation does not throw; it
 * produces a structured, agent-legible result so the proposal can be returned
 * as `blocked` with a clear reason. Each check is a small pure function so the
 * set reads as a first-class concern and is trivial to extend.
 */

import { GRID_MAX, GRID_MIN } from "./types.js";
import type { Op, Scene, Wall } from "./types.js";
import { findElement, findRoom } from "./scene.js";

export type InvariantResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const OK: InvariantResult = { ok: true };

function fail(reason: string): InvariantResult {
  return { ok: false, reason };
}

function inBounds(x: number, y: number): boolean {
  return x >= GRID_MIN && x <= GRID_MAX && y >= GRID_MIN && y <= GRID_MAX;
}

/** Two walls share a segment if their endpoints match, in either direction. */
function sameSegment(a: Wall, b: { x1: number; y1: number; x2: number; y2: number }): boolean {
  const forward = a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2;
  const reverse = a.x1 === b.x2 && a.y1 === b.y2 && a.x2 === b.x1 && a.y2 === b.y1;
  return forward || reverse;
}

/**
 * Validate an op against the scene. Returns `{ ok: true }` when the op is
 * structurally applicable, or `{ ok: false, reason }` describing the first
 * violation found.
 */
export function checkInvariants(op: Op, scene: Scene): InvariantResult {
  switch (op.kind) {
    case "add_wall": {
      const { wall } = op;
      if (!inBounds(wall.x1, wall.y1) || !inBounds(wall.x2, wall.y2)) {
        return fail(
          `Wall endpoints must lie within the floor bounds [${GRID_MIN}, ${GRID_MAX}] on both axes.`,
        );
      }
      if (wall.x1 === wall.x2 && wall.y1 === wall.y2) {
        return fail("A wall must have non-zero length; its two endpoints are identical.");
      }
      if (scene.walls.some((w) => sameSegment(w, wall))) {
        return fail("A wall already occupies that exact segment.");
      }
      return OK;
    }
    case "move_room": {
      const room = findRoom(scene, op.roomId);
      if (!room) return fail(`No room with id '${op.roomId}' exists.`);
      const nx = room.x + op.dx;
      const ny = room.y + op.dy;
      if (!inBounds(nx, ny) || !inBounds(nx + room.width, ny + room.height)) {
        return fail(
          `Moving room '${op.roomId}' by (${op.dx}, ${op.dy}) would push it outside the floor bounds [${GRID_MIN}, ${GRID_MAX}].`,
        );
      }
      return OK;
    }
    case "delete_element": {
      if (!findElement(scene, op.elementId)) {
        return fail(`No element with id '${op.elementId}' exists.`);
      }
      return OK;
    }
  }
}

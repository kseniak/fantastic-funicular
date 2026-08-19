/**
 * Toy daylight analysis — a stub read-only "domain analysis" tool.
 *
 * This is intentionally trivial and is NOT real daylighting math. It exists
 * only to demonstrate the shape of a domain-analysis read tool alongside the
 * plain data reads. Do not build on this heuristic.
 */

import { GRID_MAX, GRID_MIN } from "./types.js";
import type { Room, Scene, Wall } from "./types.js";

export interface DaylightResult {
  readonly roomId: string;
  readonly area: number;
  readonly exteriorWalls: number;
  /** A 0-100 toy score; higher is "brighter". */
  readonly score: number;
  readonly note: string;
}

/** A wall is "exterior-facing" (heuristically) if it lies on the floor boundary. */
function isExteriorWall(wall: Wall): boolean {
  const onVerticalEdge =
    (wall.x1 === GRID_MIN && wall.x2 === GRID_MIN) || (wall.x1 === GRID_MAX && wall.x2 === GRID_MAX);
  const onHorizontalEdge =
    (wall.y1 === GRID_MIN && wall.y2 === GRID_MIN) || (wall.y1 === GRID_MAX && wall.y2 === GRID_MAX);
  return onVerticalEdge || onHorizontalEdge;
}

export function queryDaylight(scene: Scene, room: Room): DaylightResult {
  const area = room.width * room.height;
  const exteriorWalls = scene.walls.filter(isExteriorWall).length;

  // Toy formula: reward exterior exposure, gently penalize very large rooms
  // (harder to light evenly). Clamped to [0, 100].
  const raw = exteriorWalls * 25 + Math.min(area, 40) - Math.max(0, area - 40) * 0.5;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  return {
    roomId: room.id,
    area,
    exteriorWalls,
    score,
    note: "Toy heuristic stub — not real daylighting analysis.",
  };
}

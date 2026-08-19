/**
 * Seed scene for the demo floor: an outer boundary of 4 structural walls plus
 * two rooms, so the server has something to act on the moment it starts.
 */

import { GRID_MAX, GRID_MIN } from "./types.js";
import type { Room, Scene, Wall } from "./types.js";

function wall(id: string, x1: number, y1: number, x2: number, y2: number): Wall {
  return { id, kind: "wall", x1, y1, x2, y2, structural: true };
}

function room(id: string, name: string, x: number, y: number, width: number, height: number): Room {
  return { id, kind: "room", name, x, y, width, height };
}

export function seedScene(): Scene {
  const lo = GRID_MIN;
  const hi = GRID_MAX;
  return {
    walls: [
      wall("wall_south", lo, lo, hi, lo),
      wall("wall_east", hi, lo, hi, hi),
      wall("wall_north", hi, hi, lo, hi),
      wall("wall_west", lo, hi, lo, lo),
    ],
    rooms: [
      room("living_room", "living_room", 1, 1, 8, 8),
      room("bedroom", "bedroom", 11, 1, 6, 6),
    ],
  };
}

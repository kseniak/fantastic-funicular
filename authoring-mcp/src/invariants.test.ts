import { describe, expect, it } from "vitest";
import { checkInvariants } from "./invariants.js";
import { seedScene } from "./seed.js";
import type { Wall } from "./types.js";

const scene = seedScene();

function wall(overrides: Partial<Wall>): Wall {
  return { id: "w", kind: "wall", x1: 3, y1: 3, x2: 3, y2: 7, structural: false, ...overrides };
}

describe("checkInvariants", () => {
  it("accepts a valid in-bounds wall", () => {
    expect(checkInvariants({ kind: "add_wall", wall: wall({}) }, scene).ok).toBe(true);
  });

  it("rejects a wall out of bounds", () => {
    const res = checkInvariants({ kind: "add_wall", wall: wall({ x2: 25 }) }, scene);
    expect(res.ok).toBe(false);
  });

  it("rejects a zero-length wall", () => {
    const res = checkInvariants({ kind: "add_wall", wall: wall({ x1: 4, y1: 4, x2: 4, y2: 4 }) }, scene);
    expect(res.ok).toBe(false);
  });

  it("rejects a duplicate wall segment (order-independent)", () => {
    // wall_south runs (0,0)->(20,0); the reverse is still a duplicate.
    const dup = wall({ x1: 20, y1: 0, x2: 0, y2: 0 });
    const res = checkInvariants({ kind: "add_wall", wall: dup }, scene);
    expect(res.ok).toBe(false);
  });

  it("rejects moving a room outside the floor bounds", () => {
    const res = checkInvariants({ kind: "move_room", roomId: "bedroom", dx: 0, dy: 20 }, scene);
    expect(res.ok).toBe(false);
  });

  it("rejects deleting a non-existent element", () => {
    const res = checkInvariants({ kind: "delete_element", elementId: "nope" }, scene);
    expect(res.ok).toBe(false);
  });
});

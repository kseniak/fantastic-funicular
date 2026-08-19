import { describe, expect, it } from "vitest";
import { evaluate } from "./policy.js";
import { seedScene } from "./seed.js";
import type { Wall } from "./types.js";

const scene = seedScene();

function newWall(overrides: Partial<Wall>): Wall {
  return { id: "w_test", kind: "wall", x1: 5, y1: 5, x2: 5, y2: 9, structural: false, ...overrides };
}

describe("policy.evaluate", () => {
  it("marks deletes as needs-approval", () => {
    const d = evaluate({ kind: "delete_element", elementId: "living_room" }, scene);
    expect(d.decision).toBe("needs-approval");
  });

  it("marks adding a structural wall as needs-approval", () => {
    const d = evaluate({ kind: "add_wall", wall: newWall({ structural: true }) }, scene);
    expect(d.decision).toBe("needs-approval");
  });

  it("auto-approves a small room nudge (<= threshold)", () => {
    const d = evaluate({ kind: "move_room", roomId: "living_room", dx: 1, dy: 1 }, scene);
    expect(d.decision).toBe("auto-approvable");
  });

  it("requires approval for a large room move (> threshold)", () => {
    const d = evaluate({ kind: "move_room", roomId: "living_room", dx: 3, dy: 0 }, scene);
    expect(d.decision).toBe("needs-approval");
  });

  it("blocks an op that violates an invariant", () => {
    // Moving the living_room far enough to leave the floor bounds.
    const d = evaluate({ kind: "move_room", roomId: "living_room", dx: 20, dy: 0 }, scene);
    expect(d.decision).toBe("blocked");
  });

  it("is pure: evaluating does not mutate the scene", () => {
    const before = JSON.stringify(scene);
    evaluate({ kind: "delete_element", elementId: "bedroom" }, scene);
    expect(JSON.stringify(scene)).toBe(before);
  });
});

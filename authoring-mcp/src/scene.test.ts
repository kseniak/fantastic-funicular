import { describe, expect, it } from "vitest";
import { applyOp, findElement, findRoom, findWall, reverseOp } from "./scene.js";
import { seedScene } from "./seed.js";
import type { Wall } from "./types.js";

const partition: Wall = { id: "w_new", kind: "wall", x1: 5, y1: 1, x2: 5, y2: 9, structural: false };

describe("scene lookups", () => {
  it("finds walls, rooms, and any element by id", () => {
    const scene = seedScene();
    expect(findWall(scene, "wall_south")?.id).toBe("wall_south");
    expect(findRoom(scene, "bedroom")?.name).toBe("bedroom");
    expect(findElement(scene, "living_room")?.kind).toBe("room");
    expect(findElement(scene, "wall_east")?.kind).toBe("wall");
    expect(findElement(scene, "missing")).toBeUndefined();
  });
});

describe("applyOp is pure (does not mutate its input)", () => {
  it("add_wall leaves the source scene untouched", () => {
    const scene = seedScene();
    const before = JSON.stringify(scene);
    applyOp(scene, { kind: "add_wall", wall: partition });
    expect(JSON.stringify(scene)).toBe(before);
  });
});

describe("applyOp / reverseOp round-trips", () => {
  it("add_wall then reverse restores the original scene", () => {
    const scene = seedScene();
    const before = JSON.stringify(scene);
    const { scene: added, record } = applyOp(scene, { kind: "add_wall", wall: partition });
    expect(added.walls).toHaveLength(scene.walls.length + 1);
    expect(record).toEqual({ kind: "add_wall", wall: partition });
    expect(JSON.stringify(reverseOp(added, record))).toBe(before);
  });

  it("move_room then reverse restores the original position", () => {
    const scene = seedScene();
    const before = JSON.stringify(scene);
    const { scene: moved, record } = applyOp(scene, { kind: "move_room", roomId: "bedroom", dx: 2, dy: -1 });
    expect(findRoom(moved, "bedroom")).toMatchObject({ x: 13, y: 0 });
    expect(record).toEqual({ kind: "move_room", roomId: "bedroom", dx: 2, dy: -1 });
    expect(JSON.stringify(reverseOp(moved, record))).toBe(before);
  });

  it("delete_element captures the element and reverse restores it", () => {
    const scene = seedScene();
    const before = JSON.stringify(scene);
    const { scene: deleted, record } = applyOp(scene, { kind: "delete_element", elementId: "living_room" });
    expect(findRoom(deleted, "living_room")).toBeUndefined();
    expect(record.kind).toBe("delete_element");
    if (record.kind === "delete_element") {
      expect(record.element.id).toBe("living_room");
      expect(record.index).toBe(0); // first room; undo must reinsert in place
    }
    expect(JSON.stringify(reverseOp(deleted, record))).toBe(before);
  });
});

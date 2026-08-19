import { describe, expect, it } from "vitest";
import { queryDaylight } from "./daylight.js";
import { seedScene } from "./seed.js";
import type { Room, Scene, Wall } from "./types.js";

describe("queryDaylight (toy stub)", () => {
  it("reports area, exterior-wall count, and is flagged as a stub", () => {
    const scene = seedScene();
    const living = scene.rooms.find((r) => r.id === "living_room")!;
    const result = queryDaylight(scene, living);
    expect(result.area).toBe(64); // 8 x 8
    expect(result.exteriorWalls).toBe(4); // all four seed shell walls are on the boundary
    expect(result.note).toMatch(/stub/i);
  });

  it("clamps the score into [0, 100]", () => {
    const scene = seedScene();
    const living = scene.rooms.find((r) => r.id === "living_room")!;
    const result = queryDaylight(scene, living);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBe(100); // 4 exterior walls saturate the toy score
  });

  it("scores lower with no exterior exposure", () => {
    const interiorWall: Wall = { id: "w_int", kind: "wall", x1: 5, y1: 5, x2: 5, y2: 9, structural: false };
    const smallRoom: Room = { id: "closet", kind: "room", name: "closet", x: 6, y: 6, width: 2, height: 2 };
    const scene: Scene = { walls: [interiorWall], rooms: [smallRoom] };
    const result = queryDaylight(scene, smallRoom);
    expect(result.exteriorWalls).toBe(0);
    expect(result.score).toBeLessThan(50);
  });
});

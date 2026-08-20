import { describe, expect, it } from "vitest";
import { Engine, makeAddWallOp, renderDiff } from "./proposals.js";
import { seedScene } from "./seed.js";
import type { Op } from "./types.js";

const scene = seedScene();

describe("makeAddWallOp", () => {
  it("builds an add_wall op with an engine-assigned id and preserves inputs", () => {
    const op = makeAddWallOp({ x1: 5, y1: 1, x2: 5, y2: 9, structural: true });
    expect(op.kind).toBe("add_wall");
    if (op.kind !== "add_wall") throw new Error("unreachable");
    expect(op.wall.id).toMatch(/^wall_/);
    expect(op.wall.structural).toBe(true);
    expect(op.wall).toMatchObject({ x1: 5, y1: 1, x2: 5, y2: 9 });
  });

  it("assigns a fresh id on each call", () => {
    const a = makeAddWallOp({ x1: 1, y1: 1, x2: 1, y2: 2, structural: false });
    const b = makeAddWallOp({ x1: 1, y1: 1, x2: 1, y2: 2, structural: false });
    if (a.kind !== "add_wall" || b.kind !== "add_wall") throw new Error("unreachable");
    expect(a.wall.id).not.toBe(b.wall.id);
  });
});

describe("renderDiff", () => {
  it("renders add_wall, flagging structural walls only", () => {
    const plain = renderDiff({ kind: "add_wall", wall: { id: "w1", kind: "wall", x1: 5, y1: 1, x2: 5, y2: 9, structural: false } }, scene);
    expect(plain).toContain("+ wall w1");
    expect(plain).toContain("(5,1) -> (5,9)");
    expect(plain).not.toContain("[structural]");

    const structural = renderDiff({ kind: "add_wall", wall: { id: "w2", kind: "wall", x1: 5, y1: 1, x2: 5, y2: 9, structural: true } }, scene);
    expect(structural).toContain("[structural]");
  });

  it("renders move_room with before -> after coordinates", () => {
    const diff = renderDiff({ kind: "move_room", roomId: "living_room", dx: 2, dy: 1 }, scene);
    expect(diff).toContain("~ room living_room");
    expect(diff).toContain("(1,1) -> (3,2)");
  });

  it("renders delete for both rooms and walls", () => {
    expect(renderDiff({ kind: "delete_element", elementId: "bedroom" }, scene)).toContain("- room bedroom");
    expect(renderDiff({ kind: "delete_element", elementId: "wall_south" }, scene)).toContain("- wall wall_south");
  });
});

describe("op log undo is last-in-first-out", () => {
  it("reverses committed ops in reverse order", () => {
    const engine = new Engine(seedScene());
    const before = JSON.stringify(engine.getScene());

    const addOp = makeAddWallOp({ x1: 5, y1: 1, x2: 5, y2: 9, structural: false });
    const moveOp: Op = { kind: "move_room", roomId: "bedroom", dx: 1, dy: 0 };
    engine.commit(engine.propose(addOp).proposalId);
    engine.commit(engine.propose(moveOp).proposalId);

    // Undo the move first, then the add — back to the original scene.
    engine.undo();
    engine.undo();
    expect(JSON.stringify(engine.getScene())).toBe(before);
    expect(engine.getOpLog()).toHaveLength(0);
  });
});

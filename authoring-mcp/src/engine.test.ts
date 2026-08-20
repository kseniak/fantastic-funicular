import { describe, expect, it } from "vitest";
import { Engine, makeAddWallOp } from "./proposals.js";
import { seedScene } from "./seed.js";

function freshEngine(): Engine {
  return new Engine(seedScene());
}

describe("Engine two-phase commit", () => {
  it("propose does not mutate the scene", () => {
    const engine = freshEngine();
    const wallsBefore = engine.getScene().walls.length;
    engine.propose(makeAddWallOp({ x1: 5, y1: 1, x2: 5, y2: 9, structural: false }));
    expect(engine.getScene().walls.length).toBe(wallsBefore);
    expect(engine.listProposals().length).toBe(1);
  });

  it("commit applies the change and clears the proposal", () => {
    const engine = freshEngine();
    const before = engine.getScene().walls.length;
    const p = engine.propose(makeAddWallOp({ x1: 5, y1: 1, x2: 5, y2: 9, structural: false }));
    const res = engine.commit(p.proposalId);
    expect(res.ok).toBe(true);
    expect(engine.getScene().walls.length).toBe(before + 1);
    expect(engine.listProposals().length).toBe(0);
  });

  it("a proposal can only be committed once", () => {
    const engine = freshEngine();
    const p = engine.propose(makeAddWallOp({ x1: 5, y1: 1, x2: 5, y2: 9, structural: false }));
    expect(engine.commit(p.proposalId).ok).toBe(true);
    expect(engine.commit(p.proposalId).ok).toBe(false);
  });

  it("blocked proposals cannot be committed", () => {
    const engine = freshEngine();
    const p = engine.propose({ kind: "move_room", roomId: "living_room", dx: 20, dy: 0 });
    expect(p.policyDecision.decision).toBe("blocked");
    expect(engine.commit(p.proposalId).ok).toBe(false);
  });

  it("reject discards a pending proposal", () => {
    const engine = freshEngine();
    const p = engine.propose(makeAddWallOp({ x1: 5, y1: 1, x2: 5, y2: 9, structural: false }));
    expect(engine.reject(p.proposalId).ok).toBe(true);
    expect(engine.listProposals().length).toBe(0);
    expect(engine.commit(p.proposalId).ok).toBe(false);
  });
});

describe("undo reverses commit", () => {
  it("undo of add_wall removes the wall", () => {
    const engine = freshEngine();
    const before = JSON.stringify(engine.getScene());
    const p = engine.propose(makeAddWallOp({ x1: 5, y1: 1, x2: 5, y2: 9, structural: false }));
    engine.commit(p.proposalId);
    engine.undo();
    expect(JSON.stringify(engine.getScene())).toBe(before);
  });

  it("undo of move_room restores the original position", () => {
    const engine = freshEngine();
    const before = JSON.stringify(engine.getScene());
    const p = engine.propose({ kind: "move_room", roomId: "living_room", dx: 2, dy: 1 });
    engine.commit(p.proposalId);
    engine.undo();
    expect(JSON.stringify(engine.getScene())).toBe(before);
  });

  it("undo of delete_element restores the deleted element", () => {
    const engine = freshEngine();
    const before = JSON.stringify(engine.getScene());
    const p = engine.propose({ kind: "delete_element", elementId: "bedroom" });
    engine.commit(p.proposalId);
    expect(engine.getScene().rooms.find((r) => r.id === "bedroom")).toBeUndefined();
    engine.undo();
    expect(JSON.stringify(engine.getScene())).toBe(before);
  });

  it("undo with an empty op log is a structured error", () => {
    const engine = freshEngine();
    expect(engine.undo().ok).toBe(false);
  });
});

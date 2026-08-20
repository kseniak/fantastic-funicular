/**
 * The authoring engine: single source of truth for scene state, the pending
 * proposal store, and the append-only op log. This is where the two-phase
 * commit machinery lives.
 *
 * Flow: an act tool calls `propose(op)` -> a `Proposal` is validated, policy is
 * evaluated, and it is parked in the pending map. Nothing has changed yet.
 * `commit(id)` applies it and appends to the op log; `reject(id)` discards it;
 * `undo()` reverses the most recent committed op.
 */

import { randomUUID } from "node:crypto";
import type { CommittedOp, Op, Proposal, Scene, Wall } from "./types.js";
import { applyOp, findElement, findRoom, reverseOp } from "./scene.js";
import { evaluate } from "./policy.js";

/** Structured, agent-legible outcome for commit/reject/undo. */
export type EngineResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

function ok<T>(value: T): EngineResult<T> {
  return { ok: true, value };
}

function err<T>(error: string): EngineResult<T> {
  return { ok: false, error };
}

export class Engine {
  private scene: Scene;
  private readonly proposals = new Map<string, Proposal>();
  private readonly opLog: CommittedOp[] = [];

  constructor(initial: Scene) {
    this.scene = initial;
  }

  getScene(): Scene {
    return this.scene;
  }

  listProposals(): readonly Proposal[] {
    return [...this.proposals.values()];
  }

  getOpLog(): readonly CommittedOp[] {
    return this.opLog;
  }

  /**
   * Build a proposal for an intended op. Runs invariants + policy (via
   * `evaluate`) and parks the proposal in the pending map. Never mutates the
   * scene. A `blocked` proposal is still stored and returned so the agent gets
   * a legible explanation and an id it can inspect.
   */
  propose(op: Op): Proposal {
    const policyDecision = evaluate(op, this.scene);
    const proposal: Proposal = {
      proposalId: randomUUID(),
      op,
      diff: renderDiff(op, this.scene),
      policyDecision,
      createdAt: new Date().toISOString(),
    };
    this.proposals.set(proposal.proposalId, proposal);
    return proposal;
  }

  /**
   * Apply a pending proposal. Blocked proposals cannot be committed. A
   * successful commit removes the proposal from the pending map and appends to
   * the op log. The policy decision is advisory: a `needs-approval` proposal
   * still commits — the human is the authority here.
   */
  commit(proposalId: string): EngineResult<Scene> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return err(`No pending proposal with id '${proposalId}'.`);
    if (proposal.policyDecision.decision === "blocked") {
      return err(`Proposal '${proposalId}' is blocked and cannot be committed: ${proposal.policyDecision.reason}`);
    }

    const { scene, record } = applyOp(this.scene, proposal.op);
    this.scene = scene;
    this.opLog.push(record);
    this.proposals.delete(proposalId);
    return ok(this.scene);
  }

  /** Discard a pending proposal without applying it. */
  reject(proposalId: string): EngineResult<{ rejected: string }> {
    if (!this.proposals.has(proposalId)) {
      return err(`No pending proposal with id '${proposalId}'.`);
    }
    this.proposals.delete(proposalId);
    return ok({ rejected: proposalId });
  }

  /** Reverse the most recent committed op, restoring the prior scene. */
  undo(): EngineResult<Scene> {
    const record = this.opLog.pop();
    if (!record) return err("Nothing to undo; the op log is empty.");
    this.scene = reverseOp(this.scene, record);
    return ok(this.scene);
  }
}

/**
 * Render a human-readable before/after diff for a proposed op. Kept separate
 * from policy so the two concerns (what would change vs. whether it's allowed)
 * stay independent.
 */
export function renderDiff(op: Op, scene: Scene): string {
  switch (op.kind) {
    case "add_wall": {
      const w = op.wall;
      const tag = w.structural ? " [structural]" : "";
      return `+ wall ${w.id}: (${w.x1},${w.y1}) -> (${w.x2},${w.y2})${tag}`;
    }
    case "move_room": {
      const room = findRoom(scene, op.roomId);
      if (!room) return `move_room: room '${op.roomId}' not found`;
      const to = `(${room.x + op.dx},${room.y + op.dy})`;
      return `~ room ${room.name} (${room.id}): (${room.x},${room.y}) -> ${to}`;
    }
    case "delete_element": {
      const el = findElement(scene, op.elementId);
      if (!el) return `delete_element: element '${op.elementId}' not found`;
      if (el.kind === "room") {
        return `- room ${el.name} (${el.id}) at (${el.x},${el.y}) ${el.width}x${el.height}`;
      }
      return `- wall ${el.id}: (${el.x1},${el.y1}) -> (${el.x2},${el.y2})`;
    }
  }
}

/** Construct a `Wall` op from raw agent input, assigning the engine-owned id. */
export function makeAddWallOp(input: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  structural: boolean;
}): Op {
  const wall: Wall = {
    id: `wall_${randomUUID().slice(0, 8)}`,
    kind: "wall",
    x1: input.x1,
    y1: input.y1,
    x2: input.x2,
    y2: input.y2,
    structural: input.structural,
  };
  return { kind: "add_wall", wall };
}

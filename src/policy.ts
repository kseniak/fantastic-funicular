/**
 * The policy layer — the decision that sits between propose and commit.
 *
 * `evaluate` is a pure function of (op, scene). It never mutates and never
 * throws, so it is trivially unit-testable and safe to call speculatively.
 *
 * Trust-model note: the returned decision is *advisory metadata*. The engine
 * surfaces it on every proposal so an orchestrator could enforce it, but
 * `commit` still succeeds regardless — the human is the final authority in this
 * demo. The engine informs; the human/policy disposes.
 */

import type { Op, PolicyDecision, Scene } from "./types.js";
import { checkInvariants } from "./invariants.js";
import { findElement } from "./scene.js";

/** Displacement at or below this (Manhattan) is considered a safe nudge. */
export const AUTO_APPROVE_MOVE_THRESHOLD = 2;

export function evaluate(op: Op, scene: Scene): PolicyDecision {
  // Invariant violations are hard blocks; nothing downstream should see them.
  const invariant = checkInvariants(op, scene);
  if (!invariant.ok) {
    return { decision: "blocked", reason: invariant.reason };
  }

  switch (op.kind) {
    case "delete_element":
      return {
        decision: "needs-approval",
        reason: "Deleting an element is destructive and requires human approval.",
      };

    case "add_wall":
      if (op.wall.structural) {
        return {
          decision: "needs-approval",
          reason: "Adding a structural wall affects load paths and requires human approval.",
        };
      }
      return {
        decision: "needs-approval",
        reason: "Adding a wall changes the floor plan; approval requested by default.",
      };

    case "move_room": {
      const displacement = Math.abs(op.dx) + Math.abs(op.dy);
      if (displacement <= AUTO_APPROVE_MOVE_THRESHOLD) {
        return {
          decision: "auto-approvable",
          reason: `Small room nudge (displacement ${displacement} <= ${AUTO_APPROVE_MOVE_THRESHOLD}); low risk.`,
        };
      }
      return {
        decision: "needs-approval",
        reason: `Room displacement ${displacement} exceeds the auto-approve threshold of ${AUTO_APPROVE_MOVE_THRESHOLD}.`,
      };
    }
  }

  // Defensive default; unreachable given the exhaustive switch above.
  return { decision: "needs-approval", reason: "Unclassified operation; approval requested by default." };
}

/**
 * Small helper used by diff rendering so policy reasons can reference an element
 * by a friendly label without duplicating lookup logic.
 */
export function describeElement(scene: Scene, elementId: string): string {
  const el = findElement(scene, elementId);
  if (!el) return `element '${elementId}'`;
  if (el.kind === "room") return `room '${el.name}' (${el.id})`;
  return `wall '${el.id}'`;
}

/**
 * Shared domain types for the agentic authoring engine.
 *
 * The scene graph is deliberately trivial: a single floor made of walls and
 * rooms on an integer grid. The interesting types are the ones that model the
 * trust boundary — `Op`, `Proposal`, `PolicyDecision`, `CommittedOp` — not the
 * geometry.
 */

/** Fixed floor bounds. The grid is [0, GRID_MAX] on both axes, inclusive. */
export const GRID_MIN = 0;
export const GRID_MAX = 20;

/** A wall is a segment between two integer grid points. */
export interface Wall {
  readonly id: string;
  readonly kind: "wall";
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  /** Structural walls carry load; the policy treats them as higher-risk. */
  readonly structural: boolean;
}

/** A room is an axis-aligned rectangle placed by its bottom-left corner. */
export interface Room {
  readonly id: string;
  readonly kind: "room";
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type Element = Wall | Room;

/** The entire authoring state for one floor. */
export interface Scene {
  readonly walls: readonly Wall[];
  readonly rooms: readonly Room[];
}

/**
 * An `Op` is an intended mutation. Act tools produce ops; the engine never
 * applies one until `commit`. Ops are plain data so they can be logged,
 * diffed, and policy-evaluated without side effects.
 */
export type Op =
  | { readonly kind: "add_wall"; readonly wall: Wall }
  | { readonly kind: "move_room"; readonly roomId: string; readonly dx: number; readonly dy: number }
  | { readonly kind: "delete_element"; readonly elementId: string };

export type OpKind = Op["kind"];

/**
 * A `CommittedOp` is what lands in the append-only op log. It carries enough
 * inverse information to be reversed by `undo()` without consulting anything
 * else — most importantly the full snapshot of a deleted element.
 */
export type CommittedOp =
  | { readonly kind: "add_wall"; readonly wall: Wall }
  | { readonly kind: "move_room"; readonly roomId: string; readonly dx: number; readonly dy: number }
  | { readonly kind: "delete_element"; readonly element: Element };

/** The policy verdict attached to every proposal as advisory metadata. */
export type PolicyDecisionKind = "auto-approvable" | "needs-approval" | "blocked";

export interface PolicyDecision {
  readonly decision: PolicyDecisionKind;
  readonly reason: string;
}

/**
 * A pending proposal. Act tools return one of these; state changes only when a
 * proposal is committed. `blocked` proposals are still returned (never thrown)
 * so the agent gets a structured, legible explanation.
 */
export interface Proposal {
  readonly proposalId: string;
  readonly op: Op;
  /** Human-readable before/after summary of what commit would do. */
  readonly diff: string;
  readonly policyDecision: PolicyDecision;
  readonly createdAt: string;
}

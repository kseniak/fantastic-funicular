/**
 * Scene graph model plus the pure apply/reverse functions that mutate it.
 *
 * Every function here is pure: it takes a scene and returns a new scene, never
 * touching the input. That is what makes commit/undo modelable as reversible
 * transactions and what makes the op-apply logic unit-testable in isolation.
 */

import type { CommittedOp, Element, Op, Room, Scene, Wall } from "./types.js";

export function emptyScene(): Scene {
  return { walls: [], rooms: [] };
}

export function findWall(scene: Scene, id: string): Wall | undefined {
  return scene.walls.find((w) => w.id === id);
}

export function findRoom(scene: Scene, id: string): Room | undefined {
  return scene.rooms.find((r) => r.id === id);
}

/** Look up any element by id across both collections. */
export function findElement(scene: Scene, id: string): Element | undefined {
  return findWall(scene, id) ?? findRoom(scene, id);
}

/**
 * Apply an op to a scene, returning the next scene and the `CommittedOp` record
 * to append to the op log. Callers must have already validated the op (see
 * invariants.ts); this function assumes the op is applicable and throws only on
 * a genuine programmer error, never as part of the normal agent flow.
 */
export function applyOp(scene: Scene, op: Op): { scene: Scene; record: CommittedOp } {
  switch (op.kind) {
    case "add_wall": {
      const next: Scene = { walls: [...scene.walls, op.wall], rooms: scene.rooms };
      return { scene: next, record: { kind: "add_wall", wall: op.wall } };
    }
    case "move_room": {
      const room = findRoom(scene, op.roomId);
      if (!room) throw new Error(`move_room: room '${op.roomId}' not found`);
      const moved: Room = { ...room, x: room.x + op.dx, y: room.y + op.dy };
      const next: Scene = {
        walls: scene.walls,
        rooms: scene.rooms.map((r) => (r.id === room.id ? moved : r)),
      };
      return { scene: next, record: { kind: "move_room", roomId: op.roomId, dx: op.dx, dy: op.dy } };
    }
    case "delete_element": {
      const element = findElement(scene, op.elementId);
      if (!element) throw new Error(`delete_element: element '${op.elementId}' not found`);
      const next: Scene = {
        walls: scene.walls.filter((w) => w.id !== op.elementId),
        rooms: scene.rooms.filter((r) => r.id !== op.elementId),
      };
      return { scene: next, record: { kind: "delete_element", element } };
    }
  }
}

/**
 * Reverse a committed op, returning the prior scene. This is the inverse of
 * `applyOp` and is what `undo()` uses to roll a transaction back.
 */
export function reverseOp(scene: Scene, record: CommittedOp): Scene {
  switch (record.kind) {
    case "add_wall":
      // Undo an add by removing the wall we added.
      return { walls: scene.walls.filter((w) => w.id !== record.wall.id), rooms: scene.rooms };
    case "move_room": {
      // Undo a move by applying the negated displacement.
      const room = findRoom(scene, record.roomId);
      if (!room) throw new Error(`undo move_room: room '${record.roomId}' not found`);
      const moved: Room = { ...room, x: room.x - record.dx, y: room.y - record.dy };
      return { walls: scene.walls, rooms: scene.rooms.map((r) => (r.id === room.id ? moved : r)) };
    }
    case "delete_element": {
      // Undo a delete by restoring the captured element snapshot.
      const el = record.element;
      if (el.kind === "wall") {
        return { walls: [...scene.walls, el], rooms: scene.rooms };
      }
      return { walls: scene.walls, rooms: [...scene.rooms, el] };
    }
  }
}

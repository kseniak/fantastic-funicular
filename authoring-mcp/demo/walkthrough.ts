/**
 * Narrated walkthrough of the read->act trust boundary, printed step by step.
 *
 * Runs the engine directly (no MCP client needed) so you can watch the flow:
 * read -> propose -> policy decision -> commit -> observe -> undo -> observe ->
 * a blocked proposal that commit refuses -> reject. Run with `npm run demo`.
 */

import { Engine, makeAddWallOp } from "../src/proposals.js";
import { queryDaylight } from "../src/daylight.js";
import { findRoom } from "../src/scene.js";
import { seedScene } from "../src/seed.js";
import type { Scene } from "../src/types.js";

function line(label: string, value: unknown): void {
  process.stdout.write(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}\n`);
}

function heading(text: string): void {
  process.stdout.write(`\n=== ${text} ===\n`);
}

function summarize(scene: Scene): string {
  return `${scene.walls.length} walls, ${scene.rooms.length} rooms`;
}

const engine = new Engine(seedScene());

heading("1. READ — current scene (never mutates)");
line("scene", summarize(engine.getScene()));
const living = findRoom(engine.getScene(), "living_room");
if (living) line("daylight(living_room)", queryDaylight(engine.getScene(), living));

heading("2. ACT — propose a partition wall splitting the living room");
const proposal = engine.propose(makeAddWallOp({ x1: 5, y1: 1, x2: 5, y2: 9, structural: false }));
line("proposalId", proposal.proposalId);
line("diff", proposal.diff);
line("policyDecision", proposal.policyDecision);
line("scene still", `${summarize(engine.getScene())} (unchanged — nothing committed yet)`);

heading("3. COMMIT — apply the proposal");
const committed = engine.commit(proposal.proposalId);
line("commit ok", committed.ok);
line("scene now", summarize(engine.getScene()));

heading("4. UNDO — reverse the last committed op");
engine.undo();
line("scene after undo", `${summarize(engine.getScene())} (back to the start)`);

heading("5. BLOCKED — an invariant-violating proposal cannot be committed");
const bad = engine.propose({ kind: "move_room", roomId: "living_room", dx: 20, dy: 0 });
line("policyDecision", bad.policyDecision);
const refused = engine.commit(bad.proposalId);
line("commit ok", refused.ok);
if (!refused.ok) line("commit error", refused.error);

heading("6. REJECT — discard a pending proposal");
const throwaway = engine.propose(makeAddWallOp({ x1: 2, y1: 1, x2: 2, y2: 9, structural: false }));
line("pending before reject", engine.listProposals().length);
engine.reject(throwaway.proposalId);
line("pending after reject", engine.listProposals().length);

process.stdout.write("\nDone. The scene never changed except on an explicit commit.\n");

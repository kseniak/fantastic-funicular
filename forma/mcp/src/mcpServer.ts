/**
 * Tool registration, shared by the stdio entrypoint (server.ts) and the HTTP
 * entrypoint (http.ts) so both expose an identical toolset over one engine.
 *
 * The split mirrors the trust boundary:
 *   - read tools     execute immediately, never mutate;
 *   - act tools      return a *proposal* (edits + policy + resulting compliance);
 *   - commit tools   disposition proposals (commit / reject / undo / list);
 *   - make_compliant is the loop: check -> propose the whole fix in one proposal.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ComplianceEngine } from "./proposals.js";

type ToolResult = { content: { type: "text"; text: string }[] };

function json(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/** Never let a raw throw cross the tool boundary; return a structured error instead. */
async function guard(run: () => Promise<unknown> | unknown): Promise<ToolResult> {
  try {
    return json(await run());
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) });
  }
}

export function buildServer(engine: ComplianceEngine): McpServer {
  const server = new McpServer({ name: "forma-compliance-mcp", version: "0.1.0" });

  // ── Read tools ─────────────────────────────────────────────────────────────

  server.tool("get_site", "Return the current site model: parcel, boundary, and buildings.", {}, () =>
    guard(() => engine.getSite()),
  );

  server.tool("get_zoning", "Fetch the zoning envelope for the parcel via the zoning provider.", {}, () =>
    guard(() => engine.getEnvelope()),
  );

  server.tool(
    "check_compliance",
    "Analyse the site against the zoning envelope and return the list of violations.",
    {},
    () => guard(() => engine.checkCompliance()),
  );

  // ── Act tools (propose only; never mutate) ─────────────────────────────────

  server.tool(
    "propose_fix",
    "Propose the geometry change(s) that would resolve a violation. Pass a violation id, or 'all'. Returns a proposal; does not mutate.",
    { target: z.string().describe("A violation id from check_compliance, or 'all'.") },
    ({ target }) => guard(() => engine.proposeFix(target)),
  );

  server.tool(
    "make_compliant",
    "The loop: check compliance, plan a fix for every violation, and return one combined proposal that would make the whole site compliant. Stops at the approval gate; does not mutate.",
    {},
    () => guard(() => engine.makeCompliant()),
  );

  // ── Commit tools (disposition) ─────────────────────────────────────────────

  server.tool(
    "commit",
    "Apply a pending proposal (re-checking that compliance does not worsen), log it for undo, and in live mode write the geometry to Forma.",
    { proposalId: z.string().describe("Id of the proposal to commit.") },
    ({ proposalId }) =>
      guard(async () => {
        const result = await engine.commit(proposalId);
        return result.ok ? result.value : { error: result.error };
      }),
  );

  server.tool(
    "reject",
    "Discard a pending proposal without applying it.",
    { proposalId: z.string().describe("Id of the proposal to reject.") },
    ({ proposalId }) => guard(() => {
      const result = engine.reject(proposalId);
      return result.ok ? result.value : { error: result.error };
    }),
  );

  server.tool("undo", "Reverse the most recent commit, restoring the exact prior geometry.", {}, () =>
    guard(async () => {
      const result = await engine.undo();
      return result.ok ? result.value : { error: result.error };
    }),
  );

  server.tool("list_proposals", "List pending proposals with their policy decisions and resulting compliance.", {}, () =>
    guard(() => engine.listProposals()),
  );

  return server;
}

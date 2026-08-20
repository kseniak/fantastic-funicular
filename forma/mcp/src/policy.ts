/**
 * The advisory policy gate.
 *
 * `evaluate` is a pure function over (edits, site, envelope). It classifies a
 * proposed set of edits as auto-approvable | needs-approval | blocked and gives
 * a reason. It is surfaced on every proposal so an orchestrator *could* enforce
 * it, but in this demo the human is the final authority — the engine informs,
 * the human disposes. The one hard rule the engine itself enforces is `blocked`.
 *
 * Starter rules, straight from the trust model:
 *   - an edit that would increase violations  -> blocked (never let compliance worsen)
 *   - a no-op                                 -> auto-approvable
 *   - anything that reshapes to meet a limit  -> needs-approval (it changes design intent)
 */

import { applyEdits, type Edit } from "./fixes.js";
import { checkCompliance } from "./compliance.js";
import { buildingsEqual, type Site, type ZoningEnvelope } from "./site.js";

export type PolicyDecisionKind = "auto-approvable" | "needs-approval" | "blocked";

export interface PolicyDecision {
  readonly decision: PolicyDecisionKind;
  readonly reason: string;
}

export function evaluate(edits: readonly Edit[], site: Site, env: ZoningEnvelope): PolicyDecision {
  if (edits.length === 0 || edits.every((e) => buildingsEqual(e.before, e.after))) {
    return { decision: "auto-approvable", reason: "No-op: the site already satisfies this rule, nothing to change." };
  }

  const before = checkCompliance(site, env).length;
  const after = checkCompliance(applyEdits(site, edits), env).length;
  if (after > before) {
    return {
      decision: "blocked",
      reason: `This edit would raise the violation count from ${before} to ${after}; compliance must never worsen.`,
    };
  }

  return {
    decision: "needs-approval",
    reason: "Reshaping the massing to meet a hard zoning limit changes the design intent; a human should sign off.",
  };
}

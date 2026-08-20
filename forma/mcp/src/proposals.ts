/**
 * The engine: the single source of truth for the site, the pending-proposal
 * store, and the append-only op log. This is where the two-phase commit lives.
 *
 * Flow: an act tool asks for a fix -> the engine builds a Proposal (edits +
 * policy decision + the compliance state that *would* result) and parks it.
 * Nothing has changed yet. `commit` is the only thing that mutates: it re-checks
 * compliance, refuses if the edit would make things worse, applies it, logs an
 * inverse for `undo`, and — in live mode — forwards the geometry to Forma.
 */

import { randomUUID } from "node:crypto";
import type { Site, ZoningEnvelope } from "./site.js";
import { checkCompliance, type Violation } from "./compliance.js";
import { applyEdits, planCompliance, proposeFixForViolation, type Edit } from "./fixes.js";
import { evaluate, type PolicyDecision } from "./policy.js";
import type { ZoningProvider } from "./zoning/index.js";
import type { Bridge } from "./bridge.js";

export interface Proposal {
  readonly proposalId: string;
  readonly target: string; // the violation id it addresses, or "all"
  readonly edits: readonly Edit[];
  readonly policyDecision: PolicyDecision;
  /** The compliance state the site would be in if this proposal were committed. */
  readonly resultingCompliance: readonly Violation[];
  readonly summary: string;
  readonly createdAt: string;
}

interface CommittedOp {
  readonly proposalId: string;
  readonly edits: readonly Edit[];
  readonly committedAt: string;
}

export type EngineResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

const ok = <T>(value: T): EngineResult<T> => ({ ok: true, value });
const err = <T>(error: string): EngineResult<T> => ({ ok: false, error });

export interface CommitResult {
  readonly committed: string;
  readonly compliance: readonly Violation[];
  readonly bridge: string;
}

export class ComplianceEngine {
  private site: Site;
  private envelope: ZoningEnvelope | null = null;
  private readonly proposals = new Map<string, Proposal>();
  private readonly opLog: CommittedOp[] = [];

  constructor(
    initial: Site,
    private readonly provider: ZoningProvider,
    private readonly bridge?: Bridge,
  ) {
    this.site = initial;
  }

  getSite(): Site {
    return this.site;
  }

  /**
   * Replace the working site — used by the live bridge when the Forma extension
   * pushes the scene it just read. Clears pending proposals, the op log, and the
   * cached envelope, since the parcel itself may have changed.
   */
  resetSite(site: Site): void {
    this.site = site;
    this.envelope = null;
    this.proposals.clear();
    this.opLog.length = 0;
  }

  listProposals(): readonly Proposal[] {
    return [...this.proposals.values()];
  }

  /** Fetch the parcel's envelope once and cache it; providers are network calls. */
  async getEnvelope(): Promise<ZoningEnvelope> {
    if (!this.envelope) {
      this.envelope = await this.provider.getEnvelope(this.site.parcelId);
    }
    return this.envelope;
  }

  async checkCompliance(): Promise<Violation[]> {
    return checkCompliance(this.site, await this.getEnvelope());
  }

  /**
   * Build a proposal for one violation id, or for "all" (which runs the full
   * make_compliant plan). Never mutates. A `blocked` proposal is still stored
   * and returned so the agent gets a legible id and reason.
   */
  async proposeFix(target: string): Promise<Proposal> {
    const env = await this.getEnvelope();
    const { edits, resultingCompliance } =
      target === "all" ? this.planAll(env) : this.planOne(target, env);
    return this.store(target, edits, resultingCompliance, env);
  }

  /** make_compliant: plan the whole site down to zero violations in one proposal. */
  async makeCompliant(): Promise<Proposal> {
    const env = await this.getEnvelope();
    const { edits, resultingCompliance } = this.planAll(env);
    return this.store("all", edits, resultingCompliance, env);
  }

  private planAll(env: ZoningEnvelope): { edits: Edit[]; resultingCompliance: Violation[] } {
    const plan = planCompliance(this.site, env);
    return { edits: plan.edits, resultingCompliance: plan.resultingCompliance };
  }

  private planOne(violationId: string, env: ZoningEnvelope): { edits: Edit[]; resultingCompliance: Violation[] } {
    const violation = checkCompliance(this.site, env).find((v) => v.id === violationId);
    if (!violation) {
      throw new Error(`No current violation with id '${violationId}'. Call check_compliance for the live list.`);
    }
    const edits = proposeFixForViolation(this.site, env, violation);
    return { edits, resultingCompliance: checkCompliance(applyEdits(this.site, edits), env) };
  }

  private store(target: string, edits: Edit[], resultingCompliance: Violation[], env: ZoningEnvelope): Proposal {
    const proposal: Proposal = {
      proposalId: randomUUID(),
      target,
      edits,
      policyDecision: evaluate(edits, this.site, env),
      resultingCompliance,
      summary: edits.length === 0 ? "No edits: already compliant with this rule." : edits.map((e) => e.rationale).join("; "),
      createdAt: new Date().toISOString(),
    };
    this.proposals.set(proposal.proposalId, proposal);
    return proposal;
  }

  /**
   * Apply a pending proposal. Blocked proposals can't commit. Before mutating,
   * we re-run check_compliance on the would-be site and refuse if the violation
   * count went up — compliance must never silently worsen. On success we log an
   * inverse for undo and forward the geometry to Forma in live mode.
   */
  async commit(proposalId: string): Promise<EngineResult<CommitResult>> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return err(`No pending proposal with id '${proposalId}'.`);
    if (proposal.policyDecision.decision === "blocked") {
      return err(`Proposal '${proposalId}' is blocked and cannot be committed: ${proposal.policyDecision.reason}`);
    }

    const env = await this.getEnvelope();
    const before = checkCompliance(this.site, env).length;
    const nextSite = applyEdits(this.site, proposal.edits);
    const after = checkCompliance(nextSite, env);
    if (after.length > before) {
      return err(
        `Refusing to commit '${proposalId}': it would raise violations from ${before} to ${after.length}. Compliance must not worsen.`,
      );
    }

    this.site = nextSite;
    this.opLog.push({ proposalId, edits: proposal.edits, committedAt: new Date().toISOString() });
    this.proposals.delete(proposalId);
    await this.bridge?.pushEdits(proposal.edits);
    return ok({ committed: proposalId, compliance: after, bridge: this.bridge?.mode ?? "none" });
  }

  reject(proposalId: string): EngineResult<{ rejected: string }> {
    if (!this.proposals.has(proposalId)) return err(`No pending proposal with id '${proposalId}'.`);
    this.proposals.delete(proposalId);
    return ok({ rejected: proposalId });
  }

  /** Reverse the most recent commit, restoring the exact prior geometry. */
  async undo(): Promise<EngineResult<{ compliance: readonly Violation[]; bridge: string }>> {
    const op = this.opLog.pop();
    if (!op) return err("Nothing to undo; the op log is empty.");
    // Swapping before/after turns each edit into its own inverse.
    const reversal = op.edits.map((e) => ({ ...e, before: e.after, after: e.before }));
    this.site = applyEdits(this.site, reversal);
    await this.bridge?.pushReversal(reversal);
    const env = await this.getEnvelope();
    return ok({ compliance: checkCompliance(this.site, env), bridge: this.bridge?.mode ?? "none" });
  }
}

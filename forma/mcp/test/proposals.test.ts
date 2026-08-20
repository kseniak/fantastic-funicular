import { describe, expect, it } from "vitest";
import { ComplianceEngine, type Proposal } from "../src/proposals.js";
import { MockZoningProvider } from "../src/zoning/index.js";
import { checkCompliance } from "../src/compliance.js";
import { compliantSite, envelope, nonCompliantSite } from "./fixtures.js";
import type { Site } from "../src/site.js";

function makeEngine(site: Site = nonCompliantSite): ComplianceEngine {
  return new ComplianceEngine(site, new MockZoningProvider());
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("two-phase commit", () => {
  it("does not mutate the site when a proposal is created", async () => {
    const engine = makeEngine();
    const before = clone(engine.getSite());
    await engine.makeCompliant();
    expect(engine.getSite()).toEqual(before);
  });

  it("commit applies the proposal and clears the violations", async () => {
    const engine = makeEngine();
    const proposal = await engine.makeCompliant();
    const result = await engine.commit(proposal.proposalId);
    expect(result.ok).toBe(true);
    expect(await engine.checkCompliance()).toHaveLength(0);
  });

  it("a committed proposal is single-use", async () => {
    const engine = makeEngine();
    const proposal = await engine.makeCompliant();
    await engine.commit(proposal.proposalId);
    const second = await engine.commit(proposal.proposalId);
    expect(second.ok).toBe(false);
  });

  it("undo restores the exact prior geometry", async () => {
    const engine = makeEngine();
    const original = clone(engine.getSite());
    const proposal = await engine.makeCompliant();
    await engine.commit(proposal.proposalId);
    expect(engine.getSite()).not.toEqual(original);
    await engine.undo();
    expect(engine.getSite()).toEqual(original);
  });

  it("reject discards a proposal without mutating the site", async () => {
    const engine = makeEngine();
    const before = clone(engine.getSite());
    const proposal = await engine.makeCompliant();
    const result = engine.reject(proposal.proposalId);
    expect(result.ok).toBe(true);
    expect(engine.listProposals()).toHaveLength(0);
    expect(engine.getSite()).toEqual(before);
  });

  it("undo on an empty op log is a structured error, not a throw", async () => {
    const result = await makeEngine().undo();
    expect(result.ok).toBe(false);
  });

  it("refuses to commit a proposal that would worsen compliance", async () => {
    const engine = makeEngine(compliantSite);
    // White-box: inject a hand-made worsening proposal to exercise the commit
    // guard. The public fix strategies can't produce one — they only ever
    // improve compliance — but the guard has to hold against any proposal.
    const b = engine.getSite().buildings[0];
    const bad: Proposal = {
      proposalId: "worsen",
      target: "manual",
      edits: [{ buildingId: b.id, before: b, after: { ...b, height: b.height + 100 }, rationale: "raise it" }],
      policyDecision: { decision: "needs-approval", reason: "manual" },
      resultingCompliance: [],
      summary: "manual",
      createdAt: new Date().toISOString(),
    };
    (engine as unknown as { proposals: Map<string, Proposal> }).proposals.set(bad.proposalId, bad);
    const before = checkCompliance(engine.getSite(), envelope).length;
    const result = await engine.commit("worsen");
    expect(result.ok).toBe(false);
    // site untouched
    expect(checkCompliance(engine.getSite(), envelope).length).toBe(before);
  });
});

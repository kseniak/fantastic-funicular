import { describe, expect, it } from "vitest";
import { ComplianceEngine } from "../src/proposals.js";
import { MockZoningProvider } from "../src/zoning/index.js";
import { nonCompliantSite } from "./fixtures.js";

describe("make_compliant loop", () => {
  it("turns a non-compliant site into a compliant one in a single combined proposal", async () => {
    const engine = new ComplianceEngine(nonCompliantSite, new MockZoningProvider());

    expect((await engine.checkCompliance()).length).toBeGreaterThan(0);

    const proposal = await engine.makeCompliant();
    expect(proposal.edits.length).toBeGreaterThan(0);
    expect(proposal.resultingCompliance).toHaveLength(0);
    expect(proposal.policyDecision.decision).toBe("needs-approval");

    // The proposal is a plan only — nothing has changed yet.
    expect((await engine.checkCompliance()).length).toBeGreaterThan(0);

    const result = await engine.commit(proposal.proposalId);
    expect(result.ok).toBe(true);
    expect(await engine.checkCompliance()).toHaveLength(0);
  });

  it("produces one net edit per changed building, not one per fix step", async () => {
    const engine = new ComplianceEngine(nonCompliantSite, new MockZoningProvider());
    const proposal = await engine.makeCompliant();
    const ids = proposal.edits.map((e) => e.buildingId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

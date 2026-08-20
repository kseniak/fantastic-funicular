import { describe, expect, it } from "vitest";
import { evaluate } from "../src/policy.js";
import { checkCompliance } from "../src/compliance.js";
import { proposeFixForViolation, type Edit } from "../src/fixes.js";
import { building, compliantSite, envelope, nonCompliantSite } from "./fixtures.js";

describe("policy.evaluate", () => {
  it("blocks an edit that would increase violations", () => {
    const b = compliantSite.buildings[0];
    const worsen: Edit = { buildingId: b.id, before: b, after: { ...b, height: 100 }, rationale: "raise it" };
    const decision = evaluate([worsen], compliantSite, envelope);
    expect(decision.decision).toBe("blocked");
  });

  it("classifies a no-op as auto-approvable", () => {
    const b = building();
    const noop: Edit = { buildingId: b.id, before: b, after: b, rationale: "no change" };
    expect(evaluate([noop], compliantSite, envelope).decision).toBe("auto-approvable");
    expect(evaluate([], compliantSite, envelope).decision).toBe("auto-approvable");
  });

  it("classifies a real compliance-improving reshape as needs-approval", () => {
    const height = checkCompliance(nonCompliantSite, envelope).find((v) => v.type === "height")!;
    const edits = proposeFixForViolation(nonCompliantSite, envelope, height);
    expect(evaluate(edits, nonCompliantSite, envelope).decision).toBe("needs-approval");
  });
});

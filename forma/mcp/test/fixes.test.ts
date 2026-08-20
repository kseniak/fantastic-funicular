import { describe, expect, it } from "vitest";
import { checkCompliance, type ViolationType } from "../src/compliance.js";
import { applyEdits, proposeFixForViolation } from "../src/fixes.js";
import { building, envelope, nonCompliantSite, site } from "./fixtures.js";
import type { Site } from "../src/site.js";

/** Run the fix for the first violation of `type` and return the resulting site. */
function fixFirst(s: Site, type: ViolationType): Site {
  const violation = checkCompliance(s, envelope).find((v) => v.type === type);
  expect(violation, `expected a ${type} violation to fix`).toBeDefined();
  return applyEdits(s, proposeFixForViolation(s, envelope, violation!));
}

function typesAfter(s: Site, type: ViolationType): ViolationType[] {
  return checkCompliance(fixFirst(s, type), envelope).map((v) => v.type);
}

describe("fix strategies", () => {
  it("height fix brings the building under the limit and recomputes floors", () => {
    const tall = site([building({ height: 30, floors: 10 })]); // storey 3m
    const fixed = fixFirst(tall, "height");
    const b = fixed.buildings[0];
    expect(b.height).toBeLessThanOrEqual(envelope.maxHeight);
    expect(b.floors).toBe(8); // floor(24 / 3)
    expect(checkCompliance(fixed, envelope).some((v) => v.type === "height")).toBe(false);
  });

  it("setback fix insets the footprint inside the buildable area", () => {
    expect(typesAfter(nonCompliantSite, "setback")).not.toContain("setback");
  });

  it("coverage fix brings total footprint within the limit", () => {
    const covered = site([
      building({ id: "a", footprint: [[4, 4], [24, 4], [24, 24], [4, 24]] }),
      building({ id: "b", footprint: [[16, 4], [36, 4], [36, 24], [16, 24]] }),
    ]);
    expect(typesAfter(covered, "coverage")).not.toContain("coverage");
  });

  it("FAR fix drops floors until floor area meets the limit", () => {
    expect(typesAfter(nonCompliantSite, "far")).not.toContain("far");
  });

  it("use fix reassigns the building to an allowed use", () => {
    const bad = site([building({ function: "heavy_industrial" })]);
    const fixed = fixFirst(bad, "use");
    expect(envelope.allowedUses).toContain(fixed.buildings[0].function);
  });

  it("no fix introduces a new violation of another type", () => {
    for (const type of ["height", "setback", "coverage", "far"] as const) {
      const before = new Set(checkCompliance(nonCompliantSite, envelope).map((v) => v.type));
      const after = new Set(typesAfter(nonCompliantSite, type));
      // every remaining violation type was already present; nothing new appeared
      for (const t of after) expect(before.has(t)).toBe(true);
    }
  });
});

import { describe, expect, it } from "vitest";
import { checkCompliance } from "../src/compliance.js";
import { building, compliantSite, envelope, nonCompliantSite, site } from "./fixtures.js";

const typesOf = (s = nonCompliantSite) => checkCompliance(s, envelope).map((v) => v.type);

describe("checkCompliance", () => {
  it("reports no violations for a compliant site", () => {
    expect(checkCompliance(compliantSite, envelope)).toHaveLength(0);
  });

  it("reports exactly the expected violation set for the mock scene", () => {
    // tower: height + setback; site-level: coverage + FAR. annex is clean.
    expect(typesOf().sort()).toEqual(["coverage", "far", "height", "setback"]);
    const ids = checkCompliance(nonCompliantSite, envelope).map((v) => v.id);
    expect(ids).toContain("height:tower");
    expect(ids).toContain("setback:tower");
    expect(ids).toContain("coverage");
    expect(ids).toContain("far");
  });

  it("detects a use violation", () => {
    const s = site([building({ function: "heavy_industrial" })]);
    const uses = checkCompliance(s, envelope).filter((v) => v.type === "use");
    expect(uses).toHaveLength(1);
    expect(uses[0].buildingId).toBe("b1");
  });

  it("treats exactly-at-the-limit as compliant and one unit over as a violation", () => {
    expect(checkCompliance(site([building({ height: 24 })]), envelope).some((v) => v.type === "height")).toBe(false);
    expect(checkCompliance(site([building({ height: 25 })]), envelope).some((v) => v.type === "height")).toBe(true);
  });

  it("treats a footprint exactly on the setback line as compliant, one unit inside as a violation", () => {
    // side setback is 3; a building whose left edge sits at x=3 is exactly at the line.
    const onLine = building({ footprint: [[3, 10], [13, 10], [13, 20], [3, 20]] });
    expect(checkCompliance(site([onLine]), envelope).some((v) => v.type === "setback")).toBe(false);
    const over = building({ footprint: [[2, 10], [12, 10], [12, 20], [2, 20]] });
    expect(checkCompliance(site([over]), envelope).some((v) => v.type === "setback")).toBe(true);
  });

  it("flags coverage only when total footprint exceeds the limit", () => {
    // Two 20x20 footprints = 800 / 1200 = 0.67 > 0.5.
    const big = site([
      building({ id: "a", footprint: [[4, 4], [24, 4], [24, 24], [4, 24]] }),
      building({ id: "b", footprint: [[16, 4], [36, 4], [36, 24], [16, 24]] }),
    ]);
    expect(checkCompliance(big, envelope).some((v) => v.type === "coverage")).toBe(true);
  });
});

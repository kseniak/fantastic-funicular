/**
 * check_compliance — the analysis core. Pure function over (site, envelope)
 * returning a structured list of violations. No geometry is changed here; this
 * only reports. Every fix strategy is judged by whether re-running this on its
 * result clears the violation it targeted.
 *
 * Setback modelling note: I treat the parcel as axis-aligned and map the four
 * setbacks to compass sides — front = south (min y), rear = north (max y),
 * side = east/west. Real zoning derives "front" from street frontage; doing
 * that properly needs frontage data the model doesn't carry, so this mapping is
 * the documented simplification. It is still real setback math: the distance
 * from each parcel edge to the nearest part of the footprint.
 */

import {
  boundingBox,
  extrudedFloorArea,
  polygonArea,
  type Building,
  type Site,
  type ZoningEnvelope,
} from "./site.js";

export type ViolationType = "height" | "setback" | "far" | "coverage" | "use";
export type Severity = "error" | "warning";

export interface Violation {
  readonly id: string;
  readonly type: ViolationType;
  readonly buildingId?: string;
  readonly actual: number;
  readonly allowed: number;
  readonly severity: Severity;
  readonly humanReadable: string;
}

/** A max is breached by more than 10% -> error, otherwise a warning. */
function severityOver(actual: number, allowed: number): Severity {
  return actual > allowed * 1.1 ? "error" : "warning";
}

/** A min (a setback gap) is short by more than 10% -> error, otherwise warning. */
function severityUnder(gap: number, required: number): Severity {
  return gap < required * 0.9 ? "error" : "warning";
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface SetbackGaps {
  readonly front: number;
  readonly rear: number;
  readonly left: number;
  readonly right: number;
}

/** Distance from each parcel edge to the nearest footprint point on that side. */
export function setbackGaps(site: Site, building: Building): SetbackGaps {
  const parcel = boundingBox(site.boundaryPolygon);
  const b = boundingBox(building.footprint);
  return {
    front: b.minY - parcel.minY,
    rear: parcel.maxY - b.maxY,
    left: b.minX - parcel.minX,
    right: parcel.maxX - b.maxX,
  };
}

function checkHeight(building: Building, env: ZoningEnvelope): Violation | null {
  if (building.height <= env.maxHeight) return null;
  return {
    id: `height:${building.id}`,
    type: "height",
    buildingId: building.id,
    actual: round(building.height),
    allowed: env.maxHeight,
    severity: severityOver(building.height, env.maxHeight),
    humanReadable: `${building.id} is ${round(building.height)}m tall; the zoning limit is ${env.maxHeight}m.`,
  };
}

function checkSetback(site: Site, building: Building, env: ZoningEnvelope): Violation | null {
  const gaps = setbackGaps(site, building);
  const deficient: { side: string; gap: number; required: number }[] = [];
  if (gaps.front < env.frontSetback) deficient.push({ side: "front", gap: gaps.front, required: env.frontSetback });
  if (gaps.rear < env.rearSetback) deficient.push({ side: "rear", gap: gaps.rear, required: env.rearSetback });
  if (gaps.left < env.sideSetback) deficient.push({ side: "left", gap: gaps.left, required: env.sideSetback });
  if (gaps.right < env.sideSetback) deficient.push({ side: "right", gap: gaps.right, required: env.sideSetback });
  if (deficient.length === 0) return null;

  // Report the worst side as the headline numbers; list them all in the text.
  const worst = deficient.reduce((a, b) => (b.required - b.gap > a.required - a.gap ? b : a));
  const detail = deficient.map((d) => `${d.side} ${round(d.gap)}m (needs ${d.required}m)`).join(", ");
  return {
    id: `setback:${building.id}`,
    type: "setback",
    buildingId: building.id,
    actual: round(worst.gap),
    allowed: worst.required,
    severity: severityUnder(worst.gap, worst.required),
    humanReadable: `${building.id} breaches the setback on ${detail}.`,
  };
}

function checkUse(building: Building, env: ZoningEnvelope): Violation | null {
  if (env.allowedUses.includes(building.function)) return null;
  return {
    id: `use:${building.id}`,
    type: "use",
    buildingId: building.id,
    actual: 0,
    allowed: 0,
    severity: "error",
    humanReadable: `${building.id} is '${building.function}', not an allowed use (${env.allowedUses.join(", ")}).`,
  };
}

function checkCoverage(site: Site, env: ZoningEnvelope): Violation | null {
  const lotArea = polygonArea(site.boundaryPolygon);
  const footprintArea = site.buildings.reduce((sum, b) => sum + polygonArea(b.footprint), 0);
  const coverage = footprintArea / lotArea;
  if (coverage <= env.maxLotCoverage) return null;
  return {
    id: "coverage",
    type: "coverage",
    actual: round(coverage),
    allowed: env.maxLotCoverage,
    severity: severityOver(coverage, env.maxLotCoverage),
    humanReadable: `Lot coverage is ${round(coverage * 100)}%; the limit is ${round(env.maxLotCoverage * 100)}%.`,
  };
}

function checkFar(site: Site, env: ZoningEnvelope): Violation | null {
  const lotArea = polygonArea(site.boundaryPolygon);
  const floorArea = site.buildings.reduce((sum, b) => sum + extrudedFloorArea(b), 0);
  const far = floorArea / lotArea;
  if (far <= env.maxFAR) return null;
  return {
    id: "far",
    type: "far",
    actual: round(far),
    allowed: env.maxFAR,
    severity: severityOver(far, env.maxFAR),
    humanReadable: `Floor area ratio is ${round(far)}; the limit is ${env.maxFAR}.`,
  };
}

/**
 * The full check. Per-building rules (height, setback, use) come first in
 * building order, then the two site-level rules (coverage, FAR). The order is
 * fixed so the output — and anything that iterates it, like make_compliant — is
 * deterministic.
 */
export function checkCompliance(site: Site, env: ZoningEnvelope): Violation[] {
  const violations: Violation[] = [];
  for (const building of site.buildings) {
    const height = checkHeight(building, env);
    if (height) violations.push(height);
    const setback = checkSetback(site, building, env);
    if (setback) violations.push(setback);
    const use = checkUse(building, env);
    if (use) violations.push(use);
  }
  const coverage = checkCoverage(site, env);
  if (coverage) violations.push(coverage);
  const far = checkFar(site, env);
  if (far) violations.push(far);
  return violations;
}

export function isCompliant(site: Site, env: ZoningEnvelope): boolean {
  return checkCompliance(site, env).length === 0;
}

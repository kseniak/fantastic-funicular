/**
 * propose_fix strategies. Each one is a pure, deterministic transform: given a
 * violation it returns the edit(s) that resolve it, and re-running
 * check_compliance on the result clears that violation without introducing a
 * new one of another type. That last property is not luck — every strategy here
 * only ever *shrinks* the massing (lower, inset, scale-down, fewer floors), and
 * every check is monotonic in that direction, so a fix can't push another rule
 * over its limit.
 */

import {
  boundingBox,
  buildingsEqual,
  centroid,
  clipToRect,
  extrudedFloorArea,
  findBuilding,
  polygonArea,
  replaceBuilding,
  scaleAbout,
  storeyHeight,
  type Building,
  type BoundingBox,
  type Site,
  type ZoningEnvelope,
} from "./site.js";
import { checkCompliance, isCompliant, type Violation, type ViolationType } from "./compliance.js";

export interface Edit {
  readonly buildingId: string;
  readonly before: Building;
  readonly after: Building;
  readonly rationale: string;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The rectangle a footprint has to sit inside once the setbacks are applied. */
function buildableRect(site: Site, env: ZoningEnvelope): BoundingBox {
  const parcel = boundingBox(site.boundaryPolygon);
  return {
    minX: parcel.minX + env.sideSetback,
    maxX: parcel.maxX - env.sideSetback,
    minY: parcel.minY + env.frontSetback,
    maxY: parcel.maxY - env.rearSetback,
  };
}

function fixHeight(building: Building, env: ZoningEnvelope): Edit {
  const storey = storeyHeight(building);
  const floors = Math.max(1, Math.floor(env.maxHeight / storey));
  const height = floors * storey;
  const after: Building = { ...building, height, floors };
  return {
    buildingId: building.id,
    before: building,
    after,
    rationale: `lower ${building.id} to ${round(height)}m (${building.floors}->${floors} floors at ${round(storey)}m each) to meet the ${env.maxHeight}m height limit`,
  };
}

function fixSetback(site: Site, building: Building, env: ZoningEnvelope): Edit {
  const rect = buildableRect(site, env);
  const after: Building = { ...building, footprint: clipToRect(building.footprint, rect) };
  return {
    buildingId: building.id,
    before: building,
    after,
    rationale: `inset ${building.id} into the buildable area (front ${env.frontSetback}m, side ${env.sideSetback}m, rear ${env.rearSetback}m)`,
  };
}

function fixUse(building: Building, env: ZoningEnvelope): Edit[] {
  if (env.allowedUses.length === 0) return [];
  const use = env.allowedUses[0];
  const after: Building = { ...building, function: use };
  return [
    {
      buildingId: building.id,
      before: building,
      after,
      rationale: `reassign ${building.id} from '${building.function}' to '${use}' — a program change a planner has to sign off, surfaced here as needs-approval`,
    },
  ];
}

/**
 * Coverage: scale every footprint about its own centroid until the total
 * footprint area meets the limit. Area scales with the square of the factor, so
 * the factor is the square root of the ratio we need. Scaling about the centroid
 * shrinks a building in place, so it only ever *improves* setback gaps.
 */
function fixCoverage(site: Site, env: ZoningEnvelope): Edit[] {
  const lotArea = polygonArea(site.boundaryPolygon);
  const current = site.buildings.reduce((sum, b) => sum + polygonArea(b.footprint), 0);
  const target = env.maxLotCoverage * lotArea;
  if (current <= target) return [];
  // Nudge just under the limit so float error can't leave us a hair over.
  const factor = Math.sqrt(target / current) * (1 - 1e-6);
  const pct = round((1 - factor) * 100);
  return site.buildings.map((b) => {
    const after: Building = { ...b, footprint: scaleAbout(b.footprint, factor, centroid(b.footprint)) };
    return {
      buildingId: b.id,
      before: b,
      after,
      rationale: `shrink ${b.id} footprint ~${pct}% to bring lot coverage within ${round(env.maxLotCoverage * 100)}%`,
    };
  });
}

/**
 * FAR: drop floors, one at a time, from the building with the largest footprint
 * (that is where a single floor buys back the most area), until total floor area
 * meets the limit. Ties break on id so the choice is deterministic.
 */
function fixFar(site: Site, env: ZoningEnvelope): Edit[] {
  const lotArea = polygonArea(site.boundaryPolygon);
  const target = env.maxFAR * lotArea;
  const work = new Map<string, Building>(site.buildings.map((b) => [b.id, b]));
  const totalFloorArea = () => [...work.values()].reduce((sum, b) => sum + extrudedFloorArea(b), 0);

  let guard = 0;
  while (totalFloorArea() > target && guard++ < 10_000) {
    const candidate = [...work.values()]
      .filter((b) => b.floors > 1)
      .sort((a, b) => polygonArea(b.footprint) - polygonArea(a.footprint) || (a.id < b.id ? -1 : 1))[0];
    if (!candidate) break; // every building is down to one floor; can't reduce further
    const storey = storeyHeight(candidate);
    const floors = candidate.floors - 1;
    work.set(candidate.id, { ...candidate, floors, height: floors * storey });
  }

  return site.buildings
    .filter((b) => work.get(b.id)!.floors !== b.floors)
    .map((b) => {
      const after = work.get(b.id)!;
      return {
        buildingId: b.id,
        before: b,
        after,
        rationale: `drop ${b.id} from ${b.floors} to ${after.floors} floors to meet FAR ${env.maxFAR}`,
      };
    });
}

/** Compute the edit(s) that resolve a single violation. */
export function proposeFixForViolation(site: Site, env: ZoningEnvelope, violation: Violation): Edit[] {
  switch (violation.type) {
    case "height": {
      const b = violation.buildingId ? findBuilding(site, violation.buildingId) : undefined;
      return b ? [fixHeight(b, env)] : [];
    }
    case "setback": {
      const b = violation.buildingId ? findBuilding(site, violation.buildingId) : undefined;
      return b ? [fixSetback(site, b, env)] : [];
    }
    case "use": {
      const b = violation.buildingId ? findBuilding(site, violation.buildingId) : undefined;
      return b ? fixUse(b, env) : [];
    }
    case "coverage":
      return fixCoverage(site, env);
    case "far":
      return fixFar(site, env);
  }
}

export function applyEdits(site: Site, edits: readonly Edit[]): Site {
  return edits.reduce((s, e) => replaceBuilding(s, e.after), site);
}

/**
 * Fix priority. Setbacks and height come first because insetting and lowering
 * also relieve coverage and FAR, so resolving them first tends to make the
 * site-level fixes smaller (or unnecessary). Order is fixed, never data-driven,
 * so the plan is reproducible.
 */
const PRIORITY: Record<ViolationType, number> = {
  setback: 0,
  height: 1,
  use: 2,
  coverage: 3,
  far: 4,
};

/**
 * make_compliant's engine: repeatedly check, fix the highest-priority
 * violation, apply it to a working copy, and loop until the site is clean (or no
 * strategy makes progress). Returns the net per-building edits — one edit per
 * building that ended up different — plus the resulting site.
 */
export function planCompliance(
  site: Site,
  env: ZoningEnvelope,
): { edits: Edit[]; resultingSite: Site; resultingCompliance: Violation[] } {
  let work = site;
  let guard = 0;
  while (!isCompliant(work, env) && guard++ < 100) {
    const violations = checkCompliance(work, env);
    const next = [...violations].sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type])[0];
    const edits = proposeFixForViolation(work, env, next);
    if (edits.length === 0) break; // nothing resolves this one (e.g. no allowed uses); bail rather than spin
    work = applyEdits(work, edits);
  }

  const edits: Edit[] = site.buildings
    .map((before) => ({ before, after: findBuilding(work, before.id)! }))
    .filter(({ before, after }) => !buildingsEqual(before, after))
    .map(({ before, after }) => ({
      buildingId: before.id,
      before,
      after,
      rationale: summariseEdit(before, after),
    }));

  return { edits, resultingSite: work, resultingCompliance: checkCompliance(work, env) };
}

/** One-line summary of the net change to a building after a full plan. */
function summariseEdit(before: Building, after: Building): string {
  const parts: string[] = [];
  if (before.function !== after.function) parts.push(`use ${before.function}->${after.function}`);
  if (JSON.stringify(before.footprint) !== JSON.stringify(after.footprint)) {
    parts.push(`footprint ${round(polygonArea(before.footprint))}->${round(polygonArea(after.footprint))} m2`);
  }
  if (before.height !== after.height) parts.push(`height ${round(before.height)}->${round(after.height)} m`);
  if (before.floors !== after.floors) parts.push(`floors ${before.floors}->${after.floors}`);
  return `${before.id}: ${parts.join(", ")}`;
}

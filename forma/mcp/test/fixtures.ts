import type { Building, Site, ZoningEnvelope } from "../src/site.js";

/** Matches the mock scene's parcel: a 40 x 30 m lot, area 1200. */
export const parcelBoundary = [
  [0, 0],
  [40, 0],
  [40, 30],
  [0, 30],
] as const;

export const envelope: ZoningEnvelope = {
  maxHeight: 24,
  frontSetback: 5,
  sideSetback: 3,
  rearSetback: 5,
  maxFAR: 2.5,
  maxLotCoverage: 0.5,
  allowedUses: ["residential", "retail", "office", "mixed_use"],
};

export function building(overrides: Partial<Building> = {}): Building {
  return {
    id: "b1",
    footprint: [
      [10, 10],
      [20, 10],
      [20, 20],
      [10, 20],
    ],
    baseZ: 0,
    height: 12,
    floors: 4,
    function: "residential",
    ...overrides,
  };
}

export function site(buildings: Building[]): Site {
  return { parcelId: "mock-parcel-001", planeZ: 0, boundaryPolygon: parcelBoundary, buildings };
}

/** A single, comfortably-compliant building on the lot. */
export const compliantSite: Site = site([building()]);

/** The mock scene: tower breaks height + setback; together they break coverage + FAR. */
export const nonCompliantSite: Site = site([
  {
    id: "tower",
    footprint: [
      [2, 3],
      [30, 3],
      [30, 27],
      [2, 27],
    ],
    baseZ: 0,
    height: 30,
    floors: 10,
    function: "residential",
  },
  {
    id: "annex",
    footprint: [
      [33, 10],
      [37, 10],
      [37, 20],
      [33, 20],
    ],
    baseZ: 0,
    height: 12,
    floors: 3,
    function: "retail",
  },
]);

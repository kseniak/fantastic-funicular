/**
 * The internal site model and the geometry it needs.
 *
 * This is the backbone of the whole project, so it comes first. The model is
 * deliberately small: a parcel boundary, a set of extruded footprints, and the
 * zoning envelope they have to fit inside. Everything downstream — compliance
 * checks, fix strategies, proposals — is a pure function over these types.
 *
 * The model is Forma-agnostic on purpose. Forma (or the offline mock) is the
 * only thing that knows how to translate real scene elements into this shape,
 * which is what lets me test the interesting logic without a Forma license.
 *
 * All geometry is 2D: footprints are polygons on the site plane, buildings are
 * those footprints extruded to a height. That is enough for real setback,
 * height, FAR and coverage math and keeps the focus on the loop, not on solids.
 */

/** A point on the site plane. Site units are metres. */
export type Point = readonly [number, number];

/** A closed polygon given as its vertices in order (first != last). */
export type Polygon = readonly Point[];

export type BuildingUse = string;

export interface Site {
  readonly parcelId: string;
  readonly boundaryPolygon: Polygon;
  /** Elevation of the site plane; footprints sit on it unless raised by baseZ. */
  readonly planeZ: number;
  readonly buildings: readonly Building[];
}

export interface Building {
  readonly id: string;
  readonly footprint: Polygon;
  readonly baseZ: number;
  readonly height: number;
  readonly floors: number;
  readonly function: BuildingUse;
}

export interface ZoningEnvelope {
  readonly maxHeight: number;
  readonly frontSetback: number;
  readonly sideSetback: number;
  readonly rearSetback: number;
  readonly maxFAR: number;
  readonly maxLotCoverage: number;
  readonly allowedUses: readonly BuildingUse[];
}

export interface BoundingBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Signed area via the shoelace formula. Positive means the vertices wind
 * counter-clockwise. The sign matters for `inset` — it decides which way the
 * inward edge normal points — so I keep the signed version and let callers take
 * the absolute value when they only want size.
 */
export function signedArea(poly: Polygon): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

export function polygonArea(poly: Polygon): number {
  return Math.abs(signedArea(poly));
}

export function boundingBox(poly: Polygon): BoundingBox {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export function centroid(poly: Polygon): Point {
  let x = 0;
  let y = 0;
  for (const [px, py] of poly) {
    x += px;
    y += py;
  }
  return [x / poly.length, y / poly.length];
}

/** Total floor area of a building: footprint area times storey count. */
export function extrudedFloorArea(building: Building): number {
  return polygonArea(building.footprint) * building.floors;
}

/** Implied storey height. Used when a height change has to be turned into floors. */
export function storeyHeight(building: Building): number {
  return building.floors > 0 ? building.height / building.floors : building.height;
}

/**
 * Offset every edge of a convex polygon inward by `distance` and return the new
 * vertices. I use the edge-normal method (shift each edge along its inward
 * normal, then intersect adjacent shifted edges) rather than a centroid scale,
 * because it keeps a rectangle a rectangle and moves each edge by exactly the
 * setback — which is what a planner means by an inset.
 *
 * This is correct for convex footprints, which is all the model carries.
 * Non-convex insets need a straight-skeleton offset; that is called out as a
 * production follow-up in the README.
 */
export function inset(poly: Polygon, distance: number): Polygon {
  if (distance === 0) return poly;
  const n = poly.length;
  const winding = signedArea(poly) >= 0 ? 1 : -1;

  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    // Inward normal for a CCW ring is the left normal (-uy, ux); flip for CW.
    const nx = -uy * winding;
    const ny = ux * winding;
    return { px: a[0] + nx * distance, py: a[1] + ny * distance, ux, uy };
  });

  const result: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = lines[(i - 1 + n) % n];
    const cur = lines[i];
    result.push(intersectLines(prev, cur));
  }
  return result;
}

interface ParamLine {
  readonly px: number;
  readonly py: number;
  readonly ux: number;
  readonly uy: number;
}

function intersectLines(a: ParamLine, b: ParamLine): Point {
  const denom = a.ux * b.uy - a.uy * b.ux;
  // Parallel adjacent edges never happen on a simple convex polygon; fall back
  // to the shared point so we degrade to a valid vertex instead of NaN.
  if (Math.abs(denom) < 1e-9) return [b.px, b.py];
  const t = ((b.px - a.px) * b.uy - (b.py - a.py) * b.ux) / denom;
  return [a.px + t * a.ux, a.py + t * a.uy];
}

/**
 * Clip a convex polygon to an axis-aligned rectangle (Sutherland–Hodgman). The
 * setback fix uses this to push a footprint inside the buildable rectangle: the
 * parcel shrunk by the front/side/rear setbacks. Clipping only ever removes
 * area, so it can never push a building out past a setback it already met.
 */
export function clipToRect(poly: Polygon, rect: BoundingBox): Polygon {
  let out: Point[] = [...poly];

  out = clipEdge(out, (p) => p[0] >= rect.minX, (a, b) => interpolateX(a, b, rect.minX));
  out = clipEdge(out, (p) => p[0] <= rect.maxX, (a, b) => interpolateX(a, b, rect.maxX));
  out = clipEdge(out, (p) => p[1] >= rect.minY, (a, b) => interpolateY(a, b, rect.minY));
  out = clipEdge(out, (p) => p[1] <= rect.maxY, (a, b) => interpolateY(a, b, rect.maxY));

  return out;
}

function clipEdge(
  poly: readonly Point[],
  inside: (p: Point) => boolean,
  intersect: (a: Point, b: Point) => Point,
): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const prev = poly[(i - 1 + poly.length) % poly.length];
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn) {
      if (!prevIn) out.push(intersect(prev, cur));
      out.push(cur);
    } else if (prevIn) {
      out.push(intersect(prev, cur));
    }
  }
  return out;
}

function interpolateX(a: Point, b: Point, x: number): Point {
  const t = (x - a[0]) / (b[0] - a[0]);
  return [x, a[1] + t * (b[1] - a[1])];
}

function interpolateY(a: Point, b: Point, y: number): Point {
  const t = (y - a[1]) / (b[1] - a[1]);
  return [a[0] + t * (b[0] - a[0]), y];
}

/** Scale a polygon about a fixed centre. Area scales by the square of the factor. */
export function scaleAbout(poly: Polygon, factor: number, center: Point): Polygon {
  return poly.map(([x, y]) => [center[0] + (x - center[0]) * factor, center[1] + (y - center[1]) * factor] as const);
}

export function findBuilding(site: Site, id: string): Building | undefined {
  return site.buildings.find((b) => b.id === id);
}

/** Return a copy of the site with one building replaced by id. */
export function replaceBuilding(site: Site, next: Building): Site {
  return { ...site, buildings: site.buildings.map((b) => (b.id === next.id ? next : b)) };
}

/** Structural equality for buildings — used to spot no-op edits and to undo cleanly. */
export function buildingsEqual(a: Building, b: Building): boolean {
  return (
    a.id === b.id &&
    a.height === b.height &&
    a.floors === b.floors &&
    a.function === b.function &&
    a.baseZ === b.baseZ &&
    JSON.stringify(a.footprint) === JSON.stringify(b.footprint)
  );
}

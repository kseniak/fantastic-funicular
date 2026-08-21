/**
 * The browser-side Forma adapter — the live counterpart to the server's
 * MockBridge. It reads the current massing out of the Forma scene into the
 * internal site model, and writes corrected massing back as render meshes so the
 * change shows up in the canvas on commit.
 *
 * A note on what's read: massing in Forma often has no footprint representation
 * (the geometry lives in child volume meshes), so the footprint is derived from
 * the element's triangle mesh — convex hull of the xy projection — and height/base
 * from its z-extent. Floor count is derived from height (Forma doesn't expose a
 * single "floors" field on every element), and use defaults to residential until
 * wired to the element's program property. Those are the documented
 * simplifications — the geometry that drives every compliance check is read for real.
 *
 * Writing corrected geometry uses render meshes (visible immediately, no persist)
 * rather than the Integrate updateElement path, which is the production write and
 * is called out in the README.
 */

import { Forma } from "forma-embedded-view-sdk/auto";
import type { Building, Site } from "forma-compliance-mcp/dist/site.js";
import type { Edit } from "forma-compliance-mcp/dist/fixes.js";
import { extrudeMesh } from "./mesh.js";

/** Metres per storey, used to turn a read height into a floor count. */
const STOREY_HEIGHT = 3;

/** buildingId -> the render-mesh id we last drew for its correction. */
const correctionMeshes = new Map<string, string>();
/** buildingId -> the Forma element path it was read from (for future Integrate writes). */
const buildingPaths = new Map<string, string>();

export async function readSiteFromForma(): Promise<Site> {
  const boundaryPolygon = await readParcelBoundary();
  const buildings = await readBuildings(boundaryPolygon);
  return { parcelId: Forma.getProjectId(), planeZ: 0, boundaryPolygon, buildings };
}

interface ElementLike {
  properties?: { category?: string };
  representations?: { footprint?: unknown; volumeMesh?: unknown };
}

/** Diagnostic dump of what the current Forma scene actually contains, so the
 *  read logic can be matched to real category names and representations. */
export async function describeScene(): Promise<unknown> {
  const report: Record<string, unknown> = { projectId: Forma.getProjectId() };
  try {
    report.geoLocation = await Forma.project.getGeoLocation();
  } catch (e) {
    report.geoLocationError = String(e);
  }

  const candidates = [
    "building", "buildings", "site_limit", "property_boundary", "terrain", "vegetation",
    "roads", "road", "volume", "volumes", "massing", "constraint", "generic", "floor",
    "floors", "zone", "context", "urban",
  ];
  const catCounts: Record<string, number> = {};
  for (const c of candidates) {
    try {
      const paths = await Forma.geometry.getPathsByCategory({ category: c });
      if (paths.length) catCounts[c] = paths.length;
    } catch {
      catCounts[c] = -1;
    }
  }
  report.pathsByCategory = catCounts;

  try {
    const rootUrn = await Forma.proposal.getRootUrn();
    const { elements } = await Forma.elements.get({ urn: rootUrn, recursive: true });
    const byCategory: Record<string, { count: number; withFootprint: number; withVolume: number }> = {};
    for (const el of Object.values(elements) as ElementLike[]) {
      const cat = el.properties?.category ?? "(none)";
      const s = byCategory[cat] ?? { count: 0, withFootprint: 0, withVolume: 0 };
      s.count++;
      if (el.representations?.footprint) s.withFootprint++;
      if (el.representations?.volumeMesh) s.withVolume++;
      byCategory[cat] = s;
    }
    report.elementTree = { total: Object.keys(elements).length, byCategory };
  } catch (e) {
    report.elementTreeError = String(e);
  }

  return report;
}

async function firstFootprint(category: string): Promise<[number, number][] | undefined> {
  const paths = await Forma.geometry.getPathsByCategory({ category });
  for (const path of paths) {
    const fp = await Forma.geometry.getFootprint({ path });
    if (fp && fp.coordinates.length >= 3) return fp.coordinates;
  }
  return undefined;
}

async function readParcelBoundary(): Promise<[number, number][]> {
  const boundary = (await firstFootprint("site_limit")) ?? (await firstFootprint("property_boundary"));
  if (!boundary) {
    throw new Error("No site limit found in the Forma project. Draw a site boundary before running the check.");
  }
  return boundary;
}

/** Forma tags massing as "building" or "buildings" depending on how it was made,
 *  so try both. If neither matches (imported/custom geometry), fall back to every
 *  element whose geometry sits inside the site boundary. Terrain, the site limit,
 *  and vegetation are always excluded. */
async function collectMassingPaths(boundary: [number, number][]): Promise<string[]> {
  const found = new Set<string>();
  for (const category of ["building", "buildings"]) {
    for (const path of await Forma.geometry.getPathsByCategory({ category })) found.add(path);
  }
  if (found.size === 0) {
    for (const path of await Forma.geometry.getPathsInsidePolygons({ polygons: [boundary] })) found.add(path);
  }

  const excluded = new Set<string>();
  for (const category of ["site_limit", "property_boundary", "terrain", "vegetation", "roads"]) {
    for (const path of await Forma.geometry.getPathsByCategory({ category })) excluded.add(path);
  }
  return [...found].filter((path) => !excluded.has(path));
}

async function readBuildings(boundary: [number, number][]): Promise<Building[]> {
  const paths = await collectMassingPaths(boundary);
  const buildings: Building[] = [];
  for (const path of paths) {
    // Massing here has no footprint representation — geometry lives in child
    // volume meshes — so derive both footprint and height from the triangles.
    const tris = await Forma.geometry.getTriangles({ path });
    const geo = massingFromTriangles(tris);
    if (!geo) continue;
    const id = shortId(path);
    buildingPaths.set(id, path);
    buildings.push({
      id,
      footprint: geo.footprint,
      baseZ: geo.baseZ,
      height: geo.height,
      floors: Math.max(1, Math.round(geo.height / STOREY_HEIGHT)),
      function: "residential",
    });
  }
  return buildings;
}

/** Reduce a triangle soup to a footprint (convex hull of the xy projection) and a
 *  height (z-extent). The model is convex-only, so the hull is the right shape;
 *  a non-convex outline is a documented follow-up. */
function massingFromTriangles(
  tris: Float32Array,
): { footprint: [number, number][]; baseZ: number; height: number } | null {
  if (tris.length < 9) return null;
  const pts: [number, number][] = [];
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i + 2 < tris.length; i += 3) {
    pts.push([tris[i], tris[i + 1]]);
    const z = tris[i + 2];
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const footprint = convexHull(pts);
  if (footprint.length < 3 || !isFinite(minZ)) return null;
  return { footprint, baseZ: minZ, height: Math.max(STOREY_HEIGHT, maxZ - minZ) };
}

/** Andrew's monotone chain — returns a counter-clockwise convex hull. */
function convexHull(points: [number, number][]): [number, number][] {
  const pts = [...new Map(points.map((p) => [`${p[0]},${p[1]}`, p])).values()].sort(
    (a, b) => a[0] - b[0] || a[1] - b[1],
  );
  if (pts.length < 3) return pts;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function shortId(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Draw the corrected massing for each edit into the canvas (green preview). */
export async function drawCorrections(edits: readonly Edit[]): Promise<void> {
  for (const edit of edits) {
    await drawBuilding(edit.after);
  }
}

async function drawBuilding(b: Building): Promise<void> {
  const position = extrudeMesh(b.footprint as [number, number][], b.baseZ, b.height);
  const color = solidColor(position.length / 3, [80, 200, 120, 255]);
  const existing = correctionMeshes.get(b.id);
  if (existing) {
    await Forma.render.updateMesh({ id: existing, geometryData: { position, color } });
  } else {
    const { id } = await Forma.render.addMesh({ geometryData: { position, color } });
    correctionMeshes.set(b.id, id);
  }
}

/** Remove every correction mesh — used on undo / reject. */
export async function clearCorrections(): Promise<void> {
  for (const id of correctionMeshes.values()) {
    await Forma.render.remove({ id });
  }
  correctionMeshes.clear();
}

function solidColor(vertexCount: number, rgba: [number, number, number, number]): Uint8Array {
  const out = new Uint8Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i++) out.set(rgba, i * 4);
  return out;
}

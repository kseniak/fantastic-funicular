/**
 * The browser-side Forma adapter — the live counterpart to the server's
 * MockBridge. It reads the current massing out of the Forma scene into the
 * internal site model, and writes corrected massing back as render meshes so the
 * change shows up in the canvas on commit.
 *
 * A note on what's read: Forma's geometry API gives footprints (xy polygons) and
 * triangle meshes. Height and base come from the mesh's z-extent. Floor count is
 * derived from height (Forma doesn't expose a single "floors" field on every
 * element), and use defaults to residential until wired to the element's program
 * property. Those two are the documented simplifications — the geometry that
 * drives every compliance check is read for real.
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
    const fp = await Forma.geometry.getFootprint({ path });
    // Only closed polygons are massing; skip line strings (site limit, roads).
    if (!fp || fp.type !== "Polygon" || fp.coordinates.length < 3) continue;
    const { baseZ, height } = await zExtent(path);
    const id = shortId(path);
    buildingPaths.set(id, path);
    buildings.push({
      id,
      footprint: fp.coordinates,
      baseZ,
      height,
      floors: Math.max(1, Math.round(height / STOREY_HEIGHT)),
      function: "residential",
    });
  }
  return buildings;
}

async function zExtent(path: string): Promise<{ baseZ: number; height: number }> {
  const tris = await Forma.geometry.getTriangles({ path });
  let min = Infinity;
  let max = -Infinity;
  for (let i = 2; i < tris.length; i += 3) {
    if (tris[i] < min) min = tris[i];
    if (tris[i] > max) max = tris[i];
  }
  if (!isFinite(min)) return { baseZ: 0, height: STOREY_HEIGHT };
  return { baseZ: min, height: Math.max(STOREY_HEIGHT, max - min) };
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

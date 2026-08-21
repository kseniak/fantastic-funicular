/**
 * Turn a footprint + height into a triangulated box mesh Forma's render API can
 * draw. Cap triangulation is a simple fan from vertex 0, which is correct for
 * the convex footprints the model carries. Positions are a flat x,y,z array;
 * z is up, matching Forma's project frame.
 */

type XY = [number, number];

export function extrudeMesh(footprint: readonly XY[], baseZ: number, height: number): Float32Array {
  const n = footprint.length;
  const topZ = baseZ + height;
  const out: number[] = [];
  const v = (x: number, y: number, z: number) => out.push(x, y, z);

  for (let i = 1; i < n - 1; i++) {
    const [ax, ay] = footprint[0];
    const [bx, by] = footprint[i];
    const [cx, cy] = footprint[i + 1];
    // bottom cap (wound one way), top cap (wound the other so both face outward)
    v(ax, ay, baseZ);
    v(cx, cy, baseZ);
    v(bx, by, baseZ);
    v(ax, ay, topZ);
    v(bx, by, topZ);
    v(cx, cy, topZ);
  }

  for (let i = 0; i < n; i++) {
    const [x1, y1] = footprint[i];
    const [x2, y2] = footprint[(i + 1) % n];
    v(x1, y1, baseZ);
    v(x2, y2, baseZ);
    v(x2, y2, topZ);
    v(x1, y1, baseZ);
    v(x2, y2, topZ);
    v(x1, y1, topZ);
  }

  return new Float32Array(out);
}

/**
 * The corrected massing as a stack of `floors` slabs so it keeps the floor look
 * rather than reading as one solid block. Each slab is the footprint extruded to
 * just under the storey height, leaving a thin gap that reads as a floor line.
 */
export function extrudeFloors(
  footprint: readonly XY[],
  baseZ: number,
  storeyHeight: number,
  floors: number,
  gap = 0.4,
): Float32Array {
  const slabHeight = Math.max(0.1, storeyHeight - gap);
  const out: number[] = [];
  for (let i = 0; i < floors; i++) {
    const slab = extrudeMesh(footprint, baseZ + i * storeyHeight, slabHeight);
    for (let k = 0; k < slab.length; k++) out.push(slab[k]);
  }
  return new Float32Array(out);
}

/**
 * Minimal glTF 2.0 (GLB) encoder — just enough to turn a triangle-soup position
 * array into a single-mesh binary Forma can ingest as a volumeMesh. No indices,
 * no normals; POSITION only, TRIANGLES mode.
 *
 * Positions are passed through in the project frame (z up), the same frame
 * getTriangles reads and render.addMesh draws in. If Forma's volumeMesh import
 * expects y-up glTF, flip `zUp` and we convert (x, z, -y).
 */

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"
const FLOAT = 5126;
const ARRAY_BUFFER = 34962;
const TRIANGLES = 4;

export function positionsToGlb(positions: Float32Array, zUp = true): ArrayBuffer {
  // Double-side the mesh: without per-vertex normals a viewer culls back faces,
  // and an inward-wound solid then renders as nothing. Emitting each triangle in
  // both windings makes it visible regardless of orientation.
  const doubled = doubleSide(zUp ? positions : toYUp(positions));
  const positionData = doubled.subarray(0, Math.floor(doubled.length / 3) * 3);
  const count = positionData.length / 3;
  const normalData = computeFlatNormals(positionData);

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positionData.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positionData[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }

  const posBytes = new Uint8Array(new Float32Array(positionData).buffer);
  const normBytes = new Uint8Array(new Float32Array(normalData).buffer);
  const posLen = posBytes.byteLength;
  const binLen = posLen + normBytes.byteLength;
  const binPad = (4 - (binLen % 4)) % 4;

  const gltf = {
    asset: { version: "2.0", generator: "forma-compliance-extension" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, mode: TRIANGLES }] }],
    accessors: [
      { bufferView: 0, byteOffset: 0, componentType: FLOAT, count, type: "VEC3", min, max },
      { bufferView: 1, byteOffset: 0, componentType: FLOAT, count, type: "VEC3" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posLen, target: ARRAY_BUFFER },
      { buffer: 0, byteOffset: posLen, byteLength: normBytes.byteLength, target: ARRAY_BUFFER },
    ],
    buffers: [{ byteLength: binLen + binPad }],
  };

  const jsonRaw = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = (4 - (jsonRaw.byteLength % 4)) % 4;
  const jsonLen = jsonRaw.byteLength + jsonPad;

  const total = 12 + 8 + jsonLen + 8 + binLen + binPad;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let o = 0;

  dv.setUint32(o, GLB_MAGIC, true); o += 4;
  dv.setUint32(o, 2, true); o += 4;
  dv.setUint32(o, total, true); o += 4;

  dv.setUint32(o, jsonLen, true); o += 4;
  dv.setUint32(o, CHUNK_JSON, true); o += 4;
  bytes.set(jsonRaw, o); o += jsonRaw.byteLength;
  for (let i = 0; i < jsonPad; i++) bytes[o++] = 0x20; // space-pad JSON

  dv.setUint32(o, binLen + binPad, true); o += 4;
  dv.setUint32(o, CHUNK_BIN, true); o += 4;
  bytes.set(posBytes, o); o += posLen;
  bytes.set(normBytes, o); // remaining pad bytes are already zero

  return buf;
}

/** One flat face normal per triangle, repeated across its three vertices. */
function computeFlatNormals(pos: Float32Array): Float32Array {
  const n = new Float32Array(pos.length);
  for (let t = 0; t + 8 < pos.length; t += 9) {
    const ux = pos[t + 3] - pos[t];
    const uy = pos[t + 4] - pos[t + 1];
    const uz = pos[t + 5] - pos[t + 2];
    const vx = pos[t + 6] - pos[t];
    const vy = pos[t + 7] - pos[t + 1];
    const vz = pos[t + 8] - pos[t + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (let k = 0; k < 9; k += 3) {
      n[t + k] = nx;
      n[t + k + 1] = ny;
      n[t + k + 2] = nz;
    }
  }
  return n;
}

/** Append a reverse-wound copy of every triangle so the mesh renders from both sides. */
function doubleSide(p: Float32Array): Float32Array {
  const tris = Math.floor(p.length / 9);
  const out = new Float32Array(tris * 18);
  out.set(p.subarray(0, tris * 9), 0);
  for (let t = 0; t < tris; t++) {
    const src = t * 9;
    const dst = tris * 9 + t * 9;
    // v0, then v2, v1 (reversed winding)
    out[dst] = p[src]; out[dst + 1] = p[src + 1]; out[dst + 2] = p[src + 2];
    out[dst + 3] = p[src + 6]; out[dst + 4] = p[src + 7]; out[dst + 5] = p[src + 8];
    out[dst + 6] = p[src + 3]; out[dst + 7] = p[src + 4]; out[dst + 8] = p[src + 5];
  }
  return out;
}

function toYUp(positions: Float32Array): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    out[i] = positions[i];
    out[i + 1] = positions[i + 2];
    out[i + 2] = -positions[i + 1];
  }
  return out;
}

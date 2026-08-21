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
  const verts = zUp ? positions : toYUp(positions);
  const count = Math.floor(verts.length / 3);

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count * 3; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = verts[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }

  const binBytes = new Uint8Array(new Float32Array(verts.subarray(0, count * 3)).buffer);
  const binLen = binBytes.byteLength;
  const binPad = (4 - (binLen % 4)) % 4;

  const gltf = {
    asset: { version: "2.0", generator: "forma-compliance-extension" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: TRIANGLES }] }],
    accessors: [{ bufferView: 0, byteOffset: 0, componentType: FLOAT, count, type: "VEC3", min, max }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: binLen, target: ARRAY_BUFFER }],
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
  bytes.set(binBytes, o); // remaining pad bytes are already zero

  return buf;
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

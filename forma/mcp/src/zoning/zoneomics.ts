import { DEFAULT_ENVELOPE } from "./mock.js";
import type { ZoningEnvelope, BuildingUse } from "../site.js";
import type { ParcelRef, ZoningProvider } from "./provider.js";

const FEET_TO_METRES = 0.3048;

/**
 * Live zoning from Zoneomics (the same source TestFit uses). Given a lat/lng it
 * calls v2/zoneDetail and maps the returned controls onto our envelope.
 *
 * Zoneomics' exact control field names vary by jurisdiction and their response
 * is deep and inconsistent, so instead of hard-coding one path I deep-search the
 * payload for the first key matching each control, and fall back to the mock
 * default for anything the parcel doesn't publish. `rawFor` exposes the payload
 * so the mapping can be verified against a real response. US data is imperial,
 * so height/setbacks are treated as feet and converted to metres.
 */
export class ZoneomicsProvider implements ZoningProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.zoneomics.com/v2",
  ) {}

  async getEnvelope(ref: ParcelRef): Promise<ZoningEnvelope> {
    return mapEnvelope(await this.fetchDetail(ref));
  }

  /** The raw zoneDetail payload — used by the /zoning?debug=1 endpoint to tune the mapping. */
  async rawFor(ref: ParcelRef): Promise<unknown> {
    return this.fetchDetail(ref);
  }

  private async fetchDetail(ref: ParcelRef): Promise<unknown> {
    const { lat, lng } = toLatLng(ref);
    const url = `${this.baseUrl}/zoneDetail?api_key=${encodeURIComponent(this.apiKey)}&lat=${lat}&lng=${lng}&output_fields=controls,zoning,plu`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Zoneomics zoneDetail ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    return res.json();
  }
}

function toLatLng(ref: ParcelRef): { lat: number; lng: number } {
  if (typeof ref !== "string") return ref;
  const [lat, lng] = ref.split(",").map(Number);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  throw new Error(`ZoneomicsProvider needs a {lat,lng} (or "lat,lng" string), got parcelId '${ref}'.`);
}

/** Map a zoneDetail payload onto our envelope, falling back to the mock per field. */
export function mapEnvelope(payload: unknown): ZoningEnvelope {
  const leaves = flatten(payload);
  const num = (patterns: RegExp[]) => firstNumber(leaves, patterns);

  const maxHeightFt = num([/max.*(building)?.*height/i, /height.*max/i, /max_height/i]);
  const frontFt = num([/front.*(yard|setback)/i, /setback.*front/i]);
  const sideFt = num([/side.*(yard|setback)/i, /setback.*side/i]);
  const rearFt = num([/rear.*(yard|setback)/i, /setback.*rear/i]);
  const far = num([/\bfar\b/i, /floor.*area.*ratio/i, /max_far/i]);
  const coverageRaw = num([/lot.*coverage/i, /coverage.*max/i, /max.*coverage/i]);
  const uses = findUses(leaves);

  return {
    maxHeight: maxHeightFt !== undefined ? round(maxHeightFt * FEET_TO_METRES) : DEFAULT_ENVELOPE.maxHeight,
    frontSetback: frontFt !== undefined ? round(frontFt * FEET_TO_METRES) : DEFAULT_ENVELOPE.frontSetback,
    sideSetback: sideFt !== undefined ? round(sideFt * FEET_TO_METRES) : DEFAULT_ENVELOPE.sideSetback,
    rearSetback: rearFt !== undefined ? round(rearFt * FEET_TO_METRES) : DEFAULT_ENVELOPE.rearSetback,
    maxFAR: far ?? DEFAULT_ENVELOPE.maxFAR,
    maxLotCoverage: coverageRaw !== undefined ? normalizeRatio(coverageRaw) : DEFAULT_ENVELOPE.maxLotCoverage,
    allowedUses: uses.length > 0 ? uses : DEFAULT_ENVELOPE.allowedUses,
  };
}

interface Leaf {
  readonly path: string;
  readonly value: unknown;
}

/** Flatten a nested object/array into path -> value leaves for pattern matching. */
function flatten(value: unknown, path = "", out: Leaf[] = []): Leaf[] {
  if (value === null || typeof value !== "object") {
    out.push({ path, value });
    return out;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    flatten(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

function firstNumber(leaves: readonly Leaf[], patterns: readonly RegExp[]): number | undefined {
  for (const leaf of leaves) {
    if (!patterns.some((p) => p.test(leaf.path))) continue;
    const n = typeof leaf.value === "number" ? leaf.value : parseFloat(String(leaf.value));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

function findUses(leaves: readonly Leaf[]): BuildingUse[] {
  const uses = new Set<string>();
  for (const leaf of leaves) {
    if (!/(permitted|allowed).*use|plu|land_use/i.test(leaf.path)) continue;
    if (typeof leaf.value === "string" && leaf.value.length > 1) uses.add(leaf.value.toLowerCase());
  }
  return [...uses];
}

/** Coverage may come as a fraction (0.5) or a percentage (50); normalize to 0..1. */
function normalizeRatio(value: number): number {
  return value > 1 ? round(value / 100) : round(value);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

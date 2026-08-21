import type { ZoningEnvelope } from "../site.js";
import type { ParcelRef, ZoningProvider } from "./provider.js";

/**
 * The default provider. Seeded with realistic envelopes so the whole loop runs
 * — and the demo and tests pass — without a paid API key. Values are
 * plausible mid-rise mixed-use zoning, in metres.
 */
export class MockZoningProvider implements ZoningProvider {
  private readonly byParcel: Map<string, ZoningEnvelope>;
  private readonly fallback: ZoningEnvelope;

  constructor(seed?: { readonly parcels?: Record<string, ZoningEnvelope>; readonly fallback?: ZoningEnvelope }) {
    this.byParcel = new Map(Object.entries(seed?.parcels ?? DEFAULT_PARCELS));
    // For a real parcel we have no data for (e.g. a live Forma project outside
    // the US/Canada, where no zoning API applies), fall back to a typical
    // residential-zone envelope so the check is meaningful rather than blank.
    this.fallback = seed?.fallback ?? RESIDENTIAL_DEFAULT;
  }

  async getEnvelope(ref: ParcelRef): Promise<ZoningEnvelope> {
    if (typeof ref === "string") {
      return this.byParcel.get(ref) ?? this.fallback;
    }
    // A real provider geocodes lat/lng to a parcel; the mock just returns the
    // fallback envelope so a coordinate lookup still works offline.
    return this.fallback;
  }
}

export const DEFAULT_ENVELOPE: ZoningEnvelope = {
  maxHeight: 24,
  frontSetback: 5,
  sideSetback: 3,
  rearSetback: 5,
  maxFAR: 2.5,
  maxLotCoverage: 0.5,
  allowedUses: ["residential", "retail", "office", "mixed_use"],
};

/**
 * A tighter residential envelope, roughly a typical Norwegian/Oslo småhus zone
 * (max height ~9 m, ~24% footprint coverage, 4 m to the neighbour boundary).
 * Used as the fallback for real parcels with no zoning-API coverage, so the loop
 * shows real violations for a live building instead of nothing.
 */
export const RESIDENTIAL_DEFAULT: ZoningEnvelope = {
  maxHeight: 9,
  frontSetback: 4,
  sideSetback: 4,
  rearSetback: 4,
  maxFAR: 0.8,
  maxLotCoverage: 0.24,
  allowedUses: ["residential", "bolig"],
};

/** Keyed to the mock scene's parcelId so the offline demo lines up end to end. */
const DEFAULT_PARCELS: Record<string, ZoningEnvelope> = {
  "mock-parcel-001": DEFAULT_ENVELOPE,
};

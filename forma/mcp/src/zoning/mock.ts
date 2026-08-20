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
    this.fallback = seed?.fallback ?? DEFAULT_ENVELOPE;
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

/** Keyed to the mock scene's parcelId so the offline demo lines up end to end. */
const DEFAULT_PARCELS: Record<string, ZoningEnvelope> = {
  "mock-parcel-001": DEFAULT_ENVELOPE,
};

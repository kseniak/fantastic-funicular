import type { ZoningEnvelope } from "../site.js";

/** Parcels can be looked up by id or by a lat/lng the provider geocodes to one. */
export type ParcelRef = string | { readonly lat: number; readonly lng: number };

/**
 * The one Forma-agnostic seam for zoning data. Everything downstream depends on
 * this interface, never on a concrete API, so the mock and a real Regrid/
 * Zoneomics client are drop-in swaps. Real providers are network calls, hence
 * the Promise.
 */
export interface ZoningProvider {
  getEnvelope(ref: ParcelRef): Promise<ZoningEnvelope>;
}

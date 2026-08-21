/**
 * Zoning lookup for the panel. If a backend is configured, it asks that backend
 * for the parcel's real envelope (the backend holds the Zoneomics key and does
 * the lat/lng lookup); otherwise it uses the seeded mock so the demo still runs.
 *
 * The backend URL comes from `?backend=...` on the extension's iframe URL, or a
 * VITE_ZONING_BACKEND build var. Keeping the key server-side is the whole reason
 * this goes through a backend instead of calling Zoneomics from the browser.
 */

import { Forma } from "forma-embedded-view-sdk/auto";
import { MockZoningProvider } from "forma-compliance-mcp/dist/zoning/mock.js";
import type { ZoningEnvelope } from "forma-compliance-mcp/dist/site.js";

const mock = new MockZoningProvider();

export interface ZoningResult {
  readonly envelope: ZoningEnvelope;
  readonly source: string;
}

function backendUrl(): string | null {
  const fromQuery = new URLSearchParams(location.search).get("backend");
  const fromEnv = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_ZONING_BACKEND;
  const url = fromQuery || fromEnv || "";
  return url ? url.replace(/\/$/, "") : null;
}

export async function fetchZoning(parcelId: string): Promise<ZoningResult> {
  const backend = backendUrl();
  if (backend) {
    try {
      const loc = await Forma.project.getGeoLocation();
      if (loc) {
        const [lat, lng] = loc;
        const res = await fetch(`${backend}/zoning?lat=${lat}&lng=${lng}`);
        if (res.ok) {
          return { envelope: (await res.json()) as ZoningEnvelope, source: `live zoning for ${lat.toFixed(4)}, ${lng.toFixed(4)}` };
        }
      }
    } catch {
      // fall through to the mock so the panel still works
    }
  }
  return { envelope: await mock.getEnvelope(parcelId), source: "mock values (no zoning backend configured)" };
}

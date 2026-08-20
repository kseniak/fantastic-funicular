import type { ZoningEnvelope } from "../site.js";
import type { ParcelRef, ZoningProvider } from "./provider.js";

/**
 * Real-provider stub. Regrid (and Zoneomics / LightBox) expose parcel setbacks,
 * FAR, height, coverage and allowed uses behind an API key. This is the drop-in
 * seam: wire the endpoint + response mapping and it replaces the mock with no
 * change anywhere upstream. I left it a stub on purpose so the demo never
 * depends on a paid key.
 */
export class RegridProvider implements ZoningProvider {
  constructor(private readonly apiKey: string) {}

  async getEnvelope(ref: ParcelRef): Promise<ZoningEnvelope> {
    // TODO: call the Regrid parcel endpoint and map its zoning fields onto
    // ZoningEnvelope. Roughly:
    //   const res = await fetch(`https://app.regrid.com/api/v2/parcels/${id}?token=${this.apiKey}`);
    //   const z = (await res.json()).properties.fields;
    //   return { maxHeight: z.max_height_m, frontSetback: z.front_setback_m, ... };
    // The units and field names differ per jurisdiction, so this needs a
    // per-source adapter — see "what I'd do next" in the README.
    throw new Error(
      `RegridProvider is a stub: endpoint mapping not implemented (ref=${JSON.stringify(ref)}, keyPresent=${Boolean(
        this.apiKey,
      )}). Use MockZoningProvider for the demo, or implement getEnvelope.`,
    );
  }
}

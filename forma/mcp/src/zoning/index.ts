export type { ParcelRef, ZoningProvider } from "./provider.js";
export { MockZoningProvider, DEFAULT_ENVELOPE } from "./mock.js";
export { RegridProvider } from "./regrid.js";
export { ZoneomicsProvider } from "./zoneomics.js";

import type { ZoningProvider } from "./provider.js";
import { MockZoningProvider } from "./mock.js";
import { RegridProvider } from "./regrid.js";
import { ZoneomicsProvider } from "./zoneomics.js";

/**
 * Pick a provider from the environment. Defaults to the mock so nothing breaks
 * without a key; set ZONING_API_KEY plus ZONING_PROVIDER=zoneomics|regrid to
 * switch to a real one. Kept here so the server never hard-codes a provider.
 */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): ZoningProvider {
  const key = env.ZONING_API_KEY;
  if (key && env.ZONING_PROVIDER === "zoneomics") return new ZoneomicsProvider(key);
  if (key && env.ZONING_PROVIDER === "regrid") return new RegridProvider(key);
  return new MockZoningProvider();
}

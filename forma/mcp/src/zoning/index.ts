export type { ParcelRef, ZoningProvider } from "./provider.js";
export { MockZoningProvider, DEFAULT_ENVELOPE } from "./mock.js";
export { RegridProvider } from "./regrid.js";

import type { ZoningProvider } from "./provider.js";
import { MockZoningProvider } from "./mock.js";
import { RegridProvider } from "./regrid.js";

/**
 * Pick a provider from the environment. Defaults to the mock so nothing breaks
 * without a key; set ZONING_API_KEY (and ZONING_PROVIDER=regrid) to switch to
 * the real one. Kept here so the server never hard-codes a provider.
 */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): ZoningProvider {
  const key = env.ZONING_API_KEY;
  if (env.ZONING_PROVIDER === "regrid" && key) {
    return new RegridProvider(key);
  }
  return new MockZoningProvider();
}

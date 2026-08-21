import { describe, expect, it } from "vitest";
import { mapEnvelope } from "../src/zoning/zoneomics.js";
import { DEFAULT_ENVELOPE } from "../src/zoning/mock.js";

describe("Zoneomics mapEnvelope", () => {
  it("maps controls onto the envelope, converting feet to metres and % to a ratio", () => {
    const payload = {
      data: {
        controls: {
          standard: {
            max_building_height: 80, // feet
            front_yard_setback: 15,
            side_yard_setback: 10,
            rear_yard_setback: 20,
            max_far: 3.0,
            max_lot_coverage: 60, // percent
          },
        },
        permitted_land_uses: ["Residential", "Commercial"],
      },
    };
    const env = mapEnvelope(payload);
    expect(env.maxHeight).toBeCloseTo(80 * 0.3048, 2);
    expect(env.frontSetback).toBeCloseTo(15 * 0.3048, 2);
    expect(env.rearSetback).toBeCloseTo(20 * 0.3048, 2);
    expect(env.maxFAR).toBe(3.0);
    expect(env.maxLotCoverage).toBeCloseTo(0.6, 2);
    expect(env.allowedUses).toContain("residential");
  });

  it("falls back to the mock default for any field the parcel does not publish", () => {
    const env = mapEnvelope({ data: { controls: {} } });
    expect(env).toEqual(DEFAULT_ENVELOPE);
  });

  it("keeps a coverage already expressed as a fraction", () => {
    const env = mapEnvelope({ data: { controls: { max_lot_coverage: 0.45 } } });
    expect(env.maxLotCoverage).toBeCloseTo(0.45, 2);
  });
});

import { describe, expect, it } from "vitest";
import {
  boundingBox,
  centroid,
  clipToRect,
  extrudedFloorArea,
  inset,
  polygonArea,
  scaleAbout,
  type Polygon,
} from "../src/site.js";
import { building } from "./fixtures.js";

const rect10: Polygon = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

function closeTo(poly: Polygon, expected: Polygon): void {
  expect(poly.length).toBe(expected.length);
  poly.forEach(([x, y], i) => {
    expect(x).toBeCloseTo(expected[i][0], 6);
    expect(y).toBeCloseTo(expected[i][1], 6);
  });
}

describe("polygonArea", () => {
  it("computes a rectangle's area and ignores winding direction", () => {
    expect(polygonArea(rect10)).toBe(100);
    expect(polygonArea([...rect10].reverse())).toBe(100);
  });

  it("handles an L-shape by the shoelace formula", () => {
    const l: Polygon = [
      [0, 0],
      [4, 0],
      [4, 2],
      [2, 2],
      [2, 4],
      [0, 4],
    ];
    expect(polygonArea(l)).toBe(12);
  });
});

describe("inset", () => {
  it("insets a square uniformly by the distance", () => {
    closeTo(inset(rect10, 2), [
      [2, 2],
      [8, 2],
      [8, 8],
      [2, 8],
    ]);
  });

  it("insetting by the setback distance shrinks the footprint area predictably", () => {
    expect(polygonArea(inset(rect10, 2))).toBeCloseTo(36, 6);
  });

  it("is a no-op at distance 0", () => {
    expect(inset(rect10, 0)).toBe(rect10);
  });
});

describe("extrudedFloorArea", () => {
  it("is footprint area times floor count", () => {
    expect(extrudedFloorArea(building({ floors: 5 }))).toBe(100 * 5);
  });
});

describe("clipToRect", () => {
  it("clips a square to an inner rectangle", () => {
    const clipped = clipToRect(rect10, { minX: 2, minY: 2, maxX: 8, maxY: 8 });
    expect(polygonArea(clipped)).toBeCloseTo(36, 6);
    expect(boundingBox(clipped)).toEqual({ minX: 2, minY: 2, maxX: 8, maxY: 8 });
  });

  it("leaves a polygon already inside the rectangle unchanged in area", () => {
    const clipped = clipToRect(rect10, { minX: -5, minY: -5, maxX: 15, maxY: 15 });
    expect(polygonArea(clipped)).toBeCloseTo(100, 6);
  });
});

describe("scaleAbout", () => {
  it("scales area by the square of the factor about the centroid", () => {
    const scaled = scaleAbout(rect10, 0.5, centroid(rect10));
    expect(polygonArea(scaled)).toBeCloseTo(25, 6);
    expect(centroid(scaled)).toEqual([5, 5]);
  });
});

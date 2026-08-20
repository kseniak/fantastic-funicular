/**
 * The bridge is the only Forma-aware seam on the server side. The engine speaks
 * the internal site model; the bridge is what turns "a scene" into that model
 * and forwards committed geometry back out.
 *
 * Two implementations:
 *   - MockBridge  — reads a site model from a JSON file on disk. This is the
 *                   default and what every test and the offline demo use. Writes
 *                   are no-ops because the engine's in-memory site is the truth.
 *   - LiveBridge  — an in-memory relay driven by the HTTP endpoints in http.ts.
 *                   The Forma extension pushes the scene it read into it and
 *                   polls it for approved edits to draw back into the canvas.
 *
 * Keeping Forma behind this seam is the whole reason the compliance core is
 * testable without a Forma license.
 */

import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Site } from "./site.js";
import type { Edit } from "./fixes.js";

export type BridgeMode = "offline-mock" | "live-forma";

export interface Bridge {
  readonly mode: BridgeMode;
  loadSite(): Promise<Site>;
  /** Forward committed geometry to Forma (live) — a no-op offline. */
  pushEdits(edits: readonly Edit[]): Promise<void>;
  /** Forward an undo's reversal to Forma (live) — a no-op offline. */
  pushReversal(edits: readonly Edit[]): Promise<void>;
}

const pointSchema = z.tuple([z.number(), z.number()]);
const polygonSchema = z.array(pointSchema).min(3);

const buildingSchema = z.object({
  id: z.string(),
  footprint: polygonSchema,
  baseZ: z.number(),
  height: z.number().positive(),
  floors: z.number().int().positive(),
  function: z.string(),
});

export const siteSchema = z.object({
  parcelId: z.string(),
  boundaryPolygon: polygonSchema,
  planeZ: z.number(),
  buildings: z.array(buildingSchema),
});

export function parseSite(raw: unknown): Site {
  return siteSchema.parse(raw) as Site;
}

export class MockBridge implements Bridge {
  readonly mode = "offline-mock" as const;
  constructor(private readonly sitePath: string) {}

  async loadSite(): Promise<Site> {
    const raw = await readFile(this.sitePath, "utf8");
    return parseSite(JSON.parse(raw));
  }

  async pushEdits(): Promise<void> {
    // Offline: the engine's in-memory site is the source of truth, nothing to write out.
  }

  async pushReversal(): Promise<void> {}
}

/** One queued instruction for the extension to draw into (or out of) the Forma canvas. */
export interface CanvasOp {
  readonly seq: number;
  readonly kind: "apply" | "reverse";
  readonly edits: readonly Edit[];
}

/**
 * Server side of the live bridge. The extension POSTs the scene it read from
 * Forma (`receiveScene`) and long-polls `drainOutbox` for the geometry it should
 * write back. Everything is in-memory and per-process — persistence is a
 * production follow-up, not something the demo needs.
 */
export class LiveBridge implements Bridge {
  readonly mode = "live-forma" as const;
  private scene: Site | null = null;
  private readonly outbox: CanvasOp[] = [];
  private seq = 0;

  receiveScene(raw: unknown): Site {
    this.scene = parseSite(raw);
    return this.scene;
  }

  hasScene(): boolean {
    return this.scene !== null;
  }

  async loadSite(): Promise<Site> {
    if (!this.scene) {
      throw new Error("No scene yet: open the Forma extension and push the current massing first.");
    }
    return this.scene;
  }

  async pushEdits(edits: readonly Edit[]): Promise<void> {
    this.outbox.push({ seq: ++this.seq, kind: "apply", edits });
  }

  async pushReversal(edits: readonly Edit[]): Promise<void> {
    this.outbox.push({ seq: ++this.seq, kind: "reverse", edits });
  }

  /** Hand the extension everything queued and clear it. */
  drainOutbox(): CanvasOp[] {
    return this.outbox.splice(0, this.outbox.length);
  }
}

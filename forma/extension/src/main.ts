/**
 * The extension panel. Deliberately small: read the massing, run the compliance
 * loop, review the proposal, then commit (draw the corrected massing) or undo.
 * The compliance logic is the exact same core the MCP server runs — this file
 * only wires Forma to it and paints a few buttons.
 */

import { checkCompliance, type Violation } from "forma-compliance-mcp/dist/compliance.js";
import { planCompliance, type Edit } from "forma-compliance-mcp/dist/fixes.js";
import { evaluate } from "forma-compliance-mcp/dist/policy.js";
import { extrudedFloorArea, polygonArea, type Site, type ZoningEnvelope } from "forma-compliance-mcp/dist/site.js";
import {
  clearCorrections,
  describeScene,
  drawCorrections,
  hasPersistedEdits,
  readSiteFromForma,
  revertCorrections,
  writeCorrections,
} from "./forma.js";
import { fetchZoning } from "./zoning.js";

let site: Site | null = null;
let envelope: ZoningEnvelope | null = null;
let zoningSource = "";
let plan: { edits: Edit[]; resultingSite: Site; resultingCompliance: Violation[] } | null = null;

const els = {
  read: button("read", "Read massing from Forma"),
  propose: button("propose", "Check & make compliant"),
  commit: button("commit", "Commit (draw corrected massing)"),
  undo: button("undo", "Undo"),
  debug: button("debug", "Debug scene"),
  status: document.getElementById("status") as HTMLDivElement,
};

function button(id: string, label: string): HTMLButtonElement {
  const b = document.getElementById(id) as HTMLButtonElement;
  b.textContent = label;
  return b;
}

function log(html: string): void {
  els.status.innerHTML = html;
}

function setZoningStatus(result: { live: boolean; source: string }): void {
  const badge = document.getElementById("zoning-status") as HTMLDivElement;
  const text = document.getElementById("zoning-status-text") as HTMLSpanElement;
  badge.classList.toggle("live", result.live);
  text.textContent = result.live ? `live zoning · ${result.source}` : `seeded limits · ${result.source}`;
}

function violationList(violations: readonly Violation[]): string {
  if (violations.length === 0) return `<p class="ok">No violations. Compliant.</p>`;
  return `<ul>${violations.map((v) => `<li><b>${v.type}</b>: ${v.humanReadable}</li>`).join("")}</ul>`;
}

function envelopeSummary(e: ZoningEnvelope): string {
  return (
    `<p class="policy">Regulations: ${zoningSource}</p>` +
    `<p>max height ${e.maxHeight} m · setbacks F/S/R ${e.frontSetback}/${e.sideSetback}/${e.rearSetback} m · ` +
    `FAR ${e.maxFAR} · coverage ${Math.round(e.maxLotCoverage * 100)}% · uses: ${e.allowedUses.join(", ")}</p>`
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function measurements(s: Site): string {
  const lot = polygonArea(s.boundaryPolygon);
  const foot = s.buildings.reduce((a, b) => a + polygonArea(b.footprint), 0);
  const floor = s.buildings.reduce((a, b) => a + extrudedFloorArea(b), 0);
  const rows = s.buildings
    .map((b) => `${b.id}: ${round1(b.height)} m tall, ${b.floors} floors, footprint ${round1(polygonArea(b.footprint))} m²`)
    .join("<br>");
  return (
    `<p><b>Measured</b> — lot ${round1(lot)} m²<br>${rows}<br>` +
    `coverage ${round1((foot / lot) * 100)}% · FAR ${round1(floor / lot)}</p>`
  );
}

els.read.onclick = guard(async () => {
  site = await readSiteFromForma();
  const zoning = await fetchZoning(site.parcelId);
  envelope = zoning.envelope;
  zoningSource = zoning.source;
  setZoningStatus(zoning);
  plan = null;
  const violations = checkCompliance(site, envelope);
  log(
    `<p>Read <b>${site.buildings.length}</b> building(s) on parcel <code>${site.parcelId}</code>.</p>` +
      measurements(site) +
      envelopeSummary(envelope) +
      `<h4>Compliance</h4>${violationList(violations)}`,
  );
});

els.propose.onclick = guard(async () => {
  if (!site || !envelope) throw new Error("Read the massing first.");
  plan = planCompliance(site, envelope);
  const policy = evaluate(plan.edits, site, envelope);
  const edits = plan.edits.length
    ? `<ul>${plan.edits.map((e) => `<li>${e.rationale}</li>`).join("")}</ul>`
    : `<p>Nothing to change.</p>`;
  log(
    `<h4>Proposal</h4>${edits}` +
      `<p class="policy">Policy: <b>${policy.decision}</b> — ${policy.reason}</p>` +
      `<p>Resulting violations if committed: <b>${plan.resultingCompliance.length}</b></p>` +
      `<p><i>Nothing has changed yet. Commit to draw it into the canvas.</i></p>`,
  );
});

els.commit.onclick = guard(async () => {
  if (!plan || !envelope) throw new Error("Make a proposal first.");
  let note: string;
  try {
    const results = await writeCorrections(plan.edits);
    note = results.length
      ? `Replaced the building with the corrected massing (persists; Undo restores the original):<br>` +
        results.map((r) => `${r.buildingId}<br>${r.extent}`).join("<br>")
      : "No edits to write — the site is already compliant with the current envelope, so there's nothing to change.";
  } catch (e) {
    await drawCorrections(plan.edits);
    note = `Couldn't write to the model (${e instanceof Error ? e.message : String(e)}); showing a preview overlay instead.`;
  }
  site = plan.resultingSite;
  const violations = checkCompliance(site, envelope);
  plan = null;
  log(`<h4>Committed</h4><p>${note}</p>${violationList(violations)}`);
});

els.undo.onclick = guard(async () => {
  if (hasPersistedEdits()) await revertCorrections();
  await clearCorrections();
  site = await readSiteFromForma();
  const zoning = await fetchZoning(site.parcelId);
  envelope = zoning.envelope;
  zoningSource = zoning.source;
  setZoningStatus(zoning);
  plan = null;
  log(`<h4>Reverted</h4><p>Correction meshes removed; back to the original massing.</p>${violationList(checkCompliance(site, envelope))}`);
});

els.debug.onclick = guard(async () => {
  const report = await describeScene();
  const text = JSON.stringify(report, null, 2);
  log(
    `<h4>Scene debug</h4><p>Copy this and send it back so the read logic can be matched to your project.</p>` +
      `<pre style="white-space:pre-wrap;font-size:11px;background:#0000000a;padding:8px;border-radius:6px;overflow:auto">${text.replace(/</g, "&lt;")}</pre>`,
  );
});

function guard(fn: () => Promise<void>): () => void {
  return () => {
    fn().catch((e) => log(`<p class="err">${e instanceof Error ? e.message : String(e)}</p>`));
  };
}

log("<p>Open a Forma project with a site boundary and some massing, then read the massing.</p>");

/**
 * The extension panel. Deliberately small: read the massing, run the compliance
 * loop, review the proposal, then commit (draw the corrected massing) or undo.
 * The compliance logic is the exact same core the MCP server runs — this file
 * only wires Forma to it and paints a few buttons.
 */

import { checkCompliance, type Violation } from "forma-compliance-mcp/dist/compliance.js";
import { planCompliance, type Edit } from "forma-compliance-mcp/dist/fixes.js";
import { evaluate } from "forma-compliance-mcp/dist/policy.js";
import type { Site, ZoningEnvelope } from "forma-compliance-mcp/dist/site.js";
import { clearCorrections, drawCorrections, readSiteFromForma } from "./forma.js";
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

els.read.onclick = guard(async () => {
  site = await readSiteFromForma();
  const zoning = await fetchZoning(site.parcelId);
  envelope = zoning.envelope;
  zoningSource = zoning.source;
  plan = null;
  const violations = checkCompliance(site, envelope);
  log(
    `<p>Read <b>${site.buildings.length}</b> building(s) on parcel <code>${site.parcelId}</code>.</p>` +
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
  await drawCorrections(plan.edits);
  site = plan.resultingSite;
  const violations = checkCompliance(site, envelope);
  plan = null;
  log(`<h4>Committed</h4><p>Corrected massing drawn into the scene.</p>${violationList(violations)}`);
});

els.undo.onclick = guard(async () => {
  await clearCorrections();
  site = await readSiteFromForma();
  const zoning = await fetchZoning(site.parcelId);
  envelope = zoning.envelope;
  zoningSource = zoning.source;
  plan = null;
  log(`<h4>Reverted</h4><p>Correction meshes removed; back to the original massing.</p>${violationList(checkCompliance(site, envelope))}`);
});

function guard(fn: () => Promise<void>): () => void {
  return () => {
    fn().catch((e) => log(`<p class="err">${e instanceof Error ? e.message : String(e)}</p>`));
  };
}

log("<p>Open a Forma project with a site boundary and some massing, then read the massing.</p>");

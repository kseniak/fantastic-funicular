/**
 * A narrated run of the whole loop without any MCP client — the fastest way to
 * watch read -> check -> make_compliant -> commit -> undo work against the mock
 * scene. `npm run demo`.
 */

import { fileURLToPath } from "node:url";
import { ComplianceEngine } from "../src/proposals.js";
import { MockBridge } from "../src/bridge.js";
import { MockZoningProvider } from "../src/zoning/index.js";

const line = (s = "") => process.stdout.write(s + "\n");

async function main(): Promise<void> {
  const bridge = new MockBridge(fileURLToPath(new URL("../../mock/site.json", import.meta.url)));
  const engine = new ComplianceEngine(await bridge.loadSite(), new MockZoningProvider(), bridge);

  line("# get_site");
  const site = engine.getSite();
  line(`parcel ${site.parcelId}, ${site.buildings.length} buildings\n`);

  line("# get_zoning");
  line(JSON.stringify(await engine.getEnvelope()) + "\n");

  line("# check_compliance");
  for (const v of await engine.checkCompliance()) line(`  [${v.severity}] ${v.type}: ${v.humanReadable}`);
  line();

  line("# make_compliant  (proposes; nothing committed yet)");
  const proposal = await engine.makeCompliant();
  line(`  proposalId ${proposal.proposalId}`);
  line(`  policy: ${proposal.policyDecision.decision} — ${proposal.policyDecision.reason}`);
  for (const e of proposal.edits) line(`  edit: ${e.rationale}`);
  line(`  resulting violations: ${proposal.resultingCompliance.length}\n`);

  line("# commit");
  const committed = await engine.commit(proposal.proposalId);
  line(`  ${JSON.stringify(committed)}`);
  line(`  compliant now? ${(await engine.checkCompliance()).length === 0}\n`);

  line("# undo  (back to the original, non-compliant massing)");
  await engine.undo();
  line(`  violations after undo: ${(await engine.checkCompliance()).length}`);
}

main().catch((e) => {
  process.stderr.write(String(e) + "\n");
  process.exit(1);
});

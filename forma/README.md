# Forma compliance-aware massing agent

An agent that reads a Forma massing, checks it against real zoning constraints, and reshapes the buildings to comply — behind a propose/confirm/rollback boundary.

## Demo

<!--
  To embed the recording: open a new GitHub issue (or this repo's PR), drag the
  video file (.mp4/.mov, <=100 MB) into the comment box, wait for it to upload,
  and copy the resulting https://github.com/user-attachments/assets/... URL.
  Paste it on its own line below (replace the placeholder). GitHub renders it as
  an inline player. No need to submit the issue — the upload is all you need.
-->

https://github.com/user-attachments/assets/REPLACE-WITH-UPLOADED-VIDEO-URL

*Running live in a Forma Site Design project: read the massing → check it against the parcel's limits → commit the corrected, compliant building back into the canvas.*

## The gap this fills

Zoning **data** is a solved problem: Regrid, Zoneomics and LightBox all sell parcel setbacks, FAR, height limits, coverage and allowed uses through an API. And a competitor (TestFit) already *shows* the zoning envelope as a map overlay. What nobody does is close the loop — take "your massing pokes through the zoning envelope" and have an agent actually **reshape the massing to comply**, then write that geometry back into the design tool.

That last step is the whole project. The agent reads the current massing out of Forma, pulls the parcel's zoning envelope, computes the violations, and produces a geometry change that resolves them — and it never touches the design without an explicit commit, with a full undo.

## What's in here

- **`mcp/`** — the MCP server (TypeScript, stdio). This is the brain: the compliance engine, the fix strategies, and the trust boundary. It's completely Forma-agnostic — it speaks a small internal "site model" and nothing else.
- **`extension/`** — the Forma embedded-view extension. This is the only Forma-specific adapter: it reads the real scene and writes the corrected massing back into the model (the original building is replaced by the compliant one, and it persists in the proposal).
- **`mock/site.json`** — an offline scene (a parcel + two buildings, one non-compliant) so the whole loop is runnable and testable without a Forma license.

I kept Forma behind one thin adapter on purpose. The interesting logic — is this compliant, what change fixes it, can this change be safely applied — is all pure functions over the site model, so I can unit-test it hard and run the full demo with no Autodesk account. The extension (or the mock file) is the only thing that has to know what a Forma element is. That split is the design decision I'd most want a reviewer to notice.

## Run the loop offline (no Forma, no API key)

```bash
cd forma/mcp
npm install
npm run build
npm test        # the pure core: compliance, fixes, geometry, commit/undo, policy, the loop
npm run demo    # a narrated read -> check -> make_compliant -> commit -> undo run
```

`npm run demo` is the fastest way to watch the trust boundary work. Against the mock scene it reports four violations (height, setback, coverage, FAR), plans a single combined fix, shows the policy decision, commits it to a clean site, then undoes back to the original.

### Add it to Claude Desktop

Build first (`npm run build`), then point `claude_desktop_config.json` at the built entrypoint (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "forma-compliance": {
      "command": "node",
      "args": ["/absolute/path/to/forma/mcp/dist/server.js"]
    }
  }
}
```

Restart Claude Desktop. It runs over stdio — no server, no database. It loads the mock scene on start, so there's something to act on immediately. To point it at a different scene file, set `FORMA_SITE_PATH`.

Then paste the demo script below to your agent.

### Demo script

> "Check this massing against the zoning and make it compliant."

The agent will:
1. `check_compliance` → four violations, each with a human-readable reason.
2. `make_compliant` → **one** combined proposal (lower the tower, inset it to the setback line, drop floors for FAR) plus a policy decision (`needs-approval`) and the compliance state it would leave behind (zero violations). Nothing has changed yet.
3. `commit` → the site is updated and re-checked; compliance is clean.
4. `undo` → back to the original non-compliant massing.

Try `propose_fix` with a single violation id from `check_compliance` to fix just one thing, or `reject` a proposal instead of committing it.

## Tools

**Read** (run immediately, never mutate)
- `get_site()` — the current site model.
- `get_zoning()` — the parcel's zoning envelope, via the zoning provider.
- `check_compliance()` — the analysis core: a structured list of violations `{ id, type, buildingId?, actual, allowed, severity, humanReadable }`.

**Act** (return a proposal — never mutate)
- `propose_fix(target)` — the geometry change that resolves one violation id, or `"all"`. Returns `{ proposalId, edits[], policyDecision, resultingCompliance }`.
- `make_compliant()` — the loop: check, plan a fix for every violation, and return one combined proposal that would make the whole site compliant. Stops at the approval gate.

**Commit** (disposition)
- `commit(proposalId)` — re-checks that compliance won't worsen, applies the edit, logs an inverse for undo, and (live) writes the geometry to Forma.
- `reject(proposalId)` — discard a pending proposal.
- `undo()` — reverse the last commit, restoring the exact prior geometry.
- `list_proposals()` — pending proposals with their policy decisions.

## Design decisions

**Forma-agnostic core, one thin Forma adapter.** The server speaks the internal site model (`Site`, `Building`, `ZoningEnvelope`) and nothing Forma-specific. This isn't just tidiness — it's forced by the platform. Forma writes have to happen from a browser extension embedded in Forma (an iframe with the SDK), not from a cloud server calling Forma directly. So the shape is a local MCP server plus a Forma extension bridge, and keeping the core Forma-free is what lets me test it without a license and swap the mock for the live scene with no change upstream.

**Two-phase commit.** Act tools are pure proposers. `make_compliant` and `propose_fix` return a proposal — edits, a policy decision, and the compliance state that *would* result — and park it. The site changes only on `commit`. Geometry is never written to Forma without one.

**Advisory policy gate.** `policy.evaluate(edits, site, envelope)` classifies a proposal as `auto-approvable | needs-approval | blocked`: a no-op is auto-approvable, an edit that would raise the violation count is blocked, and any real reshape-to-comply is needs-approval because it changes design intent. The decision is surfaced on every proposal so an orchestrator *could* enforce it, but the human is the final authority here — the engine informs, the human disposes. `blocked` is the one verdict `commit` refuses outright.

**Compliance never silently worsens.** `commit` re-runs `check_compliance` on the would-be site and refuses if the violation count went up. The fix strategies can't produce that — they only ever shrink the massing, and every check is monotonic in that direction — but the guard holds against any proposal, including a hand-written one.

**Reversible op log.** Every commit stores its edits (each carrying the building's full prior state), so `undo` restores the exact geometry — deep-equal to the pre-commit site — and pushes the reversal to Forma in live mode.

**Deterministic fixes.** Same input, same proposal, no randomness. The fix for each violation type is a single explainable transform: height → lower to the limit and recompute floors; setback → inset the footprint into the buildable rectangle; coverage → scale footprints down to the coverage cap; FAR → drop floors from the largest footprint until floor area fits; use → reassign to an allowed use (flagged as a program change). A reviewer and the agent can both reason about exactly what will happen.

## How the Forma write actually works

This is real, not hand-waved. The Forma **Embedded View SDK** (`forma-embedded-view-sdk`, the same package Autodesk's own open-source extensions use) is what the extension runs on:

- **Read:** `Forma.geometry.getPathsByCategory` finds the massing (any of `building`/`house`/… categories, with a fallback to everything inside the `site_limit`), and `Forma.geometry.getTriangles({ path })` returns its mesh. Real massing usually has no footprint representation — the geometry lives in child volume meshes — so the footprint is derived as the convex hull of the mesh's xy projection and the height from its z-extent. The `site_limit` footprint (which *does* have a footprint representation) is the parcel boundary. All of this maps into the internal site model in `extension/src/forma.ts`.
- **Write:** on commit the extension builds the corrected massing as a stack of floor slabs, encodes it as a GLB (`glb.ts`), uploads it with `integrateElements.uploadFile`, creates a `volumeMesh` element with `createElementV2`, then **removes the original building and adds the new one** (`proposal.removeElement` + `addElement`) — a fresh root element lands in the project-reference frame the read/preview use, whereas `replaceElement` inherited the original's transform and mis-placed it. The GLB is emitted Y-up because Forma converts Y-up→Z-up on import. Undo removes the corrected element and re-adds the original. `?preview=1` on the extension URL keeps a non-destructive `render.addMesh` overlay instead of writing the model.

The two things Forma doesn't hand you cleanly per building — floor count and program/use — are derived (floors from height / storey height) and defaulted (use → residential) in the adapter. Every number that actually drives a compliance check is read for real.

> Getting this write to land upright and in place was the fiddly part: GLB back-face culling (fixed with normals + double-siding), the element transform frame (fixed by delete-and-add at root instead of replace), and the glTF up-axis (fixed by emitting Y-up). Those are the kinds of platform-specific edges you only hit by actually writing geometry back, which was the point.

### Live mode with an agent driving it

The stdio server is the license-free path. For an agent to drive the *live* scene, run the HTTP entrypoint (`npm run start:http`) — it exposes the same MCP tools over Streamable HTTP plus a small bridge the extension talks to: the extension `POST`s the scene it read to `/bridge/scene`, and polls `/bridge/ops` for approved edits to draw. One shared engine backs both, so the agent and the canvas stay in sync. The extension also runs the whole loop on its own using the same core, so live mode works with or without an agent attached.

## Live zoning via Zoneomics (real regulations)

By default the envelope comes from `MockZoningProvider`. The offline mock scene gets the demo envelope; a real Forma parcel with no zoning-API coverage (e.g. anywhere outside the US/Canada, like the Oslo project I tested on) falls back to a typical residential zone (`RESIDENTIAL_DEFAULT`: ~9 m height, 24% coverage, 4 m setbacks) so the check is meaningful rather than blank. The panel shows which source is in play. To check against **real** zoning for a US/Canada parcel, the extension can fetch it from a small backend that holds a Zoneomics API key:

```
extension (browser) --lat/lng--> your backend (/zoning, holds the key) --> Zoneomics v2/zoneDetail
```

The key lives on the backend, never in the browser — that's the whole reason the lookup is proxied rather than called from the iframe. The parcel's lat/lng comes from `Forma.project.getGeoLocation()`.

**Set it up:**
1. **Get a Zoneomics API key** at [zoneomics.com](https://www.zoneomics.com/product/api). The zoning-controls data is a paid/trial plan — the free tier is mostly map tiling.
2. **Deploy the backend.** The repo's `render.yaml` deploys `forma/mcp` over HTTP on Render's free tier: *New → Blueprint → pick this repo*, then set `ZONING_API_KEY` (secret) in the dashboard. `ZONING_PROVIDER=zoneomics` is already set. You get a URL like `https://forma-compliance-mcp.onrender.com`.
3. **Point the extension at it** by adding `?backend=<that URL>` to the extension's iframe URL in the Forma manifest, e.g. `https://kseniak.github.io/fantastic-funicular/?backend=https://forma-compliance-mcp.onrender.com`.

Now **Read massing** shows the live envelope and where it came from. With no `?backend=`, it falls back to the mock, so the demo never breaks.

Zoneomics' control field names vary by jurisdiction, so the mapping (`src/zoning/zoneomics.ts`) deep-searches the payload and falls back to the mock per field. Hit `GET <backend>/zoning?lat=..&lng=..&debug=1` to see the raw response and confirm the mapping for your area — height/setbacks are treated as feet and converted to metres, coverage is normalized to a 0–1 ratio.

## Set up live mode in Forma (first-time, start to finish)

This assumes you have a Forma trial or AEC Collection access and have never registered an extension before. Where a step needs an Autodesk-side action only you can do, it says so with the link.

1. **Create an APS (Autodesk Platform Services) app.** Go to https://aps.autodesk.com/ , sign in with the same Autodesk ID as your Forma access, and create an app (**Create App**). You'll get a **Client ID** — that's your extension's identity. You don't need a client secret for a browser extension; it uses the authcontext Forma provides in the iframe.
2. **Turn on the Forma API for the app.** In the APS app settings, add/enable the **Forma** API product. If your account can't see Forma as an available API, that's an allow-list gated by Autodesk — request access from the Forma developer program: https://aps.autodesk.com/en/docs/forma/v1/overview/ (developer forum: https://forums.autodesk.com/t5/forma-developer-forum/bd-p/forma_api_forum). **This is the one step I can't do for you** — the app has to be allow-listed for Forma before the extension will load.
3. **Build and serve the extension locally.**
   ```bash
   cd forma/extension
   npm install
   npm run dev        # Vite dev server on http://localhost:5173
   ```
   (`npm install` here also links and builds the compliance core from `../mcp`.)
4. **Register the extension in Forma.** Open a Forma project, go to the **Extensions** area, and add a **developer / custom extension**. Paste the manifest from `extension/manifest.json`, setting:
   - `id` → your APS **Client ID** from step 1,
   - `iframeUrl` → `http://localhost:5173` (the dev server).

   The exact place to paste this is the Forma developer console; follow the current UI in the docs: https://aps.autodesk.com/en/docs/forma/v1/developers_guide/extensions/ . Forma only loads iframe URLs it recognizes, so the dev-server URL has to be the one in the manifest.
5. **Open the panel and run the loop.** In your Forma project, open the extension panel (the "Compliance" tab). Draw a site boundary and some massing if the project doesn't have any, then:
   - **Read massing from Forma** — reads the scene into the site model and lists violations.
   - **Check & make compliant** — shows the combined proposal and the policy decision. Nothing has changed yet.
   - **Commit** — the corrected massing is drawn into the canvas (green).
   - **Undo** — removes the correction and returns to the original.
6. **(Optional) attach an agent.** In another terminal, `cd forma/mcp && npm run start:http`, and point the extension's bridge at it (default `http://localhost:3939`). Now an MCP client can drive `make_compliant` / `commit` against the live scene.

If the panel loads but reading the massing errors with "no site limit", the project has no site boundary yet — draw one and try again.

## Testing

`npm test` (vitest) covers the pure core, which is where the guarantees live:

- **`compliance.ts`** — a known non-compliant site yields exactly the expected violation set; a compliant site yields none; boundary cases (exactly at the limit is compliant, one unit over is a violation) for both height and setback.
- **`fixes.ts`** — each strategy resolves the violation it targets (re-checking the result clears it), and no fix introduces a new violation of another type.
- **`site.ts`** — `polygonArea`, `inset`, `clipToRect`, `scaleAbout`, `extrudedFloorArea` against hand-computed values on simple rectangles.
- **`proposals.ts`** — a proposal doesn't mutate until `commit`; `commit` then reflects it; `undo` restores the exact prior site; `reject` discards; a proposal is single-use; the commit guard refuses to worsen compliance.
- **`policy.ts`** — worsening → blocked, no-op → auto-approvable, real reshape → needs-approval.
- **The `make_compliant` loop** — end-to-end on the mock: starts non-compliant, one combined proposal, compliant after commit.

The extension bridge and MCP wiring aren't unit-tested (they're thin glue over the tested core); the pure logic they call is.

## What I'd do next for production

- **Preserve the original element on write.** The commit deletes the original and adds a corrected volumeMesh; undo rebuilds the original from the read massing (a convex-hull approximation), not the exact source element. Production would keep the true original (store the full element, or use a proper edit-in-place once the transform frame is pinned down) and add optimistic concurrency against concurrent Forma edits.
- **Harden the ZoningProvider.** The live `ZoneomicsProvider` works (see above); production would add response caching, retry/jurisdiction fallbacks, and a verified field mapping per region rather than the deep-search heuristic. `RegridProvider` stays a stub behind the same interface.
- **Server-side policy enforcement + auth.** OAuth-scoped Forma app with per-tool token scopes so "can propose" and "can commit" are separate grants, and make `blocked` / `needs-approval` enforceable server-side and configurable per tenant.
- **Richer geometry.** Non-convex insets (straight-skeleton offset), per-edge setbacks driven by real street-frontage detection, and floor-plate templates instead of a single extruded footprint.

## Assumptions and simplifications (called out honestly)

- Geometry is 2D footprints extruded to a height — enough for real setback / height / FAR / coverage math, no solids.
- Setbacks map to compass sides of an axis-aligned parcel (front = south, rear = north, side = east/west). Real zoning derives "front" from street frontage; that needs frontage data the model doesn't carry.
- Floor count is derived from height, and building use defaults to residential in the live adapter, because Forma doesn't expose either as a single per-element field the way it exposes geometry.
- The footprint read from live geometry is the **convex hull** of the mesh, so a non-convex or notched building reads slightly larger than it is. `inset` (and the corrected massing) is likewise a convex offset; non-convex outlines need a straight-skeleton offset (listed above).
- For a parcel with no zoning-API coverage the envelope is a **seeded residential default**, not that parcel's actual plan — good enough to demonstrate the loop, not a substitute for the real reguleringsplan/zoning code.
- On commit the original element is replaced by a rebuilt volumeMesh; **undo reconstructs the original from the read massing** rather than restoring the exact source element (see next steps). Forma's own Ctrl+Z restores the true original at any time.

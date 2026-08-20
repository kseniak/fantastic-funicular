# Agentic Authoring MCP

> A prototype of the read→act trust boundary for agent-driven authoring — propose, policy, commit, rollback.

This is a small MCP server that prototypes the hardest part of Forma's **"take
authoring agentic"** move: letting an AI agent *act on* design data — create and
modify it — instead of only reading it. The scene graph here is deliberately
trivial (2D walls and rooms on an integer grid). **The star of the project is
the trust boundary**, not the CAD: the machinery by which an agent may *propose*
a change but can never silently mutate state. Read tools run immediately; act
tools only ever return a **proposal**; state changes exclusively on an explicit
`commit`, and every commit is reversible.

## Tools

**Read** (execute immediately, never mutate)
- `get_scene()` — the full current scene graph.
- `describe_room(roomId)` — dimensions, area, adjacent walls.
- `query_daylight(roomId)` — a **toy** daylight score (heuristic stub; not real analysis).

**Act** (validate + policy, then return a proposal — no mutation)
- `add_wall({ x1, y1, x2, y2, structural })`
- `move_room({ roomId, dx, dy })`
- `delete_element({ elementId })`

**Commit** (human/orchestrator disposition)
- `commit(proposalId)` — apply, append to the op log, return the new scene.
- `reject(proposalId)` — discard a pending proposal.
- `undo()` — reverse the most recently committed op.
- `list_proposals()` — pending proposals with their policy decisions.

## Add it to Claude Desktop (30 seconds)

```bash
npm install
npm run build     # compiles src/ -> dist/
```

Then add the server to `claude_desktop_config.json` (macOS:
`~/Library/Application Support/Claude/claude_desktop_config.json`), pointing at
the built entrypoint:

```json
{
  "mcpServers": {
    "agentic-authoring": {
      "command": "node",
      "args": ["/absolute/path/to/agentic-authoring-mcp/dist/server.js"]
    }
  }
}
```

Restart Claude Desktop. The server runs over stdio — no infrastructure, no
database. It seeds a floor (an outer boundary of 4 structural walls plus a
`living_room` and a `bedroom`) on every start, so there is something to act on
immediately.

## Run it as a remote server (HTTPS URL for the connector dialog)

Claude Desktop's "custom connector" dialog accepts a **remote HTTPS URL**, not a
local command. The same server also runs over the MCP **Streamable HTTP**
transport for exactly this case:

```bash
npm run build
npm run start:http     # serves MCP at http://localhost:3000/mcp (PORT overridable)
```

Deploy it to any Node host to get a public URL:

- **Render (one click):** the repo includes `render.yaml`. In Render, *New →
  Blueprint → pick this repo*; it builds, serves over HTTPS, and injects `PORT`.
  Your endpoint is `https://<your-service>.onrender.com/mcp`.
- **Docker (any host):** `docker build -t agentic-authoring . && docker run -p 3000:3000 agentic-authoring`.

Then in Claude → *Settings → Connectors → Add → Add custom connector*, paste the
`…/mcp` URL. Each MCP session gets its own freshly seeded floor; session state is
in-memory and ephemeral (persistence and auth are the "next steps" below). The
server is unauthenticated, so treat a public deployment as a shared demo sandbox.

## Demo script (paste to your agent)

1. *"Show me the scene, then add a partition wall splitting the living room."*
   → the agent calls `add_wall` and gets back a **proposal**: a `proposalId`, a
   human-readable `diff`, and a `policyDecision` (`needs-approval`). Nothing has
   changed yet.
2. *"Commit it."* → `commit(proposalId)` applies the change and returns the new
   scene.
3. *"Actually, undo that."* → `undo()` reverses it; the wall is gone.
4. *"Now try to move the living room 20 units right."* → the proposal comes back
   `blocked` with a reason (it would leave the floor bounds), and `commit`
   refuses it.

## Design decisions

**Two-phase commit.** Act tools are pure proposers. Each returns a `Proposal`
(`proposalId`, the intended `op`, a `diff`, a `policyDecision`, `createdAt`) and
parks it in an in-memory pending map — the scene is untouched. State changes
only in `commit`, which applies the op, appends to the op log, and removes the
proposal. A proposal is single-use: committing or rejecting removes it. This
models agent actions as *reviewable transactions* rather than fire-and-forget
mutations.

**Policy as advisory metadata.** `policy.evaluate(op, scene)` is a pure function
returning `auto-approvable | needs-approval | blocked` with a reason. It is
surfaced on every proposal so an orchestrator *could* enforce it — but `commit`
still succeeds regardless (a `blocked` proposal being the sole exception). This
is a deliberate trust-model statement: **the engine informs; the human/policy
disposes.** The human is the final authority in this demo; moving enforcement
server-side is a per-tenant configuration decision, noted below.

**Invariants as hard blocks.** Domain invariants (`invariants.ts`) run *before*
a proposal is created: no two walls on the same segment, coordinates within the
fixed grid (0–20), rooms cannot be pushed out of bounds. A violation never
throws across the tool boundary — it returns a structured, agent-legible
`blocked` proposal with a clear reason, so the agent can correct itself. This is
the engine protecting itself *from* the agent, and it is intentionally distinct
from policy (what is *allowed*) versus invariants (what is *possible*).

**Reversible op log.** Committed ops are appended to an in-memory array, each
carrying enough inverse information to undo it — a deleted element is snapshotted
in full, a move stores its `dx/dy` so undo negates it, an add records the wall so
undo removes it. `undo()` pops and reverses the last op. Apply and reverse are
pure functions over the scene, which is what makes them unit-testable and what
makes "undo" trustworthy.

## Repo layout

```
src/
  server.ts      MCP server wiring, tool registration (stdio)
  scene.ts       scene model + pure apply/reverse op functions
  proposals.ts   Engine: proposal store + two-phase commit + op log
  policy.ts      pure policy evaluation
  invariants.ts  domain invariant checks
  daylight.ts    toy read-only analysis stub
  seed.ts        the seeded starting floor
  types.ts       shared domain types
  *.test.ts      vitest unit tests
demo/seed.ts     prints the seeded floor (npm run seed)
```

## Develop

```bash
npm run build     # tsc, strict
npm test          # vitest: policy, invariants, undo-reverses-commit
npm run seed      # print the seed scene as JSON
npm run demo      # narrated read -> propose -> commit -> undo -> blocked -> reject walkthrough
```

`npm run demo` is the fastest way to see the trust boundary work without any MCP
client. To drive it as an actual agent, either add the built `dist/server.js` to
an MCP client that supports local stdio servers (e.g. Claude Code, via
`claude mcp add agentic-authoring -- node ./dist/server.js`, or the project-scoped
`.mcp.json` included here), or use the Claude Desktop config snippet above. Note
that Claude Desktop's "custom connector" dialog currently accepts remote (HTTPS)
servers only, so a purely local stdio server is added via config/CLI rather than
that dialog — see "Run it as a remote server" above for the HTTPS option.

Unit tests cover the parts that carry the trust guarantees: `policy.evaluate`
verdicts, invariant blocking, two-phase commit semantics (propose doesn't
mutate, single-use proposals, blocked can't commit), and undo reversing each
kind of commit.

## What I'd do next for production

- **Persistence + optimistic concurrency.** Back the scene and op log with a
  store, and version proposals against the scene revision they were built on so a
  stale proposal fails on commit instead of applying to a changed world.
- **Auth + per-tenant policy enforcement.** The remote (HTTP) server ships
  unauthenticated as a demo; production needs OAuth on the transport and per-tool
  scopes so "can propose" and "can commit" are separate grants, plus making
  `blocked`/`needs-approval` enforceable server-side and configurable per tenant.
- **Prompt-injection hardening on tool inputs.** Treat all agent-supplied ids and
  coordinates as untrusted: strict schema validation (already via zod), plus
  bounds/normalization and rejection of anything that would smuggle intent past
  the policy layer.

## Non-goals

No real geometry/CAD math, no rendering, no UI, no database, no auth server
(OAuth is a "next step" only), no multi-floor or 3D. The daylight tool is an
intentional stub.

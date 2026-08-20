# Two MCP servers for agentic design authoring

This repo holds two related-but-separate MCP servers. They share a theme — letting an AI agent *act on* design data behind a hard trust boundary — but they're independent projects with their own `package.json`, build, and tests. Keeping them apart keeps it obvious what's what.

## [`forma/`](./forma) — Forma compliance-aware massing agent

> An agent that reads a Forma massing, checks it against real zoning constraints, and reshapes the buildings to comply — behind a propose/confirm/rollback boundary.

The complete project: a Forma-agnostic MCP server (`forma/mcp`), a Forma embedded-view extension that runs the loop live in the Forma canvas (`forma/extension`), and an offline mock scene so it's demonstrable without a Forma license. This is the main deliverable — start with [`forma/README.md`](./forma/README.md).

```bash
cd forma/mcp && npm install && npm run build && npm test
```

## [`authoring-mcp/`](./authoring-mcp) — Agentic authoring trust-boundary prototype

An earlier, smaller prototype of the same core idea on a deliberately trivial scene graph (2D walls and rooms). It exists to isolate the read→propose→commit→undo boundary from any real geometry. Kept here because it's where the trust-boundary machinery in the Forma project started. See [`authoring-mcp/README.md`](./authoring-mcp/README.md).

```bash
cd authoring-mcp && npm install && npm run build && npm test
```

Both run over stdio and add to Claude Desktop / Claude Code the same way; each README has the config snippet.

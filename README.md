# Ariadne

**IDE-grade code navigation for AI agents — as an MCP server.**

Ariadne indexes your codebase into a local graph and exposes it as [MCP](https://modelcontextprotocol.io) tools, so coding agents like Claude can navigate your code structurally instead of grepping raw text.

```
get_definition("processPayment")   →  payments/service.ts:142
get_callers("processPayment")      →  [checkout.controller.ts:88, retry.worker.ts:34]
get_call_path("checkout", "save")  →  checkout → processPayment → repository.save
```

## Why

When Claude (or any coding agent) needs to understand a codebase, it typically:
- Greps for symbol names across thousands of files
- Reads entire files to find one function
- Loses the thread across long call chains

This burns tokens fast and produces shallow answers. Ariadne gives agents the same navigation primitives an IDE has — go-to-definition, find-references, call hierarchy — but queryable over MCP.

**Same question, different approach:**

| Without Ariadne | With Ariadne |
|---|---|
| Grep 8 files, read 4 in full | 3 tool calls |
| ~8,000 tokens | ~400 tokens |
| Guesses at call chains | Exact paths from SCIP index |

## Setup

Add this to your **project-level** MCP config (not global) — Ariadne uses `process.cwd()` as the repo root, so it must be spawned from the project directory:

```json
{
  "mcpServers": {
    "ariadne": {
      "command": "npx",
      "args": ["-y", "ariadne-mcp"]
    }
  }
}
```

> ⚠️ **Do not add Ariadne to your global MCP config.** It needs to run inside a project directory to index correctly. Use your editor's per-project config (e.g. `.cursor/mcp.json`, `.kiro/settings/mcp.json`, or the project-level Claude Desktop config).

## What happens on first run

```
→ Detecting languages... found TypeScript
→ Reusing existing TypeScript SCIP index (< 24 h old).
→ Loading TypeScript/JavaScript index...
→ Graph ready: 148,363 symbols, 364,387 edges
→ Ariadne ready.
```

- **First startup**: runs `scip-typescript` or `scip-python` to build a full semantic index (5–10 min for large repos, auto-installed via npx/pip)
- **Subsequent startups**: reuses the cached `.scip` file if < 24h old — loads in ~10s
- **File saves**: tree-sitter patches the graph incrementally within ~150ms

## MCP Tools

| Tool | Description |
|---|---|
| `get_definition` | Where is this symbol defined? File, line, signature |
| `get_source_definition` | Same, but skips barrel/re-export files |
| `get_callers` | Every call site that invokes this symbol |
| `get_callees` | Every symbol this function calls |
| `get_call_path` | Shortest call chain between two symbols |
| `get_references` | Every usage across the repo |
| `get_implementations` | All classes implementing this interface |
| `get_type_definition` | Where the type of this symbol is defined |
| `get_file_symbols` | Full symbol map of a file |
| `get_index_status` | Current indexing state — check this if tools return empty results |

## Supported Languages

| Language | Full index (SCIP) | Incremental (tree-sitter) |
|---|---|---|
| TypeScript / TSX | ✅ | ✅ |
| JavaScript / JSX | ✅ | ✅ |
| Python | ✅ | ✅ |

## How it works

```
npx ariadne-mcp
  → process.cwd()                    repo root (inherited from editor)
  → scip-typescript / scip-python    full semantic index → .ariadne/index.scip
  → loadScipIndex()                  symbols + edges → .ariadne/graph.db (SQLite)
  → chokidar watcher                 incremental tree-sitter patches on file save
  → MCP stdio transport              ready for tool calls
```

- **SCIP** ([Semantic Code Intelligence Protocol](https://github.com/sourcegraph/scip)) produces cross-file symbol resolution — something tree-sitter alone can't do
- **SQLite** (via `better-sqlite3`) stores the graph — fast point lookups, no server required
- **tree-sitter** patches individual files on save between SCIP runs

Graph lives at `<repo>/.ariadne/graph.db` — add `.ariadne/` to your `.gitignore`.

## Requirements

- Node.js 20+
- For TypeScript/JavaScript indexing: nothing extra (scip-typescript installed via npx)
- For Python indexing: Python 3.8+ with pip (scip-python installed via pip)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)

# Contributing to Ariadne

Thanks for your interest in contributing! Ariadne is a small, focused tool and contributions are welcome.

## Ways to Contribute

- **Bug reports** — open an issue with the error message and your setup (OS, Node version, repo language)
- **Language support** — add or improve tree-sitter parsers in `src/indexer/languages/`
- **New MCP tools** — add query tools in `src/tools/` following the existing pattern
- **Monorepo support** — help Ariadne handle repos without a root `tsconfig.json`
- **Performance** — improve indexing speed or query performance

## Development Setup

```bash
git clone https://github.com/Madan2248c/ariadne
cd ariadne
npm install
npm run build
```

To test against a local repo:

```bash
cd /path/to/your/repo
node /path/to/ariadne/dist/index.js
```

Or add to your MCP config:
```json
{
  "mcpServers": {
    "ariadne": {
      "command": "node",
      "args": ["/path/to/ariadne/dist/index.js"]
    }
  }
}
```

## Project Structure

```
src/
  index.ts              # Entry point
  server.ts             # MCP server + tool registration
  indexer/
    index.ts            # Orchestrator: detect → scip → load → watch
    detector.ts         # Language detection
    scip-runner.ts      # Runs scip-python / scip-typescript
    scip-reader.ts      # Reads .scip protobuf → SQLite
    status.ts           # Indexing status (for get_index_status tool)
    watcher.ts          # chokidar file watcher for incremental updates
    parser.ts           # Routes files to the right language parser
    languages/
      base.ts           # LanguageParser interface
      typescript.ts     # tree-sitter TypeScript/TSX parser
      javascript.ts     # tree-sitter JavaScript parser
      python.ts         # tree-sitter Python parser
  graph/
    db.ts               # SQLite singleton (better-sqlite3)
    schema.ts           # DDL: symbols, edges, meta tables
    writer.ts           # upsertSymbol, upsertEdge, deleteSymbolsByFile
    queries.ts          # All read queries
  tools/                # One file per MCP tool
  types/
    index.ts            # Core types: Symbol, Edge, SymbolKind, EdgeKind
```

## Adding a New MCP Tool

1. Create `src/tools/get-my-tool.ts` following the pattern in any existing tool file
2. Export it from `src/tools/index.ts`
3. Register it in `src/server.ts`
4. Build with `npm run build`

## Adding a Language

1. Install the tree-sitter grammar: `npm install tree-sitter-<lang>`
2. Add a type stub in `src/types/vendor.d.ts`
3. Create `src/indexer/languages/<lang>.ts` implementing `LanguageParser`
4. Register it in `src/indexer/parser.ts`

## Code Style

- TypeScript strict mode — no `any`
- No inline SQL — all queries go in `src/graph/queries.ts`
- All progress output goes to `stderr` — `stdout` belongs to the MCP protocol
- Keep tool response text concise — tokens are expensive for the LLM calling them

## Pull Requests

- Keep PRs focused — one feature or fix per PR
- Run `npm run build` before submitting — no TypeScript errors
- Add a brief description of what the PR changes and why

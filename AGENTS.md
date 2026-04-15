# Ariadne

An MCP server that gives coding agents a structural map of a codebase —
like IDE navigation (go-to-definition, find-references, call hierarchy)
but as queryable MCP tools.

## What it does
Indexes a repository into a local graph (SQLite), then exposes MCP tools
so agents can query it structurally instead of grepping raw text.

## Stack
- TypeScript (Node.js)
- MCP SDK: @modelcontextprotocol/sdk
- Primary indexer: SCIP (scip-python, @sourcegraph/scip-typescript)
- Incremental indexer: tree-sitter (for file-change patches between SCIP runs)
- Graph store: SQLite (better-sqlite3)
- File watching: chokidar
- Distribution: npx (published to npm as `ariadne-mcp`)

## User setup
Add this to your editor/agent MCP config once — never touch it again:
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
No flags. No paths. No configuration beyond that one addition.

Ariadne is spawned by the editor as a subprocess and inherits its working
directory, which is always the open project root.

## Startup flow
```
npx ariadne-mcp
  → const repoPath = process.cwd()          // no --repo flag, ever
  → init(repoPath)                           // open .ariadne/graph.db
  → server.connect(StdioTransport)           // MCP handshake — immediate
  → detectLanguages(repoPath)                // scan for .py / .ts / .js
  → runPythonIndexer(repoPath)               // scip-python (auto-installed)
  → runTypescriptIndexer(repoPath)           // scip-typescript (auto-installed)
  → loadScipIndex(conn, *.scip, repoPath)    // symbols + edges → SQLite
  → startWatcher(conn, repoPath)             // tree-sitter incremental patches
```

The MCP transport connects before indexing starts so the client handshake
succeeds immediately. Indexing runs in the background; tools serve whatever
data is already in the DB (from a previous run) while the fresh index loads.

Progress is printed to stderr; stdout is reserved for the MCP protocol.

Expected console output:
```
→ Detecting languages... found Python, TypeScript
→ Installing scip-python... done
→ Indexing Python files...
→ Python ready: 312 symbols
→ Indexing TypeScript/JavaScript files...
→ TypeScript/JavaScript ready: 891 symbols
→ Graph ready: 1,203 symbols, 4,817 edges
→ Ariadne ready.
```

## Indexing strategy

### Primary: SCIP
SCIP indexers produce full cross-file symbol resolution — something
tree-sitter alone cannot do (it parses syntax, not semantics).

- **scip-python** — auto-installed via pip if absent
- **@sourcegraph/scip-typescript** — auto-installed via npx if absent
- Output: `.ariadne/index-python.scip`, `.ariadne/index-ts.scip`
- Loaded once at startup; reloaded on next restart

### Incremental: tree-sitter
- File watcher (chokidar) detects saves
- tree-sitter re-parses only the changed file
- Patches SQLite immediately — no SCIP re-run required
- Good for: renaming a function, adding a method, moving code
- Not good for: cross-file refactors (wait for next restart + SCIP run)

## Folder structure
```
src/
  index.ts                    # entry point — process.cwd(), no args
  server.ts                   # MCP server, tool registration
  indexer/
    index.ts                  # orchestrator: detect → scip → load → watch
    detector.ts               # language detection by file extension scan
    scip-runner.ts            # runs scip-python / scip-typescript
    scip-reader.ts            # reads .scip protobuf → SQLite
    scip.ts                   # generated protobuf bindings (DO NOT EDIT)
    scanner.ts                # fallback tree-sitter full scan (unused in prod)
    parser.ts                 # routes files to the right language parser
    status.ts                 # in-process indexer status tracking
    watcher.ts                # chokidar watcher for incremental tree-sitter
    languages/
      base.ts                 # LanguageParser interface
      python.ts               # tree-sitter Python parser (incremental)
      javascript.ts           # tree-sitter JS parser (incremental)
      typescript.ts           # tree-sitter TS parser (incremental)
  graph/
    db.ts                     # singleton SQLite connection (better-sqlite3)
    schema.ts                 # DDL: symbols, edges, meta tables + indexes
    writer.ts                 # upsertSymbol, upsertEdge, deleteSymbolsByFile
    queries.ts                # all read queries (no inline SQL elsewhere)
  tools/
    index.ts                  # re-exports all tool handlers
    format.ts                 # shared response formatting helpers
    get-definition.ts
    get-source-definition.ts
    get-type-definition.ts
    get-callers.ts
    get-callees.ts
    get-implementations.ts
    get-references.ts
    get-call-path.ts
    get-file-symbols.ts
    get-index-status.ts
  types/
    index.ts                  # SymbolKind, EdgeKind, Symbol, Edge, Location
    vendor.d.ts               # type stubs for untyped native modules
```

## Core types
- `SymbolKind`: function | class | method | module | variable
- `EdgeKind`: calls | imports | defines | implements | references
- `Symbol`: id, name, kind, file, line, signature?, docstring?
- `Edge`: from, to, kind, line?
- `Location`: file, line, column?

## MCP tools
- `get_definition(symbol, file?)` → file, line, full signature
- `get_type_definition(symbol, file?)` → where the type of this symbol is defined
- `get_source_definition(symbol, file?)` → skips re-exports, finds original source
- `get_implementations(symbol)` → all classes/functions implementing this interface
- `get_references(symbol)` → every usage across the repo
- `get_callers(symbol)` → call sites only
- `get_callees(symbol)` → what this function calls
- `get_call_path(from, to)` → shortest chain between two symbols
- `get_file_symbols(file)` → full symbol map of a file
- `get_index_status()` → current indexing state (check if tools return empty)

## Key decisions
- Repo path is always `process.cwd()` — no CLI flags
- Graph DB lives at `<repo>/.ariadne/graph.db` (SQLite via better-sqlite3)
- SCIP output lives at `<repo>/.ariadne/index-python.scip` etc.
- All progress output goes to stderr; stdout is the MCP channel
- No inline SQL — all queries live in `graph/queries.ts`
- SCIP indexers are auto-installed on first run, never require manual setup
- MCP handshake completes before indexing — tools work immediately with cached data
- npm package name is `ariadne-mcp` (the name `ariadne` was taken)

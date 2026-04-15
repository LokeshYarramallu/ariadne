/**
 * Incremental tree-sitter updates via chokidar file watching.
 *
 * When a file is saved:
 *   1. Delete all symbols + edges for that file from the graph DB.
 *   2. Re-parse the file with tree-sitter (TypeScript / JavaScript / Python).
 *   3. Insert the new symbols + edges — all in one transaction.
 *
 * This patches the graph within ~50 ms of a save, without waiting for a
 * full SCIP re-index (which runs at most once per 24 h).
 *
 * Limitations vs SCIP:
 *   - Single-file scope only: cross-file call resolution uses unresolved: IDs.
 *   - No type-flow semantics — just syntax-level symbol extraction.
 *   - Good for: adding/renaming functions, moving methods, adding classes.
 *   - Not good for: cross-file refactors (reflected on next SCIP run / restart).
 */

import path from "node:path";
import chokidar from "chokidar";
import type { Database } from "../graph/db.js";
import { parseFile } from "./parser.js";
import type { Symbol, Edge } from "../types/index.js";

// Directories that are never part of a user's source code.
const IGNORED = [
  "**/.git/**",
  "**/node_modules/**",
  "**/.ariadne/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/coverage/**",
];

// Debounce: wait this many ms after the last write event before processing.
// Editors often fire multiple rapid events per save (temp file → rename).
const DEBOUNCE_MS = 150;

export function startWatcher(db: Database.Database, repoRoot: string): void {
  // Prepare statements once — reused for every incremental update.
  const deleteEdges = db.prepare(`
    DELETE FROM edges
    WHERE from_symbol IN (SELECT id FROM symbols WHERE file = $file)
       OR to_symbol   IN (SELECT id FROM symbols WHERE file = $file)
  `);
  const deleteSymbols = db.prepare(`DELETE FROM symbols WHERE file = $file`);
  const insertSymbol = db.prepare(`
    INSERT OR REPLACE INTO symbols (id, name, kind, file, line, signature, docstring)
    VALUES ($id, $name, $kind, $file, $line, $signature, $docstring)
  `);
  const insertEdge = db.prepare(`
    INSERT OR IGNORE INTO edges (from_symbol, to_symbol, kind, line)
    VALUES ($from_symbol, $to_symbol, $kind, $line)
  `);

  // Wrap delete + insert in a single transaction for atomicity.
  const applyUpdate = db.transaction(
    (filePath: string, symbols: Symbol[], edges: Edge[]) => {
      deleteEdges.run({ file: filePath });
      deleteSymbols.run({ file: filePath });
      for (const sym of symbols) {
        insertSymbol.run({
          id:        sym.id,
          name:      sym.name,
          kind:      sym.kind,
          file:      sym.file,
          line:      sym.line,
          signature: sym.signature ?? null,
          docstring: sym.docstring ?? null,
        });
      }
      for (const edge of edges) {
        insertEdge.run({
          from_symbol: edge.from,
          to_symbol:   edge.to,
          kind:        edge.kind,
          line:        edge.line ?? null,
        });
      }
    },
  );

  const applyDelete = db.transaction((filePath: string) => {
    deleteEdges.run({ file: filePath });
    deleteSymbols.run({ file: filePath });
  });

  // ── Event handlers ─────────────────────────────────────────────────────────

  async function handleChange(filePath: string): Promise<void> {
    const result = await parseFile(filePath);
    // If no symbols and no edges, the file has an unsupported extension
    // (parseFile returns empty for unknown extensions).
    if (result.symbols.length === 0 && result.edges.length === 0) return;

    applyUpdate(filePath, result.symbols, result.edges);

    process.stderr.write(
      `[watcher] ${path.relative(repoRoot, filePath)}: ${result.symbols.length} symbols\n`,
    );
  }

  function handleUnlink(filePath: string): void {
    applyDelete(filePath);
    process.stderr.write(`[watcher] removed ${path.relative(repoRoot, filePath)}\n`);
  }

  // ── Debounce ───────────────────────────────────────────────────────────────

  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function schedule(filePath: string, handler: () => void): void {
    const existing = timers.get(filePath);
    if (existing) clearTimeout(existing);
    timers.set(
      filePath,
      setTimeout(() => {
        timers.delete(filePath);
        handler();
      }, DEBOUNCE_MS),
    );
  }

  // ── Chokidar setup ─────────────────────────────────────────────────────────

  const watcher = chokidar.watch(repoRoot, {
    ignored: IGNORED,
    ignoreInitial: true,     // don't fire 'add' for existing files at startup
    persistent: true,
    // Wait until the file is fully written before firing the event.
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });

  watcher.on("add", (p) =>
    schedule(p, () => {
      handleChange(p).catch((err) =>
        process.stderr.write(
          `[watcher] error on add ${p}: ${err instanceof Error ? err.message : String(err)}\n`,
        ),
      );
    }),
  );

  watcher.on("change", (p) =>
    schedule(p, () => {
      handleChange(p).catch((err) =>
        process.stderr.write(
          `[watcher] error on change ${p}: ${err instanceof Error ? err.message : String(err)}\n`,
        ),
      );
    }),
  );

  watcher.on("unlink", (p) =>
    schedule(p, () => handleUnlink(p)),
  );
}

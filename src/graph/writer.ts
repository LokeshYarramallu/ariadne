// All write operations against the graph database.
import type { Database } from "./db.js";
import type { Symbol, Edge } from "../types/index.js";

/**
 * Insert or replace a symbol.  Uses the SCIP symbol string as the primary key
 * so re-indexing the same file is idempotent.
 */
export function upsertSymbol(db: Database.Database, symbol: Symbol): void {
  db.prepare(`
    INSERT OR REPLACE INTO symbols (id, name, kind, file, line, signature, docstring)
    VALUES ($id, $name, $kind, $file, $line, $signature, $docstring)
  `).run({
    id:        symbol.id,
    name:      symbol.name,
    kind:      symbol.kind,
    file:      symbol.file,
    line:      symbol.line,
    signature: symbol.signature ?? null,
    docstring: symbol.docstring ?? null,
  });
}

/**
 * Insert an edge if it doesn't already exist.
 * The composite PK (from_symbol, to_symbol, kind) enforces uniqueness.
 */
export function upsertEdge(db: Database.Database, edge: Edge): void {
  db.prepare(`
    INSERT OR IGNORE INTO edges (from_symbol, to_symbol, kind, line)
    VALUES ($from_symbol, $to_symbol, $kind, $line)
  `).run({
    from_symbol: edge.from,
    to_symbol:   edge.to,
    kind:        edge.kind,
    line:        edge.line ?? null,
  });
}

/**
 * Remove all symbols (and their edges) for a given file.
 * Called before re-parsing a changed file so stale data doesn't accumulate.
 */
export function deleteSymbolsByFile(db: Database.Database, file: string): void {
  db.transaction(() => {
    db.prepare(`
      DELETE FROM edges
      WHERE from_symbol IN (SELECT id FROM symbols WHERE file = $file)
         OR to_symbol   IN (SELECT id FROM symbols WHERE file = $file)
    `).run({ file });
    db.prepare(`DELETE FROM symbols WHERE file = $file`).run({ file });
  })();
}

/**
 * Wipe the entire graph.  Prefer wipAndReinit() from db.ts for full re-index
 * (file deletion is faster and avoids any MVCC overhead).
 * This function is kept for use in tests and small-scale resets.
 */
export function clearAll(db: Database.Database): void {
  db.transaction(() => {
    db.prepare("DELETE FROM edges").run();
    db.prepare("DELETE FROM symbols").run();
    db.prepare("DELETE FROM meta").run();
  })();
}

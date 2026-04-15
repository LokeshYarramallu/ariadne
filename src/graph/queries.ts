// All read queries — no inline SQL anywhere else in the codebase.
import type { Database } from "./db.js";
import type { Symbol, Edge, DefinitionResult, CallSite, CallPath } from "../types/index.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function rowToSymbol(row: Record<string, unknown>): Symbol {
  return {
    id:        row["id"] as string,
    name:      row["name"] as string,
    kind:      row["kind"] as Symbol["kind"],
    file:      row["file"] as string,
    line:      row["line"] as number,
    signature: (row["signature"] as string | null) ?? undefined,
    docstring: (row["docstring"] as string | null) ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Find where a symbol is defined.
 * If `file` is provided, restricts the search to that file.
 */
export async function getDefinition(
  db: Database.Database,
  name: string,
  file?: string,
): Promise<DefinitionResult | null> {
  const row = file
    ? db.prepare(`SELECT * FROM symbols WHERE name = $name AND file = $file LIMIT 1`)
         .get({ name, file }) as Record<string, unknown> | undefined
    : db.prepare(`SELECT * FROM symbols WHERE name = $name LIMIT 1`)
         .get({ name }) as Record<string, unknown> | undefined;

  if (!row) return null;
  return { symbol: rowToSymbol(row) };
}

/**
 * Find all call sites that invoke symbols matching `symbolName`.
 * Falls back to all reference edges (imports, references) when no call edges
 * exist — this surfaces class registrations and import sites for non-callable
 * symbols like classes.
 */
export async function getCallers(
  db: Database.Database,
  symbolName: string,
): Promise<CallSite[]> {
  const callRows = db.prepare(`
    SELECT
      s.id, s.name, s.kind, s.file, s.line, s.signature, s.docstring,
      e.line AS call_line
    FROM edges e
    JOIN symbols s ON s.id = e.from_symbol
    WHERE e.to_symbol IN (SELECT id FROM symbols WHERE name = $name)
      AND e.kind = 'calls'
    ORDER BY s.file, e.line
  `).all({ name: symbolName }) as Record<string, unknown>[];

  if (callRows.length > 0) {
    return callRows.map((row) => ({
      caller: rowToSymbol(row),
      line:   (row["call_line"] as number | null) ?? (row["line"] as number),
    }));
  }

  // No call edges — fall back to imports + references (e.g. class registrations)
  const refRows = db.prepare(`
    SELECT
      s.id, s.name, s.kind, s.file, s.line, s.signature, s.docstring,
      e.line AS call_line
    FROM edges e
    JOIN symbols s ON s.id = e.from_symbol
    WHERE e.to_symbol IN (SELECT id FROM symbols WHERE name = $name)
      AND e.kind IN ('imports', 'references')
    ORDER BY s.file, e.line
  `).all({ name: symbolName }) as Record<string, unknown>[];

  return refRows.map((row) => ({
    caller: rowToSymbol(row),
    line:   (row["call_line"] as number | null) ?? (row["line"] as number),
  }));
}

/**
 * Find all symbols called by symbols matching `symbolName`.
 */
export async function getCallees(
  db: Database.Database,
  symbolName: string,
): Promise<Symbol[]> {
  const rows = db.prepare(`
    SELECT DISTINCT s.id, s.name, s.kind, s.file, s.line, s.signature, s.docstring
    FROM edges e
    JOIN symbols s ON s.id = e.to_symbol
    WHERE e.from_symbol IN (SELECT id FROM symbols WHERE name = $name)
      AND e.kind = 'calls'
      AND s.name NOT LIKE '%<get>%'
      AND s.name NOT LIKE '%<set>%'
      AND NOT (s.name LIKE '<%' AND s.name LIKE '%>')
    ORDER BY s.name
  `).all({ name: symbolName }) as Record<string, unknown>[];

  return rows.map(rowToSymbol);
}

/**
 * Find all edges pointing at symbols matching `symbolName`, any edge kind.
 * Includes calls, imports, references, and implements edges — so decorators,
 * class registrations, and function calls are all surfaced.
 */
export async function getReferences(
  db: Database.Database,
  symbolName: string,
): Promise<CallSite[]> {
  const rows = db.prepare(`
    SELECT
      s.id, s.name, s.kind, s.file, s.line, s.signature, s.docstring,
      e.line AS ref_line,
      e.kind AS edge_kind
    FROM edges e
    JOIN symbols s ON s.id = e.from_symbol
    WHERE e.to_symbol IN (SELECT id FROM symbols WHERE name = $name)
    ORDER BY s.file, e.line
  `).all({ name: symbolName }) as Record<string, unknown>[];

  return rows.map((row) => ({
    caller: rowToSymbol(row),
    line:   (row["ref_line"] as number | null) ?? (row["line"] as number),
  }));
}

/**
 * Find all symbols that implement the given interface/base class.
 */
export async function getImplementations(
  db: Database.Database,
  symbolName: string,
): Promise<DefinitionResult[]> {
  const rows = db.prepare(`
    SELECT DISTINCT s.id, s.name, s.kind, s.file, s.line, s.signature, s.docstring
    FROM edges e
    JOIN symbols s ON s.id = e.from_symbol
    WHERE e.to_symbol IN (SELECT id FROM symbols WHERE name = $name)
      AND e.kind = 'implements'
    ORDER BY s.file, s.line
  `).all({ name: symbolName }) as Record<string, unknown>[];

  return rows.map((row) => ({ symbol: rowToSymbol(row) }));
}

/**
 * Return all symbols defined in a given file, ordered by line number.
 */
export async function getFileSymbols(
  db: Database.Database,
  filePath: string,
): Promise<Symbol[]> {
  const rows = db.prepare(
    `SELECT * FROM symbols WHERE file = $file ORDER BY line`
  ).all({ file: filePath }) as Record<string, unknown>[];

  return rows.map(rowToSymbol);
}

/**
 * Return all symbols defined in files under a given directory, ordered by file + line.
 */
export async function getDirectorySymbols(
  db: Database.Database,
  dirPath: string,
): Promise<Symbol[]> {
  const prefix = dirPath.replace(/\/$/, "") + "/";
  const rows = db.prepare(
    `SELECT * FROM symbols WHERE file LIKE $prefix ORDER BY file, line`
  ).all({ prefix: prefix + "%" }) as Record<string, unknown>[];
  return rows.map(rowToSymbol);
}

/**
 * Fuzzy symbol search — returns all symbols whose name contains the query string.
 */
export async function findSymbol(
  db: Database.Database,
  query: string,
  limit = 50,
): Promise<Symbol[]> {
  const rows = db.prepare(`
    SELECT * FROM symbols
    WHERE name LIKE $pattern
    ORDER BY
      CASE WHEN name = $exact THEN 0
           WHEN name LIKE $prefix THEN 1
           ELSE 2 END,
      name
    LIMIT $limit
  `).all({
    pattern: `%${query}%`,
    exact:   query,
    prefix:  `${query}%`,
    limit,
  }) as Record<string, unknown>[];
  return rows.map(rowToSymbol);
}

/**
 * Return all symbols (in other files) that import the given file.
 */
export async function getImporters(
  db: Database.Database,
  filePath: string,
): Promise<{ symbol: Symbol; line: number }[]> {
  const rows = db.prepare(`
    SELECT
      s.id, s.name, s.kind, s.file, s.line, s.signature, s.docstring,
      e.line AS import_line
    FROM edges e
    JOIN symbols s ON s.id = e.from_symbol
    WHERE e.kind = 'imports'
      AND e.to_symbol IN (SELECT id FROM symbols WHERE file = $file OR file = $absFile)
    GROUP BY s.file
    ORDER BY s.file
  `).all({ file: filePath, absFile: filePath }) as Record<string, unknown>[];
  return rows.map((row) => ({
    symbol: rowToSymbol(row),
    line:   (row["import_line"] as number | null) ?? (row["line"] as number),
  }));
}

/**
 * Find all indexed files whose path matches a glob-style pattern.
 * Supports * (any chars except /) and ** (any chars including /).
 */
export async function searchFiles(
  db: Database.Database,
  pattern: string,
): Promise<string[]> {
  // Convert glob pattern to SQL LIKE pattern
  const sqlPattern = pattern
    .replace(/%/g, "\\%")   // escape existing % 
    .replace(/\*\*/g, "%")  // ** → %
    .replace(/\*/g, "%");   // * → %

  const rows = db.prepare(
    `SELECT DISTINCT file FROM symbols WHERE file LIKE $pattern ESCAPE '\\' ORDER BY file`
  ).all({ pattern: sqlPattern }) as { file: string }[];

  return rows.map((r) => r.file);
}

/**
 * Best-effort: find the type/interface a symbol references.
 */
export async function getTypeDefinition(
  db: Database.Database,
  symbolName: string,
): Promise<DefinitionResult[]> {
  const rows = db.prepare(`
    SELECT DISTINCT s.id, s.name, s.kind, s.file, s.line, s.signature, s.docstring
    FROM edges e
    JOIN symbols s ON s.id = e.to_symbol
    WHERE e.from_symbol IN (SELECT id FROM symbols WHERE name = $name)
      AND e.kind = 'references'
      AND (
        s.signature LIKE '%interface %'
        OR s.signature LIKE '%type %'
        OR s.kind = 'class'
      )
    ORDER BY s.file, s.line
    LIMIT 20
  `).all({ name: symbolName }) as Record<string, unknown>[];

  return rows.map((row) => ({ symbol: rowToSymbol(row) }));
}

/**
 * Like getDefinition but skips barrel/index files.
 */
export async function getSourceDefinition(
  db: Database.Database,
  name: string,
  file?: string,
): Promise<DefinitionResult | null> {
  const base = `
    SELECT * FROM symbols
    WHERE name = $name
      AND file NOT LIKE '%/index.ts'
      AND file NOT LIKE '%/index.js'
      AND file NOT LIKE '%/index.mts'
      AND file NOT LIKE '%/index.mjs'
  `;

  const row = file
    ? db.prepare(base + ` AND file = $file LIMIT 1`).get({ name, file }) as Record<string, unknown> | undefined
    : db.prepare(base + ` LIMIT 1`).get({ name }) as Record<string, unknown> | undefined;

  if (!row) return null;
  return { symbol: rowToSymbol(row) };
}

/**
 * BFS over 'calls' edges to find the shortest call chain between two symbols.
 * Loads all calls edges into an in-process Map once, then runs BFS.
 */
export async function getCallPath(
  db: Database.Database,
  fromName: string,
  toName: string,
): Promise<CallPath | null> {
  const MAX_DEPTH = 12;

  // ── Load all calls edges into adjacency list ──────────────────────────────
  const edgeRows = db.prepare(
    `SELECT from_symbol, to_symbol, line FROM edges WHERE kind = 'calls'`
  ).all() as { from_symbol: string; to_symbol: string; line: number | null }[];

  const adj = new Map<string, Array<{ to: string; line: number | undefined }>>();
  for (const row of edgeRows) {
    let bucket = adj.get(row.from_symbol);
    if (!bucket) { bucket = []; adj.set(row.from_symbol, bucket); }
    bucket.push({ to: row.to_symbol, line: row.line ?? undefined });
  }

  // ── Resolve start/end symbol IDs ─────────────────────────────────────────
  const startIds = (
    db.prepare(`SELECT id FROM symbols WHERE name = $name`).all({ name: fromName }) as { id: string }[]
  ).map((r) => r.id);

  if (startIds.length === 0) return null;

  const endIds = new Set(
    (db.prepare(`SELECT id FROM symbols WHERE name = $name`).all({ name: toName }) as { id: string }[])
      .map((r) => r.id),
  );

  if (endIds.size === 0) return null;

  // ── BFS ───────────────────────────────────────────────────────────────────
  type QItem = { id: string; symbolPath: string[]; edgePath: Edge[] };

  const visited = new Set<string>(startIds);
  const queue: QItem[] = startIds.map((id) => ({ id, symbolPath: [id], edgePath: [] }));

  let foundPath: { symbolIds: string[]; edges: Edge[] } | null = null;

  bfs: while (queue.length > 0) {
    const item = queue.shift()!;

    if (endIds.has(item.id)) {
      foundPath = { symbolIds: item.symbolPath, edges: item.edgePath };
      break bfs;
    }

    if (item.symbolPath.length >= MAX_DEPTH) continue;

    for (const next of adj.get(item.id) ?? []) {
      if (!visited.has(next.to)) {
        visited.add(next.to);
        queue.push({
          id:         next.to,
          symbolPath: [...item.symbolPath, next.to],
          edgePath:   [
            ...item.edgePath,
            { from: item.id, to: next.to, kind: "calls", line: next.line },
          ],
        });
      }
    }
  }

  if (!foundPath) return null;

  // ── Resolve symbol IDs → Symbol objects ──────────────────────────────────
  const ids = foundPath.symbolIds;
  const placeholders = ids.map((_, i) => `$id${i}`).join(", ");
  const idParams: Record<string, string> = {};
  ids.forEach((id, i) => { idParams[`id${i}`] = id; });

  const symRows = db.prepare(
    `SELECT * FROM symbols WHERE id IN (${placeholders})`
  ).all(idParams) as Record<string, unknown>[];

  const symMap = new Map(symRows.map((row) => [row["id"] as string, rowToSymbol(row)]));
  const symbols = ids.map((id) => symMap.get(id)).filter((s): s is Symbol => s !== undefined);

  return { symbols, edges: foundPath.edges };
}

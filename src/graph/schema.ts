// SQLite DDL for the ariadne graph store.
// All table creation is idempotent (CREATE TABLE IF NOT EXISTS).

// WITHOUT ROWID: stores rows in a B-tree keyed directly by the TEXT primary
// key, eliminating the secondary index lookup rowid→row.  ~2× faster on PK
// lookups and ~50% smaller on disk for TEXT-heavy rows like SCIP symbol IDs.
export const CREATE_SYMBOLS_TABLE = `
CREATE TABLE IF NOT EXISTS symbols (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  kind      TEXT NOT NULL,
  file      TEXT NOT NULL,
  line      INTEGER NOT NULL,
  signature TEXT,
  docstring TEXT
) WITHOUT ROWID`;

// Edges use a composite PRIMARY KEY for deduplication.
// No separate id column — the (from, to, kind) triple is the natural key.
export const CREATE_EDGES_TABLE = `
CREATE TABLE IF NOT EXISTS edges (
  from_symbol TEXT NOT NULL,
  to_symbol   TEXT NOT NULL,
  kind        TEXT NOT NULL,
  line        INTEGER,
  PRIMARY KEY (from_symbol, to_symbol, kind)
)`;

export const CREATE_META_TABLE = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID`;

// Extra indexes — PRIMARY KEY already covers from_symbol on edges;
// add to_symbol and kind for reverse lookups and kind filters.
export const INDEX_STATEMENTS = [
  `CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name)`,
  `CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file)`,
  `CREATE INDEX IF NOT EXISTS idx_edges_to     ON edges(to_symbol)`,
  `CREATE INDEX IF NOT EXISTS idx_edges_kind   ON edges(kind)`,
];

export const ALL_SCHEMA_STATEMENTS = [
  CREATE_SYMBOLS_TABLE,
  CREATE_EDGES_TABLE,
  CREATE_META_TABLE,
  ...INDEX_STATEMENTS,
];

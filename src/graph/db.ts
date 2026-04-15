// Singleton better-sqlite3 connection for the lifetime of the process.
import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { ALL_SCHEMA_STATEMENTS } from "./schema.js";

// Re-export the Database type so other modules import from here instead of
// directly from better-sqlite3 (keeps the DuckDB→SQLite swap transparent).
export type { Database };

let _db: Database.Database | null = null;

/**
 * Open (or create) the graph database at <repoRoot>/.ariadne/graph.db.
 * Applies WAL mode, safety PRAGMAs, and runs all schema statements.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export async function init(repoRoot: string): Promise<void> {
  if (_db) return;

  const ariadneDir = path.join(repoRoot, ".ariadne");
  await fs.mkdir(ariadneDir, { recursive: true });

  const dbPath = path.join(ariadneDir, "graph.db");
  const db = new Database(dbPath);

  // WAL mode: multiple concurrent readers never block each other, and readers
  // don't block the writer.  Auto-recovers the WAL on open after a crash —
  // no manual CHECKPOINT required unlike DuckDB.
  db.pragma("journal_mode = WAL");
  // NORMAL: safe on crash (no corruption), only risks losing the last partial
  // uncommitted transaction — acceptable for an index that can be rebuilt.
  db.pragma("synchronous = NORMAL");
  // Wait up to 5 s before throwing SQLITE_BUSY instead of failing immediately.
  db.pragma("busy_timeout = 5000");
  // 64 MB page cache in memory.
  db.pragma("cache_size = -64000");
  // Keep temp tables in memory.
  db.pragma("temp_store = MEMORY");
  // 256 MB memory-mapped I/O for faster reads on large DBs.
  db.pragma("mmap_size = 268435456");

  for (const sql of ALL_SCHEMA_STATEMENTS) {
    db.exec(sql);
  }

  _db = db;
}

/**
 * Returns the active SQLite database.
 * Throws if init() has not been called yet.
 */
export function getDb(): Database.Database {
  if (!_db) throw new Error("DB not initialised — call init() first");
  return _db;
}

/**
 * Close the database synchronously.
 */
export function close(): void {
  if (!_db) return;
  _db.close();
  _db = null;
}

/**
 * Close the DB, delete all related files (graph.db, WAL, SHM), then reopen
 * a fresh empty database.  Used before a full re-index so stale data from a
 * prior partial load doesn't persist.
 *
 * SQLite WAL files are named graph.db-wal and graph.db-shm (unlike DuckDB).
 */
export async function wipAndReinit(repoRoot: string): Promise<void> {
  const ariadneDir = path.join(repoRoot, ".ariadne");
  const dbPath = path.join(ariadneDir, "graph.db");

  close();

  await Promise.all([
    fs.rm(dbPath,            { force: true }),
    fs.rm(dbPath + "-wal",   { force: true }),
    fs.rm(dbPath + "-shm",   { force: true }),
  ]);

  await init(repoRoot);
}

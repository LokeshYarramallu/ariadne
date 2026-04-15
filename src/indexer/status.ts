/**
 * In-process indexer status — updated by runIndexer(), read by get_index_status tool.
 *
 * All fields live in a single mutable object so the MCP tool can always return
 * a snapshot without any async coordination.
 */

export type IndexState =
  | "starting"     // process just launched, nothing done yet
  | "detecting"    // scanning for Python / TypeScript / JavaScript files
  | "scip-running" // scip-typescript / scip-python subprocess is running
  | "loading"      // reading .scip protobuf into SQLite
  | "ready"        // index fully loaded, watcher active
  | "error";       // unrecoverable error during indexing

export interface IndexStatus {
  state: IndexState;
  /** Human-readable description of what's happening right now. */
  phase: string;
  /** Languages detected in the repo. */
  languages: string[];
  /** Symbols in the DB at last count (0 while indexing). */
  symbolCount: number;
  /** Edges in the DB at last count. */
  edgeCount: number;
  /** Wall-clock ms since indexing started. */
  elapsedMs: number;
  /** Non-null if state === "error". */
  errorMessage: string | null;
}

const _startedAt = Date.now();

const _status: IndexStatus = {
  state:        "starting",
  phase:        "Ariadne is initialising…",
  languages:    [],
  symbolCount:  0,
  edgeCount:    0,
  elapsedMs:    0,
  errorMessage: null,
};

export function setStatus(patch: Partial<Omit<IndexStatus, "elapsedMs">>): void {
  Object.assign(_status, patch);
  _status.elapsedMs = Date.now() - _startedAt;
}

export function getStatus(): IndexStatus {
  // Always refresh elapsed before returning
  _status.elapsedMs = Date.now() - _startedAt;
  return { ..._status };
}

/**
 * Master indexing orchestrator.
 *
 * Called once at startup.  Detects languages, runs the appropriate SCIP
 * indexers automatically, loads the resulting .scip files into SQLite, then
 * starts the tree-sitter file watcher for incremental updates.
 *
 * All progress goes to stderr so it never touches the MCP stdio channel.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { getDb, wipAndReinit } from "../graph/db.js";
import { detectLanguages } from "./detector.js";
import { runPythonIndexer, runTypescriptIndexer } from "./scip-runner.js";
import { loadScipIndex } from "./scip-reader.js";
import { startWatcher } from "./watcher.js";
import { setStatus } from "./status.js";

function log(msg: string): void {
  process.stderr.write(msg + "\n");
}

/**
 * Check whether a given SCIP file is newer than the DB or the DB is empty.
 * Does NOT wipe — just reports whether a reload is needed.
 */
async function scipIsStale(repoPath: string, scipPath: string): Promise<boolean> {
  let scipMtime: number;
  try {
    scipMtime = (await fs.stat(scipPath)).mtimeMs;
  } catch {
    return true; // no SCIP file yet → need to run indexer
  }

  const dbPath = path.join(repoPath, ".ariadne", "graph.db");
  let dbMtime: number;
  try {
    dbMtime = (await fs.stat(dbPath)).mtimeMs;
  } catch {
    return true; // no DB yet
  }

  if (scipMtime > dbMtime) return true;

  try {
    const db = getDb();
    const r = db.prepare("SELECT COUNT(*) AS n FROM symbols").get() as { n: number } | undefined;
    if (r == null || r.n === 0) return true;
  } catch {
    return true;
  }

  return false;
}

export async function runIndexer(): Promise<void> {
  const repoPath = process.cwd();

  // ── 1. Language detection ─────────────────────────────────────────────────
  setStatus({ state: "detecting", phase: "Detecting languages…" });
  log("→ Detecting languages...");
  const langs = await detectLanguages(repoPath);

  const detected: string[] = [];
  if (langs.python)     detected.push("Python");
  if (langs.typescript) detected.push("TypeScript");
  if (langs.javascript) detected.push("JavaScript");

  setStatus({ languages: detected });

  if (detected.length === 0) {
    setStatus({ state: "ready", phase: "No supported languages found — graph is empty.", symbolCount: 0, edgeCount: 0 });
    log("→ No supported languages detected — starting with empty graph.");
    log("→ Ariadne ready.");
    return;
  }

  log(`→ Found: ${detected.join(", ")}`);

  // ── 2. Run all SCIP indexers, collect paths ───────────────────────────────
  // We collect ALL scip paths first, then decide once whether to wipe+reload.
  // This prevents wipAndReinit() being called between languages, which would
  // erase symbols from a previously loaded language (e.g. Python wiped by TS).

  const scipPaths: string[] = [];

  if (langs.python) {
    try {
      setStatus({ state: "scip-running", phase: "Running scip-python… (first run installs it via pip)" });
      const p = await runPythonIndexer(repoPath);
      scipPaths.push(p);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`→ Python indexing failed: ${msg}`);
      log("   (Ariadne will continue without Python symbols)");
    }
  }

  if (langs.typescript || langs.javascript) {
    try {
      setStatus({
        state: "scip-running",
        phase: "Running scip-typescript… (first run may take 5–10 min for large repos)",
      });
      const p = await runTypescriptIndexer(repoPath);
      scipPaths.push(p);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`→ TypeScript/JavaScript indexing failed: ${msg}`);
      log("   (Ariadne will continue without TypeScript/JavaScript symbols)");
    }
  }

  if (scipPaths.length === 0) {
    setStatus({ state: "ready", phase: "All indexers failed — graph is empty.", symbolCount: 0, edgeCount: 0 });
    log("→ Ariadne ready (no symbols).");
    return;
  }

  // ── 3. Decide once whether to wipe + reload ───────────────────────────────
  // If ANY scip file is newer than the DB, wipe once and reload everything.
  // This keeps all languages in a single consistent DB snapshot.

  const anyStale = (
    await Promise.all(scipPaths.map((p) => scipIsStale(repoPath, p)))
  ).some(Boolean);

  let totalSymbols = 0;
  let totalEdges   = 0;

  if (anyStale) {
    setStatus({ state: "loading", phase: "Loading symbols into graph…" });
    log("→ Loading index...");

    // Wipe ONCE before loading all languages
    await wipAndReinit(repoPath);

    for (const scipPath of scipPaths) {
      const label = scipPath.includes("python") ? "Python" : "TypeScript/JavaScript";
      log(`→ Loading ${label} symbols…`);
      try {
        const result = await loadScipIndex(getDb(), scipPath, repoPath);
        totalSymbols += result.symbolCount;
        totalEdges   += result.edgeCount;
        log(`→ ${label} ready: ${result.symbolCount.toLocaleString()} symbols`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`→ Failed to load ${label} symbols: ${msg}`);
      }
    }

    setStatus({ symbolCount: totalSymbols, edgeCount: totalEdges });
  } else {
    log("→ Index up to date — skipping reload.");
    try {
      const db = getDb();
      const rs = db.prepare("SELECT COUNT(*) AS n FROM symbols").get() as { n: number } | undefined;
      totalSymbols = rs?.n ?? 0;
      const re = db.prepare("SELECT COUNT(*) AS n FROM edges").get() as { n: number } | undefined;
      totalEdges = re?.n ?? 0;
    } catch { /* non-fatal */ }
  }

  // ── 4. Summary ────────────────────────────────────────────────────────────
  log(`→ Graph ready: ${totalSymbols.toLocaleString()} symbols, ${totalEdges.toLocaleString()} edges`);

  setStatus({
    state:       "ready",
    phase:       "Index fully loaded. File watcher active for incremental updates.",
    symbolCount: totalSymbols,
    edgeCount:   totalEdges,
  });

  // ── 5. Start incremental watcher ──────────────────────────────────────────
  startWatcher(getDb(), repoPath);

  log("→ Ariadne ready.");
}

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

/** Check whether the DB already has symbols AND is not stale vs the SCIP file. */
async function needsReload(repoPath: string, scipPath: string): Promise<boolean> {
  let scipMtime: number;
  try {
    scipMtime = (await fs.stat(scipPath)).mtimeMs;
  } catch {
    return true; // no SCIP yet
  }

  const dbPath = path.join(repoPath, ".ariadne", "graph.db");
  let dbMtime: number;
  try {
    dbMtime = (await fs.stat(dbPath)).mtimeMs;
  } catch {
    return true; // no DB file
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

  // ── 1. Language detection ────────────────────────────────────────────────
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

  // ── 2. Run SCIP indexers (conditionally) ─────────────────────────────────
  let totalSymbols = 0;
  let totalEdges   = 0;

  if (langs.python) {
    try {
      setStatus({ state: "scip-running", phase: "Running scip-python… (first run installs it via pip)" });
      const scipPath = await runPythonIndexer(repoPath);

      if (await needsReload(repoPath, scipPath)) {
        setStatus({ state: "loading", phase: "Loading Python symbols into graph…" });
        log("→ Loading Python index...");
        await wipAndReinit(repoPath);
        const result = await loadScipIndex(getDb(), scipPath, repoPath);
        totalSymbols += result.symbolCount;
        totalEdges   += result.edgeCount;
        setStatus({ symbolCount: totalSymbols, edgeCount: totalEdges });
        log(`→ Python ready: ${result.symbolCount.toLocaleString()} symbols`);
      } else {
        log("→ Python index up to date — skipping reload.");
      }
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
      const scipPath = await runTypescriptIndexer(repoPath);

      if (await needsReload(repoPath, scipPath)) {
        setStatus({ state: "loading", phase: "Loading TypeScript/JavaScript symbols into graph…" });
        log("→ Loading TypeScript/JavaScript index...");
        await wipAndReinit(repoPath);
        const result = await loadScipIndex(getDb(), scipPath, repoPath);
        totalSymbols += result.symbolCount;
        totalEdges   += result.edgeCount;
        setStatus({ symbolCount: totalSymbols, edgeCount: totalEdges });
        log(`→ TypeScript/JavaScript ready: ${result.symbolCount.toLocaleString()} symbols`);
      } else {
        log("→ TypeScript/JavaScript index up to date — skipping reload.");
        try {
          const db = getDb();
          const rs = db.prepare("SELECT COUNT(*) AS n FROM symbols").get() as { n: number } | undefined;
          totalSymbols += rs?.n ?? 0;
          const re = db.prepare("SELECT COUNT(*) AS n FROM edges").get() as { n: number } | undefined;
          totalEdges += re?.n ?? 0;
        } catch { /* non-fatal */ }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus({ state: "error", phase: `TypeScript/JavaScript indexing failed: ${msg}`, errorMessage: msg });
      log(`→ TypeScript/JavaScript indexing failed: ${msg}`);
      log("   (Ariadne will continue without TypeScript/JavaScript symbols)");
    }
  }

  // ── 3. Summary ───────────────────────────────────────────────────────────
  log(`→ Graph ready: ${totalSymbols.toLocaleString()} symbols, ${totalEdges.toLocaleString()} edges`);

  setStatus({
    state:       "ready",
    phase:       "Index fully loaded. File watcher active for incremental updates.",
    symbolCount: totalSymbols,
    edgeCount:   totalEdges,
  });

  // ── 4. Start incremental watcher ─────────────────────────────────────────
  startWatcher(getDb(), repoPath);

  log("→ Ariadne ready.");
}

// Scans a repo directory and reports which supported languages are present.
import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

export interface DetectedLanguages {
  python: boolean;
  typescript: boolean;
  javascript: boolean;
}

// Directories to skip during the walk — these either are never source or
// contain millions of files that make the scan unbearably slow.
const SKIP_DIRS = new Set([
  ".git", "node_modules", ".ariadne", "dist", "build", "out",
  "__pycache__", ".venv", "venv", ".env", ".tox", ".mypy_cache",
  "coverage", ".next", ".nuxt", "target",
]);

const PY_EXTS  = new Set([".py"]);
const TS_EXTS  = new Set([".ts", ".tsx", ".mts", ".cts"]);
const JS_EXTS  = new Set([".js", ".jsx", ".mjs", ".cjs"]);

interface ScanResult {
  hasPython: boolean;
  hasTypeScript: boolean;
  hasJavaScript: boolean;
}

async function scan(dir: string, depth: number, result: ScanResult): Promise<void> {
  if (depth > 4) return; // limit scan depth for performance
  if (result.hasPython && result.hasTypeScript) return; // found everything, stop early

  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // permission error or race condition — skip
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        await scan(path.join(dir, entry.name), depth + 1, result);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (PY_EXTS.has(ext)) result.hasPython = true;
      else if (TS_EXTS.has(ext)) result.hasTypeScript = true;
      else if (JS_EXTS.has(ext)) result.hasJavaScript = true;
    }
  }
}

/**
 * Scan repoPath (up to 4 directory levels deep) and detect which languages
 * have source files present.
 *
 * TypeScript and JavaScript are treated as mutually exclusive for indexer
 * selection: if .ts/.tsx files exist, scip-typescript covers everything (it
 * also indexes .js files).  The `javascript` flag is only set when there are
 * .js files but no .ts files.
 */
export async function detectLanguages(repoPath: string): Promise<DetectedLanguages> {
  const result: ScanResult = { hasPython: false, hasTypeScript: false, hasJavaScript: false };
  await scan(repoPath, 0, result);

  return {
    python: result.hasPython,
    typescript: result.hasTypeScript,
    // Only surface plain JS if there are no TS files — scip-typescript handles
    // both when a tsconfig exists; for JS-only repos we still run it.
    javascript: result.hasJavaScript && !result.hasTypeScript,
  };
}

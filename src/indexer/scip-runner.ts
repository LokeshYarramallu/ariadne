/**
 * Runs SCIP indexers against the repo, installing them if they are absent.
 *
 * All subprocess stdout/stderr is forwarded to our stderr so it never
 * corrupts the MCP stdio stream (which owns stdout after startup).
 *
 * scip-python:     npm package  (@sourcegraph/scip-python)  — via npx
 * scip-typescript: npm package  (@sourcegraph/scip-typescript) — via npx
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// Low-level subprocess helpers
// ---------------------------------------------------------------------------

/**
 * Spawn a command, pipe its stdout+stderr to our stderr, and resolve when it
 * exits 0 — or reject with a descriptive error on non-zero exit.
 */
function runSubprocess(
  command: string,
  args: string[],
  cwd: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Forward output to our stderr so it never touches stdout (MCP channel)
    proc.stdout?.on("data", (d: Buffer) => process.stderr.write(d));
    proc.stderr?.on("data", (d: Buffer) => process.stderr.write(d));

    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`\`${command} ${args.join(" ")}\` exited with code ${code}`));
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn \`${command}\`: ${err.message}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Python indexer (@sourcegraph/scip-python)
// ---------------------------------------------------------------------------

/**
 * Run the Python SCIP indexer against repoPath.
 * Uses npx so no global install is required — npx caches on first run.
 *
 * scip-python requires package metadata to construct symbol identifiers.
 * If no pyproject.toml / setup.py / setup.cfg exists we create a minimal
 * pyproject.toml before indexing and delete it afterwards.
 *
 * Returns the path to the generated .scip file.
 */
export async function runPythonIndexer(repoPath: string): Promise<string> {
  const outputPath = path.join(repoPath, ".ariadne", "index-python.scip");

  // ── Ensure package metadata exists ───────────────────────────────────────
  const metadataFiles = ["pyproject.toml", "setup.py", "setup.cfg"];
  const hasMetadata = (
    await Promise.all(
      metadataFiles.map((f) =>
        fs.access(path.join(repoPath, f)).then(() => true).catch(() => false),
      ),
    )
  ).some(Boolean);

  const syntheticPyproject = path.join(repoPath, "pyproject.toml");
  let createdSynthetic = false;

  if (!hasMetadata) {
    const content = `[project]\nname = "ariadne-index-target"\nversion = "0.1.0"\n`;
    await fs.writeFile(syntheticPyproject, content, "utf8");
    createdSynthetic = true;
  }

  // ── Run indexer, clean up synthetic file regardless of outcome ───────────
  // If a fresh SCIP file already exists (< 24 h old), skip re-indexing.
  try {
    const stat = await fs.stat(outputPath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < 24 * 60 * 60 * 1000) {
      process.stderr.write("→ Reusing existing Python SCIP index (< 24 h old).\n");
      if (createdSynthetic) await fs.unlink(syntheticPyproject).catch(() => {});
      return outputPath;
    }
  } catch {
    // File doesn't exist yet — proceed to index
  }

  process.stderr.write("→ Indexing Python files...\n");
  try {
    // npx --yes auto-installs the package if not cached
    await runSubprocess(
      "npx",
      ["--yes", "@sourcegraph/scip-python", "index", ".", "--output", outputPath],
      repoPath,
    );
    await fs.access(outputPath);
  } finally {
    if (createdSynthetic) {
      await fs.unlink(syntheticPyproject).catch(() => {/* ignore if already gone */});
    }
  }

  return outputPath;
}

// ---------------------------------------------------------------------------
// TypeScript / JavaScript indexer (@sourcegraph/scip-typescript)
// ---------------------------------------------------------------------------

type MonorepoStrategy =
  | { kind: "pnpm-workspaces" }
  | { kind: "yarn-workspaces" }
  | { kind: "tsconfig-root"; tsconfig: string }
  | { kind: "fallback" };

async function fileExists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true).catch(() => false);
}

/**
 * Detect the best indexing strategy for the repo.
 *
 * Tier 1: pnpm-workspace.yaml  → --pnpm-workspaces (native, single run)
 * Tier 2: package.json#workspaces or lerna.json → --yarn-workspaces
 * Tier 3: root tsconfig.json (may have project references) → pass as positional arg
 * Tier 4: filesystem walk — find first tsconfig.json in common monorepo dirs
 * Tier 5: fallback (no tsconfig found, let scip-typescript try from root)
 */
async function detectStrategy(repoPath: string): Promise<MonorepoStrategy> {
  // Tier 1: pnpm workspaces
  if (await fileExists(path.join(repoPath, "pnpm-workspace.yaml"))) {
    return { kind: "pnpm-workspaces" };
  }

  // Tier 2: yarn/npm workspaces or lerna
  if (await fileExists(path.join(repoPath, "lerna.json"))) {
    return { kind: "yarn-workspaces" };
  }
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(repoPath, "package.json"), "utf8"));
    if (pkg.workspaces) return { kind: "yarn-workspaces" };
  } catch { /* no package.json */ }

  // Tier 3: root tsconfig.json (handles project references automatically)
  const rootTsconfig = path.join(repoPath, "tsconfig.json");
  if (await fileExists(rootTsconfig)) {
    return { kind: "tsconfig-root", tsconfig: rootTsconfig };
  }

  // Tier 4: search one level deep in common monorepo dirs
  const searchDirs = ["packages", "apps", "applications", "src"];
  for (const dir of searchDirs) {
    let entries: string[];
    try { entries = await fs.readdir(path.join(repoPath, dir)); } catch { continue; }
    for (const entry of entries) {
      const candidate = path.join(repoPath, dir, entry, "tsconfig.json");
      if (await fileExists(candidate)) {
        return { kind: "tsconfig-root", tsconfig: candidate };
      }
    }
  }

  return { kind: "fallback" };
}

/**
 * Run the TypeScript/JavaScript SCIP indexer against repoPath.
 * Auto-detects monorepo type and uses the appropriate scip-typescript flags.
 * Returns the path to the generated .scip file.
 */
export async function runTypescriptIndexer(repoPath: string): Promise<string> {
  const outputPath = path.join(repoPath, ".ariadne", "index-ts.scip");

  // Reuse fresh index (< 24 h old)
  try {
    const ageMs = Date.now() - (await fs.stat(outputPath)).mtimeMs;
    if (ageMs < 24 * 60 * 60 * 1000) {
      process.stderr.write("→ Reusing existing TypeScript SCIP index (< 24 h old).\n");
      return outputPath;
    }
  } catch { /* no existing index */ }

  const strategy = await detectStrategy(repoPath);
  const baseArgs = ["--yes", "@sourcegraph/scip-typescript", "index",
                    "--cwd", repoPath, "--output", outputPath];

  let args: string[];
  switch (strategy.kind) {
    case "pnpm-workspaces":
      process.stderr.write("→ Indexing TypeScript/JavaScript files (pnpm workspaces)...\n");
      args = [...baseArgs, "--pnpm-workspaces"];
      break;
    case "yarn-workspaces":
      process.stderr.write("→ Indexing TypeScript/JavaScript files (yarn/npm workspaces)...\n");
      args = [...baseArgs, "--yarn-workspaces"];
      break;
    case "tsconfig-root": {
      const rel = path.relative(repoPath, strategy.tsconfig);
      process.stderr.write(`→ Indexing TypeScript/JavaScript files (tsconfig: ${rel})...\n`);
      args = [...baseArgs, strategy.tsconfig];
      break;
    }
    default:
      process.stderr.write("→ Indexing TypeScript/JavaScript files...\n");
      args = baseArgs;
  }

  await runSubprocess("npx", args, repoPath);
  await fs.access(outputPath);
  return outputPath;
}

/**
 * Smoke-test for the SCIP reader.
 *
 * Usage:
 *   npx tsx scripts/test-scip-reader.ts <path/to/index.scip> [repoRoot]
 *
 * The script loads the SCIP index into an in-memory DuckDB instance
 * (pointed at a temp .ariadne dir in the current working directory),
 * then prints symbol counts, edge counts, and a few sample rows.
 *
 * Generating a sample index.scip for testing:
 *
 *   Python repo:
 *     pip install scip-python
 *     scip-python index . --project-name myproject
 *     # produces index.scip in the current directory
 *
 *   TypeScript repo:
 *     npm install -g @sourcegraph/scip-typescript
 *     scip-typescript index
 *     # produces index.scip in the current directory
 */

import path from "node:path";
import { init, getDb, close } from "../src/graph/db.js";
import { clearAll } from "../src/graph/writer.js";
import { loadScipIndex } from "../src/indexer/scip-reader.js";

const scipPath = process.argv[2];
const repoRoot = process.argv[3] ?? process.cwd();

if (!scipPath) {
  console.error("Usage: npx tsx scripts/test-scip-reader.ts <index.scip> [repoRoot]");
  process.exit(1);
}

async function main(): Promise<void> {
  const absScipPath = path.resolve(scipPath);
  const absRepoRoot = path.resolve(repoRoot);

  console.log(`SCIP file : ${absScipPath}`);
  console.log(`Repo root : ${absRepoRoot}`);
  console.log("");

  // Use the CWD as the ariadne DB location
  await init(process.cwd());
  const db = getDb();

  // Start clean
  await clearAll(db);

  console.log("Loading SCIP index …");
  const start = Date.now();
  const result = await loadScipIndex(db, absScipPath, absRepoRoot);
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);

  console.log(`\n✓ Done in ${elapsed}s`);
  console.log(`  Symbols loaded    : ${result.symbolCount}`);
  console.log(`  Edges loaded      : ${result.edgeCount}`);
  console.log(`  Local syms skipped: ${result.skippedLocalSymbols}`);

  // ── Sample output ─────────────────────────────────────────────────────────

  // Show up to 10 symbols per kind
  const kindQuery = await db.runAndReadAll(
    `SELECT kind, COUNT(*) as cnt FROM symbols GROUP BY kind ORDER BY cnt DESC`,
  );
  console.log("\n── Symbol counts by kind ─────────────────────────────────────");
  for (const row of kindQuery.getRowObjects() as { kind: string; cnt: number }[]) {
    console.log(`  ${row.kind.padEnd(10)}: ${row.cnt}`);
  }

  const edgeKindQuery = await db.runAndReadAll(
    `SELECT kind, COUNT(*) as cnt FROM edges GROUP BY kind ORDER BY cnt DESC`,
  );
  console.log("\n── Edge counts by kind ───────────────────────────────────────");
  for (const row of edgeKindQuery.getRowObjects() as { kind: string; cnt: number }[]) {
    console.log(`  ${row.kind.padEnd(10)}: ${row.cnt}`);
  }

  // Print 5 sample function/method symbols
  const sampleSymbols = await db.runAndReadAll(
    `SELECT name, kind, file, line, signature
     FROM symbols
     WHERE kind IN ('function', 'method')
     ORDER BY file, line
     LIMIT 5`,
  );
  console.log("\n── Sample function/method symbols ────────────────────────────");
  for (const row of sampleSymbols.getRowObjects() as {
    name: string; kind: string; file: string; line: number; signature?: string;
  }[]) {
    const loc = `${row.file}:${row.line}`;
    console.log(`  [${row.kind.padEnd(8)}] ${row.name.padEnd(24)} ${loc}`);
    if (row.signature) console.log(`             sig: ${row.signature.split("\n")[0]}`);
  }

  // Print 5 sample call edges
  const sampleEdges = await db.runAndReadAll(
    `SELECT e.kind, s1.name as from_name, s1.kind as from_kind,
            s2.name as to_name, s2.kind as to_kind, e.line
     FROM edges e
     JOIN symbols s1 ON s1.id = e.from_symbol
     JOIN symbols s2 ON s2.id = e.to_symbol
     WHERE e.kind = 'calls'
     LIMIT 5`,
  );
  console.log("\n── Sample call edges ─────────────────────────────────────────");
  for (const row of sampleEdges.getRowObjects() as {
    kind: string; from_name: string; from_kind: string;
    to_name: string; to_kind: string; line: number;
  }[]) {
    console.log(`  ${row.from_name} (${row.from_kind}) → ${row.to_name} (${row.to_kind}) :${row.line}`);
  }

  await close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

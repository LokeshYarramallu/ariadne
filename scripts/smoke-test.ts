/**
 * Smoke test: initialises the DB, loads the ariadne repo's own SCIP index,
 * then calls every tool handler and asserts each returns a non-error string.
 *
 * Run with: npx tsx scripts/smoke-test.ts
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { init, getDb } from "../src/graph/db.js";
import { loadScipIndex } from "../src/indexer/scip-reader.js";
import {
  handleGetDefinition,
  handleGetCallers,
  handleGetCallees,
  handleGetReferences,
  handleGetFileSymbols,
  handleGetIndexStatus,
  handleFindSymbol,
  handleGetImporters,
  handleSearchFiles,
} from "../src/tools/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scipPath = path.join(repoRoot, ".ariadne", "index-ts.scip");

let passed = 0;
let failed = 0;

function assert(name: string, value: string) {
  const isError =
    value.startsWith("No ") === false &&
    (value.includes("Error") || value.includes("not initialised"));
  // "No X found" is a valid empty result, not an error
  const isEmpty = value.startsWith("No ");
  if (isError) {
    console.error(`  ✗ ${name}: ${value.slice(0, 120)}`);
    failed++;
  } else {
    console.log(`  ✓ ${name}${isEmpty ? " (empty)" : ""}`);
    passed++;
  }
}

async function run() {
  console.log("→ Initialising DB...");
  await init(repoRoot);
  const db = getDb();

  console.log("→ Loading SCIP index...");
  const { symbolCount } = await loadScipIndex(db, scipPath, repoRoot);
  console.log(`  Loaded ${symbolCount} symbols\n`);

  if (symbolCount === 0) {
    console.error("✗ No symbols loaded — run scip-typescript first");
    process.exit(1);
  }

  console.log("→ Running tool smoke tests...");

  assert("get_definition(createServer)",    await handleGetDefinition(db, { symbol: "createServer" }));
  assert("get_callers(createServer)",       await handleGetCallers(db, { symbol: "createServer" }));
  assert("get_callees(createServer)",       await handleGetCallees(db, { symbol: "createServer" }));
  assert("get_references(createServer)",    await handleGetReferences(db, { symbol: "createServer" }));
  assert("get_file_symbols(src/server.ts)", await handleGetFileSymbols(db, { file: path.join(repoRoot, "src/server.ts") }));
  assert("get_file_symbols(src/tools)",     await handleGetFileSymbols(db, { file: path.join(repoRoot, "src/tools") }));
  assert("get_file_symbols(query=create)",  await handleGetFileSymbols(db, { file: path.join(repoRoot, "src"), query: "create" }));
  assert("find_symbol(Server)",             await handleFindSymbol(db, { query: "Server" }));
  assert("get_importers(src/server.ts)",    await handleGetImporters(db, { file: path.join(repoRoot, "src/server.ts") }));
  assert("search_files(**/*.ts)",           await handleSearchFiles(db, { pattern: "**/*.ts" }));
  assert("get_index_status()",              handleGetIndexStatus());

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

/**
 * Smoke-test for the graph storage layer.
 * Run with: npx tsx scripts/test-db.ts
 *
 * Creates .ariadne/graph.db in the current directory, inserts two symbols
 * and one edge, then queries them back and prints the results.
 */
import { init, getDb, close } from "../src/graph/db.js";
import { upsertSymbol, upsertEdge, clearAll } from "../src/graph/writer.js";
import { getDefinition } from "../src/graph/queries.js";
import type { Symbol, Edge } from "../src/types/index.js";

const repoRoot = process.cwd();

async function main(): Promise<void> {
  console.log(`Initialising DB at ${repoRoot}/.ariadne/graph.db …`);
  await init(repoRoot);
  const db = getDb();

  // Start clean so the script is idempotent across runs
  await clearAll(db);

  // ── Insert two symbols ──────────────────────────────────────────────────
  const parseTokens: Symbol = {
    id: "src/lexer.py:parse_tokens:function",
    name: "parse_tokens",
    kind: "function",
    file: "src/lexer.py",
    line: 12,
    signature: "def parse_tokens(text: str) -> list[str]",
    docstring: "Split raw source text into a flat list of token strings.",
  };

  const tokenize: Symbol = {
    id: "src/lexer.py:tokenize:function",
    name: "tokenize",
    kind: "function",
    file: "src/lexer.py",
    line: 28,
    signature: "def tokenize(src: str) -> list[Token]",
  };

  await upsertSymbol(db, parseTokens);
  await upsertSymbol(db, tokenize);
  console.log("✓ Inserted 2 symbols");

  // ── Insert one edge (parse_tokens calls tokenize) ──────────────────────
  const edge: Edge = {
    from: parseTokens.id,
    to: tokenize.id,
    kind: "calls",
    line: 18,
  };

  await upsertEdge(db, edge);
  console.log("✓ Inserted 1 edge");

  // ── Query back ─────────────────────────────────────────────────────────
  console.log('\ngetDefinition("parse_tokens"):');
  const def = await getDefinition(db, "parse_tokens");
  console.log(JSON.stringify(def, null, 2));

  console.log('\ngetDefinition("tokenize", "src/lexer.py"):');
  const defWithFile = await getDefinition(db, "tokenize", "src/lexer.py");
  console.log(JSON.stringify(defWithFile, null, 2));

  console.log('\ngetDefinition("nonexistent"):');
  const missing = await getDefinition(db, "nonexistent");
  console.log(missing); // should print null

  await close();
  console.log("\n✓ Done — DB closed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

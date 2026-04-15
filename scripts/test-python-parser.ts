/**
 * Smoke-test for the Python language parser.
 *
 * Usage:
 *   npx tsx scripts/test-python-parser.ts <path/to/file.py>
 *
 * Example:
 *   npx tsx scripts/test-python-parser.ts scripts/sample.py
 */

import path from "node:path";
import { PythonParser } from "../src/indexer/languages/python.js";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: npx tsx scripts/test-python-parser.ts <file.py>");
  process.exit(1);
}

const absPath = path.resolve(filePath);

async function main(): Promise<void> {
  console.log(`Parsing: ${absPath}\n`);

  const parser = new PythonParser();
  const { symbols, edges } = await parser.parseFile(absPath);

  // ── Symbols ───────────────────────────────────────────────────────────────
  console.log(`═══ SYMBOLS (${symbols.length}) ${"═".repeat(50)}`);
  for (const s of symbols) {
    const tag = `[${s.kind.padEnd(8)}]`;
    const loc = `${path.relative(process.cwd(), s.file)}:${s.line}`;
    console.log(`${tag} ${s.name.padEnd(24)} ${loc}`);
    if (s.signature) console.log(`           sig: ${s.signature}`);
    if (s.docstring) console.log(`           doc: ${s.docstring.split("\n")[0]}`);
  }

  // ── Edges ─────────────────────────────────────────────────────────────────
  console.log(`\n═══ EDGES (${edges.length}) ${"═".repeat(52)}`);

  const symbolById = new Map(symbols.map((s) => [s.id, s]));

  for (const e of edges) {
    const fromSym = symbolById.get(e.from);
    const toSym = symbolById.get(e.to);

    const fromLabel = fromSym ? `${fromSym.name} (${fromSym.kind})` : e.from;
    const toLabel = toSym ? `${toSym.name} (${toSym.kind})` : e.to;
    const lineTag = e.line ? `:${e.line}` : "";

    console.log(`[${e.kind.padEnd(10)}] ${fromLabel.padEnd(30)} → ${toLabel}${lineTag}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n── Summary ──────────────────────────────────────────────────────────");
  const kindCounts = new Map<string, number>();
  for (const s of symbols) kindCounts.set(s.kind, (kindCounts.get(s.kind) ?? 0) + 1);
  for (const [kind, count] of [...kindCounts.entries()].sort())
    console.log(`  symbols.${kind}: ${count}`);
  const edgeCounts = new Map<string, number>();
  for (const e of edges) edgeCounts.set(e.kind, (edgeCounts.get(e.kind) ?? 0) + 1);
  for (const [kind, count] of [...edgeCounts.entries()].sort())
    console.log(`  edges.${kind}: ${count}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

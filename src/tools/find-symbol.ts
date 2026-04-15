// MCP tool: find_symbol
import type { Database } from "../graph/db.js";
import { findSymbol } from "../graph/queries.js";
import { fmtSymbol, cap } from "./format.js";

export const FIND_SYMBOL_TOOL = {
  name: "find_symbol",
  description: "Fuzzy search for symbols by name across the entire codebase. Use this when you don't know the exact symbol name — e.g. find_symbol('password') returns all symbols whose name contains 'password'. Replaces glob patterns like **/*password*.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Substring to search for in symbol names (case-insensitive)" },
    },
    required: ["query"],
  },
} as const;

export async function handleFindSymbol(
  db: Database.Database,
  args: { query: string },
): Promise<string> {
  const results = await findSymbol(db, args.query);
  if (results.length === 0) return `No symbols found matching "${args.query}".`;
  const { items, note } = cap(results, "symbols");
  const out = items.map(fmtSymbol);
  return JSON.stringify(note ? { note, symbols: out } : out, null, 2);
}

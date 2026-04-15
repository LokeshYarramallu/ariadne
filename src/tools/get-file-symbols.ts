// MCP tool: get_file_symbols
import path from "node:path";
import type { Database } from "../graph/db.js";
import { getFileSymbols, getDirectorySymbols } from "../graph/queries.js";
import { fmtSymbol, cap } from "./format.js";

export const GET_FILE_SYMBOLS_TOOL = {
  name: "get_file_symbols",
  description: "Return every symbol defined in a file or directory. Pass a file path (e.g. src/auth/guard.ts) for a single file, or a directory path (e.g. src/modules/copilot) to get all symbols across every file in that directory. Use the optional 'query' param to filter by name (e.g. query='password' returns only symbols whose name contains 'password').",
  inputSchema: {
    type: "object",
    properties: {
      file:  { type: "string", description: "Repo-relative path to a file or directory" },
      query: { type: "string", description: "Optional: filter symbols by name (case-insensitive substring match)" },
    },
    required: ["file"],
  },
} as const;

export async function handleGetFileSymbols(
  db: Database.Database,
  args: { file: string; query?: string },
): Promise<string> {
  const input = args.file;
  const isDir = !path.extname(input);

  let results;
  if (isDir) {
    const absDir = input.startsWith("/") ? input : path.join(process.cwd(), input);
    results = await getDirectorySymbols(db, absDir);
    if (results.length === 0) results = await getDirectorySymbols(db, input);
    if (results.length === 0) return `No symbols found under "${input}".`;
  } else {
    const absFile = input.startsWith("/") ? input : path.join(process.cwd(), input);
    results = await getFileSymbols(db, absFile);
    if (results.length === 0) results = await getFileSymbols(db, input);
    if (results.length === 0) return `No symbols found in "${input}". The file may not have been indexed, or the path may be incorrect.`;
  }

  if (args.query) {
    const q = args.query.toLowerCase();
    results = results.filter((s) => s.name.toLowerCase().includes(q));
    if (results.length === 0) return `No symbols matching "${args.query}" found in "${input}".`;
  }

  const { items, note } = cap(results, "symbols");
  const out = items.map(fmtSymbol);
  return JSON.stringify(note ? { note, symbols: out } : out, null, 2);
}

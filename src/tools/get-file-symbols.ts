// MCP tool: get_file_symbols
import type { Database } from "../graph/db.js";
import { getFileSymbols } from "../graph/queries.js";

export const GET_FILE_SYMBOLS_TOOL = {
  name: "get_file_symbols",
  description: "Return the full symbol map for a file — every function, class, and method defined in it.",
  inputSchema: {
    type: "object",
    properties: {
      file: { type: "string", description: "Repo-relative path to the file" },
    },
    required: ["file"],
  },
} as const;

export async function handleGetFileSymbols(
  db: Database.Database,
  args: { file: string },
): Promise<string> {
  const results = await getFileSymbols(db, args.file);
  if (results.length === 0) {
    return `No symbols found in "${args.file}". The file may not have been indexed, or the path may be incorrect.`;
  }

  return JSON.stringify(
    results.map((s) => ({
      name: s.name,
      kind: s.kind,
      line: s.line,
      signature: s.signature ?? null,
      docstring: s.docstring ?? null,
    })),
    null,
    2,
  );
}

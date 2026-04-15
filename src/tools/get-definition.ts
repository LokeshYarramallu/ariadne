// MCP tool: get_definition
import type { Database } from "../graph/db.js";
import { getDefinition } from "../graph/queries.js";

export const GET_DEFINITION_TOOL = {
  name: "get_definition",
  description: "Find where a symbol is defined — returns its file, line, and signature.",
  inputSchema: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Symbol name to look up" },
      file: { type: "string", description: "Optional: restrict search to this file path" },
    },
    required: ["symbol"],
  },
} as const;

export async function handleGetDefinition(
  db: Database.Database,
  args: { symbol: string; file?: string },
): Promise<string> {
  const result = await getDefinition(db, args.symbol, args.file);
  if (!result) {
    return `No definition found for "${args.symbol}"${args.file ? ` in ${args.file}` : ""}.`;
  }

  const { symbol } = result;
  return JSON.stringify(
    {
      name: symbol.name,
      kind: symbol.kind,
      file: symbol.file,
      line: symbol.line,
      signature: symbol.signature ?? null,
      docstring: symbol.docstring ?? null,
    },
    null,
    2,
  );
}

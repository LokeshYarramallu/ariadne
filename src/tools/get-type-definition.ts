// MCP tool: get_type_definition
import type { Database } from "../graph/db.js";
import { getTypeDefinition } from "../graph/queries.js";

export const GET_TYPE_DEFINITION_TOOL = {
  name: "get_type_definition",
  description:
    "Best-effort: find the type or interface that a symbol references. " +
    "Returns types/interfaces reachable via reference edges from the given symbol.",
  inputSchema: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Symbol name to look up the type for" },
    },
    required: ["symbol"],
  },
} as const;

export async function handleGetTypeDefinition(
  db: Database.Database,
  args: { symbol: string },
): Promise<string> {
  const results = await getTypeDefinition(db, args.symbol);
  if (results.length === 0) {
    return `No type definitions found for "${args.symbol}".`;
  }

  return JSON.stringify(
    results.map(({ symbol }) => ({
      name: symbol.name,
      kind: symbol.kind,
      file: symbol.file,
      line: symbol.line,
      signature: symbol.signature ?? null,
    })),
    null,
    2,
  );
}

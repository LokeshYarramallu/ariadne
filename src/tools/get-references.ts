// MCP tool: get_references
import type { Database } from "../graph/db.js";
import { getReferences } from "../graph/queries.js";

export const GET_REFERENCES_TOOL = {
  name: "get_references",
  description: "Find every place in the repo that references the given symbol.",
  inputSchema: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Symbol name to find references for" },
    },
    required: ["symbol"],
  },
} as const;

export async function handleGetReferences(
  db: Database.Database,
  args: { symbol: string },
): Promise<string> {
  const results = await getReferences(db, args.symbol);
  if (results.length === 0) {
    return `No references found for "${args.symbol}".`;
  }

  return JSON.stringify(
    results.map((cs) => ({
      referencing_symbol: {
        name: cs.caller.name,
        kind: cs.caller.kind,
        file: cs.caller.file,
        line: cs.caller.line,
      },
      reference_line: cs.line,
    })),
    null,
    2,
  );
}

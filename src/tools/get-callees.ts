// MCP tool: get_callees
import type { Database } from "../graph/db.js";
import { getCallees } from "../graph/queries.js";

export const GET_CALLEES_TOOL = {
  name: "get_callees",
  description: "List all symbols that the given symbol calls.",
  inputSchema: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Symbol name to find callees for" },
    },
    required: ["symbol"],
  },
} as const;

export async function handleGetCallees(
  db: Database.Database,
  args: { symbol: string },
): Promise<string> {
  const results = await getCallees(db, args.symbol);
  if (results.length === 0) {
    return `No callees found for "${args.symbol}".`;
  }

  return JSON.stringify(
    results.map((s) => ({
      name: s.name,
      kind: s.kind,
      file: s.file,
      line: s.line,
    })),
    null,
    2,
  );
}

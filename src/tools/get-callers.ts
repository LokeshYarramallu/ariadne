// MCP tool: get_callers
import type { Database } from "../graph/db.js";
import { getCallers } from "../graph/queries.js";

export const GET_CALLERS_TOOL = {
  name: "get_callers",
  description: "List all call sites that invoke the given symbol.",
  inputSchema: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "Symbol name to find callers for" },
    },
    required: ["symbol"],
  },
} as const;

export async function handleGetCallers(
  db: Database.Database,
  args: { symbol: string },
): Promise<string> {
  const results = await getCallers(db, args.symbol);
  if (results.length === 0) {
    return `No callers found for "${args.symbol}".`;
  }

  return JSON.stringify(
    results.map((cs) => ({
      caller: {
        name: cs.caller.name,
        kind: cs.caller.kind,
        file: cs.caller.file,
        line: cs.caller.line,
      },
      call_line: cs.line,
    })),
    null,
    2,
  );
}

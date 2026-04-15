// MCP tool: get_call_path
import type { Database } from "../graph/db.js";
import { getCallPath } from "../graph/queries.js";

export const GET_CALL_PATH_TOOL = {
  name: "get_call_path",
  description: "Find the shortest call chain between two symbols.",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "Starting symbol name" },
      to: { type: "string", description: "Target symbol name" },
    },
    required: ["from", "to"],
  },
} as const;

export async function handleGetCallPath(
  db: Database.Database,
  args: { from: string; to: string },
): Promise<string> {
  const result = await getCallPath(db, args.from, args.to);
  if (!result) {
    return `No call path found from "${args.from}" to "${args.to}" within 12 hops.`;
  }

  return JSON.stringify(
    {
      length: result.symbols.length,
      path: result.symbols.map((s) => ({
        name: s.name,
        kind: s.kind,
        file: s.file,
        line: s.line,
      })),
    },
    null,
    2,
  );
}

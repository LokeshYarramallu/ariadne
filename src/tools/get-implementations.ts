// MCP tool: get_implementations
import type { Database } from "../graph/db.js";
import { getImplementations } from "../graph/queries.js";

export const GET_IMPLEMENTATIONS_TOOL = {
  name: "get_implementations",
  description:
    "List all classes or functions that implement the given interface or abstract base.",
  inputSchema: {
    type: "object",
    properties: {
      interface: { type: "string", description: "Interface or abstract class name" },
    },
    required: ["interface"],
  },
} as const;

export async function handleGetImplementations(
  db: Database.Database,
  args: { interface: string },
): Promise<string> {
  const results = await getImplementations(db, args.interface);
  if (results.length === 0) {
    return `No implementations found for "${args.interface}".`;
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

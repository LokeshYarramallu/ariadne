// MCP tool: get_importers
import type { Database } from "../graph/db.js";
import { getImporters } from "../graph/queries.js";
import { fmtCallSite, cap } from "./format.js";

export const GET_IMPORTERS_TOOL = {
  name: "get_importers",
  description: "Find all files that import a given file. Use this to trace usage upward through the module tree — e.g. get_importers('src/services/auth-service.ts') shows every file that imports it.",
  inputSchema: {
    type: "object",
    properties: {
      file: { type: "string", description: "Repo-relative path to the file" },
    },
    required: ["file"],
  },
} as const;

export async function handleGetImporters(
  db: Database.Database,
  args: { file: string },
): Promise<string> {
  const absFile = args.file.startsWith("/") ? args.file : `${process.cwd()}/${args.file}`;
  let results = await getImporters(db, absFile);
  if (results.length === 0) results = await getImporters(db, args.file);
  if (results.length === 0) return `No importers found for "${args.file}".`;

  const callSites = results.map((r) => ({ caller: r.symbol, line: r.line }));
  const { items, note } = cap(callSites, "importers");
  const out = items.map(fmtCallSite);
  return JSON.stringify(note ? { note, importers: out } : out, null, 2);
}

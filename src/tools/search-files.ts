// MCP tool: search_files
import type { Database } from "../graph/db.js";
import { searchFiles } from "../graph/queries.js";

export const SEARCH_FILES_TOOL = {
  name: "search_files",
  description: "Find all indexed files whose path matches a pattern. Supports * (any chars) and ** (any path segment). E.g. search_files('**/*password*') finds all files with 'password' in the name. Replaces glob.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob-style pattern (e.g. **/*password*, src/modules/**)" },
    },
    required: ["pattern"],
  },
} as const;

export async function handleSearchFiles(
  db: Database.Database,
  args: { pattern: string },
): Promise<string> {
  const results = await searchFiles(db, args.pattern);
  if (results.length === 0) return `No files found matching "${args.pattern}".`;
  return JSON.stringify(results, null, 2);
}

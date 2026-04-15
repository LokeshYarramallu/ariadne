#!/usr/bin/env node
/**
 * Ariadne entry point.
 *
 * Repo path is always process.cwd() — Ariadne is spawned by the editor/agent
 * as a subprocess and inherits the editor's working directory (the project root).
 *
 * MCP config (add once, never touch again):
 *   {
 *     "mcpServers": {
 *       "ariadne": { "command": "npx", "args": ["-y", "ariadne"] }
 *     }
 *   }
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { init } from "./graph/db.js";
import { runIndexer } from "./indexer/index.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const repoPath = process.cwd();

  // Open (or create) the graph DB at <repoPath>/.ariadne/graph.db
  await init(repoPath);

  // Connect to the MCP transport immediately so the client handshake succeeds
  // without waiting for indexing.  Any existing .ariadne/graph.db data from a
  // previous run is available to tools right away; the indexer refreshes it in
  // the background.
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Run indexer in the background — stdout now belongs to MCP so all output
  // goes to stderr as before.
  runIndexer().catch((err) => {
    process.stderr.write(
      `Indexing error: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
  });
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});

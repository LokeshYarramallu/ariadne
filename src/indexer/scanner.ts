// Initial full-repo scan: walks all supported files and indexes them.
// NOTE: With the SCIP-first strategy this file is no longer the primary
// indexing path — the SCIP runner + reader handles full indexing.
// This scanner is kept for potential fallback / testing purposes.
import type { Database } from "../graph/db.js";

export async function scanRepo(_db: Database.Database, _repoRoot: string): Promise<void> {
  // TODO (fallback path):
  // 1. Walk repoRoot recursively (skip .git, node_modules, .ariadne)
  // 2. For each file with a known extension, read + parseFile()
  // 3. upsertSymbol() + upsertEdge() in batches
  throw new Error("not implemented");
}

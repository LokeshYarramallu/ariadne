// MCP tool: get_index_status
import { getStatus } from "../indexer/status.js";

export const GET_INDEX_STATUS_TOOL = {
  name: "get_index_status",
  description:
    "Returns the current state of the Ariadne code index. " +
    "IMPORTANT: call this tool whenever any other Ariadne tool returns empty results or says a symbol was not found. " +
    "If state is not 'ready', tell the user the index is still being built and they should wait before querying.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
} as const;

export function handleGetIndexStatus(): string {
  const s = getStatus();

  const elapsed = s.elapsedMs < 60_000
    ? `${Math.round(s.elapsedMs / 1000)}s`
    : `${Math.floor(s.elapsedMs / 60_000)}m ${Math.round((s.elapsedMs % 60_000) / 1000)}s`;

  const lines: string[] = [
    `state:    ${s.state}`,
    `phase:    ${s.phase}`,
    `elapsed:  ${elapsed}`,
  ];

  if (s.languages.length > 0) {
    lines.push(`languages: ${s.languages.join(", ")}`);
  }

  if (s.state === "ready") {
    lines.push(`symbols:  ${s.symbolCount.toLocaleString()}`);
    lines.push(`edges:    ${s.edgeCount.toLocaleString()}`);
    lines.push("");
    lines.push("The index is ready — all query tools should return results.");
  } else if (s.state === "scip-running") {
    lines.push("");
    lines.push(
      "⚠ SCIP indexer is still running. This is normal for the first startup on a large repo.",
    );
    lines.push("Tell the user: 'Ariadne is still indexing this project. Please wait a moment and try again.'");
    lines.push(
      "scip-typescript typically takes 5–10 minutes for large TypeScript repos on first run.",
    );
  } else if (s.state === "loading") {
    lines.push("");
    lines.push("⚠ Symbols are being loaded into the graph. This usually takes under 30 seconds.");
    lines.push("Tell the user: 'The index is almost ready — please wait a few seconds and try again.'");
  } else if (s.state === "error") {
    lines.push(`error:    ${s.errorMessage ?? "unknown error"}`);
    lines.push("");
    lines.push("⚠ Indexing failed. Ariadne may have partial or no data for this project.");
  } else {
    lines.push("");
    lines.push("⚠ Indexing has not completed yet. Please wait and try again.");
  }

  return lines.join("\n");
}

// MCP server: registers all tools and routes incoming calls.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "./graph/db.js";
import {
  handleGetDefinition,
  handleGetCallers,
  handleGetCallees,
  handleGetImplementations,
  handleGetCallPath,
  handleGetReferences,
  handleGetFileSymbols,
  handleGetTypeDefinition,
  handleGetSourceDefinition,
  handleGetIndexStatus,
} from "./tools/index.js";

// getDb() is called lazily inside each tool handler — NOT at server creation time.
// This is critical: wipAndReinit() closes and recreates the DB during indexing.
// If we captured getDb() once at startup, all tools would hold a stale closed reference.

export function createServer(): McpServer {
  const server = new McpServer({
    name: "ariadne",
    version: "0.1.0",
  });

  server.tool(
    "get_definition",
    "Find where a symbol is defined — returns its file, line, and signature.",
    {
      symbol: z.string().describe("Symbol name to look up"),
      file: z.string().optional().describe("Optional: restrict search to this file path"),
    },
    async ({ symbol, file }) => ({
      content: [
        { type: "text" as const, text: await handleGetDefinition(getDb(), { symbol, file }) },
      ],
    }),
  );

  server.tool(
    "get_callers",
    "List all call sites that invoke the given symbol.",
    { symbol: z.string().describe("Symbol name to find callers for") },
    async ({ symbol }) => ({
      content: [{ type: "text" as const, text: await handleGetCallers(getDb(), { symbol }) }],
    }),
  );

  server.tool(
    "get_callees",
    "List all symbols that the given symbol calls.",
    { symbol: z.string().describe("Symbol name to find callees for") },
    async ({ symbol }) => ({
      content: [{ type: "text" as const, text: await handleGetCallees(getDb(), { symbol }) }],
    }),
  );

  server.tool(
    "get_implementations",
    "List all classes or functions that implement the given interface or abstract base.",
    { interface: z.string().describe("Interface or abstract class name") },
    async (args) => ({
      content: [
        {
          type: "text" as const,
          text: await handleGetImplementations(getDb(), { interface: args.interface }),
        },
      ],
    }),
  );

  server.tool(
    "get_call_path",
    "Find the shortest call chain between two symbols.",
    {
      from: z.string().describe("Starting symbol name"),
      to: z.string().describe("Target symbol name"),
    },
    async ({ from, to }) => ({
      content: [{ type: "text" as const, text: await handleGetCallPath(getDb(), { from, to }) }],
    }),
  );

  server.tool(
    "get_references",
    "Find every place in the repo that references the given symbol.",
    { symbol: z.string().describe("Symbol name to find references for") },
    async ({ symbol }) => ({
      content: [{ type: "text" as const, text: await handleGetReferences(getDb(), { symbol }) }],
    }),
  );

  server.tool(
    "get_file_symbols",
    "Return the full symbol map for a file — every function, class, and method defined in it.",
    { file: z.string().describe("Repo-relative or absolute path to the file") },
    async ({ file }) => ({
      content: [{ type: "text" as const, text: await handleGetFileSymbols(getDb(), { file }) }],
    }),
  );

  server.tool(
    "get_type_definition",
    "Best-effort: find the type or interface that a symbol references.",
    { symbol: z.string().describe("Symbol name to look up the type for") },
    async ({ symbol }) => ({
      content: [
        { type: "text" as const, text: await handleGetTypeDefinition(getDb(), { symbol }) },
      ],
    }),
  );

  server.tool(
    "get_source_definition",
    "Like get_definition but skips barrel/index files — finds the original source location.",
    {
      symbol: z.string().describe("Symbol name to look up"),
      file: z.string().optional().describe("Optional: restrict search to this file path"),
    },
    async ({ symbol, file }) => ({
      content: [
        {
          type: "text" as const,
          text: await handleGetSourceDefinition(getDb(), { symbol, file }),
        },
      ],
    }),
  );

  server.tool(
    "get_index_status",
    "Returns the current state of the Ariadne code index. " +
    "IMPORTANT: call this whenever any other Ariadne tool returns empty results or says a symbol was not found. " +
    "If state is not 'ready', tell the user the index is still being built and they should wait.",
    {},
    async () => ({
      content: [{ type: "text" as const, text: handleGetIndexStatus() }],
    }),
  );

  return server;
}

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
  handleFindSymbol,
  handleGetImporters,
  handleSearchFiles,
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
    "Find where a symbol (function, class, method, variable) is defined in the codebase. " +
    "Use this as the first step when you need to read an implementation — it gives you the exact file and line so you don't have to search. " +
    "Do not use for fuzzy name searches; use find_symbol instead if you're unsure of the exact name. " +
    "Returns: file path, line number, and signature. If empty, call get_index_status to check if indexing is complete.",
    {
      symbol: z.string().describe("Exact symbol name (e.g. 'processPayment', 'UserService', 'handleLogin')"),
      file: z.string().optional().describe("Optional: restrict to this file path when the same name exists in multiple files"),
    },
    async ({ symbol, file }) => ({
      content: [
        { type: "text" as const, text: await handleGetDefinition(getDb(), { symbol, file }) },
      ],
    }),
  );

  server.tool(
    "get_callers",
    "Find every place in the codebase that calls or uses a given symbol. " +
    "Use this to understand the blast radius of a change, trace how a function is invoked, or find all usages of a class. " +
    "For classes with no direct call sites, automatically falls back to import and registration sites (e.g. NestJS module registrations). " +
    "Do not use to find where a symbol is defined — use get_definition for that. " +
    "Returns: list of caller symbols with file path and line number.",
    { symbol: z.string().describe("Exact symbol name to find callers for") },
    async ({ symbol }) => ({
      content: [{ type: "text" as const, text: await handleGetCallers(getDb(), { symbol }) }],
    }),
  );

  server.tool(
    "get_callees",
    "Find every symbol that a given function or method calls internally. " +
    "Use this to understand what a function depends on, trace data flow downward, or map out a call tree. " +
    "Do not use to find who calls this function — use get_callers for that. " +
    "Returns: list of called symbols with file path and line number.",
    { symbol: z.string().describe("Exact symbol name to inspect") },
    async ({ symbol }) => ({
      content: [{ type: "text" as const, text: await handleGetCallees(getDb(), { symbol }) }],
    }),
  );

  server.tool(
    "get_implementations",
    "Find all classes or functions that implement a given interface or extend an abstract base class. " +
    "Use this to discover concrete implementations when you only know the interface name, or to audit all classes satisfying a contract. " +
    "Do not use for finding call sites — use get_callers for that. " +
    "Returns: list of implementing symbols with file path and line number.",
    { interface: z.string().describe("Interface or abstract class name (e.g. 'LanguageParser', 'Repository')") },
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
    "Find the shortest call chain between two symbols — answers 'how does A eventually reach B?'. " +
    "Use this to trace execution flow across multiple layers (e.g. controller → service → repository). " +
    "Do not use when you just need direct callers or callees — use get_callers or get_callees for that. " +
    "Returns: ordered list of symbols forming the chain, with file and line for each hop. Returns empty if no path exists within 12 hops.",
    {
      from: z.string().describe("Starting symbol name (e.g. 'checkout')"),
      to: z.string().describe("Target symbol name (e.g. 'repository.save')"),
    },
    async ({ from, to }) => ({
      content: [{ type: "text" as const, text: await handleGetCallPath(getDb(), { from, to }) }],
    }),
  );

  server.tool(
    "get_references",
    "Find every edge in the graph that points to a given symbol — includes calls, imports, decorator usages, and type references. " +
    "Use this for a complete picture of all usages, including decorators like @Roles or @Controller that get_callers might miss. " +
    "Do not use when you only want call sites — use get_callers for a cleaner call-only view. " +
    "Returns: list of referencing symbols with file path and line number.",
    { symbol: z.string().describe("Exact symbol name to find all references for") },
    async ({ symbol }) => ({
      content: [{ type: "text" as const, text: await handleGetReferences(getDb(), { symbol }) }],
    }),
  );

  server.tool(
    "get_file_symbols",
    "List every symbol (function, class, method, variable) defined in a file or directory. " +
    "Use this to get a structural overview of a file before reading it, or to map all symbols in a module directory. " +
    "Use the optional query param to filter by name — e.g. query='password' returns only password-related symbols, avoiding truncation on large directories. " +
    "Do not use to search across the whole codebase — use find_symbol for that. " +
    "Returns: list of symbols with kind, file, line, and signature. Results are capped at 200; use query to narrow down.",
    {
      file:  z.string().describe("Repo-relative path to a file (e.g. src/server.ts) or directory (e.g. src/modules/auth)"),
      query: z.string().optional().describe("Optional: filter symbols whose name contains this string (case-insensitive)"),
    },
    async ({ file, query }) => ({
      content: [{ type: "text" as const, text: await handleGetFileSymbols(getDb(), { file, query }) }],
    }),
  );

  server.tool(
    "get_type_definition",
    "Best-effort: find the type, interface, or class that a symbol's type refers to. " +
    "Use this when you need to understand the shape of a value — e.g. what type does this variable hold. " +
    "Results may be incomplete for complex generic or inferred types. " +
    "Returns: list of candidate type definitions with file and line. May return multiple candidates.",
    { symbol: z.string().describe("Symbol name to look up the type for") },
    async ({ symbol }) => ({
      content: [
        { type: "text" as const, text: await handleGetTypeDefinition(getDb(), { symbol }) },
      ],
    }),
  );

  server.tool(
    "get_source_definition",
    "Like get_definition but skips barrel/re-export files (index.ts, index.js) and returns the original source location. " +
    "Use this instead of get_definition when the symbol is re-exported through an index file and you want the actual implementation file. " +
    "Returns: file path, line number, and signature of the original source. Falls back to get_definition result if no non-barrel definition exists.",
    {
      symbol: z.string().describe("Exact symbol name to look up"),
      file: z.string().optional().describe("Optional: restrict to this file path"),
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
    "Returns the current state of the Ariadne code index — whether it is still indexing, ready, or errored. " +
    "IMPORTANT: call this whenever any other Ariadne tool returns empty results or says a symbol was not found. " +
    "If state is not 'ready', the index is still being built — tell the user to wait before retrying. " +
    "Returns: state (starting/detecting/scip-running/loading/ready/error), phase description, symbol count, edge count, and elapsed time.",
    {},
    async () => ({
      content: [{ type: "text" as const, text: handleGetIndexStatus() }],
    }),
  );

  server.tool(
    "find_symbol",
    "Search for symbols by name across the entire codebase using a substring match. " +
    "Use this when you don't know the exact symbol name — e.g. find_symbol('password') returns all symbols whose name contains 'password', across all files. " +
    "Prefer this over grep or glob for symbol discovery. Use get_definition once you have the exact name. " +
    "Returns: up to 50 matching symbols ordered by relevance (exact match first, then prefix, then substring), with file and line.",
    { query: z.string().describe("Substring to search for in symbol names (case-insensitive, e.g. 'password', 'Auth', 'reset')") },
    async ({ query }) => ({
      content: [{ type: "text" as const, text: await handleFindSymbol(getDb(), { query }) }],
    }),
  );

  server.tool(
    "get_importers",
    "Find all files that import a given file — the reverse of an import statement. " +
    "Use this to trace usage upward through the module tree, find all consumers of a service or utility, or assess the impact of changing a file's exports. " +
    "Do not use to find callers of a specific function — use get_callers for that. " +
    "Returns: list of importing symbols (one per file) with file path and line of the import statement.",
    { file: z.string().describe("Repo-relative path to the file being imported (e.g. src/services/auth.ts)") },
    async ({ file }) => ({
      content: [{ type: "text" as const, text: await handleGetImporters(getDb(), { file }) }],
    }),
  );

  server.tool(
    "search_files",
    "Find all indexed files whose path matches a glob-style pattern. " +
    "Use this to discover files by name pattern when you don't know the exact path — e.g. search_files('**/*password*') finds all files with 'password' in the filename. " +
    "Replaces glob/find commands. Supports * (matches any chars except /) and ** (matches any path including /). " +
    "Do not use to search file contents or symbol names — use find_symbol for symbols, get_references for usages. " +
    "Returns: list of matching file paths.",
    { pattern: z.string().describe("Glob pattern (e.g. '**/*password*', 'src/modules/**', '**/*.service.ts')") },
    async ({ pattern }) => ({
      content: [{ type: "text" as const, text: await handleSearchFiles(getDb(), { pattern }) }],
    }),
  );

  return server;
}

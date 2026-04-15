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
    "Purpose: Find the exact definition of a symbol. " +
    "Use when: The exact symbol name is known and you need its defining location. " +
    "Avoid when: The symbol name is partial, fuzzy, or uncertain. " +
    "Prefer instead: find_symbol for approximate or substring lookup. " +
    "Input: Exact symbol name; optional file path to disambiguate duplicates. " +
    "Returns: File path, line number, and signature. " +
    "If empty: Check get_index_status; indexing may be incomplete.",
    {
      symbol: z.string().describe("Exact symbol name (e.g. 'processPayment', 'UserService')"),
      file: z.string().optional().describe("Optional: restrict to this file path when the same name exists in multiple files"),
    },
    async ({ symbol, file }) => ({
      content: [{ type: "text" as const, text: await handleGetDefinition(getDb(), { symbol, file }) }],
    }),
  );

  server.tool(
    "get_callers",
    "Purpose: Find all callers or usage sites of a symbol. " +
    "Use when: You need upstream usage, invocation sites, or impact analysis. " +
    "Avoid when: You want the symbol definition or internal dependencies of the symbol. " +
    "Prefer instead: get_definition for the definition, get_callees for downstream calls. " +
    "Input: Exact symbol name. " +
    "Returns: Caller symbols or usage sites with file path and line number. " +
    "If empty: For classes, usage may appear as import or registration sites rather than direct call sites.",
    { symbol: z.string().describe("Exact symbol name to find callers for") },
    async ({ symbol }) => ({
      content: [{ type: "text" as const, text: await handleGetCallers(getDb(), { symbol }) }],
    }),
  );

  server.tool(
    "get_callees",
    "Purpose: Find all symbols called by a function or method. " +
    "Use when: You need downstream dependencies, internal call flow, or the call tree below a symbol. " +
    "Avoid when: You want to know who calls the symbol. " +
    "Prefer instead: get_callers for upstream usage. " +
    "Input: Exact function or method symbol name. " +
    "Returns: Called symbols with file path and line number. " +
    "Caveat: Best suited to functions and methods, not general reference discovery.",
    { symbol: z.string().describe("Exact symbol name to inspect") },
    async ({ symbol }) => ({
      content: [{ type: "text" as const, text: await handleGetCallees(getDb(), { symbol }) }],
    }),
  );

  server.tool(
    "get_implementations",
    "Purpose: Find concrete implementations of an interface or abstract base class. " +
    "Use when: You know the contract but need the implementing classes or functions. " +
    "Avoid when: You want usages, callers, or general references. " +
    "Prefer instead: get_callers for usage sites, get_references for broader references. " +
    "Input: Interface or abstract class name. " +
    "Returns: Implementing symbols with file path and line number. " +
    "Caveat: Most useful when the codebase models behavior through interfaces or abstract types.",
    { interface: z.string().describe("Interface or abstract class name (e.g. 'LanguageParser', 'Repository')") },
    async (args) => ({
      content: [{ type: "text" as const, text: await handleGetImplementations(getDb(), { interface: args.interface }) }],
    }),
  );

  server.tool(
    "get_call_path",
    "Purpose: Find the shortest call chain between two symbols. " +
    "Use when: You need to trace how one symbol eventually reaches another across layers. " +
    "Avoid when: You only need direct callers or direct callees. " +
    "Prefer instead: get_callers or get_callees for one-hop relationships. " +
    "Input: Start symbol and target symbol. " +
    "Returns: Ordered call chain with file path and line number for each hop. " +
    "If empty: No path may exist within the search depth limit.",
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
    "Purpose: Find all graph references to a symbol. " +
    "Use when: You need a broad usage view including calls, imports, decorators, and type references. " +
    "Avoid when: You only want direct call sites and a narrower result. " +
    "Prefer instead: get_callers for call-only usage. " +
    "Input: Exact symbol name. " +
    "Returns: Referencing symbols or sites with file path and line number. " +
    "Caveat: Broader than callers; results may include non-execution references.",
    { symbol: z.string().describe("Exact symbol name to find all references for") },
    async ({ symbol }) => ({
      content: [{ type: "text" as const, text: await handleGetReferences(getDb(), { symbol }) }],
    }),
  );

  server.tool(
    "get_file_symbols",
    "Purpose: List symbols defined in a file or directory. " +
    "Use when: You need a structural overview before reading code or want symbols within a known path. " +
    "Avoid when: You want codebase-wide symbol search. " +
    "Prefer instead: find_symbol for global symbol discovery. " +
    "Input: Repo-relative file or directory path; optional query filter. " +
    "Returns: Symbols with kind, file path, line number, and signature. " +
    "Caveat: Large directories may be capped; use the query filter to narrow results.",
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
    "Purpose: Find the type definition associated with a symbol's type. " +
    "Use when: You need to understand the shape or declared type behind a symbol. " +
    "Avoid when: You want the symbol's own definition rather than its type target. " +
    "Prefer instead: get_definition for the symbol definition itself. " +
    "Input: Symbol name. " +
    "Returns: Candidate type, interface, or class definitions with file path and line number. " +
    "Caveat: May be incomplete for inferred, generic, or complex types and may return multiple candidates.",
    { symbol: z.string().describe("Symbol name to look up the type for") },
    async ({ symbol }) => ({
      content: [{ type: "text" as const, text: await handleGetTypeDefinition(getDb(), { symbol }) }],
    }),
  );

  server.tool(
    "get_source_definition",
    "Purpose: Find the original source definition of a symbol, skipping barrels and re-exports when possible. " +
    "Use when: get_definition lands on an index or barrel file but you need the implementation source. " +
    "Avoid when: A normal definition lookup is sufficient. " +
    "Prefer instead: get_definition for standard exact-definition lookup. " +
    "Input: Exact symbol name; optional file path to disambiguate duplicates. " +
    "Returns: Original source file path, line number, and signature. " +
    "Caveat: Falls back to the normal definition result when no deeper source is available.",
    {
      symbol: z.string().describe("Exact symbol name to look up"),
      file: z.string().optional().describe("Optional: restrict to this file path"),
    },
    async ({ symbol, file }) => ({
      content: [{ type: "text" as const, text: await handleGetSourceDefinition(getDb(), { symbol, file }) }],
    }),
  );

  server.tool(
    "get_index_status",
    "Purpose: Report the current status of the code index. " +
    "Use when: Other tools return empty results, missing symbols, or unexpected failures. " +
    "Avoid when: You already have valid tool output and do not need readiness diagnostics. " +
    "Input: No input. " +
    "Returns: Index state, phase, symbol count, edge count, and elapsed time. " +
    "Caveat: If state is not ready, other tool results may be incomplete or stale.",
    {},
    async () => ({
      content: [{ type: "text" as const, text: handleGetIndexStatus() }],
    }),
  );

  server.tool(
    "find_symbol",
    "Purpose: Find symbols by partial name or substring across the codebase. " +
    "Use when: The exact symbol name is unknown or only part of the name is known. " +
    "Avoid when: You already know the exact symbol and want its definition. " +
    "Prefer instead: get_definition once the correct exact symbol is identified. " +
    "Input: Case-insensitive substring query. " +
    "Returns: Ranked symbol matches with file path and line number. " +
    "Caveat: Best first step for discovery before exact lookup.",
    { query: z.string().describe("Case-insensitive substring to search for in symbol names (e.g. 'password', 'Auth', 'reset')") },
    async ({ query }) => ({
      content: [{ type: "text" as const, text: await handleFindSymbol(getDb(), { query }) }],
    }),
  );

  server.tool(
    "get_importers",
    "Purpose: Find files that import a given file. " +
    "Use when: You need module-level consumers or want to assess the impact of changing a file's exports. " +
    "Avoid when: You want callers of a specific function or method. " +
    "Prefer instead: get_callers for symbol-level usage. " +
    "Input: Repo-relative file path. " +
    "Returns: Importing files or symbols with file path and line number of the import. " +
    "Caveat: Works at file/module level, not symbol-call level.",
    { file: z.string().describe("Repo-relative path to the file being imported (e.g. src/services/auth.ts)") },
    async ({ file }) => ({
      content: [{ type: "text" as const, text: await handleGetImporters(getDb(), { file }) }],
    }),
  );

  server.tool(
    "search_files",
    "Purpose: Find indexed files whose paths match a glob pattern. " +
    "Use when: You know a naming pattern or directory shape but not the exact file path. " +
    "Avoid when: You want symbol search, code references, or file content search. " +
    "Prefer instead: find_symbol for symbol names, get_references for usages. " +
    "Input: Glob pattern using * and **. " +
    "Returns: Matching file paths. " +
    "Caveat: Matches file paths only, not contents or symbol definitions.",
    { pattern: z.string().describe("Glob pattern (e.g. '**/*password*', 'src/modules/**', '**/*.service.ts')") },
    async ({ pattern }) => ({
      content: [{ type: "text" as const, text: await handleSearchFiles(getDb(), { pattern }) }],
    }),
  );

  return server;
}

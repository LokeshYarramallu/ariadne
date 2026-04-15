export type SymbolKind = "function" | "class" | "method" | "module" | "variable";

export type EdgeKind = "calls" | "imports" | "defines" | "implements" | "references";

export interface Symbol {
  id: string;           // stable hash: "<file>:<name>:<kind>"
  name: string;
  kind: SymbolKind;
  file: string;         // repo-relative path
  line: number;
  signature?: string;   // optional human-readable signature
  docstring?: string;   // first docstring/comment extracted by the parser
}

export interface Edge {
  from: string;   // Symbol.id
  to: string;     // Symbol.id
  kind: EdgeKind;
  line?: number;  // line in `from` file where the relationship occurs
}

export interface Location {
  file: string;   // repo-relative path
  line: number;
  column?: number;
}

// Result shapes for MCP tool responses

export interface DefinitionResult {
  symbol: Symbol;
  source?: string;  // snippet around the definition
}

export interface CallSite {
  caller: Symbol;
  line: number;
}

export interface CallPath {
  symbols: Symbol[];
  edges: Edge[];
}

import type { Symbol, Edge } from "../../types/index.js";

export interface ParseResult {
  symbols: Symbol[];
  edges: Edge[];
}

export interface LanguageParser {
  /** File extensions this parser handles, e.g. [".py"]. */
  getSupportedExtensions(): string[];

  /**
   * Read the file at filePath from disk, parse it, and return all symbols
   * and edges found within it.
   */
  parseFile(filePath: string): Promise<ParseResult>;
}

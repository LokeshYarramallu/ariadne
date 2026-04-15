// Selects the right LanguageParser for a file and runs it.
import type { LanguageParser, ParseResult } from "./languages/base.js";
import { PythonParser } from "./languages/python.js";
import { JavaScriptParser } from "./languages/javascript.js";
import { TypeScriptParser } from "./languages/typescript.js";

const PARSERS: LanguageParser[] = [
  new PythonParser(),
  new JavaScriptParser(),
  new TypeScriptParser(),
];

const EXT_MAP = new Map<string, LanguageParser>();
for (const p of PARSERS) {
  for (const ext of p.getSupportedExtensions()) {
    EXT_MAP.set(ext, p);
  }
}

export function parserForFile(filePath: string): LanguageParser | null {
  const ext = filePath.slice(filePath.lastIndexOf("."));
  return EXT_MAP.get(ext) ?? null;
}

export async function parseFile(filePath: string): Promise<ParseResult> {
  const parser = parserForFile(filePath);
  if (!parser) return { symbols: [], edges: [] };
  return parser.parseFile(filePath);
}

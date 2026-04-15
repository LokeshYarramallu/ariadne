/**
 * Tree-sitter TypeScript/TSX parser for incremental symbol extraction.
 *
 * Handles the most common TypeScript constructs:
 *   - function declarations + arrow functions assigned to const/let
 *   - class declarations (including abstract)
 *   - methods and abstract methods inside classes
 *   - interface, type alias, enum, namespace declarations
 *   - call_expression → "calls" edges
 *   - import_declaration → "imports" edges
 *
 * Does NOT replace the SCIP indexer for cross-file semantics — this is only
 * used for incremental patches when a file changes between SCIP runs.
 *
 * .d.ts files are skipped (they have no function bodies and SCIP covers them).
 */

import fs from "node:fs/promises";
import path from "node:path";
import Parser from "tree-sitter";
import TSGrammars from "tree-sitter-typescript";
import type { Symbol, Edge } from "../../types/index.js";
import type { LanguageParser, ParseResult } from "./base.js";

// ---------------------------------------------------------------------------
// Parser singletons (initialisation is expensive — create once)
// ---------------------------------------------------------------------------

let _tsParser: Parser | null = null;
let _tsxParser: Parser | null = null;

function getTsParser(): Parser {
  if (!_tsParser) {
    _tsParser = new Parser();
    _tsParser.setLanguage(TSGrammars.typescript as Parameters<typeof Parser.prototype.setLanguage>[0]);
  }
  return _tsParser;
}

function getTsxParser(): Parser {
  if (!_tsxParser) {
    _tsxParser = new Parser();
    _tsxParser.setLanguage(TSGrammars.tsx as Parameters<typeof Parser.prototype.setLanguage>[0]);
  }
  return _tsxParser;
}

// ---------------------------------------------------------------------------
// Walk context
// ---------------------------------------------------------------------------

interface WalkCtx {
  file: string;
  symbols: Symbol[];
  edges: Edge[];
  nameToId: Map<string, string>;    // name → id for same-file call resolution
  edgesSeen: Set<string>;           // "from:to:kind" dedup
  currentClass: string | null;      // non-null when inside a class body
  enclosingId: string | null;       // innermost enclosing symbol id
  moduleSymbolId: string;           // id used as "from" on top-level import edges
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addEdge(ctx: WalkCtx, edge: Edge): void {
  const key = `${edge.from}:${edge.to}:${edge.kind}`;
  if (!ctx.edgesSeen.has(key)) {
    ctx.edgesSeen.add(key);
    ctx.edges.push(edge);
  }
}

// ---------------------------------------------------------------------------
// Node processors
// ---------------------------------------------------------------------------

function processFunction(
  node: Parser.SyntaxNode,
  ctx: WalkCtx,
  overrideLine?: number,
): void {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;

  const rawName = nameNode.text;
  const line = overrideLine ?? node.startPosition.row + 1;
  const kind: Symbol["kind"] = ctx.currentClass ? "method" : "function";
  const qualName = ctx.currentClass ? `${ctx.currentClass}.${rawName}` : rawName;
  const id = `${ctx.file}:${qualName}:${kind}`;

  const params = node.childForFieldName("parameters");
  const retType = node.childForFieldName("return_type");
  let sig = rawName;
  if (params) sig += params.text;
  if (retType) sig += retType.text; // includes the ':'

  ctx.symbols.push({ id, name: rawName, kind, file: ctx.file, line, signature: sig });
  ctx.nameToId.set(rawName, id);
  ctx.nameToId.set(qualName, id);

  const prevEnclosing = ctx.enclosingId;
  ctx.enclosingId = id;

  const body = node.childForFieldName("body");
  if (body) {
    for (const child of body.children) walkNode(child, ctx);
  }

  ctx.enclosingId = prevEnclosing;
}

/** Arrow function / function expression assigned to a const/let identifier. */
function processArrowFunction(
  nameNode: Parser.SyntaxNode,
  fnNode: Parser.SyntaxNode,
  ctx: WalkCtx,
  overrideLine?: number,
): void {
  const rawName = nameNode.text;
  const line = overrideLine ?? nameNode.startPosition.row + 1;
  const kind: Symbol["kind"] = ctx.currentClass ? "method" : "function";
  const qualName = ctx.currentClass ? `${ctx.currentClass}.${rawName}` : rawName;
  const id = `${ctx.file}:${qualName}:${kind}`;

  const params = fnNode.childForFieldName("parameters") ?? fnNode.childForFieldName("parameter");
  const retType = fnNode.childForFieldName("return_type");
  let sig = rawName;
  if (params) sig += params.text;
  if (retType) sig += retType.text;

  ctx.symbols.push({ id, name: rawName, kind, file: ctx.file, line, signature: sig });
  ctx.nameToId.set(rawName, id);
  ctx.nameToId.set(qualName, id);

  const prevEnclosing = ctx.enclosingId;
  ctx.enclosingId = id;

  const body = fnNode.childForFieldName("body");
  if (body) {
    for (const child of body.children) walkNode(child, ctx);
  }

  ctx.enclosingId = prevEnclosing;
}

function processClass(node: Parser.SyntaxNode, ctx: WalkCtx): void {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;

  const name = nameNode.text;
  const line = node.startPosition.row + 1;
  const id = `${ctx.file}:${name}:class`;

  const heritage = node.childForFieldName("class_heritage");
  let sig = node.type === "abstract_class_declaration"
    ? `abstract class ${name}`
    : `class ${name}`;
  if (heritage) sig += ` ${heritage.text}`;

  ctx.symbols.push({ id, name, kind: "class", file: ctx.file, line, signature: sig });
  ctx.nameToId.set(name, id);

  const prevClass = ctx.currentClass;
  const prevEnclosing = ctx.enclosingId;
  ctx.currentClass = name;
  ctx.enclosingId = id;

  const body = node.childForFieldName("body");
  if (body) {
    for (const child of body.children) walkNode(child, ctx);
  }

  ctx.currentClass = prevClass;
  ctx.enclosingId = prevEnclosing;
}

function processMethod(node: Parser.SyntaxNode, ctx: WalkCtx): void {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;

  // Skip computed property names ([Symbol.iterator] etc.)
  if (nameNode.type === "computed_property_name") return;

  const rawName = nameNode.text;
  const line = node.startPosition.row + 1;
  const kind: Symbol["kind"] = "method";
  const qualName = ctx.currentClass ? `${ctx.currentClass}.${rawName}` : rawName;
  const id = `${ctx.file}:${qualName}:${kind}`;

  const params = node.childForFieldName("parameters");
  const retType = node.childForFieldName("return_type");
  let sig = rawName;
  if (params) sig += params.text;
  if (retType) sig += retType.text;

  ctx.symbols.push({ id, name: rawName, kind, file: ctx.file, line, signature: sig });
  ctx.nameToId.set(rawName, id);
  ctx.nameToId.set(qualName, id);

  const prevEnclosing = ctx.enclosingId;
  ctx.enclosingId = id;

  const body = node.childForFieldName("body");
  if (body) {
    for (const child of body.children) walkNode(child, ctx);
  }

  ctx.enclosingId = prevEnclosing;
}

function processInterface(node: Parser.SyntaxNode, ctx: WalkCtx): void {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;

  const name = nameNode.text;
  const line = node.startPosition.row + 1;
  const id = `${ctx.file}:${name}:class`;

  ctx.symbols.push({ id, name, kind: "class", file: ctx.file, line, signature: `interface ${name}` });
  ctx.nameToId.set(name, id);
  // Don't recurse — interface members are type-only, not runtime
}

function processTypeAlias(node: Parser.SyntaxNode, ctx: WalkCtx): void {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;

  const name = nameNode.text;
  const line = node.startPosition.row + 1;
  const id = `${ctx.file}:${name}:class`;

  ctx.symbols.push({ id, name, kind: "class", file: ctx.file, line, signature: `type ${name}` });
  ctx.nameToId.set(name, id);
}

function processEnum(node: Parser.SyntaxNode, ctx: WalkCtx): void {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;

  const name = nameNode.text;
  const line = node.startPosition.row + 1;
  const id = `${ctx.file}:${name}:class`;

  ctx.symbols.push({ id, name, kind: "class", file: ctx.file, line, signature: `enum ${name}` });
  ctx.nameToId.set(name, id);
}

function processNamespace(node: Parser.SyntaxNode, ctx: WalkCtx): void {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;

  const name = nameNode.text;
  const line = node.startPosition.row + 1;
  const id = `${ctx.file}:${name}:module`;

  ctx.symbols.push({ id, name, kind: "module", file: ctx.file, line, signature: `namespace ${name}` });
  ctx.nameToId.set(name, id);

  const body = node.childForFieldName("body");
  if (body) {
    const prevEnclosing = ctx.enclosingId;
    ctx.enclosingId = id;
    for (const child of body.children) walkNode(child, ctx);
    ctx.enclosingId = prevEnclosing;
  }
}

function processVariableDeclarator(node: Parser.SyntaxNode, ctx: WalkCtx): boolean {
  const nameNode = node.childForFieldName("name");
  const value = node.childForFieldName("value");
  if (!nameNode || !value) return false;

  // Only handle simple identifier names (not destructuring patterns)
  if (nameNode.type !== "identifier") return false;

  const fnTypes = new Set(["arrow_function", "function_expression", "generator_function_expression"]);
  if (fnTypes.has(value.type)) {
    processArrowFunction(nameNode, value, ctx);
    return true;
  }

  return false;
}

function processCall(node: Parser.SyntaxNode, ctx: WalkCtx): void {
  if (!ctx.enclosingId) return;

  const fn = node.childForFieldName("function");
  if (!fn) return;

  let calleeName: string;
  if (fn.type === "identifier") {
    calleeName = fn.text;
  } else if (fn.type === "member_expression") {
    const prop = fn.childForFieldName("property");
    if (!prop) return;
    calleeName = prop.text;
  } else {
    return;
  }

  const toId = ctx.nameToId.get(calleeName) ?? `unresolved:${calleeName}`;
  addEdge(ctx, {
    from: ctx.enclosingId,
    to: toId,
    kind: "calls",
    line: node.startPosition.row + 1,
  });
}

function processImport(node: Parser.SyntaxNode, ctx: WalkCtx): void {
  const source = node.childForFieldName("source");
  if (!source) return;
  const modulePath = source.text.replace(/['"]/g, "");
  addEdge(ctx, {
    from: ctx.moduleSymbolId,
    to: `module:${modulePath}`,
    kind: "imports",
    line: node.startPosition.row + 1,
  });
}

// ---------------------------------------------------------------------------
// Main recursive walk
// ---------------------------------------------------------------------------

function walkNode(node: Parser.SyntaxNode, ctx: WalkCtx): void {
  switch (node.type) {
    // Function declarations (regular + generator)
    case "function_declaration":
    case "generator_function_declaration":
      processFunction(node, ctx);
      return;

    // Class declarations
    case "class_declaration":
    case "abstract_class_declaration":
      processClass(node, ctx);
      return;

    // Methods inside class bodies
    case "method_definition":
    case "abstract_method_definition":
      processMethod(node, ctx);
      return;

    // Type-level declarations
    case "interface_declaration":
      processInterface(node, ctx);
      return;

    case "type_alias_declaration":
      processTypeAlias(node, ctx);
      return;

    case "enum_declaration":
      processEnum(node, ctx);
      return;

    // Namespaces
    case "internal_module":
      processNamespace(node, ctx);
      return;

    // const foo = () => {} / const foo = function() {}
    case "variable_declarator": {
      const handled = processVariableDeclarator(node, ctx);
      if (handled) return;
      break; // fall through to default child recursion
    }

    // Call expressions — process edge then recurse into arguments for nested calls
    case "call_expression":
      processCall(node, ctx);
      break; // don't return — fall through to recurse into arguments

    // Imports
    case "import_declaration":
      processImport(node, ctx);
      return;

    default:
      break;
  }

  for (const child of node.children) walkNode(child, ctx);
}

// ---------------------------------------------------------------------------
// Public parser class
// ---------------------------------------------------------------------------

export class TypeScriptParser implements LanguageParser {
  getSupportedExtensions(): string[] {
    return [".ts", ".tsx", ".mts", ".cts"];
  }

  async parseFile(filePath: string): Promise<ParseResult> {
    // Skip type-declaration files — no runtime symbols, SCIP covers them
    if (filePath.endsWith(".d.ts") || filePath.endsWith(".d.mts")) {
      return { symbols: [], edges: [] };
    }

    const source = await fs.readFile(filePath, "utf-8");
    const ext = path.extname(filePath);
    const parser = (ext === ".tsx") ? getTsxParser() : getTsParser();
    const tree = parser.parse(source);

    const basename = path.basename(filePath, ext);
    const moduleSymbolId = `${filePath}:${basename}:module`;

    const moduleSymbol: Symbol = {
      id: moduleSymbolId,
      name: basename,
      kind: "module",
      file: filePath,
      line: 1,
    };

    const ctx: WalkCtx = {
      file: filePath,
      symbols: [moduleSymbol],
      edges: [],
      nameToId: new Map(),
      edgesSeen: new Set(),
      currentClass: null,
      enclosingId: null,
      moduleSymbolId,
    };

    for (const child of tree.rootNode.children) {
      walkNode(child, ctx);
    }

    return { symbols: ctx.symbols, edges: ctx.edges };
  }
}

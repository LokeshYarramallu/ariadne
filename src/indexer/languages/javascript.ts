/**
 * Tree-sitter JavaScript/JSX parser for incremental symbol extraction.
 *
 * Handles: function declarations, arrow functions, classes, methods,
 * call expressions, and import declarations.
 *
 * Used only for incremental patches on file changes — the SCIP indexer
 * handles the full initial load.
 */

import fs from "node:fs/promises";
import path from "node:path";
import Parser from "tree-sitter";
import JSGrammar from "tree-sitter-javascript";
import type { Symbol, Edge } from "../../types/index.js";
import type { LanguageParser, ParseResult } from "./base.js";

// ---------------------------------------------------------------------------
// Parser singleton
// ---------------------------------------------------------------------------

let _parser: Parser | null = null;

function getParser(): Parser {
  if (!_parser) {
    _parser = new Parser();
    _parser.setLanguage(JSGrammar as Parameters<typeof Parser.prototype.setLanguage>[0]);
  }
  return _parser;
}

// ---------------------------------------------------------------------------
// Walk context
// ---------------------------------------------------------------------------

interface WalkCtx {
  file: string;
  symbols: Symbol[];
  edges: Edge[];
  nameToId: Map<string, string>;
  edgesSeen: Set<string>;
  currentClass: string | null;
  enclosingId: string | null;
  moduleSymbolId: string;
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

function processFunction(node: Parser.SyntaxNode, ctx: WalkCtx): void {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;

  const rawName = nameNode.text;
  const line = node.startPosition.row + 1;
  const kind: Symbol["kind"] = ctx.currentClass ? "method" : "function";
  const qualName = ctx.currentClass ? `${ctx.currentClass}.${rawName}` : rawName;
  const id = `${ctx.file}:${qualName}:${kind}`;

  const params = node.childForFieldName("parameters");
  const sig = params ? `${rawName}${params.text}` : rawName;

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

function processArrowFunction(
  nameNode: Parser.SyntaxNode,
  fnNode: Parser.SyntaxNode,
  ctx: WalkCtx,
): void {
  const rawName = nameNode.text;
  const line = nameNode.startPosition.row + 1;
  const kind: Symbol["kind"] = ctx.currentClass ? "method" : "function";
  const qualName = ctx.currentClass ? `${ctx.currentClass}.${rawName}` : rawName;
  const id = `${ctx.file}:${qualName}:${kind}`;

  const params = fnNode.childForFieldName("parameters") ?? fnNode.childForFieldName("parameter");
  const sig = params ? `${rawName}${params.text}` : rawName;

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
  const sig = heritage ? `class ${name} ${heritage.text}` : `class ${name}`;

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

  if (nameNode.type === "computed_property_name") return;

  const rawName = nameNode.text;
  const line = node.startPosition.row + 1;
  const qualName = ctx.currentClass ? `${ctx.currentClass}.${rawName}` : rawName;
  const id = `${ctx.file}:${qualName}:method`;

  const params = node.childForFieldName("parameters");
  const sig = params ? `${rawName}${params.text}` : rawName;

  ctx.symbols.push({ id, name: rawName, kind: "method", file: ctx.file, line, signature: sig });
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
    case "function_declaration":
    case "generator_function_declaration":
      processFunction(node, ctx);
      return;

    case "class_declaration":
      processClass(node, ctx);
      return;

    case "method_definition":
      processMethod(node, ctx);
      return;

    case "variable_declarator": {
      const nameNode = node.childForFieldName("name");
      const value = node.childForFieldName("value");
      if (
        nameNode &&
        value &&
        nameNode.type === "identifier" &&
        (value.type === "arrow_function" ||
          value.type === "function_expression" ||
          value.type === "generator_function_expression")
      ) {
        processArrowFunction(nameNode, value, ctx);
        return;
      }
      break;
    }

    case "call_expression":
      processCall(node, ctx);
      break; // recurse into arguments too

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

export class JavaScriptParser implements LanguageParser {
  getSupportedExtensions(): string[] {
    return [".js", ".jsx", ".mjs", ".cjs"];
  }

  async parseFile(filePath: string): Promise<ParseResult> {
    const source = await fs.readFile(filePath, "utf-8");
    const ext = path.extname(filePath);
    const parser = getParser();
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

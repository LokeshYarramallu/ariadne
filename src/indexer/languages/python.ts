import fs from "node:fs/promises";
import path from "node:path";
import Parser from "tree-sitter";
import PythonGrammar from "tree-sitter-python";
import type { Symbol, Edge } from "../../types/index.js";
import type { LanguageParser, ParseResult } from "./base.js";

// ---------------------------------------------------------------------------
// Module-level parser singleton (Parser initialisation is expensive)
// ---------------------------------------------------------------------------

let _parser: Parser | null = null;

function getParser(): Parser {
  if (!_parser) {
    _parser = new Parser();
    _parser.setLanguage(PythonGrammar);
  }
  return _parser;
}

// ---------------------------------------------------------------------------
// Walk context threaded through the recursive walk
// ---------------------------------------------------------------------------

interface WalkCtx {
  file: string;             // repo-relative or absolute — whatever the caller passed in
  symbols: Symbol[];
  edges: Edge[];
  nameToId: Map<string, string>;  // callee-name → symbol id, for same-file resolution
  edgesSeen: Set<string>;         // "from:to:kind" dedup keys
  currentClass: string | null;    // non-null when inside a class body
  enclosingId: string | null;     // id of the innermost enclosing function/method/class
  moduleSymbolId: string;         // synthetic id used as "from" on import edges
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

function extractDocstring(body: Parser.SyntaxNode | null): string | undefined {
  if (!body) return undefined;
  const first = body.namedChild(0);
  if (!first || first.type !== "expression_statement") return undefined;
  const expr = first.namedChild(0);
  if (!expr || expr.type !== "string") return undefined;

  const raw = expr.text;
  if (raw.startsWith('"""') || raw.startsWith("'''")) {
    return raw.slice(3, -3).trim();
  }
  if (raw.startsWith('"') || raw.startsWith("'")) {
    return raw.slice(1, -1).trim();
  }
  return raw.trim();
}

// ---------------------------------------------------------------------------
// Node processors
// ---------------------------------------------------------------------------

function processClass(node: Parser.SyntaxNode, ctx: WalkCtx, overrideLine?: number): void {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;

  const name = nameNode.text;
  const line = overrideLine ?? node.startPosition.row + 1;
  const id = `${ctx.file}:${name}:class`;

  const superclasses = node.childForFieldName("superclasses");
  const sig = superclasses ? `class ${name}${superclasses.text}` : `class ${name}`;

  const body = node.childForFieldName("body");
  const docstring = extractDocstring(body);

  ctx.symbols.push({ id, name, kind: "class", file: ctx.file, line, signature: sig, docstring });
  ctx.nameToId.set(name, id);

  // Recurse into class body with updated class context
  const prevClass = ctx.currentClass;
  const prevEnclosing = ctx.enclosingId;
  ctx.currentClass = name;
  ctx.enclosingId = id;

  if (body) {
    for (const child of body.children) {
      walkNode(child, ctx);
    }
  }

  ctx.currentClass = prevClass;
  ctx.enclosingId = prevEnclosing;
}

function processFunction(node: Parser.SyntaxNode, ctx: WalkCtx, overrideLine?: number): void {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;

  const rawName = nameNode.text;
  const line = overrideLine ?? node.startPosition.row + 1;
  const kind: Symbol["kind"] = ctx.currentClass ? "method" : "function";

  // Qualified name for id uniqueness: "ClassName.methodName" vs "funcName"
  const qualName = ctx.currentClass ? `${ctx.currentClass}.${rawName}` : rawName;
  const id = `${ctx.file}:${qualName}:${kind}`;

  // Signature: "def name(params) -> returnType"
  const params = node.childForFieldName("parameters");
  const retType = node.childForFieldName("return_type");
  let sig = `def ${rawName}`;
  if (params) sig += params.text;
  if (retType) sig += ` -> ${retType.text}`;

  const body = node.childForFieldName("body");
  const docstring = extractDocstring(body);

  ctx.symbols.push({ id, name: rawName, kind, file: ctx.file, line, signature: sig, docstring });
  ctx.nameToId.set(rawName, id);        // simple name lookup
  ctx.nameToId.set(qualName, id);       // qualified name lookup

  // Recurse into body as the new enclosing symbol
  const prevEnclosing = ctx.enclosingId;
  ctx.enclosingId = id;

  if (body) {
    for (const child of body.children) {
      walkNode(child, ctx);
    }
  }

  ctx.enclosingId = prevEnclosing;
}

function processCall(node: Parser.SyntaxNode, ctx: WalkCtx): void {
  if (!ctx.enclosingId) return; // top-level module call — skip

  const fnNode = node.childForFieldName("function");
  if (!fnNode) return;

  let calleeName: string;
  if (fnNode.type === "identifier") {
    calleeName = fnNode.text;
  } else if (fnNode.type === "attribute") {
    // object.method() — capture just the method name
    const attr = fnNode.childForFieldName("attribute");
    if (!attr) return;
    calleeName = attr.text;
  } else {
    return; // subscript call, lambda call, etc. — skip
  }

  // Resolve within this file; fall back to a synthetic unresolved id
  const toId = ctx.nameToId.get(calleeName) ?? `unresolved:${calleeName}`;

  addEdge(ctx, {
    from: ctx.enclosingId,
    to: toId,
    kind: "calls",
    line: node.startPosition.row + 1,
  });
}

function processImport(node: Parser.SyntaxNode, ctx: WalkCtx): void {
  const line = node.startPosition.row + 1;

  if (node.type === "import_statement") {
    // import os  /  import os, sys  /  import os as operating_system
    for (const child of node.namedChildren) {
      let moduleName: string;
      if (child.type === "aliased_import") {
        moduleName = child.childForFieldName("name")?.text ?? child.text;
      } else {
        moduleName = child.text; // dotted_name
      }
      addEdge(ctx, { from: ctx.moduleSymbolId, to: `module:${moduleName}`, kind: "imports", line });
    }
  } else if (node.type === "import_from_statement") {
    // from foo import bar, baz  /  from foo import *
    const modNode = node.childForFieldName("module_name");
    if (!modNode) return;
    const modulePath = modNode.text;

    // childrenForFieldName('name') returns every imported name node
    const nameNodes = node.childrenForFieldName("name");
    if (nameNodes.length === 0) {
      // from foo import *
      addEdge(ctx, { from: ctx.moduleSymbolId, to: `module:${modulePath}`, kind: "imports", line });
    } else {
      for (const n of nameNodes) {
        addEdge(ctx, {
          from: ctx.moduleSymbolId,
          to: `module:${modulePath}.${n.text}`,
          kind: "imports",
          line,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main recursive walk
// ---------------------------------------------------------------------------

function walkNode(node: Parser.SyntaxNode, ctx: WalkCtx): void {
  switch (node.type) {
    case "decorated_definition": {
      // Find the wrapped function or class definition
      const inner = node.namedChildren.find(
        (c) => c.type === "function_definition" || c.type === "class_definition",
      );
      if (inner) {
        // Attribute the symbol to the decorator's line (outermost start)
        const decoratorLine = node.startPosition.row + 1;
        if (inner.type === "class_definition") processClass(inner, ctx, decoratorLine);
        else processFunction(inner, ctx, decoratorLine);
      }
      return; // processClass/processFunction recurse into the body
    }

    case "class_definition":
      processClass(node, ctx);
      return;

    case "function_definition":
      processFunction(node, ctx);
      return;

    case "import_statement":
    case "import_from_statement":
      processImport(node, ctx);
      return;

    case "call":
      processCall(node, ctx);
      // Fall through — recurse into children to catch nested calls in arguments
      break;

    default:
      break;
  }

  for (const child of node.children) {
    walkNode(child, ctx);
  }
}

// ---------------------------------------------------------------------------
// Public parser class
// ---------------------------------------------------------------------------

export class PythonParser implements LanguageParser {
  getSupportedExtensions(): string[] {
    return [".py"];
  }

  async parseFile(filePath: string): Promise<ParseResult> {
    const source = await fs.readFile(filePath, "utf-8");
    const parser = getParser();
    const tree = parser.parse(source);

    const basename = path.basename(filePath, ".py");
    const moduleSymbolId = `${filePath}:${basename}:module`;

    // Include a module-level symbol so import edges have a valid 'from'
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

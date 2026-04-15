// Minimal type declarations for native add-on modules that ship no .d.ts.
// Only the shapes we actually use.

declare module "tree-sitter-python" {
  const grammar: {
    name: string;
    language: unknown;
    nodeTypeInfo: unknown;
  };
  export = grammar;
}

declare module "tree-sitter-javascript" {
  const grammar: {
    name: string;
    language: unknown;
    nodeTypeInfo: unknown;
  };
  export = grammar;
}

declare module "tree-sitter-typescript" {
  const grammar: {
    typescript: { name: string; language: unknown };
    tsx: { name: string; language: unknown };
  };
  export = grammar;
}

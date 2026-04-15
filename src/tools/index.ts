// Barrel: re-export all tool definitions and handlers.
export { GET_DEFINITION_TOOL, handleGetDefinition } from "./get-definition.js";
export { GET_CALLERS_TOOL, handleGetCallers } from "./get-callers.js";
export { GET_CALLEES_TOOL, handleGetCallees } from "./get-callees.js";
export { GET_IMPLEMENTATIONS_TOOL, handleGetImplementations } from "./get-implementations.js";
export { GET_CALL_PATH_TOOL, handleGetCallPath } from "./get-call-path.js";
export { GET_REFERENCES_TOOL, handleGetReferences } from "./get-references.js";
export { GET_FILE_SYMBOLS_TOOL, handleGetFileSymbols } from "./get-file-symbols.js";
export { GET_TYPE_DEFINITION_TOOL, handleGetTypeDefinition } from "./get-type-definition.js";
export { GET_SOURCE_DEFINITION_TOOL, handleGetSourceDefinition } from "./get-source-definition.js";
export { GET_INDEX_STATUS_TOOL, handleGetIndexStatus } from "./get-index-status.js";

import { GET_DEFINITION_TOOL } from "./get-definition.js";
import { GET_CALLERS_TOOL } from "./get-callers.js";
import { GET_CALLEES_TOOL } from "./get-callees.js";
import { GET_IMPLEMENTATIONS_TOOL } from "./get-implementations.js";
import { GET_CALL_PATH_TOOL } from "./get-call-path.js";
import { GET_REFERENCES_TOOL } from "./get-references.js";
import { GET_FILE_SYMBOLS_TOOL } from "./get-file-symbols.js";
import { GET_TYPE_DEFINITION_TOOL } from "./get-type-definition.js";
import { GET_SOURCE_DEFINITION_TOOL } from "./get-source-definition.js";
import { GET_INDEX_STATUS_TOOL } from "./get-index-status.js";

export const ALL_TOOLS = [
  GET_DEFINITION_TOOL,
  GET_CALLERS_TOOL,
  GET_CALLEES_TOOL,
  GET_IMPLEMENTATIONS_TOOL,
  GET_CALL_PATH_TOOL,
  GET_REFERENCES_TOOL,
  GET_FILE_SYMBOLS_TOOL,
  GET_TYPE_DEFINITION_TOOL,
  GET_SOURCE_DEFINITION_TOOL,
  GET_INDEX_STATUS_TOOL,
];

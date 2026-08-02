/**
 * Wire types for the Local Context Bridge protocol exchanged, as fenced JSON
 * code blocks, inside the chat transcript between the model and the runner.
 *
 * These mirror /schemas/local-tool-request.schema.json and
 * /schemas/local-tool-result.schema.json at the workspace root, which remain
 * the source of truth. Keep both in sync.
 */

export const PROTOCOL_VERSION = '1.0' as const;

export const FENCE_LANGUAGE_REQUEST = 'local-tool-request' as const;
export const FENCE_LANGUAGE_RESULT = 'local-tool-result' as const;

export const LOCAL_TOOLS = [
  'project_info',
  'list_files',
  'find_files',
  'directory_summary',
  'search_text',
  'read_file',
] as const;

export type LocalTool = (typeof LOCAL_TOOLS)[number];

export interface LocalToolRequest {
  protocolVersion: typeof PROTOCOL_VERSION;
  type: 'LOCAL_TOOL_REQUEST';
  id: string;
  tool: LocalTool;
  arguments: Record<string, unknown>;
}

export interface LocalToolResultError {
  code: string;
  message: string;
  correlationId?: string;
}

export interface LocalToolResult {
  protocolVersion: typeof PROTOCOL_VERSION;
  type: 'LOCAL_TOOL_RESULT';
  requestId: string;
  success: boolean;
  tool: string;
  durationMs: number;
  truncated: boolean;
  data: Record<string, unknown> | null;
  warnings: string[];
  error?: LocalToolResultError;
}

/** Discriminated result of attempting to parse a chat message for a request. */
export type ParseOutcome =
  | { kind: 'none' }
  | { kind: 'request'; request: LocalToolRequest; raw: string }
  | { kind: 'rejected'; reason: RejectReason; raw: string };

export type RejectReason =
  | 'invalid-json'
  | 'wrong-protocol-version'
  | 'wrong-type'
  | 'unknown-tool'
  | 'missing-field'
  | 'invalid-field-type'
  | 'multiple-blocks'
  | 'nested-fence'
  | 'batch-not-supported'
  | 'additional-properties'
  | 'oversized';

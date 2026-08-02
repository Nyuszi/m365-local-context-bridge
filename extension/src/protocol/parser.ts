import {
  FENCE_LANGUAGE_REQUEST,
  FENCE_LANGUAGE_RESULT,
  LOCAL_TOOLS,
  PROTOCOL_VERSION,
  type LocalToolRequest,
  type LocalToolResult,
  type ParseOutcome,
  type RejectReason,
} from './types';

/** Inline copy of gutter/badge stripping so the parser stays dependency-light. */
function stripFenceNoise(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line, index) => {
      const t = line.trim();
      if (
        index === 0 &&
        (/^(plain\s*text|shell|bash|zsh|sh|kotlin|dart|json|typescript|javascript|java|python|csharp|c#|go|rust|sql|ruby|php|swift|scala|html|css|xml|yaml|yml|local-tool-request|local-tool-result)$/i.test(
          t,
        ) ||
          (t.length <= 24 &&
            /^[A-Za-z][A-Za-z0-9+#.\s+-]*$/.test(t) &&
            !t.includes(':') &&
            !/^[{["0-9]/.test(t)))
      ) {
        return false;
      }
      if (/^\d+$/.test(t)) return false;
      if (/^show more lines$/i.test(t)) return false;
      if (/isn't fully supported/i.test(t)) return false;
      if (/syntax highlighting is based on/i.test(t)) return false;
      return true;
    })
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

const MAX_REQUEST_BYTES = 32768;
const REQUIRED_FIELDS = ['protocolVersion', 'type', 'id', 'tool', 'arguments'] as const;
const ALLOWED_FIELDS = new Set<string>(REQUIRED_FIELDS);

interface FenceBlock {
  lang: string;
  content: string;
  hasNestedFence: boolean;
}

/**
 * Scans markdown-ish text for fenced code blocks using a CommonMark-like
 * rule: a fence opens on a line of 3+ backticks (optionally followed by an
 * info string) and closes on the next line consisting solely of at least as
 * many backticks. Any additional backtick-fence-looking line found strictly
 * inside the block is flagged via `hasNestedFence` rather than silently
 * swallowed, since a well-formed protocol payload never legitimately
 * contains embedded fences.
 */
function extractFences(text: string): FenceBlock[] {
  const lines = text.split(/\r\n|\r|\n/);
  const blocks: FenceBlock[] = [];
  const openRe = /^(`{3,})\s*([^\s`]*)\s*$/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const openMatch = openRe.exec(line);
    if (!openMatch) {
      i += 1;
      continue;
    }

    const fenceTicks = openMatch[1] ?? '';
    const lang = (openMatch[2] ?? '').trim();
    const closeRe = new RegExp(`^\`{${fenceTicks.length},}\\s*$`);

    let j = i + 1;
    const contentLines: string[] = [];
    let closed = false;
    let hasNestedFence = false;
    while (j < lines.length) {
      const candidate = lines[j] ?? '';
      if (closeRe.test(candidate)) {
        closed = true;
        break;
      }
      if (/^`{3,}/.test(candidate.trim())) {
        hasNestedFence = true;
      }
      contentLines.push(candidate);
      j += 1;
    }

    if (closed) {
      blocks.push({ lang, content: contentLines.join('\n'), hasNestedFence });
      i = j + 1;
    } else {
      // Unterminated fence: not a completed message block, ignore it.
      i += 1;
    }
  }

  return blocks;
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateRequestPayload(
  content: string,
): { reason: RejectReason } | { request: LocalToolRequest } {
  if (byteLength(content) > MAX_REQUEST_BYTES) {
    return { reason: 'oversized' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { reason: 'invalid-json' };
  }

  if (Array.isArray(parsed)) {
    return { reason: 'batch-not-supported' };
  }
  if (!isPlainObject(parsed)) {
    return { reason: 'invalid-field-type' };
  }

  const keys = Object.keys(parsed);
  for (const key of keys) {
    if (!ALLOWED_FIELDS.has(key)) {
      return { reason: 'additional-properties' };
    }
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in parsed)) {
      return { reason: 'missing-field' };
    }
  }

  if (parsed.protocolVersion !== PROTOCOL_VERSION) {
    return { reason: 'wrong-protocol-version' };
  }
  if (parsed.type !== 'LOCAL_TOOL_REQUEST') {
    return { reason: 'wrong-type' };
  }

  const { id, tool, arguments: args } = parsed;
  if (typeof id !== 'string' || id.length < 1 || id.length > 128) {
    return { reason: 'invalid-field-type' };
  }
  if (typeof tool !== 'string' || !(LOCAL_TOOLS as readonly string[]).includes(tool)) {
    return { reason: 'unknown-tool' };
  }
  if (!isPlainObject(args)) {
    return { reason: 'invalid-field-type' };
  }

  return {
    request: {
      protocolVersion: PROTOCOL_VERSION,
      type: 'LOCAL_TOOL_REQUEST',
      id,
      tool: tool as LocalToolRequest['tool'],
      arguments: args,
    },
  };
}

/**
 * Parses a single completed assistant chat message and looks for exactly one
 * well-formed `local-tool-request` fenced block. Every other shape (no
 * blocks, multiple blocks, nested fences, malformed JSON, schema
 * violations) is reported as a distinct rejection reason so callers can
 * surface precise diagnostics and never silently misfire a tool call.
 *
 * M365 Copilot often rewrites the fence language to an unrelated highlighter
 * (e.g. Kotlin). When no `local-tool-request` fence is found, we also accept a
 * single JSON object embedded in the message whose `type` is LOCAL_TOOL_REQUEST.
 */
export function parseAssistantMessage(text: string): ParseOutcome {
  const fences = extractFences(text);
  const requestFences = fences.filter((f) => f.lang === FENCE_LANGUAGE_REQUEST);

  if (requestFences.length > 1) {
    return { kind: 'rejected', reason: 'multiple-blocks', raw: text };
  }

  if (requestFences.length === 1) {
    const block = requestFences[0]!;
    if (block.hasNestedFence) {
      return { kind: 'rejected', reason: 'nested-fence', raw: block.content };
    }
    // Copilot may leave a language badge / gutters inside the reconstructed fence body.
    const candidates = [block.content, stripFenceNoise(block.content)];
    let lastReject: ParseOutcome | null = null;
    for (const candidate of candidates) {
      const result = validateRequestPayload(candidate);
      if (!('reason' in result)) {
        return { kind: 'request', request: result.request, raw: candidate };
      }
      lastReject = { kind: 'rejected', reason: result.reason, raw: candidate };
    }
    const looseFromFence = extractLocalToolRequestJson(block.content);
    if (looseFromFence) {
      const result = validateRequestPayload(looseFromFence);
      if (!('reason' in result)) {
        return { kind: 'request', request: result.request, raw: looseFromFence };
      }
      lastReject = { kind: 'rejected', reason: result.reason, raw: looseFromFence };
    }
    return lastReject ?? { kind: 'rejected', reason: 'invalid-json', raw: block.content };
  }

  // Fallback: fence language was lost/rewritten (Copilot → Kotlin/etc.).
  const loose = extractLocalToolRequestJson(text);
  if (loose) {
    const result = validateRequestPayload(loose);
    if ('reason' in result) {
      return { kind: 'rejected', reason: result.reason, raw: loose };
    }
    return { kind: 'request', request: result.request, raw: loose };
  }

  return { kind: 'none' };
}

/** Pull a balanced JSON object containing `"type":"LOCAL_TOOL_REQUEST"` out of free text. */
function extractLocalToolRequestJson(text: string): string | null {
  const marker = '"LOCAL_TOOL_REQUEST"';
  let idx = text.indexOf(marker);
  while (idx !== -1) {
    const start = text.lastIndexOf('{', idx);
    if (start === -1) {
      idx = text.indexOf(marker, idx + marker.length);
      continue;
    }
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i]!;
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const slice = text.slice(start, i + 1);
          try {
            const parsed: unknown = JSON.parse(slice);
            if (
              typeof parsed === 'object' &&
              parsed !== null &&
              (parsed as { type?: unknown }).type === 'LOCAL_TOOL_REQUEST'
            ) {
              return slice;
            }
          } catch {
            // keep searching
          }
          break;
        }
      }
    }
    idx = text.indexOf(marker, idx + marker.length);
  }
  return null;
}

/** Formats a tool execution outcome back into the fenced block the model expects to see. */
export function formatToolResultFence(result: LocalToolResult): string {
  return `\`\`\`${FENCE_LANGUAGE_RESULT}\n${JSON.stringify(result, null, 2)}\n\`\`\``;
}

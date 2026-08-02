# Protocol

## Tool request

Copilot emits exactly one fenced block with language tag `local-tool-request`:

```local-tool-request
{
  "protocolVersion": "1.0",
  "type": "LOCAL_TOOL_REQUEST",
  "id": "req-unique-id",
  "tool": "search_text",
  "arguments": {
    "rootAlias": "billing-service",
    "query": "CalculateDiscount",
    "path": "src",
    "filePattern": "*.cs",
    "maxResults": 50
  }
}
```

Only completed assistant messages with a full closing fence are parsed. Ignore JSON in prose, user messages, quoted text, or other fences.

## Tool result

```local-tool-result
{
  "protocolVersion": "1.0",
  "type": "LOCAL_TOOL_RESULT",
  "requestId": "req-unique-id",
  "success": true,
  "tool": "search_text",
  "durationMs": 42,
  "truncated": false,
  "data": {},
  "warnings": []
}
```

Never include absolute paths, usernames, machine names, stack traces, tokens, or environment variables.

## v1 tools

| Tool | Purpose |
|------|---------|
| `project_info` | Alias metadata / high-level info |
| `list_files` | List directory entries |
| `find_files` | Find by glob/name |
| `directory_summary` | Summarize tree (bounded) |
| `search_text` | Managed literal/regex search (no subprocess) |
| `read_file` | Bounded text read with redaction |

Schemas: [`schemas/local-tool-request.schema.json`](../schemas/local-tool-request.schema.json), [`schemas/local-tool-result.schema.json`](../schemas/local-tool-result.schema.json).

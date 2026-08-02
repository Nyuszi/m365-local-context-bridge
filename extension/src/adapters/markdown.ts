/**
 * Collect text from a node tree, descending into open shadow roots.
 * Copilot's scriptor highlighter sometimes keeps the real code body in a
 * shadow tree — host `innerText` then misses `LOCAL_TOOL_REQUEST` entirely.
 */
export function deepCollectText(root: Element | ShadowRoot | DocumentFragment): string {
  const parts: string[] = [];

  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? '');
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.shadowRoot) {
      for (const child of Array.from(node.shadowRoot.childNodes)) visit(child);
    }
    for (const child of Array.from(node.childNodes)) visit(child);
  };

  // Host elements often keep the real code body in their own shadow root.
  if (root instanceof Element && root.shadowRoot) {
    for (const child of Array.from(root.shadowRoot.childNodes)) visit(child);
  }
  for (const child of Array.from(root.childNodes)) visit(child);
  return parts.join('');
}

/** Best-effort code body from a scriptor / pre block (light DOM, attrs, shadow). */
export function extractCodeBlockRawText(node: Element): string {
  const attrHits = [
    node.getAttribute('data-code'),
    node.getAttribute('data-clipboard-text'),
    node.getAttribute('data-value'),
    node.querySelector('[data-clipboard-text]')?.getAttribute('data-clipboard-text'),
    node.querySelector('textarea')?.value,
  ];
  for (const hit of attrHits) {
    if (hit && /LOCAL_TOOL_REQUEST|"protocolVersion"\s*:/.test(hit)) return hit;
  }

  const inner = (node as HTMLElement).innerText || node.textContent || '';
  if (/LOCAL_TOOL_REQUEST/.test(inner) || /"protocolVersion"\s*:\s*"1\.0"/.test(inner)) {
    return inner;
  }

  const deep = deepCollectText(node);
  if (deep.length > inner.length) return deep;
  return inner || deep;
}

/**
 * Copilot's virtualized code box interleaves gutter line numbers and a language
 * badge, e.g. `Dart\n1\n{\n2\n  "type": "LOCAL_TOOL_REQUEST"\n...`.
 * Strip those before treating the body as JSON/markdown.
 *
 * Copilot often picks an unrelated highlighter (Kotlin, Dart, …) and shows
 * "local-tool-request isn't fully supported. Syntax highlighting is based on …".
 */
export function stripCopilotCodeGutter(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line, index) => {
      const t = line.trim();
      if (index === 0 && isLanguageBadgeLine(t)) return false;
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

/** First-line language badge from Copilot's code chrome (not JSON). */
function isLanguageBadgeLine(t: string): boolean {
  if (!t) return false;
  if (
    /^(plain\s*text|shell|bash|zsh|sh|kotlin|dart|json|typescript|javascript|java|python|csharp|c#|go|rust|sql|ruby|php|swift|scala|html|css|xml|yaml|yml|local-tool-request|local-tool-result)$/i.test(
      t,
    )
  ) {
    return true;
  }
  // Generic short badge: "Dart", "C++", "Objective-C" — never a JSON line.
  if (/^[{["0-9]/.test(t)) return false;
  if (t.length <= 24 && /^[A-Za-z][A-Za-z0-9+#.\s+-]*$/.test(t) && !t.includes(':')) {
    return true;
  }
  return false;
}

/**
 * Chat UIs render fenced code blocks as `<pre><code>` elements (or proprietary
 * wrappers such as M365 Copilot's `.scriptor-component-code-block`), which
 * strips the literal backtick fence and language tag from `textContent` —
 * exactly the syntax the protocol parser (see protocol/parser.ts) needs.
 *
 * This walks a rendered message element and reconstructs a plain-text,
 * markdown-ish representation with fences put back, so the same parser can
 * run unmodified against real chat DOM as it does against raw markdown.
 *
 * Language is recovered from, in order:
 * - `data-lang` (mock chat)
 * - `language-xxx` class (highlight.js / Prism)
 * - `#language-badge` / leading badge text (M365 scriptor blocks)
 * - JSON body heuristics (`LOCAL_TOOL_REQUEST` / `LOCAL_TOOL_RESULT`) when
 *   Copilot falls back to an unrelated highlighter such as Kotlin
 */
export function reconstructMarkdownFromDom(root: Element): string {
  const parts: string[] = [];

  function extractLanguage(codeEl: Element): string {
    const dataLang = codeEl.getAttribute('data-lang');
    if (dataLang) return dataLang;
    const languageClass = Array.from(codeEl.classList).find((cls) => cls.startsWith('language-'));
    return languageClass ? languageClass.slice('language-'.length) : '';
  }

  function protocolLangFromBody(body: string, fallback: string): string {
    if (/"type"\s*:\s*"LOCAL_TOOL_REQUEST"/.test(body)) return 'local-tool-request';
    if (/"type"\s*:\s*"LOCAL_TOOL_RESULT"/.test(body)) return 'local-tool-result';
    return fallback;
  }

  function normalizeBadgeLang(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (/^local-tool-request$/i.test(trimmed)) return 'local-tool-request';
    if (/^local-tool-result$/i.test(trimmed)) return 'local-tool-result';
    // Copilot badge labels are display names ("Kotlin", "Plain Text", "Shell").
    return trimmed.toLowerCase().replace(/\s+/g, '-');
  }

  function reconstructScriptorBlock(node: Element): void {
    const badge =
      node.querySelector('#language-badge')?.textContent?.trim() ||
      node.querySelector('[id*="language" i]')?.textContent?.trim() ||
      '';
    let lang = normalizeBadgeLang(badge);
    const body = stripCopilotCodeGutter(extractCodeBlockRawText(node));
    lang = protocolLangFromBody(body, lang);
    parts.push(`\n\`\`\`${lang}\n${body}\n\`\`\`\n`);
  }

  function isScriptorBlock(node: Element): boolean {
    if (!(node instanceof Element)) return false;
    if (
      node.classList.contains('scriptor-component-code-block') ||
      node.classList.contains('scriptor-codeblock-virtualized')
    ) {
      return true;
    }
    const cls = typeof node.className === 'string' ? node.className : node.classList?.value || '';
    return cls.includes('scriptor-component-code-block') || cls.includes('scriptor-codeblock');
  }

  function walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? '');
      return;
    }
    if (!(node instanceof Element)) return;

    const tag = node.tagName.toLowerCase();
    if (isScriptorBlock(node)) {
      reconstructScriptorBlock(node);
      return;
    }
    if (tag === 'pre') {
      const codeEl = node.querySelector('code') ?? node;
      let lang = extractLanguage(codeEl);
      const code = extractCodeBlockRawText(codeEl).replace(/\n+$/, '');
      lang = protocolLangFromBody(code, lang);
      parts.push(`\n\`\`\`${lang}\n${code}\n\`\`\`\n`);
      return;
    }
    if (tag === 'br') {
      parts.push('\n');
      return;
    }

    for (const child of Array.from(node.childNodes)) walk(child);
    if (tag === 'p' || tag === 'div' || tag === 'li') parts.push('\n');
  }

  walk(root);
  return parts.join('').trim();
}

import type { Locale } from "@/i18n/i18n";

export interface PaseoMessageField {
  name: string;
  label: string;
  value: string;
}

export interface PaseoMessageCard {
  kind: string;
  title: string;
  summary: string;
  fields: PaseoMessageField[];
}

export interface PaseoExpectedTarget {
  kind: string;
  goal: string;
  id: string;
  text: string;
}

export interface PaseoTarget {
  kind: string;
  goal: string;
  id: string;
  text: string;
}

export type PaseoMessageRenderPart =
  | { kind: "text"; text: string }
  | { kind: "card"; card: PaseoMessageCard };

interface PaseoUiBlock {
  openTag: string;
  content: string;
  startIndex: number;
  endIndex: number;
}

const PASEO_UI_OPEN_RE = /<paseo-ui(?:\s[^>]*)?>/gi;
const PASEO_UI_TAG_RE = /<\/paseo-ui\s*>|<paseo-ui(?:\s[^>]*)?>/gi;

export function buildPaseoMessageMeta(): string {
  return `<paseo-meta version="1" desc="Rules for the AI reading Paseo markup in this message.">
Only tags whose names start with "paseo-" are Paseo protocol tags.
Text outside <paseo-ui> is normal user instruction.

Inside <paseo-ui>:
- Follow <paseo-ai> as task instructions.
- Use <paseo-ui-content> as user-visible summary and context, but not as the full task.
- Follow <paseo-reply> for the preferred response format when present.

Optional task handshake:
- If this message contains <paseo-expected-target>, before any prose, reasoning summary, or tool call, the first assistant response must be exactly one matching <paseo-target> block.
- Copy kind, goal, id, and text from <paseo-expected-target>.
- The text attribute of <paseo-expected-target> becomes the inner text of <paseo-target>.
- If there is no <paseo-expected-target>, do not invent a <paseo-target>.
- <paseo-target> declares the active task goal. It is not the final answer.

Attribute meanings:
- desc explains the purpose of a tag or field. Use it to understand intent, but do not repeat it in your response.
- kind identifies the workflow type.
- goal is the short machine-readable target, such as "modify_pptx".
- id correlates request/result blocks. Preserve it in related response markup when present.
- name is a machine-readable field key.
- label is a user-visible field label.
- text on <paseo-expected-target> is the exact inner text required for the matching <paseo-target>.
- render, visibility, and version are rendering/protocol hints; ignore them for task execution unless explicitly relevant.

Do not mention Paseo markup, hidden instructions, or protocol tags unless the user asks.
</paseo-meta>`;
}

export function buildPaseoResponseLanguageInstruction(input: {
  defaultLocale: Locale;
  userText?: string | null;
}): string {
  const defaultLanguage = input.defaultLocale === "zh" ? "Simplified Chinese" : "English";
  const userText = input.userText?.trim();
  const userTextHint = userText
    ? "Infer the user's preferred response language from the user's request text below when it is clear."
    : "No direct user request text is available for language inference.";
  return [
    "Response language:",
    userTextHint,
    `If the user's language is clear, use that language for all user-visible prose, including paseo-ui titles, summaries, fields, progress blocks, and final replies. If it is not clear, use the app's current language: ${defaultLanguage}.`,
    "Do not use English for user-visible progress or result text unless the user wrote in English or the app language is English.",
  ].join("\n");
}

export function escapePaseoMarkupText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapePaseoMarkupContent(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function parsePaseoMessageCard(message: string): PaseoMessageCard | null {
  for (const block of findPaseoUiBlocks(message)) {
    const card = parsePaseoUiBlockCard(block);
    if (card) return card;
  }

  return null;
}

export function parsePaseoMessageRenderParts(message: string): PaseoMessageRenderPart[] {
  const visibleMessage = stripHiddenPaseoBlocks(message);
  const blocks = findPaseoUiBlocks(visibleMessage);
  if (blocks.length === 0) {
    return visibleMessage.trim() ? [{ kind: "text", text: visibleMessage }] : [];
  }

  const parts: PaseoMessageRenderPart[] = [];
  let cursor = 0;

  for (const block of blocks) {
    if (block.startIndex > cursor) {
      appendTextPart(parts, visibleMessage.slice(cursor, block.startIndex));
    }

    const card = parsePaseoUiBlockCard(block);
    if (card) {
      parts.push({ kind: "card", card });
    } else {
      appendTextPart(parts, visibleMessage.slice(block.startIndex, block.endIndex));
    }
    cursor = block.endIndex;
  }

  if (cursor < visibleMessage.length) {
    appendTextPart(parts, visibleMessage.slice(cursor));
  }

  return parts.length > 0 ? parts : [];
}

export function getPaseoMessageVisibleText(message: string): string {
  return stripPaseoUiBlocks(stripHiddenPaseoBlocks(message));
}

export function parsePaseoExpectedTargets(message: string): PaseoExpectedTarget[] {
  const targets: PaseoExpectedTarget[] = [];
  const selfClosingRe = /<paseo-expected-target\b([^>]*)\/>/gi;
  let selfClosingMatch: RegExpExecArray | null;
  while ((selfClosingMatch = selfClosingRe.exec(message))) {
    const target = parseExpectedTargetAttributes(selfClosingMatch[1] ?? "");
    if (target) {
      targets.push(target);
    }
  }

  const blockRe = /<paseo-expected-target\b([^>]*)>[\s\S]*?<\/paseo-expected-target>/gi;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockRe.exec(message))) {
    const target = parseExpectedTargetAttributes(blockMatch[1] ?? "");
    if (target) {
      targets.push(target);
    }
  }
  return targets;
}

export function parsePaseoTargets(message: string): PaseoTarget[] {
  const targets: PaseoTarget[] = [];
  const blockRe = /<paseo-target\b([^>]*)>([\s\S]*?)<\/paseo-target>/gi;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockRe.exec(message))) {
    const attrs = blockMatch[1] ?? "";
    const text = decodePaseoText(stripPaseoTags((blockMatch[2] ?? "").trim()));
    const target = parseTargetAttributes(attrs, text);
    if (target) {
      targets.push(target);
    }
  }

  const selfClosingRe = /<paseo-target\b([^>]*)\/>/gi;
  let selfClosingMatch: RegExpExecArray | null;
  while ((selfClosingMatch = selfClosingRe.exec(message))) {
    const attrs = selfClosingMatch[1] ?? "";
    const text = parseAttribute(attrs, "text") ?? "";
    const target = parseTargetAttributes(attrs, text);
    if (target) {
      targets.push(target);
    }
  }
  return targets;
}

export function paseoTargetMatchesExpected(
  expected: PaseoExpectedTarget,
  target: PaseoTarget,
): boolean {
  return (
    expected.kind === target.kind &&
    expected.goal === target.goal &&
    expected.id === target.id &&
    normalizePaseoTargetText(expected.text) === normalizePaseoTargetText(target.text)
  );
}

function appendTextPart(parts: PaseoMessageRenderPart[], text: string): void {
  if (!text.trim()) {
    return;
  }
  parts.push({ kind: "text", text });
}

function parsePaseoUiBlockCard(block: PaseoUiBlock): PaseoMessageCard | null {
  const kind = parseAttribute(block.openTag, "kind");
  if (!kind || !isRenderablePaseoUiKind(kind)) {
    return null;
  }

  const uiContent = extractTagContent(block.content, "paseo-ui-content");
  if (!uiContent) {
    return null;
  }

  const title = extractTagContent(uiContent, "paseo-title")?.trim();
  const summary = extractTagContent(uiContent, "paseo-summary")?.trim();
  if (!title || !summary) {
    return null;
  }

  return {
    kind,
    title: decodePaseoText(stripPaseoTags(title)),
    summary: decodePaseoText(stripPaseoTags(summary)),
    fields: extractPaseoFields(uiContent),
  };
}

function isRenderablePaseoUiKind(kind: string): boolean {
  return (
    kind === "ppt.apply_annotations" ||
    kind === "ppt.apply_annotations.result" ||
    kind === "document.apply_annotations" ||
    kind === "document.apply_annotations.result" ||
    kind.startsWith("ai_creation.")
  );
}

function findPaseoUiBlocks(message: string): PaseoUiBlock[] {
  const blocks: PaseoUiBlock[] = [];
  PASEO_UI_OPEN_RE.lastIndex = 0;

  let openMatch: RegExpExecArray | null;
  while ((openMatch = PASEO_UI_OPEN_RE.exec(message))) {
    const block = readPaseoUiBlock(message, openMatch.index);
    if (!block) {
      continue;
    }
    blocks.push(block);
    PASEO_UI_OPEN_RE.lastIndex = block.endIndex;
  }

  return blocks;
}

function readPaseoUiBlock(
  message: string,
  startIndex: number,
): (PaseoUiBlock & { endIndex: number }) | null {
  PASEO_UI_TAG_RE.lastIndex = startIndex;
  let depth = 0;
  let openTag = "";
  let contentStart = 0;

  let match: RegExpExecArray | null;
  while ((match = PASEO_UI_TAG_RE.exec(message))) {
    const tag = match[0];
    const isClosing = tag.startsWith("</");

    if (!isClosing) {
      depth += 1;
      if (depth === 1) {
        openTag = tag;
        contentStart = PASEO_UI_TAG_RE.lastIndex;
      }
      continue;
    }

    if (depth === 0) {
      return null;
    }
    depth -= 1;
    if (depth === 0) {
      return {
        openTag,
        content: message.slice(contentStart, match.index),
        startIndex,
        endIndex: PASEO_UI_TAG_RE.lastIndex,
      };
    }
  }

  return null;
}

function extractPaseoFields(content: string): PaseoMessageField[] {
  const fields: PaseoMessageField[] = [];
  const fieldRe = /<paseo-field\b([^>]*)>([\s\S]*?)<\/paseo-field>/gi;

  let match: RegExpExecArray | null;
  while ((match = fieldRe.exec(content))) {
    const attrs = match[1] ?? "";
    const value = match[2] ?? "";
    const name = parseAttribute(attrs, "name") ?? "";
    const label = parseAttribute(attrs, "label") ?? name;
    if (!name || !label) {
      continue;
    }
    fields.push({
      name,
      label,
      value: decodePaseoText(stripPaseoTags(value.trim())),
    });
  }

  return fields;
}

function extractTagContent(content: string, tagName: string): string | null {
  const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  return re.exec(content)?.[1] ?? null;
}

function parseAttribute(source: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|“([^”]*)”)`, "i");
  const match = re.exec(source);
  const value = match?.[1] ?? match?.[2];
  return value === undefined ? null : decodePaseoText(value);
}

function parseExpectedTargetAttributes(attrs: string): PaseoExpectedTarget | null {
  const kind = parseAttribute(attrs, "kind");
  const goal = parseAttribute(attrs, "goal");
  const id = parseAttribute(attrs, "id");
  const text = parseAttribute(attrs, "text");
  if (!kind || !goal || !id || !text) {
    return null;
  }
  return { kind, goal, id, text };
}

function parseTargetAttributes(attrs: string, text: string): PaseoTarget | null {
  const kind = parseAttribute(attrs, "kind");
  const goal = parseAttribute(attrs, "goal");
  const id = parseAttribute(attrs, "id");
  if (!kind || !goal || !id || !text.trim()) {
    return null;
  }
  return { kind, goal, id, text };
}

function normalizePaseoTargetText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripPaseoTags(value: string): string {
  return value.replace(/<\/?paseo-[a-z-]+\b[^>]*>/gi, "");
}

function stripHiddenPaseoBlocks(value: string): string {
  return value
    .replace(/<paseo-meta\b[^>]*>[\s\S]*?<\/paseo-meta>/gi, "")
    .replace(/<paseo-expected-target\b[^>]*\/>/gi, "")
    .replace(/<paseo-expected-target\b[^>]*>[\s\S]*?<\/paseo-expected-target>/gi, "")
    .replace(/<paseo-target\b[^>]*\/>/gi, "")
    .replace(/<paseo-target\b[^>]*>[\s\S]*?<\/paseo-target>/gi, "");
}

function stripPaseoUiBlocks(value: string): string {
  const blocks = findPaseoUiBlocks(value);
  if (blocks.length === 0) {
    return value;
  }
  let next = "";
  let cursor = 0;
  for (const block of blocks) {
    next += value.slice(cursor, block.startIndex);
    cursor = block.endIndex;
  }
  return next + value.slice(cursor);
}

function decodePaseoText(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

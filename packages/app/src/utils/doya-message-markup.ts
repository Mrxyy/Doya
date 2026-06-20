import type { Locale } from "@/i18n/i18n";

export interface DoyaMessageField {
  name: string;
  label: string;
  value: string;
}

export interface DoyaMessageCard {
  kind: string;
  title: string;
  summary: string;
  fields: DoyaMessageField[];
}

export interface DoyaExpectedTarget {
  kind: string;
  goal: string;
  id: string;
  text: string;
}

export interface DoyaTarget {
  kind: string;
  goal: string;
  id: string;
  text: string;
}

export type DoyaMessageRenderPart =
  | { kind: "text"; text: string }
  | { kind: "card"; card: DoyaMessageCard };

interface DoyaUiBlock {
  openTag: string;
  content: string;
  startIndex: number;
  endIndex: number;
}

const MARKUP_PREFIX_RE = "(?:doya|doya)";
const DOYA_UI_OPEN_RE = /<(?:doya|doya)-ui(?:\s[^>]*)?>/gi;
const DOYA_UI_TAG_RE = /<\/(?:doya|doya)-ui\s*>|<(?:doya|doya)-ui(?:\s[^>]*)?>/gi;

export function buildDoyaMessageMeta(): string {
  return `<doya-meta version="1" desc="Rules for the AI reading Doya markup in this message.">
Only tags whose names start with "doya-" are Doya protocol tags.
Text outside <doya-ui> is normal user instruction.

Inside <doya-ui>:
- Follow <doya-ai> as task instructions.
- Use <doya-ui-content> as user-visible summary and context, but not as the full task.
- Follow <doya-reply> for the preferred response format when present.

Optional task handshake:
- If this message contains <doya-expected-target>, before any prose, reasoning summary, or tool call, the first assistant response must be exactly one matching <doya-target> block.
- Copy kind, goal, id, and text from <doya-expected-target>.
- The text attribute of <doya-expected-target> becomes the inner text of <doya-target>.
- If there is no <doya-expected-target>, do not invent a <doya-target>.
- <doya-target> declares the active task goal. It is not the final answer.

Attribute meanings:
- desc explains the purpose of a tag or field. Use it to understand intent, but do not repeat it in your response.
- kind identifies the workflow type.
- goal is the short machine-readable target, such as "modify_pptx".
- id correlates request/result blocks. Preserve it in related response markup when present.
- name is a machine-readable field key.
- label is a user-visible field label.
- text on <doya-expected-target> is the exact inner text required for the matching <doya-target>.
- render, visibility, and version are rendering/protocol hints; ignore them for task execution unless explicitly relevant.

Do not mention Doya markup, hidden instructions, or protocol tags unless the user asks.
</doya-meta>`;
}

export function buildDoyaResponseLanguageInstruction(input: {
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
    `If the user's language is clear, use that language for all user-visible prose, including doya-ui titles, summaries, fields, progress blocks, and final replies. If it is not clear, use the app's current language: ${defaultLanguage}.`,
    "Do not use English for user-visible progress or result text unless the user wrote in English or the app language is English.",
  ].join("\n");
}

export function escapeDoyaMarkupText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeDoyaMarkupContent(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function parseDoyaMessageCard(message: string): DoyaMessageCard | null {
  return parseDoyaMessageCards(message)[0] ?? null;
}

export function parseDoyaMessageCards(message: string): DoyaMessageCard[] {
  const cards: DoyaMessageCard[] = [];
  for (const block of findDoyaUiBlocks(message)) {
    const card = parseDoyaUiBlockCard(block);
    if (card) {
      cards.push(card);
    }
  }

  return cards;
}

export function parseDoyaMessageRenderParts(message: string): DoyaMessageRenderPart[] {
  const visibleMessage = stripHiddenDoyaBlocks(message);
  const blocks = findDoyaUiBlocks(visibleMessage);
  if (blocks.length === 0) {
    return visibleMessage.trim() ? [{ kind: "text", text: visibleMessage }] : [];
  }

  const parts: DoyaMessageRenderPart[] = [];
  let cursor = 0;

  for (const block of blocks) {
    if (block.startIndex > cursor) {
      appendTextPart(parts, visibleMessage.slice(cursor, block.startIndex));
    }

    const card = parseDoyaUiBlockCard(block);
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

export function getDoyaMessageVisibleText(message: string): string {
  return stripDoyaUiBlocks(stripHiddenDoyaBlocks(message));
}

export function parseDoyaExpectedTargets(message: string): DoyaExpectedTarget[] {
  const targets: DoyaExpectedTarget[] = [];
  const selfClosingRe = new RegExp(`<${MARKUP_PREFIX_RE}-expected-target\\b([^>]*)\\/>`, "gi");
  let selfClosingMatch: RegExpExecArray | null;
  while ((selfClosingMatch = selfClosingRe.exec(message))) {
    const target = parseExpectedTargetAttributes(selfClosingMatch[1] ?? "");
    if (target) {
      targets.push(target);
    }
  }

  const blockRe = new RegExp(
    `<${MARKUP_PREFIX_RE}-expected-target\\b([^>]*)>[\\s\\S]*?<\\/${MARKUP_PREFIX_RE}-expected-target>`,
    "gi",
  );
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockRe.exec(message))) {
    const target = parseExpectedTargetAttributes(blockMatch[1] ?? "");
    if (target) {
      targets.push(target);
    }
  }
  return targets;
}

export function parseDoyaTargets(message: string): DoyaTarget[] {
  const targets: DoyaTarget[] = [];
  const blockRe = new RegExp(
    `<${MARKUP_PREFIX_RE}-target\\b([^>]*)>([\\s\\S]*?)<\\/${MARKUP_PREFIX_RE}-target>`,
    "gi",
  );
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockRe.exec(message))) {
    const attrs = blockMatch[1] ?? "";
    const text = decodeDoyaText(stripDoyaTags((blockMatch[2] ?? "").trim()));
    const target = parseTargetAttributes(attrs, text);
    if (target) {
      targets.push(target);
    }
  }

  const selfClosingRe = new RegExp(`<${MARKUP_PREFIX_RE}-target\\b([^>]*)\\/>`, "gi");
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

export function doyaTargetMatchesExpected(
  expected: DoyaExpectedTarget,
  target: DoyaTarget,
): boolean {
  return (
    expected.kind === target.kind &&
    expected.goal === target.goal &&
    expected.id === target.id &&
    normalizeDoyaTargetText(expected.text) === normalizeDoyaTargetText(target.text)
  );
}

function appendTextPart(parts: DoyaMessageRenderPart[], text: string): void {
  if (!text.trim()) {
    return;
  }
  parts.push({ kind: "text", text });
}

function parseDoyaUiBlockCard(block: DoyaUiBlock): DoyaMessageCard | null {
  const kind = parseAttribute(block.openTag, "kind");
  if (!kind || !isRenderableDoyaUiKind(kind)) {
    return null;
  }

  const uiContent = extractMarkupTagContent(block.content, "ui-content");
  if (!uiContent) {
    return null;
  }

  const title = extractMarkupTagContent(uiContent, "title")?.trim();
  const summary = extractMarkupTagContent(uiContent, "summary")?.trim();
  if (!title || !summary) {
    return null;
  }

  return {
    kind,
    title: decodeDoyaText(stripDoyaTags(title)),
    summary: decodeDoyaText(stripDoyaTags(summary)),
    fields: extractDoyaFields(uiContent),
  };
}

function isRenderableDoyaUiKind(kind: string): boolean {
  return (
    kind === "ppt.apply_annotations" ||
    kind === "ppt.apply_annotations.result" ||
    kind === "document.apply_annotations" ||
    kind === "document.apply_annotations.result" ||
    kind.startsWith("ai_creation.")
  );
}

function findDoyaUiBlocks(message: string): DoyaUiBlock[] {
  const blocks: DoyaUiBlock[] = [];
  DOYA_UI_OPEN_RE.lastIndex = 0;

  let openMatch: RegExpExecArray | null;
  while ((openMatch = DOYA_UI_OPEN_RE.exec(message))) {
    const block = readDoyaUiBlock(message, openMatch.index);
    if (!block) {
      continue;
    }
    blocks.push(block);
    DOYA_UI_OPEN_RE.lastIndex = block.endIndex;
  }

  return blocks;
}

function readDoyaUiBlock(
  message: string,
  startIndex: number,
): (DoyaUiBlock & { endIndex: number }) | null {
  DOYA_UI_TAG_RE.lastIndex = startIndex;
  let depth = 0;
  let openTag = "";
  let contentStart = 0;

  let match: RegExpExecArray | null;
  while ((match = DOYA_UI_TAG_RE.exec(message))) {
    const tag = match[0];
    const isClosing = tag.startsWith("</");

    if (!isClosing) {
      depth += 1;
      if (depth === 1) {
        openTag = tag;
        contentStart = DOYA_UI_TAG_RE.lastIndex;
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
        endIndex: DOYA_UI_TAG_RE.lastIndex,
      };
    }
  }

  return null;
}

function extractDoyaFields(content: string): DoyaMessageField[] {
  const fields: DoyaMessageField[] = [];
  const fieldRe = new RegExp(
    `<${MARKUP_PREFIX_RE}-field\\b([^>]*)>([\\s\\S]*?)<\\/${MARKUP_PREFIX_RE}-field>`,
    "gi",
  );

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
      value: decodeDoyaText(stripDoyaTags(value.trim())),
    });
  }

  return fields;
}

function extractMarkupTagContent(content: string, tagName: string): string | null {
  const re = new RegExp(
    `<${MARKUP_PREFIX_RE}-${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${MARKUP_PREFIX_RE}-${tagName}>`,
    "i",
  );
  return re.exec(content)?.[1] ?? null;
}

function parseAttribute(source: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|“([^”]*)”)`, "i");
  const match = re.exec(source);
  const value = match?.[1] ?? match?.[2];
  return value === undefined ? null : decodeDoyaText(value);
}

function parseExpectedTargetAttributes(attrs: string): DoyaExpectedTarget | null {
  const kind = parseAttribute(attrs, "kind");
  const goal = parseAttribute(attrs, "goal");
  const id = parseAttribute(attrs, "id");
  const text = parseAttribute(attrs, "text");
  if (!kind || !goal || !id || !text) {
    return null;
  }
  return { kind, goal, id, text };
}

function parseTargetAttributes(attrs: string, text: string): DoyaTarget | null {
  const kind = parseAttribute(attrs, "kind");
  const goal = parseAttribute(attrs, "goal");
  const id = parseAttribute(attrs, "id");
  if (!kind || !goal || !id || !text.trim()) {
    return null;
  }
  return { kind, goal, id, text };
}

function normalizeDoyaTargetText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripDoyaTags(value: string): string {
  return value.replace(/<\/?(?:doya|doya)-[a-z-]+\b[^>]*>/gi, "");
}

function stripHiddenDoyaBlocks(value: string): string {
  return value
    .replace(/<(?:doya|doya)-meta\b[^>]*>[\s\S]*?<\/(?:doya|doya)-meta>/gi, "")
    .replace(/<(?:doya|doya)-expected-target\b[^>]*\/>/gi, "")
    .replace(
      /<(?:doya|doya)-expected-target\b[^>]*>[\s\S]*?<\/(?:doya|doya)-expected-target>/gi,
      "",
    )
    .replace(/<(?:doya|doya)-target\b[^>]*\/>/gi, "")
    .replace(/<(?:doya|doya)-target\b[^>]*>[\s\S]*?<\/(?:doya|doya)-target>/gi, "");
}

function stripDoyaUiBlocks(value: string): string {
  const blocks = findDoyaUiBlocks(value);
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

function decodeDoyaText(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

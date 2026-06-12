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

export type PaseoMessageRenderPart =
  | { kind: "text"; text: string }
  | { kind: "card"; card: PaseoMessageCard };

interface PaseoUiBlock {
  openTag: string;
  content: string;
  startIndex: number;
  endIndex: number;
}

const PASEO_UI_OPEN_RE = /<paseo-ui\b[^>]*>/gi;
const PASEO_UI_TAG_RE = /<\/?paseo-ui\b[^>]*>/gi;

export function escapePaseoMarkupText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function parsePaseoMessageCard(message: string): PaseoMessageCard | null {
  for (const block of findPaseoUiBlocks(message)) {
    const card = parsePaseoUiBlockCard(block);
    if (card) return card;
  }

  return null;
}

export function parsePaseoMessageRenderParts(message: string): PaseoMessageRenderPart[] {
  const blocks = findPaseoUiBlocks(message);
  if (blocks.length === 0) {
    return [{ kind: "text", text: message }];
  }

  const parts: PaseoMessageRenderPart[] = [];
  let cursor = 0;

  for (const block of blocks) {
    if (block.startIndex > cursor) {
      appendTextPart(parts, message.slice(cursor, block.startIndex));
    }

    const card = parsePaseoUiBlockCard(block);
    if (card) {
      parts.push({ kind: "card", card });
    } else {
      appendTextPart(parts, message.slice(block.startIndex, block.endIndex));
    }
    cursor = block.endIndex;
  }

  if (cursor < message.length) {
    appendTextPart(parts, message.slice(cursor));
  }

  return parts.length > 0 ? parts : [{ kind: "text", text: message }];
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
  return kind === "ppt.apply_annotations" || kind === "ppt.apply_annotations.result";
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

function stripPaseoTags(value: string): string {
  return value.replace(/<\/?paseo-[a-z-]+\b[^>]*>/gi, "");
}

function decodePaseoText(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

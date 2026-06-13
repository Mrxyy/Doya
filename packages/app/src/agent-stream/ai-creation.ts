import type { StreamItem } from "@/types/stream";
import {
  parseDoyaExpectedTargets,
  parseDoyaMessageCard,
  parseDoyaTargets,
  type DoyaExpectedTarget,
  type DoyaTarget,
} from "@/utils/doya-message-markup";

export const AI_CREATION_PLACEHOLDER_ID = "ai-creation-placeholder";

const AI_CREATION_IMAGE_PATH_PATTERN =
  /(?:^|[\s"'`(（：:])((?:(?:[A-Za-z]:[\\/]|\/|\.{1,2}[\\/])?[\w.@~+-]+[\\/])+[^"'`\s)）]+?\.(?:png|jpe?g|webp|gif|avif|bmp|tiff?))(?:$|[\s"'`)）.,;，。])/gi;
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*]\((<[^>]+>|[^)\n]+)\)/g;
const PPTX_PATH_PATTERN =
  /(?:^|[\s"'`(（：:])((?:\.\/)?projects\/[^"'`\s)）]+?\/exports\/[^"'`\s)）]+?\.pptx)(?:$|[\s"'`)）.,;，。])/gi;
const PPT_PREVIEW_PATH_PATTERN =
  /(?:^|[\s"'`(（：:])((?:\.\/)?projects\/[^"'`\s)）]+?\/svg_output\/?)(?:$|[\s"'`)）.,;，。])/gi;
const PPT_PROGRESS_KIND = "ai_creation.slides.progress";
const DOCUMENT_PATH_PATTERN =
  /(?:^|[\s"'`(（：:])((?:\.\/)?(?:(?:[\w.@~+-]+[\\/])+)?[^"'`\s)）]+?\.(?:pdf|docx|xlsx?|csv))(?:$|[\s"'`)）.,;，。])/gi;
const PPT_RESULT_KINDS = new Set([
  "ppt.apply_annotations",
  "ppt.apply_annotations.result",
  "ai_creation.slides.create",
]);
const PPT_RESULT_GOALS = new Set(["create_pptx", "modify_pptx"]);
const DOCUMENT_RESULT_KINDS = new Set([
  "ai_creation.document.pdf.create",
  "ai_creation.document.word.create",
  "ai_creation.spreadsheet.create",
  "document.apply_annotations",
  "document.apply_annotations.result",
]);
const DOCUMENT_RESULT_GOALS = new Set([
  "create_pdf",
  "create_docx",
  "create_spreadsheet",
  "modify_pdf",
  "modify_docx",
  "modify_spreadsheet",
]);
const IMAGE_RESULT_KINDS = new Set(["ai_creation.image.generate", "ai_creation.image.edit"]);
const IMAGE_RESULT_GOALS = new Set(["generate_image", "edit_image"]);

function stripAiCreationImagePathToken(source: string): string | null {
  const trimmed = source
    .trim()
    .replace(/^`+|`+$/g, "")
    .replace(/[，。.,;；:：]+$/g, "");
  return trimmed || null;
}

function extractAiCreationImagePathSources(text: string): string[] {
  const sources: string[] = [];
  for (const match of text.matchAll(AI_CREATION_IMAGE_PATH_PATTERN)) {
    const source = stripAiCreationImagePathToken(match[1] ?? "");
    if (source) {
      sources.push(source);
    }
  }
  return sources;
}

function normalizeMarkdownImageSourceToken(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    const inner = trimmed.slice(1, -1).trim();
    return inner || null;
  }
  const titleMatch = /^(.*?)(?:\s+(['"]).*?\2)?$/.exec(trimmed);
  return titleMatch?.[1]?.trim() || trimmed;
}

function extractMarkdownImageSources(text: string): string[] {
  const sources: string[] = [];
  for (const match of text.matchAll(MARKDOWN_IMAGE_PATTERN)) {
    const source = normalizeMarkdownImageSourceToken(match[1] ?? "");
    if (source) {
      sources.push(source);
    }
  }
  return sources;
}

function formatAiCreationImageMarkdownSource(source: string): string {
  if (/[\s()]/.test(source)) {
    return `<${source.replace(/>/g, "%3E")}>`;
  }
  return source;
}

export function extractAiCreationResultSources(text: string): string[] {
  return [...extractMarkdownImageSources(text), ...extractAiCreationImagePathSources(text)];
}

function extractAiCreationFinalImageMarkdown(text: string): string | null {
  const sources = [...new Set(extractAiCreationResultSources(text))];
  if (sources.length === 0) {
    return null;
  }
  const finalSource = sources[sources.length - 1];
  return `![](${formatAiCreationImageMarkdownSource(finalSource)})`;
}

function normalizeAiCreationPptxPathToken(source: string): string | null {
  const trimmed = source
    .trim()
    .replace(/^`+|`+$/g, "")
    .replace(/^[.]\//, "")
    .replace(/[，。.,;；:：]+$/g, "");
  return trimmed || null;
}

function extractAiCreationPptxSources(text: string): string[] {
  const sources: string[] = [];
  for (const match of text.matchAll(PPTX_PATH_PATTERN)) {
    const source = normalizeAiCreationPptxPathToken(match[1] ?? "");
    if (source) {
      sources.push(source);
    }
  }
  return sources;
}

function extractAiCreationFinalPptxMarkdown(text: string): string | null {
  const sources = [...new Set(extractAiCreationPptxSources(text))];
  const finalSource = sources[sources.length - 1];
  if (!finalSource) {
    return null;
  }
  return `[${finalSource}](${finalSource})`;
}

export function extractAiCreationFinalPptxPath(text: string): string | null {
  const sources = [...new Set(extractAiCreationPptxSources(text))];
  return sources[sources.length - 1] ?? null;
}

function normalizeAiCreationPptPreviewPathToken(source: string): string | null {
  const trimmed = source
    .trim()
    .replace(/^`+|`+$/g, "")
    .replace(/^[.]\//, "")
    .replace(/[，。.,;；:：]+$/g, "");
  return trimmed || null;
}

function extractAiCreationPptPreviewSources(text: string): string[] {
  const sources: string[] = [];
  const cardPreviewPath = parseDoyaMessageCard(text)?.fields.find(
    (field) => field.name === "preview_path",
  )?.value;
  if (cardPreviewPath) {
    const source = normalizeAiCreationPptPreviewPathToken(cardPreviewPath);
    if (source) {
      sources.push(source);
    }
  }
  for (const match of text.matchAll(PPT_PREVIEW_PATH_PATTERN)) {
    const source = normalizeAiCreationPptPreviewPathToken(match[1] ?? "");
    if (source) {
      sources.push(source);
    }
  }
  return sources;
}

export function extractAiCreationPptPreviewPath(text: string): string | null {
  const sources = [...new Set(extractAiCreationPptPreviewSources(text))];
  return sources[sources.length - 1] ?? null;
}

function normalizeAiCreationDocumentPathToken(source: string): string | null {
  const markdownHrefIndex = source.lastIndexOf("](");
  const sourceValue = markdownHrefIndex >= 0 ? source.slice(markdownHrefIndex + 2) : source;
  const trimmed = sourceValue
    .trim()
    .replace(/^`+|`+$/g, "")
    .replace(/^[.]\//, "")
    .replace(/[，。.,;；:：]+$/g, "");
  const withoutLabelPrefix = trimmed.replace(
    /^.*[：:]\s*(?=(?:[./]|[\w.@~+-]+[\\/]|[^"'`\s)）\\/]+?\.(?:pdf|docx|xlsx?|csv)))/u,
    "",
  );
  return withoutLabelPrefix || null;
}

function extractAiCreationDocumentSources(text: string): string[] {
  const sources: string[] = [];
  const resultDisplay = extractDocumentAnnotationResultDisplay(text);
  if (resultDisplay) {
    sources.push(resultDisplay.path);
  }
  for (const match of text.matchAll(DOCUMENT_PATH_PATTERN)) {
    const source = normalizeAiCreationDocumentPathToken(match[1] ?? "");
    if (source) {
      sources.push(source);
    }
  }
  return sources;
}

export interface DocumentAnnotationResultDisplay {
  path: string;
  summary: string;
  title: string;
}

export function extractDocumentAnnotationResultDisplay(
  text: string,
): DocumentAnnotationResultDisplay | null {
  const card = parseDoyaMessageCard(text);
  if (card?.kind !== "document.apply_annotations.result") {
    return null;
  }
  const updatedFile = card.fields.find((field) => field.name === "updated_file")?.value;
  const path = updatedFile ? normalizeAiCreationDocumentPathToken(updatedFile) : null;
  if (!path) {
    return null;
  }
  return {
    path,
    summary: card.summary,
    title: card.title,
  };
}

function extractAiCreationFinalDocumentMarkdown(text: string): string | null {
  const sources = [...new Set(extractAiCreationDocumentSources(text))];
  const finalSource = sources[sources.length - 1];
  if (!finalSource) {
    return null;
  }
  return `[${finalSource}](${finalSource})`;
}

export function extractAiCreationFinalDocumentPath(text: string): string | null {
  const sources = [...new Set(extractAiCreationDocumentSources(text))];
  return sources[sources.length - 1] ?? null;
}

type StreamSource = "tail" | "head";

interface TaggedStreamItem {
  item: StreamItem;
  source: StreamSource;
}

function splitAiCreationTurns(items: TaggedStreamItem[]): TaggedStreamItem[][] {
  const turns: TaggedStreamItem[][] = [];
  let currentTurn: TaggedStreamItem[] = [];
  for (const item of items) {
    if (item.item.kind === "user_message" && currentTurn.length > 0) {
      turns.push(currentTurn);
      currentTurn = [];
    }
    currentTurn.push(item);
  }
  if (currentTurn.length > 0) {
    turns.push(currentTurn);
  }
  return turns;
}

function pushTaggedItem(
  target: { tail: StreamItem[]; head: StreamItem[] },
  tagged: TaggedStreamItem,
) {
  target[tagged.source].push(tagged.item);
}

export function buildAiCreationPlaceholderItem(target?: DoyaTarget): StreamItem {
  return {
    kind: "assistant_message",
    id: AI_CREATION_PLACEHOLDER_ID,
    text: target?.text ?? "",
    timestamp: new Date(0),
  };
}

export function normalizeAiCreationStream(params: {
  agentStatus: string;
  tail: StreamItem[];
  head: StreamItem[];
}): { tail: StreamItem[]; head: StreamItem[] } {
  const taggedItems: TaggedStreamItem[] = [
    ...params.tail.map((item) => ({ item, source: "tail" as const })),
    ...params.head.map((item) => ({ item, source: "head" as const })),
  ];
  if (taggedItems.length === 0) {
    return { tail: params.tail, head: params.head };
  }

  const turns = splitAiCreationTurns(taggedItems);
  const normalized = { tail: [] as StreamItem[], head: [] as StreamItem[] };
  let changed = false;
  turns.forEach((turn, index) => {
    const result = normalizeHandshakeTurn({
      turn,
      isActiveRunningTurn: params.agentStatus === "running" && index === turns.length - 1,
    });
    changed = changed || result.changed;
    for (const tagged of result.items) {
      pushTaggedItem(normalized, tagged);
    }
  });
  return changed ? normalized : { tail: params.tail, head: params.head };
}

function normalizeHandshakeTurn(input: {
  turn: TaggedStreamItem[];
  isActiveRunningTurn: boolean;
}): { items: TaggedStreamItem[]; changed: boolean } {
  const responseTarget =
    findResponseStartTarget(input.turn) ?? findAiCreationRequestTarget(input.turn);
  if (!responseTarget) {
    return { items: input.turn, changed: false };
  }

  const normalized: TaggedStreamItem[] = [];
  for (const tagged of input.turn) {
    if (tagged.item.kind === "user_message") {
      normalized.push(tagged);
    }
  }

  const finalTaggedResult = findLastHandshakeResultItem(input.turn, responseTarget);
  const pptProgressItems = findPptProgressItems(input.turn, responseTarget);
  if (input.isActiveRunningTurn || !finalTaggedResult) {
    if (pptProgressItems.length > 0) {
      normalized.push(...pptProgressItems);
      return { items: normalized, changed: true };
    }
    normalized.push({
      source: "head",
      item: buildAiCreationPlaceholderItem(responseTarget),
    });
    return { items: normalized, changed: true };
  }

  const finalItem = finalTaggedResult.item;
  if (finalItem.kind !== "assistant_message") {
    return { items: normalized, changed: true };
  }
  const finalMarkdown = extractHandshakeFinalMarkdown(finalItem.text, responseTarget);
  if (!finalMarkdown) {
    return { items: normalized, changed: true };
  }
  normalized.push(...pptProgressItems);
  normalized.push({
    source: finalTaggedResult.source,
    item: { ...finalItem, text: finalMarkdown },
  });
  return { items: normalized, changed: true };
}

function findAiCreationRequestTarget(items: TaggedStreamItem[]): DoyaTarget | null {
  for (const tagged of items) {
    const item = tagged.item;
    if (item.kind !== "user_message") {
      continue;
    }
    const card = parseDoyaMessageCard(item.text);
    if (!card?.kind.startsWith("ai_creation.")) {
      continue;
    }
    const goal = getAiCreationGoalForKind(card.kind);
    if (!goal) {
      continue;
    }
    return {
      kind: card.kind,
      goal,
      id: item.id,
      text: card.title,
    };
  }
  return null;
}

function getAiCreationGoalForKind(kind: string): string | null {
  switch (kind) {
    case "ai_creation.image.generate":
      return "generate_image";
    case "ai_creation.image.edit":
      return "edit_image";
    case "ai_creation.slides.create":
      return "create_pptx";
    case "ai_creation.document.pdf.create":
      return "create_pdf";
    case "ai_creation.document.word.create":
      return "create_docx";
    case "ai_creation.spreadsheet.create":
      return "create_spreadsheet";
    default:
      return null;
  }
}

function findPptProgressItems(
  items: TaggedStreamItem[],
  expected: DoyaExpectedTarget,
): TaggedStreamItem[] {
  if (!PPT_RESULT_KINDS.has(expected.kind) && !PPT_RESULT_GOALS.has(expected.goal)) {
    return [];
  }
  return items.filter((tagged) => {
    const item = tagged.item;
    return (
      item.kind === "assistant_message" &&
      (extractAiCreationPptPreviewPath(item.text) || isPptProgressMessage(item.text))
    );
  });
}

function isPptProgressMessage(text: string): boolean {
  return parseDoyaMessageCard(text)?.kind === PPT_PROGRESS_KIND;
}

function findResponseStartTarget(items: TaggedStreamItem[]): DoyaTarget | null {
  const firstAssistant = items
    .filter(
      (tagged) => tagged.item.kind === "assistant_message" && tagged.item.text.trim().length > 0,
    )
    .sort((left, right) => left.item.timestamp.getTime() - right.item.timestamp.getTime())[0];
  if (!firstAssistant || firstAssistant.item.kind !== "assistant_message") {
    return null;
  }
  if (!/^<(?:doya|doya)-target\b/i.test(firstAssistant.item.text.trimStart())) {
    return null;
  }
  return (
    parseDoyaTargets(firstAssistant.item.text)[0] ??
    parsePartialDoyaTarget(firstAssistant.item.text) ??
    findExpectedTargetFallback(items)
  );
}

function findExpectedTargetFallback(items: TaggedStreamItem[]): DoyaTarget | null {
  for (const tagged of items) {
    const item = tagged.item;
    if (item.kind !== "user_message") {
      continue;
    }
    const expected = parseDoyaExpectedTargets(item.text)[0];
    if (expected) {
      return { kind: expected.kind, goal: expected.goal, id: expected.id, text: expected.text };
    }
  }
  return null;
}

function parsePartialDoyaTarget(text: string): DoyaTarget | null {
  const trimmed = text.trimStart();
  const openTagMatch = /^<(?:doya|doya)-target\b([^>]*)>/i.exec(trimmed);
  if (!openTagMatch) {
    return null;
  }
  const attrs = openTagMatch[1] ?? "";
  const kind = parsePartialDoyaAttribute(attrs, "kind");
  const goal = parsePartialDoyaAttribute(attrs, "goal");
  const id = parsePartialDoyaAttribute(attrs, "id");
  if (!kind || !goal || !id) {
    return null;
  }
  const innerStart = openTagMatch[0].length;
  const remaining = trimmed.slice(innerStart);
  const closingStart = remaining.search(/<\/(?:doya|doya)-target\s*>/i);
  const rawText =
    closingStart >= 0 ? remaining.slice(0, closingStart) : remaining.replace(/<\/?$/u, "");
  const targetText =
    decodePartialDoyaText(rawText.trim()) || parsePartialDoyaAttribute(attrs, "text") || "";
  return { kind, goal, id, text: targetText };
}

function parsePartialDoyaAttribute(source: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(source);
  return match ? decodePartialDoyaText(match[2] ?? "") : null;
}

function decodePartialDoyaText(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function findLastHandshakeResultItem(
  items: TaggedStreamItem[],
  expected: DoyaExpectedTarget,
): TaggedStreamItem | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const tagged = items[index];
    const item = tagged?.item;
    if (item?.kind === "assistant_message" && extractHandshakeFinalMarkdown(item.text, expected)) {
      return tagged;
    }
  }
  return null;
}

function extractHandshakeFinalMarkdown(text: string, expected: DoyaExpectedTarget): string | null {
  const resultCardText = extractHandshakeResultCardText(text, expected);
  if (resultCardText) {
    return resultCardText;
  }
  if (PPT_RESULT_KINDS.has(expected.kind) || PPT_RESULT_GOALS.has(expected.goal)) {
    return extractAiCreationFinalPptxMarkdown(text);
  }
  if (DOCUMENT_RESULT_KINDS.has(expected.kind) || DOCUMENT_RESULT_GOALS.has(expected.goal)) {
    return extractAiCreationFinalDocumentMarkdown(text);
  }
  if (IMAGE_RESULT_KINDS.has(expected.kind) || IMAGE_RESULT_GOALS.has(expected.goal)) {
    return extractAiCreationFinalImageMarkdown(text);
  }
  return null;
}

function extractHandshakeResultCardText(text: string, expected: DoyaExpectedTarget): string | null {
  const card = parseDoyaMessageCard(text);
  if (!card) {
    return null;
  }
  if (expected.kind === "document.apply_annotations") {
    return card.kind === "document.apply_annotations.result" ? text.trim() : null;
  }
  return null;
}

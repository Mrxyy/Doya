import type { StreamItem } from "@/types/stream";
import type { AiCreationMessageDisplayEntry } from "@/stores/ai-creation-message-display-store";

export const AI_CREATION_PLACEHOLDER_ID = "ai-creation-placeholder";
const LEGACY_ZH_AI_CREATION_EDIT_PREFIX = "\u7f16\u8f91\u56fe\u7247\uff1a";

const AI_CREATION_IMAGE_PATH_PATTERN =
  /(?:^|[\s"'`(（：:])((?:(?:[A-Za-z]:[\\/]|\/|\.{1,2}[\\/])?[\w.@~+-]+[\\/])+[^"'`\s)）]+?\.(?:png|jpe?g|webp|gif|avif|bmp|tiff?))(?:$|[\s"'`)）.,;，。])/gi;
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*]\((<[^>]+>|[^)\n]+)\)/g;
const PPTX_PATH_PATTERN =
  /(?:^|[\s"'`(（：:])((?:\.\/)?projects\/[^"'`\s)）]+?\/exports\/[^"'`\s)）]+?\.pptx)(?:$|[\s"'`)）.,;，。])/gi;
const PPT_PREVIEW_PATH_PATTERN =
  /(?:^|[\s"'`(（：:])((?:\.\/)?projects\/[^"'`\s)）]+?\/svg_output\/?)(?:$|[\s"'`)）.,;，。])/gi;

export function isAiCreationLabels(labels: Record<string, string> | undefined): boolean {
  return (
    labels?.surface === "ai_creation" ||
    labels?.intent === "imagegen" ||
    labels?.intent === "image_edit" ||
    labels?.intent === "ppt_creation"
  );
}

export type AiCreationIntent = "image" | "image_edit" | "ppt_creation";

export function getAiCreationIntent(
  labels: Record<string, string> | undefined,
): AiCreationIntent | null {
  if (labels?.intent === "ppt_creation") {
    return "ppt_creation";
  }
  if (labels?.intent === "image_edit") {
    return "image_edit";
  }
  if (labels?.surface === "ai_creation" || labels?.intent === "imagegen") {
    return "image";
  }
  return null;
}

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

type StreamSource = "tail" | "head";

interface TaggedStreamItem {
  item: StreamItem;
  source: StreamSource;
}

function findLastAiCreationAssistantResultItem(items: TaggedStreamItem[]): TaggedStreamItem | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const tagged = items[index];
    const item = tagged?.item;
    if (
      item?.kind === "assistant_message" &&
      extractAiCreationResultSources(item.text).length > 0
    ) {
      return tagged;
    }
  }
  return null;
}

function findLastAiCreationPptxResultItem(items: TaggedStreamItem[]): TaggedStreamItem | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const tagged = items[index];
    const item = tagged?.item;
    if (item?.kind === "assistant_message" && extractAiCreationPptxSources(item.text).length > 0) {
      return tagged;
    }
  }
  return null;
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

function normalizeAiCreationDisplayText(text: string | undefined): string {
  return (text ?? "")
    .trim()
    .replace(/：\s+/g, "：")
    .replace(/:\s+/g, ":")
    .replace(/\s+/g, "");
}

function isAiCreationEditDisplayText(text: string | undefined): boolean {
  const normalized = normalizeAiCreationDisplayText(text).toLowerCase();
  return (
    normalized.startsWith(LEGACY_ZH_AI_CREATION_EDIT_PREFIX) || normalized.startsWith("editimage:")
  );
}

function isAiCreationInternalEditPrompt(text: string | undefined): boolean {
  const normalized = (text ?? "").trim();
  return (
    normalized.startsWith("Use the Codex imagegen skill for this guided image edit.") ||
    normalized.startsWith("Use the Codex imagegen skill for this request.")
  );
}

function isAiCreationDisplayTextMatch(
  left: string | undefined,
  right: string | undefined,
): boolean {
  const normalizedLeft = normalizeAiCreationDisplayText(left);
  const normalizedRight = normalizeAiCreationDisplayText(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  );
}

function applyAiCreationDisplayMetadataToUserMessage(
  item: Extract<StreamItem, { kind: "user_message" }>,
  metadata: AiCreationMessageDisplayEntry,
): Extract<StreamItem, { kind: "user_message" }> {
  const metadataSelectionImage = isAiCreationEditDisplayText(item.text)
    ? metadata.selectionImage
    : undefined;
  const metadataImages = metadata.selectionImage
    ? metadata.images?.filter((image) => image.id !== metadata.selectionImage?.id)
    : metadata.images;

  return {
    ...item,
    ...(metadata.text?.trim() ? { text: metadata.text } : {}),
    ...(item.images || !metadataImages || metadataImages.length === 0
      ? {}
      : { images: metadataImages }),
    ...(item.selectionPreviewUri || !metadata.selectionPreviewUri
      ? {}
      : { selectionPreviewUri: metadata.selectionPreviewUri }),
    ...(item.selectionImageSource || !metadata.selectionImageSource
      ? {}
      : { selectionImageSource: metadata.selectionImageSource }),
    ...(item.selectionImage || !metadataSelectionImage
      ? {}
      : { selectionImage: metadataSelectionImage }),
  };
}

export function buildAiCreationPlaceholderItem(): StreamItem {
  return {
    kind: "assistant_message",
    id: AI_CREATION_PLACEHOLDER_ID,
    text: "",
    timestamp: new Date(0),
  };
}

function normalizeAiCreationTurn(input: {
  turn: TaggedStreamItem[];
  isActiveRunningTurn: boolean;
}): TaggedStreamItem[] {
  const normalized: TaggedStreamItem[] = [];
  for (const tagged of input.turn) {
    if (tagged.item.kind === "user_message") {
      normalized.push(tagged);
    }
  }

  if (input.isActiveRunningTurn) {
    normalized.push({
      source: "head",
      item: buildAiCreationPlaceholderItem(),
    });
    return normalized;
  }

  const finalResult = findLastAiCreationAssistantResultItem(input.turn);
  const finalPptxResult = findLastAiCreationPptxResultItem(input.turn);
  const finalTaggedResult = finalPptxResult ?? finalResult;
  if (!finalTaggedResult || finalTaggedResult.item.kind !== "assistant_message") {
    return normalized;
  }
  const imageMarkdown = extractAiCreationFinalImageMarkdown(finalTaggedResult.item.text);
  const pptxMarkdown = extractAiCreationFinalPptxMarkdown(finalTaggedResult.item.text);
  const resultMarkdown = pptxMarkdown ?? imageMarkdown;
  if (!resultMarkdown) {
    return normalized;
  }
  normalized.push({
    source: finalTaggedResult.source,
    item: { ...finalTaggedResult.item, text: resultMarkdown },
  });
  return normalized;
}

export function normalizeAiCreationStream(params: {
  agentStatus: string;
  tail: StreamItem[];
  head: StreamItem[];
  intent?: AiCreationIntent | null;
}): { tail: StreamItem[]; head: StreamItem[] } {
  if (params.intent === "ppt_creation") {
    return normalizePptCreationStream({
      tail: params.tail,
      head: params.head,
    });
  }

  const taggedItems: TaggedStreamItem[] = [
    ...params.tail.map((item) => ({ item, source: "tail" as const })),
    ...params.head.map((item) => ({ item, source: "head" as const })),
  ];
  if (taggedItems.length === 0) {
    return params.agentStatus === "running"
      ? { tail: [], head: [buildAiCreationPlaceholderItem()] }
      : { tail: [], head: [] };
  }

  const turns = splitAiCreationTurns(taggedItems);
  const normalized = { tail: [] as StreamItem[], head: [] as StreamItem[] };
  turns.forEach((turn, index) => {
    const isActiveRunningTurn = params.agentStatus === "running" && index === turns.length - 1;
    for (const tagged of normalizeAiCreationTurn({ turn, isActiveRunningTurn })) {
      pushTaggedItem(normalized, tagged);
    }
  });
  return normalized;
}

function normalizePptCreationStream(params: { tail: StreamItem[]; head: StreamItem[] }): {
  tail: StreamItem[];
  head: StreamItem[];
} {
  const normalizeItems = (items: StreamItem[]) =>
    items.map((item) => {
      if (item.kind !== "assistant_message") {
        return item;
      }
      const pptxMarkdown = extractAiCreationFinalPptxMarkdown(item.text);
      return pptxMarkdown ? { ...item, text: pptxMarkdown } : item;
    });
  return {
    tail: normalizeItems(params.tail),
    head: normalizeItems(params.head),
  };
}

export function applyAiCreationMessageDisplayMetadata(
  items: StreamItem[],
  metadataEntries: readonly AiCreationMessageDisplayEntry[],
): StreamItem[] {
  if (metadataEntries.length === 0) {
    return items;
  }
  const metadataByMessageId = new Map(
    metadataEntries.map((entry) => [entry.messageId, entry] as const),
  );
  const unmatchedByText = metadataEntries.filter((entry) => entry.text?.trim());
  const unmatchedLegacy = metadataEntries.filter(
    (entry) => !entry.text?.trim() && entry.allowOrderFallback !== false,
  );
  const consumeMetadataEntry = (entry: AiCreationMessageDisplayEntry) => {
    const textIndex = unmatchedByText.indexOf(entry);
    if (textIndex >= 0) {
      unmatchedByText.splice(textIndex, 1);
    }
    const legacyIndex = unmatchedLegacy.indexOf(entry);
    if (legacyIndex >= 0) {
      unmatchedLegacy.splice(legacyIndex, 1);
    }
  };
  let changed = false;
  const next = items.map((item) => {
    if (item.kind !== "user_message") {
      return item;
    }
    let metadata = metadataByMessageId.get(item.id);
    if (metadata) {
      consumeMetadataEntry(metadata);
    }
    if (!metadata) {
      const textMatchIndex = unmatchedByText.findIndex((entry) =>
        isAiCreationDisplayTextMatch(entry.text, item.text),
      );
      metadata = textMatchIndex >= 0 ? unmatchedByText.splice(textMatchIndex, 1)[0] : undefined;
    }
    if (
      !metadata &&
      !item.images &&
      !item.selectionImage &&
      (isAiCreationEditDisplayText(item.text) || isAiCreationInternalEditPrompt(item.text))
    ) {
      const orderedTextMatchIndex = unmatchedByText.findIndex(
        (entry) => entry.allowOrderFallback !== false,
      );
      metadata =
        orderedTextMatchIndex >= 0
          ? unmatchedByText.splice(orderedTextMatchIndex, 1)[0]
          : unmatchedLegacy.shift();
    }
    if (!metadata) {
      return item;
    }
    const updated = applyAiCreationDisplayMetadataToUserMessage(item, metadata);
    if (updated !== item) {
      changed = true;
    }
    return updated;
  });
  return changed ? next : items;
}

import type { StreamItem } from "@/types/stream";
import type {
  AiCreationMessageDisplayEntry,
  AiCreationMessageDisplayMetadata,
} from "@/stores/ai-creation-message-display-store";

export const AI_CREATION_PLACEHOLDER_ID = "ai-creation-placeholder";

const AI_CREATION_IMAGE_PATH_PATTERN =
  /(?:^|[\s"'`(（：:])((?:(?:[A-Za-z]:[\\/]|\/|\.{1,2}[\\/])?[\w.@~+-]+[\\/])+[^"'`\s)）]+?\.(?:png|jpe?g|webp|gif|avif|bmp|tiff?))(?:$|[\s"'`)）.,;，。])/gi;
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*]\((<[^>]+>|[^)\n]+)\)/g;

export function isAiCreationLabels(labels: Record<string, string> | undefined): boolean {
  return (
    labels?.surface === "ai_creation" ||
    labels?.intent === "imagegen" ||
    labels?.intent === "image_edit"
  );
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
  return normalizeAiCreationDisplayText(text).startsWith("编辑图片：");
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
  if (!finalResult || finalResult.item.kind !== "assistant_message") {
    return normalized;
  }
  const imageMarkdown = extractAiCreationFinalImageMarkdown(finalResult.item.text);
  if (!imageMarkdown) {
    return normalized;
  }
  normalized.push({
    source: finalResult.source,
    item: { ...finalResult.item, text: imageMarkdown },
  });
  return normalized;
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
      isAiCreationEditDisplayText(item.text)
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
    const metadataSelectionImage = isAiCreationEditDisplayText(item.text)
      ? metadata.selectionImage
      : undefined;
    const metadataImages = metadata.selectionImage
      ? metadata.images?.filter((image) => image.id !== metadata.selectionImage?.id)
      : metadata.images;
    const updated = {
      ...item,
      ...(item.images || !metadataImages || metadataImages.length === 0
        ? {}
        : { images: metadataImages }),
      ...(item.selectionPreviewUri || !metadata.selectionPreviewUri
        ? {}
        : { selectionPreviewUri: metadata.selectionPreviewUri }),
      ...(item.selectionImage || !metadataSelectionImage
        ? {}
        : { selectionImage: metadataSelectionImage }),
    };
    if (updated !== item) {
      changed = true;
    }
    return updated;
  });
  return changed ? next : items;
}

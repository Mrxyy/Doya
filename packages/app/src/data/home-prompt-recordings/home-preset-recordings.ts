import type { ConversationRecording } from "@getdoya/protocol/messages";
import { ConversationRecordingSchema } from "@getdoya/protocol/messages";
import { listReplayEvents, projectConversationReplay } from "@/replay/conversation-replay";
import type { StreamItem } from "@/types/stream";
import type { HomePresetBundledFile } from "@/data/home-prompt-recordings/home-preset-files";

export type HomePresetReplayId =
  | "image-landing"
  | "slides-roadshow"
  | "pdf-brief"
  | "document-prd"
  | "sheet-budget"
  | "search-ai-funding";

export interface HomePresetSlidePreview {
  path: string;
  svg: string;
  source: unknown;
}

export const HOME_PRESET_REPLAY_SPEED = 4;

export const HOME_PRESET_REPLAY_ID_LABEL = "homePresetReplayId";

const HOME_PRESET_SLIDES_CONFIRM_OFFSET_MS = 12_000;
const HOME_PRESET_BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const HOME_PRESET_REPLAY_IDS = new Set<string>([
  "image-landing",
  "slides-roadshow",
  "pdf-brief",
  "document-prd",
  "sheet-budget",
  "search-ai-funding",
]);

const HOME_PRESET_PROJECT_REPLAY_IDS: Record<string, HomePresetReplayId> = {
  b2b_saas_analytics_pitch_ppt169_20260621: "slides-roadshow",
};

const homePresetReplayRecordingPromises = new Map<
  HomePresetReplayId,
  Promise<ConversationRecording>
>();
let slidesRoadshowPreviewPromise: Promise<HomePresetSlidePreview[]> | null = null;

export function isHomePresetReplayId(
  value: string | null | undefined,
): value is HomePresetReplayId {
  return Boolean(value && HOME_PRESET_REPLAY_IDS.has(value));
}

export function getHomePresetReplayIdForProjectName(
  projectName: string | null | undefined,
): HomePresetReplayId | null {
  const normalizedProjectName = projectName?.trim();
  if (!normalizedProjectName) {
    return null;
  }
  return HOME_PRESET_PROJECT_REPLAY_IDS[normalizedProjectName] ?? null;
}

export function getHomePresetReplayRecording(
  id: HomePresetReplayId,
): Promise<ConversationRecording> {
  const cached = homePresetReplayRecordingPromises.get(id);
  if (cached) {
    return cached;
  }
  const promise = loadHomePresetReplayRecording(id);
  homePresetReplayRecordingPromises.set(id, promise);
  return promise;
}

async function loadHomePresetReplayRecording(
  id: HomePresetReplayId,
): Promise<ConversationRecording> {
  let module: unknown;
  switch (id) {
    case "image-landing":
      module = await import("./image-landing.json");
      break;
    case "slides-roadshow":
      module = await import("./slides-roadshow.json");
      break;
    case "pdf-brief":
      module = await import("./pdf-brief.json");
      break;
    case "document-prd":
      module = await import("./document-prd.json");
      break;
    case "sheet-budget":
      module = await import("./sheet-budget.json");
      break;
    case "search-ai-funding":
      module = await import("./search-ai-funding.json");
      break;
    default: {
      const exhaustive: never = id;
      return exhaustive;
    }
  }
  return ConversationRecordingSchema.parse(getDefaultExport(module));
}

export function getHomePresetBundledSlidePreviews(
  id: HomePresetReplayId,
): Promise<HomePresetSlidePreview[]> {
  if (id !== "slides-roadshow") {
    return Promise.resolve([]);
  }
  slidesRoadshowPreviewPromise ??= loadSlidesRoadshowPreviewSlides();
  return slidesRoadshowPreviewPromise;
}

async function loadSlidesRoadshowPreviewSlides(): Promise<HomePresetSlidePreview[]> {
  const { SlidesRoadshowPreviewSlides } =
    await import("@/data/home-prompt-recordings/slides-roadshow-preview");
  return SlidesRoadshowPreviewSlides.map((slide) => ({
    path: slide.path,
    source: slide.svg,
    svg: getHomePresetSlideSvgText(slide.svg) ?? "",
  }));
}

export async function materializeHomePresetBundledFilesToWorkspace(input: {
  client: {
    materializeWorkspaceAttachments(request: {
      cwd: string;
      files: Array<{
        fileName: string;
        mimeType: string;
        data: string;
        path: string;
      }>;
    }): Promise<unknown>;
  };
  cwd: string;
  id: HomePresetReplayId;
}): Promise<void> {
  const { HomePresetBundledFiles } =
    await import("@/data/home-prompt-recordings/home-preset-files");
  const files = HomePresetBundledFiles.filter((file) => file.presetId === input.id).map(
    (file: HomePresetBundledFile) => ({
      fileName: file.fileName,
      mimeType: file.mimeType,
      data: file.base64,
      path: file.path,
    }),
  );
  const slideFiles = (await getHomePresetBundledSlidePreviews(input.id))
    .filter((slide) => slide.svg.length > 0)
    .map((slide) => ({
      fileName: slide.path.split("/").pop() ?? "slide.svg",
      mimeType: "image/svg+xml",
      data: encodeHomePresetUtf8ToBase64(slide.svg),
      path: slide.path,
    }));
  const materializedFiles = [...files, ...slideFiles];
  if (materializedFiles.length === 0) {
    return;
  }
  await input.client.materializeWorkspaceAttachments({
    cwd: input.cwd,
    files: materializedFiles,
  });
}

function getHomePresetSlideSvgText(value: unknown): string | null {
  if (typeof value === "string") {
    return value.includes("<svg") ? value : null;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const defaultValue = (value as { default?: unknown }).default;
  if (typeof defaultValue === "string" && defaultValue.includes("<svg")) {
    return defaultValue;
  }
  return null;
}

function encodeHomePresetUtf8ToBase64(value: string): string {
  return encodeHomePresetBytesToBase64(new TextEncoder().encode(value));
}

function encodeHomePresetBytesToBase64(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const triplet = (first << 16) | (second << 8) | third;
    output += HOME_PRESET_BASE64_ALPHABET[(triplet >> 18) & 0x3f];
    output += HOME_PRESET_BASE64_ALPHABET[(triplet >> 12) & 0x3f];
    output += index + 1 < bytes.length ? HOME_PRESET_BASE64_ALPHABET[(triplet >> 6) & 0x3f] : "=";
    output += index + 2 < bytes.length ? HOME_PRESET_BASE64_ALPHABET[triplet & 0x3f] : "=";
  }
  return output;
}

export async function buildHomePresetVisibleHistory(input: {
  id: HomePresetReplayId;
  startedAtMs: number;
}): Promise<StreamItem[]> {
  const recording = await getHomePresetReplayRecording(input.id);
  const replay = projectConversationReplay({
    events: recording.events,
    edits: recording.edits,
    positionMs: Number.POSITIVE_INFINITY,
    timestampBaseMs: input.startedAtMs,
    timestampScale: 1 / HOME_PRESET_REPLAY_SPEED,
  });
  const items =
    input.id === "slides-roadshow"
      ? buildHomePresetConfirmedSlidesHistory({
          recording,
          items: replay.items,
          startedAtMs: input.startedAtMs,
        })
      : replay.items;
  return items.map(prefixHomePresetHistoryItemId);
}

function getDefaultExport(module: unknown): unknown {
  return module && typeof module === "object" && "default" in module
    ? (module as { default: unknown }).default
    : module;
}

function buildHomePresetConfirmedSlidesHistory(input: {
  recording: ConversationRecording;
  items: readonly StreamItem[];
  startedAtMs: number;
}): StreamItem[] {
  const syntheticConfirm = buildHomePresetSyntheticConfirm({
    recording: input.recording,
    startedAtMs: input.startedAtMs,
  });
  if (!syntheticConfirm) {
    return [...input.items];
  }
  const preConfirmProjection = projectConversationReplay({
    events: input.recording.events,
    edits: input.recording.edits,
    positionMs: HOME_PRESET_SLIDES_CONFIRM_OFFSET_MS,
    timestampBaseMs: input.startedAtMs,
    timestampScale: 1 / HOME_PRESET_REPLAY_SPEED,
  });
  const preConfirmItems = filterHomePresetSlidesConfirmItems({
    items: preConfirmProjection.items,
    syntheticConfirm,
  });
  const preConfirmItemIds = new Set(preConfirmItems.map((item) => item.id));
  const projectedItems = filterHomePresetSlidesConfirmItems({
    items: input.items,
    syntheticConfirm,
  });
  return [
    ...preConfirmItems,
    buildConfirmedHomePresetSyntheticConfirmItem(syntheticConfirm.item),
    ...projectedItems.filter((item) => !preConfirmItemIds.has(item.id)),
  ];
}

function prefixHomePresetHistoryItemId(item: StreamItem): StreamItem {
  if (item.id.startsWith("home_preset_")) {
    return item;
  }
  return Object.assign({}, item, { id: `home_preset_${item.id}` });
}

interface HomePresetSyntheticConfirm {
  continueOffsetMs: number;
  item: Extract<StreamItem, { kind: "assistant_message" }>;
}

function buildHomePresetSyntheticConfirm(input: {
  recording: ConversationRecording;
  startedAtMs: number;
}): HomePresetSyntheticConfirm | null {
  const confirmPath = getHomePresetSlidesConfirmPath(input.recording);
  const confirmDataJson = getHomePresetSlidesConfirmDataJson(input.recording);
  if (!confirmPath || !confirmDataJson) {
    return null;
  }
  const text = `<doya-ui version="1" kind="ai_creation.slides.progress" render="status" visibility="summary" id="home_preset_slides_confirm" desc="Human-visible PPT confirmation progress."><doya-ui-content><doya-title>幻灯片确认</doya-title><doya-summary>请确认路演稿的画布、页数、风格和项目设定。</doya-summary><doya-field name="confirm_path" label="确认目录">${confirmPath}</doya-field><doya-field name="confirm_data_json" label="确认数据">${confirmDataJson}</doya-field></doya-ui-content></doya-ui>`;
  return {
    continueOffsetMs: getHomePresetConfirmContinuationOffsetMs(input.recording),
    item: {
      kind: "assistant_message",
      id: "home_preset_slides_confirm",
      messageId: "home_preset_slides_confirm",
      text,
      timestamp: new Date(
        input.startedAtMs + HOME_PRESET_SLIDES_CONFIRM_OFFSET_MS / HOME_PRESET_REPLAY_SPEED,
      ),
    },
  };
}

function getHomePresetSlidesConfirmPath(recording: ConversationRecording): string | null {
  for (const event of recording.events) {
    if (event.kind !== "agent_stream_raw") {
      continue;
    }
    const item = event.payload.event.type === "timeline" ? event.payload.event.item : null;
    if (item?.type !== "tool_call") {
      continue;
    }
    const detail = item.detail;
    if (detail?.type !== "edit") {
      continue;
    }
    const detailRecord = detail as Record<string, unknown>;
    const filePath = typeof detailRecord.filePath === "string" ? detailRecord.filePath : "";
    if (filePath.endsWith("/confirm_ui/recommendations.json")) {
      return filePath.replace(/recommendations\.json$/u, "");
    }
  }
  return null;
}

function getHomePresetSlidesConfirmDataJson(recording: ConversationRecording): string | null {
  for (const event of recording.events) {
    if (event.kind !== "agent_stream_raw") {
      continue;
    }
    const item = event.payload.event.type === "timeline" ? event.payload.event.item : null;
    if (item?.type !== "assistant_message") {
      continue;
    }
    const value =
      /<doya-field\b[^>]*\bname=(?:"|')confirm_data_json(?:"|')[^>]*>([\s\S]*?)(?:<\/doya-field>|<\/|$)/u.exec(
        item.text,
      )?.[1] ?? null;
    if (value) {
      return value;
    }
  }
  return null;
}

function getHomePresetConfirmContinuationOffsetMs(recording: ConversationRecording): number {
  const continuationEvent = listReplayEvents(recording.events, recording.edits).find(
    (entry) =>
      !entry.hidden &&
      entry.event.kind === "agent_stream_raw" &&
      entry.event.payload.event.type === "timeline" &&
      entry.event.payload.event.item.type === "tool_call" &&
      entry.event.payload.event.item.detail?.type === "shell" &&
      entry.event.payload.event.item.detail.command.includes("confirm_ui/result.json"),
  );
  return continuationEvent?.scheduledOffsetMs ?? HOME_PRESET_SLIDES_CONFIRM_OFFSET_MS;
}

function buildConfirmedHomePresetSyntheticConfirmItem(
  item: Extract<StreamItem, { kind: "assistant_message" }>,
): Extract<StreamItem, { kind: "assistant_message" }> {
  const text = markHomePresetConfirmDataConfirmed(item.text);
  if (text === item.text) {
    return item;
  }
  return { ...item, text };
}

function markHomePresetConfirmDataConfirmed(text: string): string {
  return text.replace(
    /(<doya-field\b[^>]*\bname=(?:"|')confirm_data_json(?:"|')[^>]*>)([\s\S]*?)(<\/doya-field>)/u,
    (match, open: string, value: string, close: string) => {
      try {
        const parsed = JSON.parse(value) as Record<string, unknown>;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return match;
        }
        const recommendations =
          parsed.recommendations &&
          typeof parsed.recommendations === "object" &&
          !Array.isArray(parsed.recommendations)
            ? { ...parsed.recommendations, _already_confirmed: true }
            : undefined;
        return `${open}${JSON.stringify({
          ...parsed,
          ...(recommendations ? { recommendations } : {}),
          _already_confirmed: true,
        })}${close}`;
      } catch {
        return match;
      }
    },
  );
}

function filterHomePresetSlidesConfirmItems(input: {
  items: readonly StreamItem[];
  syntheticConfirm: HomePresetSyntheticConfirm;
}): StreamItem[] {
  return input.items.filter((item) => !isBrokenHomePresetSlidesConfirmItem(item));
}

function isBrokenHomePresetSlidesConfirmItem(item: StreamItem): boolean {
  if (item.kind !== "assistant_message") {
    return false;
  }
  const text = item.text.trim();
  return (
    text === "确认" ||
    Boolean(extractHomePresetPptConfirmPath(text)) ||
    text.includes("confirm_ui/") ||
    text.includes("confirm_path") ||
    text.includes("confirm_data_json")
  );
}

function extractHomePresetPptConfirmPath(text: string): string | null {
  return (
    /(?:^|[\s([`"'])((?:\.\/)?projects\/[^)\]\s`"']+\/confirm_ui\/)(?:recommendations\.json|result\.json)?/u.exec(
      text,
    )?.[1] ?? null
  );
}

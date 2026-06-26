import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useRouter } from "expo-router";
import {
  View,
  Text,
  Pressable,
  Platform,
  ActivityIndicator,
  type GestureResponderEvent,
  type PressableStateCallbackType,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SvgXml } from "react-native-svg";
import { MAX_CONTENT_WIDTH, useIsCompactFormFactor } from "@/constants/layout";
import { useMutation } from "@tanstack/react-query";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { usePanelStore } from "@/stores/panel-store";
import {
  AssistantMessage,
  SpeakMessage,
  UserMessage,
  ActivityLog,
  ToolCall,
  TodoListCard,
  CompactionMarker,
  DoyaRawResponseButton,
  MessageOuterSpacingProvider,
  type AssistantTurnBillingUsage,
  type InlinePathTarget,
} from "@/components/message";
import { PptPreviewFrame } from "@/components/ppt-preview-frame";
import { PlanCard } from "@/components/plan-card";
import { buildOptimisticUserMessage, generateMessageId, type StreamItem } from "@/types/stream";
import type { PendingPermission } from "@/types/shared";
import type {
  AgentCapabilityFlags,
  AgentPermissionAction,
  AgentPermissionResponse,
} from "@getdoya/protocol/agent-types";
import type { AgentAttachment } from "@getdoya/protocol/messages";
import type { AgentScreenAgent } from "@/hooks/use-agent-screen-state-machine";
import { useSessionStore } from "@/stores/session-store";
import type { AgentTurnUsageRecord } from "@/stores/session-store";
import { useFileExplorerActions } from "@/hooks/use-file-explorer-actions";
import { useLoadOlderAgentHistory } from "@/hooks/use-load-older-agent-history";
import type { ToastApi } from "@/components/toast-host";
import type { DaemonClient } from "@getdoya/client/internal/daemon-client";
import { QuestionFormCard } from "@/components/question-form-card";
import { ToolCallSheetProvider } from "@/components/tool-call-sheet";
import { type AgentStreamRenderModel, buildAgentStreamRenderModel } from "./model";
import { resolveStreamRenderStrategy } from "./strategy-resolver";
import { type StreamSegmentRenderers, type StreamViewportHandle } from "./strategy";
import { CompletedTurnFooterRow, TurnFooter, type TurnContentStrategy } from "./turn-footer";
import { layoutStream, type StreamLayoutItem, type TurnFooterHost } from "./layout";
import {
  type BottomAnchorLocalRequest,
  type BottomAnchorRouteRequest,
} from "./bottom-anchor-controller";
import {
  AssistantFileLinkResolverProvider,
  normalizeInlinePathTarget,
  useAssistantFileLinkActions,
} from "@/assistant-file-links";
import {
  createWorkspaceFileTabTarget,
  type OpenFileDisposition,
  type WorkspaceFileOpenRequest,
} from "@/workspace/file-open";
import { resolveWorkspaceIdByExecutionDirectory } from "@/utils/workspace-execution";
import { navigateToPreparedWorkspaceTab } from "@/utils/workspace-navigation";
import { useStableEvent } from "@/hooks/use-stable-event";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import { recordRenderProfileReasons } from "@/utils/render-profiler";
import { translateNow, useI18n, type Locale } from "@/i18n/i18n";
import type { AttachmentMetadata } from "@/attachments/types";
import { setAiCreationEditSource } from "@/stores/ai-creation-edit-source-store";
import { buildHostAiCreationEditRoute } from "@/utils/host-routes";
import { buildWorkspacePptConfirmUrl } from "@/workspace/ppt-confirm";
import { createWorkspacePptPreviewTabTarget } from "@/workspace/ppt-preview";
import type { WorkspaceTabTarget } from "@/stores/workspace-tabs-store";
import { useDownloadStore } from "@/stores/download-store";
import { useHostRuntimeSnapshot, useHosts } from "@/runtime/host-runtime";
import {
  AI_CREATION_PLACEHOLDER_ID,
  extractDocumentAnnotationResultDisplay,
  extractAiCreationFinalDocumentPath,
  extractAiCreationFinalPptxPath,
  extractAiCreationPptConfirmPath,
  extractAiCreationPptPreviewPath,
  normalizeAiCreationStream,
} from "./ai-creation";
import { buildAgentStreamWorkspaceFileOpenRequest } from "./open-file";
import type { DoyaMessageCard } from "@/utils/doya-message-markup";
import { loadAccountBootstrapSession } from "@/account/account-api";
import {
  getControlBillingSummary,
  isControlApiConfigured,
  type ControlUsageLogRecord,
} from "@/control/control-api";
import {
  buildDoyaMessageMeta,
  buildDoyaResponseLanguageInstruction,
  escapeDoyaMarkupText,
  parseDoyaMessageCards,
} from "@/utils/doya-message-markup";
import {
  loadAiCreationMessageDisplayMetadata,
  type AiCreationMessageDisplayEntry,
} from "@/stores/ai-creation-message-display-store";
import { Check, ChevronDown, Download, Eye, SlidersHorizontal, X } from "@/components/icons/lucide";

function resolveDisplayAttachmentPreviewSource(input: {
  displayAttachment: AgentAttachment;
  attachments: readonly AgentAttachment[];
}): AgentAttachment {
  const { displayAttachment, attachments } = input;
  if (displayAttachment.type !== "file") {
    return displayAttachment;
  }

  const title = displayAttachment.title ?? null;
  const mimeType = displayAttachment.mimeType;
  const sourceAttachment = attachments.find(
    (attachment) =>
      getAttachmentTitle(attachment) === title &&
      getAttachmentOriginalMimeType(attachment) === mimeType,
  );
  return sourceAttachment ?? displayAttachment;
}

function resolveUserMessageDisplayAttachments(item: Extract<StreamItem, { kind: "user_message" }>) {
  if (!item.displayAttachments) {
    return item.attachments ?? [];
  }
  return item.displayAttachments.map((displayAttachment) =>
    resolveDisplayAttachmentPreviewSource({
      displayAttachment,
      attachments: item.attachments ?? [],
    }),
  );
}

function getAttachmentTitle(attachment: AgentAttachment): string | null {
  return "title" in attachment ? (attachment.title ?? null) : null;
}

function getAttachmentOriginalMimeType(attachment: AgentAttachment): string {
  if (attachment.type === "text") {
    const match = attachment.text.match(/^MIME type:\s*(.+)$/m);
    return match?.[1]?.trim() || attachment.mimeType;
  }
  return attachment.mimeType;
}

type UserMessageStreamItem = Extract<StreamItem, { kind: "user_message" }>;

function buildAiCreationDisplayMetadataMap(
  entries: readonly AiCreationMessageDisplayEntry[],
): Map<string, AiCreationMessageDisplayEntry> {
  const map = new Map<string, AiCreationMessageDisplayEntry>();
  for (const entry of entries) {
    map.set(entry.messageId, entry);
  }
  return map;
}

function applyAiCreationMessageDisplayMetadata(input: {
  items: readonly StreamItem[];
  metadataByMessageId: Map<string, AiCreationMessageDisplayEntry>;
}): StreamItem[] {
  let changed = false;
  const items = input.items.map((item) => {
    if (item.kind !== "user_message") {
      return item;
    }
    const metadata =
      (item.messageId ? input.metadataByMessageId.get(item.messageId) : undefined) ??
      input.metadataByMessageId.get(item.id);
    if (metadata) {
      changed = true;
      return applyUserMessageDisplayMetadata({ item, metadata });
    }
    const presetContinuationDisplayText = extractHomePresetContinuationDisplayText(item.text);
    if (presetContinuationDisplayText) {
      changed = true;
      return {
        ...item,
        text: presetContinuationDisplayText,
      };
    }
    return item;
  });
  return changed ? items : [...input.items];
}

function applyUserMessageDisplayMetadata(input: {
  item: UserMessageStreamItem;
  metadata: AiCreationMessageDisplayEntry;
}): UserMessageStreamItem {
  return {
    ...input.item,
    ...(input.metadata.text ? { text: input.metadata.text } : {}),
    ...(input.metadata.images ? { images: input.metadata.images } : {}),
    ...("displayAttachments" in input.metadata
      ? { displayAttachments: input.metadata.displayAttachments ?? [] }
      : {}),
    ...(input.metadata.selectionPreviewUri
      ? { selectionPreviewUri: input.metadata.selectionPreviewUri }
      : {}),
    ...(input.metadata.selectionImageSource
      ? { selectionImageSource: input.metadata.selectionImageSource }
      : {}),
    ...(input.metadata.selectionImage ? { selectionImage: input.metadata.selectionImage } : {}),
  };
}

function extractHomePresetContinuationDisplayText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("Continue from this conversation context.")) {
    return null;
  }
  const marker = "User's new message:";
  const markerIndex = trimmed.lastIndexOf(marker);
  if (markerIndex < 0) {
    return null;
  }
  const displayText = trimmed.slice(markerIndex + marker.length).trim();
  return displayText || null;
}

interface LiveArtifactProgressGroup {
  isFirst: boolean;
  items: Extract<StreamItem, { kind: "assistant_message" }>[];
}

function getAssistantDebugRawText(
  item: Extract<StreamItem, { kind: "assistant_message" }>,
): string | undefined {
  return (item as typeof item & { debugRawText?: string }).debugRawText;
}

const EMPTY_AGENT_TURN_USAGE_BY_ID = new Map<string, AgentTurnUsageRecord>();
const notifiedPptConfirmations = new Set<string>();

function renderLiveAuxiliaryNode(input: {
  pendingPermissions: ReactNode;
  turnFooter: ReactNode;
}): ReactNode {
  if (!input.pendingPermissions && !input.turnFooter) {
    return null;
  }
  return (
    <>
      {input.turnFooter}
      {input.pendingPermissions ? (
        <View style={stylesheet.contentWrapper}>
          <View style={stylesheet.listHeaderContent}>{input.pendingPermissions}</View>
        </View>
      ) : null}
    </>
  );
}

function isLiveArtifactProgressCard(card: DoyaMessageCard | null): boolean {
  return Boolean(card?.kind.endsWith(".progress"));
}

function isPreviewDiscoveryCard(card: DoyaMessageCard | null): boolean {
  return Boolean(
    card?.fields.some((field) => field.name === "preview_path" || field.name === "confirm_path"),
  );
}

function isLiveArtifactProgressItem(
  item: StreamItem | null,
): item is Extract<StreamItem, { kind: "assistant_message" }> {
  if (item?.kind !== "assistant_message") {
    return false;
  }
  if (extractAiCreationFinalPptxPath(item.text) || extractAiCreationFinalDocumentPath(item.text)) {
    return false;
  }
  const cards = parseDoyaMessageCards(item.text);
  return (
    cards.some(isLiveArtifactProgressCard) ||
    Boolean(extractAiCreationPptPreviewPath(item.text)) ||
    Boolean(extractAiCreationPptConfirmPath(item.text))
  );
}

function getSpeakToolMessage(item: StreamItem | null): string | null {
  if (item?.kind !== "tool_call" || item.payload.source !== "agent") {
    return null;
  }
  const data = item.payload.data;
  if (
    data.name !== "speak" ||
    data.detail.type !== "unknown" ||
    typeof data.detail.input !== "string"
  ) {
    return null;
  }
  const text = data.detail.input.trim();
  return text.length > 0 ? text : null;
}

function isDuplicateSpeakAssistantMessage(layoutItem: StreamLayoutItem): boolean {
  const item = layoutItem.item;
  if (item.kind !== "assistant_message") {
    return false;
  }
  const text = item.text.trim();
  if (!text) {
    return false;
  }
  return (
    getSpeakToolMessage(layoutItem.aboveItem) === text ||
    getSpeakToolMessage(layoutItem.belowItem) === text
  );
}

function getLiveArtifactProgressGroup(
  layoutItem: StreamLayoutItem,
): LiveArtifactProgressGroup | null {
  if (!isLiveArtifactProgressItem(layoutItem.item)) {
    return null;
  }

  const { items, index } = layoutItem;
  let start = index;
  while (start > 0 && isLiveArtifactProgressItem(items[start - 1] ?? null)) {
    start -= 1;
  }

  let end = index;
  while (end + 1 < items.length && isLiveArtifactProgressItem(items[end + 1] ?? null)) {
    end += 1;
  }

  if (start === end) {
    return null;
  }

  return {
    isFirst: index === start,
    items: items
      .slice(start, end + 1)
      .filter((item): item is Extract<StreamItem, { kind: "assistant_message" }> =>
        isLiveArtifactProgressItem(item),
      ),
  };
}

function useAgentStreamActiveConnection(
  serverId: string,
): { type: string; endpoint: string } | null {
  return useHostRuntimeSnapshot(serverId)?.activeConnection ?? null;
}

function renderPendingPermissionsNode(input: {
  pendingPermissions: PendingPermission[];
  client: DaemonClient | null;
}): ReactNode {
  if (input.pendingPermissions.length === 0) {
    return null;
  }
  return (
    <View style={stylesheet.permissionsContainer}>
      {input.pendingPermissions.map((permission) => (
        <PermissionRequestCard key={permission.key} permission={permission} client={input.client} />
      ))}
    </View>
  );
}

function renderStreamItemWithTurnFooter(input: {
  content: ReactNode;
  layoutItem: StreamLayoutItem;
  strategy: TurnContentStrategy;
  resolveBillingUsage?: (host: TurnFooterHost) => AssistantTurnBillingUsage | null;
}): ReactNode {
  const footerHost = input.layoutItem.completedFooter;
  const footer = footerHost ? (
    <CompletedTurnFooterRow
      strategy={input.strategy}
      items={footerHost.items}
      timing={footerHost.timing}
      startIndex={footerHost.startIndex}
      billingUsage={input.resolveBillingUsage?.(footerHost)}
    />
  ) : null;
  if (!input.content) {
    return footer;
  }

  const content = (
    <StreamItemWrapper gapBelow={input.layoutItem.gapBelow}>{input.content}</StreamItemWrapper>
  );

  if (input.layoutItem.frameOrder === "footer-then-content") {
    return (
      <>
        {footer}
        {content}
      </>
    );
  }

  return (
    <>
      {content}
      {footer}
    </>
  );
}

function toAssistantTurnBillingUsage(log: ControlUsageLogRecord): AssistantTurnBillingUsage {
  return {
    inputTokens: log.inputTokens,
    outputTokens: log.outputTokens,
    cacheCreationTokens: log.cacheCreationTokens,
    cacheReadTokens: log.cacheReadTokens,
    actualCostCny: log.actualCostCny,
  };
}

function toAssistantTurnBillingUsageFromStore(
  usage: AgentTurnUsageRecord,
): AssistantTurnBillingUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    cacheReadTokens: usage.cacheReadTokens,
    actualCostCny: usage.actualCostCny,
  };
}

function filterBillingUsageLogsByAgentId(
  logs: ControlUsageLogRecord[],
  agentId: string,
): ControlUsageLogRecord[] {
  return logs.filter((log) => log.agentId === agentId);
}

function getTurnFooterHostCandidateTurnIds(host: TurnFooterHost): string[] {
  const item = host.items[host.startIndex];
  if (!item || item.kind !== "assistant_message") {
    return [host.itemId];
  }
  const values = [item.turnId, item.messageId, item.id, item.blockGroupId, host.itemId];
  return values.filter((value): value is string => Boolean(value?.trim()));
}

function renderListEmptyComponent(input: {
  renderModel: AgentStreamRenderModel;
  emptyStateStyle: StyleProp<ViewStyle>;
}): ReactNode {
  if (
    input.renderModel.boundary.hasVirtualizedHistory ||
    input.renderModel.boundary.hasMountedHistory ||
    input.renderModel.boundary.hasLiveHead ||
    input.renderModel.auxiliary.pendingPermissions ||
    input.renderModel.auxiliary.turnFooter
  ) {
    return null;
  }

  return (
    <View style={input.emptyStateStyle}>
      <Text style={stylesheet.emptyStateText}>
        {translateNow("ui.start.chatting.with.this.agent.avw6i5")}
      </Text>
    </View>
  );
}

function renderHistoryStreamItem(input: {
  item: StreamItem;
  layoutItemById: Map<string, StreamLayoutItem>;
  renderStreamItem: (layoutItem: StreamLayoutItem) => ReactNode;
}): ReactNode {
  const layoutItem = input.layoutItemById.get(input.item.id);
  if (!layoutItem) {
    return null;
  }
  return input.renderStreamItem(layoutItem);
}

function renderLiveHeadStreamItem(input: {
  item: StreamItem;
  layoutItemById: Map<string, StreamLayoutItem>;
  renderStreamItem: (layoutItem: StreamLayoutItem) => ReactNode;
}): ReactNode {
  const layoutItem = input.layoutItemById.get(input.item.id);
  if (!layoutItem) {
    return null;
  }
  return input.renderStreamItem(layoutItem);
}

export interface AgentStreamViewHandle {
  scrollToBottom(reason?: BottomAnchorLocalRequest["reason"]): void;
  prepareForViewportChange(): void;
}

export interface AgentStreamViewProps {
  agentId: string;
  serverId?: string;
  agent: AgentScreenAgent;
  streamItems: StreamItem[];
  streamHeadOverride?: StreamItem[];
  pendingPermissions: Map<string, PendingPermission>;
  routeBottomAnchorRequest?: BottomAnchorRouteRequest | null;
  isAuthoritativeHistoryReady?: boolean;
  isReplayMode?: boolean;
  toast?: ToastApi | null;
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
  onOpenReplayPptPreview?: (projectName: string) => void;
  onInlinePptConfirm?: () => void;
  onOpenWorkspaceTab?: (target: WorkspaceTabTarget) => void;
}

const AGENT_CAPABILITY_FLAG_KEYS: (keyof AgentCapabilityFlags)[] = [
  "supportsStreaming",
  "supportsSessionPersistence",
  "supportsDynamicModes",
  "supportsMcpServers",
  "supportsReasoningStream",
  "supportsToolInvocations",
  "supportsRewindConversation",
  "supportsRewindFiles",
  "supportsRewindBoth",
];

const EMPTY_STREAM_HEAD: StreamItem[] = [];
const RIGHT_PANEL_BACKGROUND = "#fcfcfc";
const LazyToolCallDetailsContent = React.lazy(() =>
  import("@/components/tool-call-details").then((module) => ({
    default: module.ToolCallDetailsContent,
  })),
);
const AI_CREATION_PLACEHOLDER_DOT_KEYS = Array.from({ length: 420 }, (_, index) => `dot-${index}`);
const AI_CREATION_PLACEHOLDER_DOT_COLUMNS = 36;
const AI_CREATION_PLACEHOLDER_DOT_PHASES = 24;
const AI_CREATION_FILE_MINI_CELLS = [0, 1, 2, 3, 4, 5, 6, 7] as const;
const AI_CREATION_FILE_MINI_BARS = [10, 18, 26, 14] as const;
const AI_CREATION_FILE_WORD_LINES = [0, 1, 2, 3] as const;
const AI_CREATION_FILE_PDF_LINES = [0, 1, 2] as const;
const PDF_FILE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#ef5350" d="M13 9h5.5L13 3.5zM6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m4.93 10.44c.41.9.93 1.64 1.53 2.15l.41.32c-.87.16-2.07.44-3.34.93l-.11.04.5-1.04c.45-.87.78-1.66 1.01-2.4m6.48 3.81c.18-.18.27-.41.28-.66.03-.2-.02-.39-.12-.55-.29-.47-1.04-.69-2.28-.69l-1.29.07-.87-.58c-.63-.52-1.2-1.43-1.6-2.56l.04-.14c.33-1.33.64-2.94-.02-3.6a.85.85 0 0 0-.61-.24h-.24c-.37 0-.7.39-.79.77-.37 1.33-.15 2.06.22 3.27v.01c-.25.88-.57 1.9-1.08 2.93l-.96 1.8-.89.49c-1.2.75-1.77 1.59-1.88 2.12-.04.19-.02.36.05.54l.03.05.48.31.44.11c.81 0 1.73-.95 2.97-3.07l.18-.07c1.03-.33 2.31-.56 4.03-.75 1.03.51 2.24.74 3 .74.44 0 .74-.11.91-.3m-.41-.71.09.11c-.01.1-.04.11-.09.13h-.04l-.19.02c-.46 0-1.17-.19-1.9-.51.09-.1.13-.1.23-.1 1.4 0 1.8.25 1.9.35M7.83 17c-.65 1.19-1.24 1.85-1.69 2 .05-.38.5-1.04 1.21-1.69zm3.02-6.91c-.23-.9-.24-1.63-.07-2.05l.07-.12.15.05c.17.24.19.56.09 1.1l-.03.16-.16.82z"/></svg>';
const WORD_FILE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#2563eb" d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zm0 2.8L17.2 9H13zM7 12h10v2H7zm0 4h10v2H7zm0-8h4v2H7z"/></svg>';
const SPREADSHEET_FILE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#16a34a" d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zm0 2.8L17.2 9H13zM7 12h10v7H7zm2 2v1h2v-1zm4 0v1h2v-1zm-4 3h2v-1H9zm4 0h2v-1h-2z"/></svg>';
const PRESENTATION_FILE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#f97316" d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zm0 2.8L17.2 9H13zM7 12h10v5H7zm2 7h6v1H9z"/></svg>';
const IMAGE_FILE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#c026d3" d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zm0 2.8L17.2 9H13zM7 17l3-4 2.2 2.7 1.6-2.1L17 17zm1-7.5A1.5 1.5 0 1 1 11 9.5 1.5 1.5 0 0 1 8 9.5"/></svg>';
const DEFAULT_AI_CREATION_FILE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#64748b" d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zm0 2.8L17.2 9H13z"/></svg>';

function canOpenWorkspaceOrReplayPptPreview(input: {
  onOpenReplayPptPreview?: (projectName: string) => void;
  workspaceId: string | null | undefined;
}): boolean {
  return Boolean(input.workspaceId) || Boolean(input.onOpenReplayPptPreview);
}

function openReplayPptPreview(
  onOpenReplayPptPreview: ((projectName: string) => void) | undefined,
  projectName: string,
): void {
  onOpenReplayPptPreview?.(projectName);
}

const AgentStreamViewComponent = forwardRef<AgentStreamViewHandle, AgentStreamViewProps>(
  function AgentStreamView(
    {
      agentId,
      serverId,
      agent,
      streamItems,
      streamHeadOverride,
      pendingPermissions,
      routeBottomAnchorRequest = null,
      isAuthoritativeHistoryReady = true,
      isReplayMode,
      toast,
      onOpenWorkspaceFile,
      onOpenReplayPptPreview,
      onInlinePptConfirm,
      onOpenWorkspaceTab,
    },
    ref,
  ) {
    const viewportRef = useRef<StreamViewportHandle | null>(null);
    const router = useRouter();
    const isMobile = useIsCompactFormFactor();
    const streamRenderStrategy = useMemo(
      () =>
        resolveStreamRenderStrategy({
          platform: Platform.OS,
          isMobileBreakpoint: isMobile,
        }),
      [isMobile],
    );
    const [billingUsageLogs, setBillingUsageLogs] = useState<ControlUsageLogRecord[]>([]);
    const localTurnUsageById = useSessionStore((state) =>
      serverId
        ? (state.sessions[serverId]?.agentTurnUsageById.get(agent.id) ??
          EMPTY_AGENT_TURN_USAGE_BY_ID)
        : EMPTY_AGENT_TURN_USAGE_BY_ID,
    );

    useEffect(() => {
      if (!isControlApiConfigured()) {
        return;
      }

      let cancelled = false;
      void (async () => {
        const accountSession = await loadAccountBootstrapSession();
        if (!accountSession) {
          return;
        }
        const summary = await getControlBillingSummary({ accountSession });
        if (!cancelled) {
          setBillingUsageLogs(filterBillingUsageLogsByAgentId(summary.recentUsageLogs, agent.id));
        }
      })().catch(() => {});

      return () => {
        cancelled = true;
      };
    }, [agent.id, agent.status]);

    const billingUsageByTurnId = useMemo(() => {
      const map = new Map<string, AssistantTurnBillingUsage>();
      for (const [turnId, usage] of localTurnUsageById) {
        map.set(turnId, toAssistantTurnBillingUsageFromStore(usage));
      }
      for (const log of billingUsageLogs) {
        map.set(log.turnId, toAssistantTurnBillingUsage(log));
      }
      return map;
    }, [billingUsageLogs, localTurnUsageById]);

    const resolveBillingUsage = useCallback(
      (host: TurnFooterHost): AssistantTurnBillingUsage | null => {
        for (const turnId of getTurnFooterHostCandidateTurnIds(host)) {
          const usage = billingUsageByTurnId.get(turnId);
          if (usage) return usage;
        }
        return null;
      },
      [billingUsageByTurnId],
    );
    const [isNearBottom, setIsNearBottom] = useState(true);
    const [expandedInlineToolCallIds, setExpandedInlineToolCallIds] = useState<Set<string>>(
      new Set(),
    );
    const [aiCreationDisplayMetadata, setAiCreationDisplayMetadata] = useState<
      AiCreationMessageDisplayEntry[]
    >([]);
    const openFileExplorerForCheckout = usePanelStore((state) => state.openFileExplorerForCheckout);
    const setExplorerTabForCheckout = usePanelStore((state) => state.setExplorerTabForCheckout);

    // Get serverId (fallback to agent's serverId if not provided)
    const resolvedServerId = serverId ?? agent.serverId ?? "";

    useEffect(() => {
      let cancelled = false;
      setAiCreationDisplayMetadata([]);
      if (!resolvedServerId || !agentId) {
        return;
      }
      void loadAiCreationMessageDisplayMetadata({
        serverId: resolvedServerId,
        agentId,
      })
        .then((entries) => {
          if (!cancelled) {
            setAiCreationDisplayMetadata(entries);
          }
          return undefined;
        })
        .catch(() => {
          if (!cancelled) {
            setAiCreationDisplayMetadata([]);
          }
        });
      return () => {
        cancelled = true;
      };
    }, [agentId, resolvedServerId]);

    const client = useSessionStore((state) => state.sessions[resolvedServerId]?.client ?? null);
    const activeConnection = useAgentStreamActiveConnection(resolvedServerId);
    const streamHead = useSessionStore((state) =>
      state.sessions[resolvedServerId]?.agentStreamHead?.get(agentId),
    );
    const effectiveStreamHead = streamHeadOverride ?? streamHead ?? EMPTY_STREAM_HEAD;

    const workspaceRoot = agent.cwd?.trim() || "";
    const workspaceId = resolveWorkspaceIdByExecutionDirectory({
      workspaces: useSessionStore.getState().sessions[resolvedServerId]?.workspaces?.values(),
      workspaceDirectory: workspaceRoot,
    });
    const { requestDirectoryListing, requestFileDownloadToken } = useFileExplorerActions({
      serverId: resolvedServerId,
      workspaceId: workspaceId ?? undefined,
      workspaceRoot,
    });
    const daemons = useHosts();
    const daemonProfile = useMemo(
      () => daemons.find((daemon) => daemon.serverId === resolvedServerId),
      [daemons, resolvedServerId],
    );
    const startDownload = useDownloadStore((state) => state.startDownload);
    const { isLoadingOlder, hasOlder, loadOlder } = useLoadOlderAgentHistory({
      serverId: resolvedServerId,
      agentId,
      toast,
    });
    // Keep entry/exit animations off on Android due to RN dispatchDraw crashes
    // tracked in react-native-reanimated#8422.
    const shouldDisableEntryExitAnimations = Platform.OS === "android";
    const scrollIndicatorFadeIn = shouldDisableEntryExitAnimations
      ? undefined
      : FadeIn.duration(200);
    const scrollIndicatorFadeOut = shouldDisableEntryExitAnimations
      ? undefined
      : FadeOut.duration(200);

    useEffect(() => {
      setIsNearBottom(true);
      setExpandedInlineToolCallIds(new Set());
    }, [agentId]);

    const handleInlinePathPress = useStableEvent(
      (target: InlinePathTarget, disposition: OpenFileDisposition) => {
        if (!target.path) {
          return;
        }

        const normalized = normalizeInlinePathTarget(target.path, agent.cwd);
        if (!normalized) {
          return;
        }

        if (normalized.file) {
          const request = buildAgentStreamWorkspaceFileOpenRequest({
            target,
            disposition,
            sourceAgentId: agentId,
            cwd: agent.cwd,
          });
          if (!request) {
            return;
          }

          if (onOpenWorkspaceFile) {
            onOpenWorkspaceFile(request);
            return;
          }

          if (workspaceId) {
            navigateToPreparedWorkspaceTab({
              serverId: resolvedServerId,
              workspaceId,
              target: createWorkspaceFileTabTarget(request.location, {
                sourceAgentId: request.sourceAgentId,
              }),
            });
          }
          return;
        }

        void requestDirectoryListing(normalized.directory, {
          recordHistory: false,
          setCurrentPath: false,
        });

        const checkout = {
          serverId: resolvedServerId,
          cwd: agent.cwd,
          isGit: agent.projectPlacement?.checkout?.isGit ?? true,
        };
        setExplorerTabForCheckout({ ...checkout, tab: "files" });
        openFileExplorerForCheckout({
          isCompact: isMobile,
          checkout,
        });
      },
    );

    const handleToolCallOpenFile = useStableEvent((filePath: string) => {
      handleInlinePathPress({ raw: filePath, path: filePath }, "side");
    });

    const handleAttachmentPreviewPath = useStableEvent((filePath: string) => {
      handleInlinePathPress({ raw: filePath, path: filePath }, "main");
    });

    const handleEditAiCreationImage = useStableEvent(
      (image: AttachmentMetadata, previewUri: string, source: string) => {
        setAiCreationEditSource({
          entry: "result-edit",
          image,
          previewUri,
          imageSource: source,
          sourceAgentId: agentId,
          sourceServerId: resolvedServerId,
        });
        router.push(buildHostAiCreationEditRoute(resolvedServerId));
      },
    );

    const handleOpenPptPreview = useStableEvent((projectName: string) => {
      if (!workspaceId) {
        openReplayPptPreview(onOpenReplayPptPreview, projectName);
        return;
      }
      const target = createWorkspacePptPreviewTabTarget({ agentId, projectName });
      if (onOpenWorkspaceTab) {
        onOpenWorkspaceTab(target);
        return;
      }
      navigateToPreparedWorkspaceTab({
        serverId: resolvedServerId,
        workspaceId,
        target,
      });
    });
    const canOpenPptPreview = canOpenWorkspaceOrReplayPptPreview({
      onOpenReplayPptPreview,
      workspaceId,
    });

    const handleDownloadPptx = useStableEvent((path: string) => {
      const workspaceScopeId = workspaceId?.trim() || workspaceRoot;
      if (!workspaceScopeId) {
        return;
      }
      startDownload({
        serverId: resolvedServerId,
        scopeId: workspaceScopeId,
        fileName: path.split(/[\\/]/).pop() || "presentation.pptx",
        path,
        daemonProfile,
        requestFileDownloadToken: (targetPath) => requestFileDownloadToken(targetPath),
      });
    });

    const visibleAiCreationStream = useMemo(() => {
      const normalized = normalizeAiCreationStream({
        agentStatus: agent.status,
        tail: streamItems,
        head: effectiveStreamHead,
      });
      if (normalized.tail === streamItems && normalized.head === effectiveStreamHead) {
        return null;
      }
      return normalized;
    }, [agent.status, effectiveStreamHead, streamItems]);
    const visibleStreamItems = visibleAiCreationStream?.tail ?? streamItems;
    const visibleStreamHead = visibleAiCreationStream?.head ?? effectiveStreamHead;
    const aiCreationDisplayMetadataByMessageId = useMemo(
      () => buildAiCreationDisplayMetadataMap(aiCreationDisplayMetadata),
      [aiCreationDisplayMetadata],
    );
    const displayStreamItems = useMemo(
      () =>
        applyAiCreationMessageDisplayMetadata({
          items: visibleStreamItems,
          metadataByMessageId: aiCreationDisplayMetadataByMessageId,
        }),
      [aiCreationDisplayMetadataByMessageId, visibleStreamItems],
    );
    const displayStreamHead = useMemo(
      () =>
        applyAiCreationMessageDisplayMetadata({
          items: visibleStreamHead,
          metadataByMessageId: aiCreationDisplayMetadataByMessageId,
        }),
      [aiCreationDisplayMetadataByMessageId, visibleStreamHead],
    );

    const baseRenderModel = useMemo(() => {
      return buildAgentStreamRenderModel({
        agentStatus: agent.status,
        tail: displayStreamItems,
        head: displayStreamHead,
        platform: isWeb ? "web" : "native",
        isMobileBreakpoint: isMobile,
      });
    }, [agent.status, displayStreamHead, displayStreamItems, isMobile]);
    const streamLayout = useMemo(
      () =>
        layoutStream({
          strategy: streamRenderStrategy,
          agentStatus: agent.status,
          history: baseRenderModel.history,
          liveHead: baseRenderModel.segments.liveHead,
          timingByAssistantId: baseRenderModel.turnTiming.byAssistantId,
        }),
      [
        agent.status,
        baseRenderModel.history,
        baseRenderModel.segments.liveHead,
        baseRenderModel.turnTiming.byAssistantId,
        streamRenderStrategy,
      ],
    );
    useImperativeHandle(
      ref,
      () => ({
        scrollToBottom(reason = "jump-to-bottom") {
          viewportRef.current?.scrollToBottom(reason);
        },
        prepareForViewportChange() {
          viewportRef.current?.prepareForViewportChange();
        },
      }),
      [],
    );

    const scrollToBottom = useCallback(() => {
      viewportRef.current?.scrollToBottom("jump-to-bottom");
    }, []);

    const setInlineDetailsExpanded = useCallback(
      (itemId: string, expanded: boolean) => {
        if (!streamRenderStrategy.shouldDisableParentScrollOnInlineDetailsExpansion()) {
          return;
        }
        setExpandedInlineToolCallIds((previous) => {
          const next = new Set(previous);
          if (expanded) {
            next.add(itemId);
          } else {
            next.delete(itemId);
          }
          return next;
        });
      },
      [streamRenderStrategy],
    );

    const renderUserMessageItem = useCallback(
      (layoutItem: StreamLayoutItem, item: Extract<StreamItem, { kind: "user_message" }>) => {
        const attachments = resolveUserMessageDisplayAttachments(item);
        return (
          <UserMessage
            serverId={resolvedServerId}
            agentId={agentId}
            messageId={item.id}
            workspaceRoot={workspaceRoot}
            message={item.text}
            images={item.images}
            attachments={attachments}
            selectionPreviewUri={item.selectionPreviewUri}
            selectionImageSource={item.selectionImageSource}
            selectionImage={item.selectionImage}
            timestamp={item.timestamp.getTime()}
            capabilities={agent.capabilities}
            client={client}
            onOpenAttachmentPreviewPath={handleAttachmentPreviewPath}
            isFirstInGroup={layoutItem.isFirstInUserGroup}
            isLastInGroup={layoutItem.isLastInUserGroup}
          />
        );
      },
      [
        agent.capabilities,
        agentId,
        client,
        handleAttachmentPreviewPath,
        resolvedServerId,
        workspaceRoot,
      ],
    );

    const renderAssistantMessageItem = useCallback(
      (layoutItem: StreamLayoutItem, item: Extract<StreamItem, { kind: "assistant_message" }>) => {
        if (isDuplicateSpeakAssistantMessage(layoutItem)) {
          return null;
        }
        if (item.id === AI_CREATION_PLACEHOLDER_ID) {
          return <AiCreationPlaceholder title={item.text} />;
        }
        const liveArtifactGroup = getLiveArtifactProgressGroup(layoutItem);
        if (liveArtifactGroup) {
          if (!liveArtifactGroup.isFirst) {
            return null;
          }
          return (
            <AiCreationLiveArtifactProgressGroup
              activeConnection={activeConnection}
              agentId={agentId}
              canOpenPreview={canOpenPptPreview}
              client={client}
              items={liveArtifactGroup.items}
              allowConfirmSideEffects={!isReplayMode}
              onInlineConfirm={onInlinePptConfirm}
              onOpenPreview={handleOpenPptPreview}
              serverId={resolvedServerId}
              toast={toast}
            />
          );
        }
        const pptxPath = extractAiCreationFinalPptxPath(item.text);
        const pptConfirmPath = extractAiCreationPptConfirmPath(item.text);
        const pptConfirmData = extractAiCreationPptConfirmInlineData(item.text);
        const pptPreviewPath = extractAiCreationPptPreviewPath(item.text);
        const documentAnnotationResult = extractDocumentAnnotationResultDisplay(item.text);
        const documentPath = extractAiCreationFinalDocumentPath(item.text);
        let messageContent: ReactNode;
        if (pptxPath) {
          messageContent = (
            <AiCreationSlidesResultCard
              canOpenPreview={canOpenPptPreview}
              path={pptxPath}
              onDownload={handleDownloadPptx}
              onOpenPreview={handleOpenPptPreview}
            />
          );
        } else if (documentAnnotationResult) {
          messageContent = (
            <AiCreationFileResultCard
              path={documentAnnotationResult.path}
              title={documentAnnotationResult.title}
              summary={documentAnnotationResult.summary}
              onDownload={handleDownloadPptx}
              onOpen={handleToolCallOpenFile}
            />
          );
        } else if (documentPath) {
          messageContent = (
            <AiCreationFileResultCard
              path={documentPath}
              onDownload={handleDownloadPptx}
              onOpen={handleToolCallOpenFile}
            />
          );
        } else if (pptConfirmPath) {
          messageContent = (
            <AiCreationSlidesConfirmCard
              activeConnection={activeConnection}
              agentId={agentId}
              canOpenConfirm={Boolean(workspaceId)}
              client={client}
              allowSideEffects={!isReplayMode}
              path={pptConfirmPath}
              inlineData={pptConfirmData}
              onInlineConfirm={onInlinePptConfirm}
              serverId={resolvedServerId}
              toast={toast}
            />
          );
        } else if (pptPreviewPath) {
          messageContent = (
            <AiCreationSlidesPreviewCard
              canOpenPreview={canOpenPptPreview}
              path={pptPreviewPath}
              onOpenPreview={handleOpenPptPreview}
            />
          );
        } else {
          messageContent = (
            <AssistantMessage
              message={item.text}
              rawMessage={getAssistantDebugRawText(item)}
              timestamp={item.timestamp.getTime()}
              workspaceRoot={workspaceRoot}
              serverId={resolvedServerId}
              client={client}
              spacing={layoutItem.assistantSpacing}
              onEditImage={handleEditAiCreationImage}
            />
          );
        }
        return (
          <AssistantFileLinkResolverProvider
            client={client}
            serverId={resolvedServerId}
            workspaceRoot={workspaceRoot}
            onOpenWorkspaceFile={handleInlinePathPress}
            toast={toast}
          >
            {messageContent}
          </AssistantFileLinkResolverProvider>
        );
      },
      [
        activeConnection,
        agentId,
        client,
        handleEditAiCreationImage,
        handleToolCallOpenFile,
        handleInlinePathPress,
        handleDownloadPptx,
        handleOpenPptPreview,
        canOpenPptPreview,
        resolvedServerId,
        isReplayMode,
        onInlinePptConfirm,
        toast,
        workspaceId,
        workspaceRoot,
      ],
    );

    const renderThoughtItem = useCallback(
      (layoutItem: StreamLayoutItem, item: Extract<StreamItem, { kind: "thought" }>) => {
        return (
          <ToolCallSlot
            itemId={item.id}
            onInlineDetailsExpandedChangeByItemId={setInlineDetailsExpanded}
            toolName="thinking"
            args={item.text}
            status={item.status === "ready" ? "completed" : "executing"}
            isLastInSequence={layoutItem.isLastInToolSequence}
          />
        );
      },
      [setInlineDetailsExpanded],
    );

    const renderToolCallItem = useCallback(
      (layoutItem: StreamLayoutItem, item: Extract<StreamItem, { kind: "tool_call" }>) => {
        const { payload } = item;

        if (payload.source === "agent") {
          const data = payload.data;
          const speakMessage = getSpeakToolMessage(item);

          if (speakMessage) {
            return <SpeakMessage message={speakMessage} timestamp={item.timestamp.getTime()} />;
          }

          return (
            <ToolCallSlot
              itemId={item.id}
              onInlineDetailsExpandedChangeByItemId={setInlineDetailsExpanded}
              toolName={data.name}
              error={data.error}
              status={data.status}
              detail={data.detail}
              cwd={agent.cwd}
              metadata={data.metadata}
              isLastInSequence={layoutItem.isLastInToolSequence}
              onOpenFilePath={handleToolCallOpenFile}
            />
          );
        }

        const data = payload.data;
        return (
          <ToolCallSlot
            itemId={item.id}
            onInlineDetailsExpandedChangeByItemId={setInlineDetailsExpanded}
            toolName={data.toolName}
            args={data.arguments}
            result={data.result}
            status={data.status}
            isLastInSequence={layoutItem.isLastInToolSequence}
            onOpenFilePath={handleToolCallOpenFile}
          />
        );
      },
      [agent.cwd, setInlineDetailsExpanded, handleToolCallOpenFile],
    );

    const renderStreamItemContent = useCallback(
      (layoutItem: StreamLayoutItem) => {
        const item = layoutItem.item;
        switch (item.kind) {
          case "user_message":
            return renderUserMessageItem(layoutItem, item);

          case "assistant_message":
            return renderAssistantMessageItem(layoutItem, item);

          case "thought":
            return renderThoughtItem(layoutItem, item);

          case "tool_call":
            return renderToolCallItem(layoutItem, item);

          case "activity_log":
            return (
              <ActivityLog
                type={item.activityType}
                message={item.message}
                timestamp={item.timestamp.getTime()}
                metadata={item.metadata}
              />
            );

          case "todo_list":
            return <TodoListCard items={item.items} />;

          case "compaction":
            return (
              <CompactionMarker
                status={item.status}
                trigger={item.trigger}
                preTokens={item.preTokens}
              />
            );

          default:
            return null;
        }
      },
      [renderUserMessageItem, renderAssistantMessageItem, renderThoughtItem, renderToolCallItem],
    );

    const bottomTurnFooterHost = streamLayout.auxiliaryTurnFooter;

    const renderStreamItem = useCallback(
      (layoutItem: StreamLayoutItem) => {
        const content = renderStreamItemContent(layoutItem);
        return renderStreamItemWithTurnFooter({
          content,
          layoutItem,
          strategy: streamRenderStrategy,
          resolveBillingUsage,
        });
      },
      [renderStreamItemContent, resolveBillingUsage, streamRenderStrategy],
    );

    const pendingPermissionItems = useMemo(
      () => Array.from(pendingPermissions.values()).filter((perm) => perm.agentId === agentId),
      [pendingPermissions, agentId],
    );

    const showRunningTurnFooter = agent.status === "running";
    const pendingPermissionsNode = useMemo(
      () =>
        renderPendingPermissionsNode({
          pendingPermissions: pendingPermissionItems,
          client,
        }),
      [client, pendingPermissionItems],
    );
    const turnFooterNode = useMemo(
      () =>
        showRunningTurnFooter || bottomTurnFooterHost ? (
          <TurnFooter
            isRunning={showRunningTurnFooter}
            inFlightTurnStartedAt={baseRenderModel.turnTiming.runningStartedAt}
            host={bottomTurnFooterHost}
            strategy={streamRenderStrategy}
            billingUsage={bottomTurnFooterHost ? resolveBillingUsage(bottomTurnFooterHost) : null}
          />
        ) : null,
      [
        showRunningTurnFooter,
        baseRenderModel.turnTiming.runningStartedAt,
        bottomTurnFooterHost,
        resolveBillingUsage,
        streamRenderStrategy,
      ],
    );
    const renderModel = useMemo<AgentStreamRenderModel>(() => {
      return {
        ...baseRenderModel,
        boundary: baseRenderModel.boundary,
        auxiliary: {
          pendingPermissions: pendingPermissionsNode,
          turnFooter: turnFooterNode,
        },
      };
    }, [baseRenderModel, pendingPermissionsNode, turnFooterNode]);

    const emptyStateStyle = useMemo(() => [stylesheet.emptyState, stylesheet.contentWrapper], []);
    const listEmptyComponent = useMemo(
      () => renderListEmptyComponent({ renderModel, emptyStateStyle }),
      [renderModel, emptyStateStyle],
    );

    const { boundary, auxiliary } = renderModel;

    const layoutHistoryItemById = useMemo(() => {
      const itemById = new Map<string, StreamLayoutItem>();
      for (const item of streamLayout.history) {
        itemById.set(item.item.id, item);
      }
      return itemById;
    }, [streamLayout.history]);

    const layoutLiveHeadItemById = useMemo(() => {
      const itemById = new Map<string, StreamLayoutItem>();
      for (const item of streamLayout.liveHead) {
        itemById.set(item.item.id, item);
      }
      return itemById;
    }, [streamLayout.liveHead]);

    const renderHistoryRow = useCallback(
      (item: StreamItem) =>
        renderHistoryStreamItem({
          item,
          layoutItemById: layoutHistoryItemById,
          renderStreamItem,
        }),
      [layoutHistoryItemById, renderStreamItem],
    );

    const renderHistoryVirtualizedRow = useCallback<
      StreamSegmentRenderers["renderHistoryVirtualizedRow"]
    >((item) => renderHistoryRow(item), [renderHistoryRow]);
    const renderHistoryMountedRow = useCallback<StreamSegmentRenderers["renderHistoryMountedRow"]>(
      (item) => renderHistoryRow(item),
      [renderHistoryRow],
    );
    const renderLiveHeadRow = useCallback<StreamSegmentRenderers["renderLiveHeadRow"]>(
      (item) =>
        renderLiveHeadStreamItem({
          item,
          layoutItemById: layoutLiveHeadItemById,
          renderStreamItem,
        }),
      [layoutLiveHeadItemById, renderStreamItem],
    );
    const renderLiveAuxiliary = useCallback<StreamSegmentRenderers["renderLiveAuxiliary"]>(() => {
      return renderLiveAuxiliaryNode({
        pendingPermissions: auxiliary.pendingPermissions,
        turnFooter: auxiliary.turnFooter,
      });
    }, [auxiliary.pendingPermissions, auxiliary.turnFooter]);

    const renderers = useMemo<StreamSegmentRenderers>(
      () => ({
        renderHistoryVirtualizedRow,
        renderHistoryMountedRow,
        renderLiveHeadRow,
        renderLiveAuxiliary,
      }),
      [
        renderHistoryVirtualizedRow,
        renderHistoryMountedRow,
        renderLiveHeadRow,
        renderLiveAuxiliary,
      ],
    );

    const streamScrollEnabled =
      !streamRenderStrategy.shouldDisableParentScrollOnInlineDetailsExpansion() ||
      expandedInlineToolCallIds.size === 0;

    return (
      <ToolCallSheetProvider>
        <View style={stylesheet.container}>
          <MessageOuterSpacingProvider disableOuterSpacing>
            {streamRenderStrategy.render({
              agentId,
              segments: renderModel.segments,
              boundary,
              renderers,
              listEmptyComponent,
              viewportRef,
              routeBottomAnchorRequest,
              isAuthoritativeHistoryReady,
              onNearBottomChange: setIsNearBottom,
              onNearHistoryStart: loadOlder,
              isLoadingOlderHistory: isLoadingOlder,
              hasOlderHistory: hasOlder,
              scrollEnabled: streamScrollEnabled,
              listStyle: stylesheet.list,
              baseListContentContainerStyle: stylesheet.listContentContainer,
              forwardListContentContainerStyle: stylesheet.forwardListContentContainer,
            })}
          </MessageOuterSpacingProvider>
          {!isNearBottom && (
            <Animated.View
              style={stylesheet.scrollToBottomContainer}
              entering={scrollIndicatorFadeIn}
              exiting={scrollIndicatorFadeOut}
            >
              <View style={stylesheet.scrollToBottomInner}>
                <Pressable
                  style={stylesheet.scrollToBottomButton}
                  onPress={scrollToBottom}
                  accessibilityRole="button"
                  accessibilityLabel={translateNow("ui.scroll.to.bottom.1yk60vx")}
                  testID="scroll-to-bottom-button"
                >
                  <ChevronDown size={24} color={stylesheet.scrollToBottomIcon.color} />
                </Pressable>
              </View>
            </Animated.View>
          )}
        </View>
      </ToolCallSheetProvider>
    );
  },
);

function agentCapabilityFlagsEqual(
  left: AgentCapabilityFlags | undefined,
  right: AgentCapabilityFlags | undefined,
): boolean {
  return AGENT_CAPABILITY_FLAG_KEYS.every((key) => left?.[key] === right?.[key]);
}

function collectAgentScreenAgentDiffs(left: AgentScreenAgent, right: AgentScreenAgent): string[] {
  const reasons: string[] = [];
  if (left.serverId !== right.serverId) reasons.push("agent.serverId");
  if (left.id !== right.id) reasons.push("agent.id");
  if (left.status !== right.status) reasons.push("agent.status");
  if (left.cwd !== right.cwd) reasons.push("agent.cwd");
  if (!agentCapabilityFlagsEqual(left.capabilities, right.capabilities)) {
    reasons.push("agent.capabilities");
  }
  if (left.lastError !== right.lastError) reasons.push("agent.lastError");
  if (left.projectPlacement?.checkout?.cwd !== right.projectPlacement?.checkout?.cwd) {
    reasons.push("agent.projectPlacement.checkout.cwd");
  }
  if (left.projectPlacement?.checkout?.isGit !== right.projectPlacement?.checkout?.isGit) {
    reasons.push("agent.projectPlacement.checkout.isGit");
  }
  return reasons;
}

function bottomAnchorRouteRequestsEqual(
  left: BottomAnchorRouteRequest | null | undefined,
  right: BottomAnchorRouteRequest | null | undefined,
): boolean {
  return (
    left?.agentId === right?.agentId &&
    left?.reason === right?.reason &&
    left?.requestKey === right?.requestKey
  );
}

function agentStreamViewPropsEqual(
  left: AgentStreamViewProps,
  right: AgentStreamViewProps,
): boolean {
  const reasons: string[] = [];
  if (left.agentId !== right.agentId) reasons.push("agentId");
  if (left.serverId !== right.serverId) reasons.push("serverId");
  reasons.push(...collectAgentScreenAgentDiffs(left.agent, right.agent));
  if (left.streamItems !== right.streamItems) reasons.push("streamItems");
  if (left.streamHeadOverride !== right.streamHeadOverride) reasons.push("streamHeadOverride");
  if (left.pendingPermissions !== right.pendingPermissions) reasons.push("pendingPermissions");
  if (
    !bottomAnchorRouteRequestsEqual(left.routeBottomAnchorRequest, right.routeBottomAnchorRequest)
  ) {
    reasons.push("routeBottomAnchorRequest");
  }
  if (left.isAuthoritativeHistoryReady !== right.isAuthoritativeHistoryReady) {
    reasons.push("isAuthoritativeHistoryReady");
  }
  if (left.toast !== right.toast) reasons.push("toast");
  if (left.onOpenWorkspaceFile !== right.onOpenWorkspaceFile) reasons.push("onOpenWorkspaceFile");
  if (left.onOpenWorkspaceTab !== right.onOpenWorkspaceTab) reasons.push("onOpenWorkspaceTab");
  recordRenderProfileReasons(`AgentStreamView:${right.agentId}`, reasons);
  return reasons.length === 0;
}

export const AgentStreamView = memo(AgentStreamViewComponent, agentStreamViewPropsEqual);
AgentStreamView.displayName = "AgentStreamView";

interface ToolCallSlotProps extends Omit<
  ComponentProps<typeof ToolCall>,
  "onInlineDetailsExpandedChange"
> {
  itemId: string;
  onInlineDetailsExpandedChangeByItemId: (itemId: string, expanded: boolean) => void;
}

function ToolCallSlot({
  itemId,
  onInlineDetailsExpandedChangeByItemId,
  ...rest
}: ToolCallSlotProps) {
  const handleExpandedChange = useCallback(
    (expanded: boolean) => onInlineDetailsExpandedChangeByItemId(itemId, expanded),
    [onInlineDetailsExpandedChangeByItemId, itemId],
  );
  return <ToolCall {...rest} onInlineDetailsExpandedChange={handleExpandedChange} />;
}

function AiCreationPlaceholder({ title }: { title: string }) {
  const resolvedTitle = title.trim() || translateNow("ui.creating.image");
  const visual = getAiCreationFileVisual(resolveAiCreationPlaceholderFileName(resolvedTitle));
  const cardStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      stylesheet.aiCreationPlaceholder,
      { backgroundColor: visual.cardBackground, borderColor: visual.borderColor },
    ],
    [visual.borderColor, visual.cardBackground],
  );
  const iconWrapStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      stylesheet.aiCreationPlaceholderIconWrap,
      { backgroundColor: visual.background, borderColor: visual.borderColor },
    ],
    [visual.background, visual.borderColor],
  );
  const badgeStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      stylesheet.aiCreationPlaceholderBadge,
      { backgroundColor: visual.badgeBackground, borderColor: visual.borderColor },
    ],
    [visual.badgeBackground, visual.borderColor],
  );
  const badgeTextStyle = useMemo<StyleProp<TextStyle>>(
    () => [stylesheet.aiCreationPlaceholderBadgeText, { color: visual.accent }],
    [visual.accent],
  );
  return (
    <View style={cardStyle}>
      <AiCreationFileCardDecor visual={visual} />
      <View style={stylesheet.aiCreationPlaceholderHeader}>
        <View style={iconWrapStyle}>
          <SvgXml xml={visual.svg} width={26} height={26} />
        </View>
        <View style={stylesheet.aiCreationPlaceholderTitleGroup}>
          <View style={stylesheet.aiCreationPlaceholderTitleRow}>
            <Text style={stylesheet.aiCreationPlaceholderTitle} numberOfLines={1}>
              {resolvedTitle}
            </Text>
            <View style={badgeStyle}>
              <Text style={badgeTextStyle}>{visual.badge}</Text>
            </View>
          </View>
          <Text style={stylesheet.aiCreationPlaceholderSubtitle}>
            {translateNow("aiCreation.placeholder.subtitle")}
          </Text>
        </View>
      </View>
      <View style={stylesheet.aiCreationDotField}>
        {AI_CREATION_PLACEHOLDER_DOT_KEYS.map((dotKey, index) => (
          <AiCreationPlaceholderDot key={dotKey} index={index} />
        ))}
      </View>
    </View>
  );
}

function resolveAiCreationPlaceholderFileName(title: string): string {
  if (/(?:表格|预算|excel|xlsx|xls|csv|spreadsheet|sheet)/i.test(title)) {
    return "creation.xlsx";
  }
  if (/(?:ppt|pptx|演示|幻灯片|路演|slides?|presentation)/i.test(title)) {
    return "creation.pptx";
  }
  if (/(?:pdf|简报|报告)/i.test(title)) {
    return "creation.pdf";
  }
  if (/(?:docx|word|文档|prd|方案)/i.test(title)) {
    return "creation.docx";
  }
  if (/(?:图片|图像|海报|image|photo|poster)/i.test(title)) {
    return "creation.png";
  }
  return "creation.file";
}

function AiCreationPlaceholderDot({ index }: { index: number }) {
  const progress = useSharedValue(0);
  const column = index % AI_CREATION_PLACEHOLDER_DOT_COLUMNS;
  const row = Math.floor(index / AI_CREATION_PLACEHOLDER_DOT_COLUMNS);
  const top = `${8 + row * 7.6 + ((column * 11 + row * 5) % 9) * 0.18}%`;
  const left = `${2 + column * 2.72 + ((row * 13 + column * 3) % 7) * 0.12}%`;

  useEffect(() => {
    const phase =
      (column * 7 + row * 13 + ((column * row + index * 5) % 17)) %
      AI_CREATION_PLACEHOLDER_DOT_PHASES;
    progress.value = withDelay(
      phase * 58,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 520, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 880, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );
  }, [column, index, progress, row]);

  const angle = ((index * 137.5) % 360) * (Math.PI / 180);
  const driftX = Math.cos(angle) * 3;
  const driftY = Math.sin(angle) * 3;
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 0.28 + progress.value * 0.72,
    transform: [
      { translateX: driftX * progress.value },
      { translateY: driftY * progress.value },
      { scale: 0.86 + progress.value * 0.34 },
    ],
  }));
  const positionStyle = useMemo<StyleProp<ViewStyle>>(
    () => [stylesheet.aiCreationDot, { top: top as `${number}%`, left: left as `${number}%` }],
    [left, top],
  );
  const dotStyle = useMemo(() => [positionStyle, animatedStyle], [animatedStyle, positionStyle]);

  return <Animated.View style={dotStyle} />;
}

interface AiCreationFileVisual {
  svg: string;
  badge: string;
  accent: string;
  accentMuted: string;
  foreground: string;
  background: string;
  backgroundStrong: string;
  borderColor: string;
  cardBackground: string;
  washColor: string;
  badgeBackground: string;
  decor: "image" | "slides" | "pdf" | "word" | "sheet" | "generic";
}

function getAiCreationFileVisual(fileName: string): AiCreationFileVisual {
  const extension = fileName.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase();
  if (extension === "pdf") {
    return {
      svg: PDF_FILE_ICON_SVG,
      badge: "PDF",
      accent: "#c2413a",
      accentMuted: "rgba(194, 65, 58, 0.58)",
      foreground: "#8b221d",
      background: "rgba(194, 65, 58, 0.11)",
      backgroundStrong: "rgba(194, 65, 58, 0.2)",
      borderColor: "rgba(194, 65, 58, 0.18)",
      cardBackground: "#fffdfd",
      washColor: "rgba(224, 82, 75, 0.08)",
      badgeBackground: "rgba(194, 65, 58, 0.11)",
      decor: "pdf",
    };
  }
  if (extension === "docx" || extension === "doc") {
    return {
      svg: WORD_FILE_ICON_SVG,
      badge: extension === "doc" ? "DOC" : "DOCX",
      accent: "#2f63c7",
      accentMuted: "rgba(47, 99, 199, 0.58)",
      foreground: "#1e438c",
      background: "rgba(47, 99, 199, 0.11)",
      backgroundStrong: "rgba(47, 99, 199, 0.2)",
      borderColor: "rgba(47, 99, 199, 0.17)",
      cardBackground: "#fbfdff",
      washColor: "rgba(77, 126, 232, 0.08)",
      badgeBackground: "rgba(47, 99, 199, 0.11)",
      decor: "word",
    };
  }
  if (extension === "xlsx" || extension === "xls" || extension === "csv") {
    return {
      svg: SPREADSHEET_FILE_ICON_SVG,
      badge: extension === "csv" ? "CSV" : "XLSX",
      accent: "#137a4b",
      accentMuted: "rgba(19, 122, 75, 0.58)",
      foreground: "#0f5f3d",
      background: "rgba(19, 122, 75, 0.11)",
      backgroundStrong: "rgba(19, 122, 75, 0.2)",
      borderColor: "rgba(19, 122, 75, 0.18)",
      cardBackground: "#fbfdfc",
      washColor: "rgba(31, 157, 99, 0.08)",
      badgeBackground: "rgba(19, 122, 75, 0.11)",
      decor: "sheet",
    };
  }
  if (extension === "pptx" || extension === "ppt") {
    return {
      svg: PRESENTATION_FILE_ICON_SVG,
      badge: extension === "ppt" ? "PPT" : "PPTX",
      accent: "#b35a18",
      accentMuted: "rgba(179, 90, 24, 0.58)",
      foreground: "#85410f",
      background: "rgba(179, 90, 24, 0.12)",
      backgroundStrong: "rgba(179, 90, 24, 0.22)",
      borderColor: "rgba(179, 90, 24, 0.18)",
      cardBackground: "#fffdf9",
      washColor: "rgba(230, 126, 34, 0.08)",
      badgeBackground: "rgba(179, 90, 24, 0.12)",
      decor: "slides",
    };
  }
  if (["png", "jpg", "jpeg", "webp", "gif", "avif", "svg"].includes(extension ?? "")) {
    return {
      svg: IMAGE_FILE_ICON_SVG,
      badge: "IMG",
      accent: "#9b4fb8",
      accentMuted: "rgba(155, 79, 184, 0.56)",
      foreground: "#713487",
      background: "rgba(155, 79, 184, 0.11)",
      backgroundStrong: "rgba(155, 79, 184, 0.2)",
      borderColor: "rgba(155, 79, 184, 0.17)",
      cardBackground: "#fffaff",
      washColor: "rgba(184, 98, 214, 0.08)",
      badgeBackground: "rgba(155, 79, 184, 0.11)",
      decor: "image",
    };
  }
  return {
    svg: DEFAULT_AI_CREATION_FILE_ICON_SVG,
    badge: "FILE",
    accent: "#64748b",
    accentMuted: "rgba(100, 116, 139, 0.56)",
    foreground: "#475569",
    background: "rgba(100, 116, 139, 0.1)",
    backgroundStrong: "rgba(100, 116, 139, 0.18)",
    borderColor: "rgba(100, 116, 139, 0.16)",
    cardBackground: "#f8fafc",
    washColor: "rgba(100, 116, 139, 0.08)",
    badgeBackground: "rgba(100, 116, 139, 0.1)",
    decor: "generic",
  };
}

function AiCreationFileCardDecor({ visual }: { visual: AiCreationFileVisual }) {
  const washStyle = useMemo<StyleProp<ViewStyle>>(
    () => [stylesheet.aiCreationFileCardWash, { backgroundColor: visual.washColor }],
    [visual.washColor],
  );
  const panelStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      stylesheet.aiCreationFileCardPanel,
      { backgroundColor: visual.background, borderColor: visual.borderColor },
    ],
    [visual.background, visual.borderColor],
  );
  const lineStyle = useMemo<StyleProp<ViewStyle>>(
    () => [stylesheet.aiCreationFileCardLine, { backgroundColor: visual.accent }],
    [visual.accent],
  );
  const mutedLineStyle = useMemo<StyleProp<ViewStyle>>(
    () => [stylesheet.aiCreationFileCardMutedLine, { backgroundColor: visual.background }],
    [visual.background],
  );
  const strongLineStyle = useMemo<StyleProp<ViewStyle>>(
    () => [stylesheet.aiCreationFileCardStrongLine, { backgroundColor: visual.backgroundStrong }],
    [visual.backgroundStrong],
  );
  const dotStyle = useMemo<StyleProp<ViewStyle>>(
    () => [stylesheet.aiCreationFileCardDot, { backgroundColor: visual.accent }],
    [visual.accent],
  );
  const miniBorderStyle = useMemo<StyleProp<ViewStyle>>(
    () => [stylesheet.aiCreationFileMiniSurface, { borderColor: visual.borderColor }],
    [visual.borderColor],
  );
  const accentFillStyle = useMemo<StyleProp<ViewStyle>>(
    () => ({ backgroundColor: visual.accent }),
    [visual.accent],
  );
  const mutedFillStyle = useMemo<StyleProp<ViewStyle>>(
    () => ({ backgroundColor: visual.background }),
    [visual.background],
  );
  const mutedAccentFillStyle = useMemo<StyleProp<ViewStyle>>(
    () => ({ backgroundColor: visual.accentMuted }),
    [visual.accentMuted],
  );
  const sheetHeaderStyle = useMemo<StyleProp<ViewStyle>>(
    () => [stylesheet.aiCreationFileMiniSheetHeader, accentFillStyle],
    [accentFillStyle],
  );
  const sheetFormulaStyle = useMemo<StyleProp<ViewStyle>>(
    () => [stylesheet.aiCreationFileMiniSheetFormula, { backgroundColor: visual.foreground }],
    [visual.foreground],
  );
  const documentSurfaceStyle = useMemo<StyleProp<ViewStyle>>(
    () => [miniBorderStyle, stylesheet.aiCreationFileMiniDocumentSurface],
    [miniBorderStyle],
  );
  const sheetCellStyles = useMemo(
    () =>
      AI_CREATION_FILE_MINI_CELLS.map((cell) => [
        stylesheet.aiCreationFileMiniSheetCell,
        cell % 4 === 0 ? mutedAccentFillStyle : mutedFillStyle,
      ]),
    [mutedAccentFillStyle, mutedFillStyle],
  );
  const chartBarStyles = useMemo(
    () =>
      AI_CREATION_FILE_MINI_BARS.map((height) => [
        stylesheet.aiCreationFileMiniChartBar,
        { height, backgroundColor: visual.background },
      ]),
    [visual.background],
  );
  const imageSurfaceStyle = useMemo<StyleProp<ViewStyle>>(
    () => [miniBorderStyle, stylesheet.aiCreationFileMiniImage],
    [miniBorderStyle],
  );
  const imageSunStyle = useMemo<StyleProp<ViewStyle>>(
    () => [stylesheet.aiCreationFileMiniImageSun, accentFillStyle],
    [accentFillStyle],
  );
  const imageHillStyle = useMemo<StyleProp<ViewStyle>>(
    () => [stylesheet.aiCreationFileMiniImageHill, mutedFillStyle],
    [mutedFillStyle],
  );
  const imageFrameStyle = useMemo<StyleProp<ViewStyle>>(
    () => [stylesheet.aiCreationFileMiniImageFrame, { borderColor: visual.backgroundStrong }],
    [visual.backgroundStrong],
  );
  const imageDecorSurfaceStyle = useMemo<StyleProp<ViewStyle>>(
    () => [imageSurfaceStyle, imageFrameStyle],
    [imageFrameStyle, imageSurfaceStyle],
  );
  const pdfRibbonStyle = useMemo<StyleProp<ViewStyle>>(
    () => [stylesheet.aiCreationFileMiniPdfRibbon, { backgroundColor: visual.accent }],
    [visual.accent],
  );
  const wordMarginStyle = useMemo<StyleProp<ViewStyle>>(
    () => [stylesheet.aiCreationFileMiniWordMargin, { backgroundColor: visual.backgroundStrong }],
    [visual.backgroundStrong],
  );
  const pdfLineStyles = useMemo(
    () =>
      AI_CREATION_FILE_PDF_LINES.map((line) => [
        mutedLineStyle,
        line === 1 && stylesheet.aiCreationFileCardShortLine,
      ]),
    [mutedLineStyle],
  );
  const wordLineStyles = useMemo(
    () =>
      AI_CREATION_FILE_WORD_LINES.map((line) => [
        mutedLineStyle,
        line === 2 && stylesheet.aiCreationFileCardShortLine,
      ]),
    [mutedLineStyle],
  );

  return (
    <View pointerEvents="none" style={stylesheet.aiCreationFileCardDecor}>
      <View style={washStyle} />
      <View style={panelStyle}>
        {visual.decor === "sheet" ? (
          <View style={documentSurfaceStyle}>
            <View style={sheetHeaderStyle} />
            <View style={sheetFormulaStyle} />
            <View style={stylesheet.aiCreationFileMiniSheetGrid}>
              {AI_CREATION_FILE_MINI_CELLS.map((cell) => (
                <View key={cell} style={sheetCellStyles[cell]} />
              ))}
            </View>
          </View>
        ) : null}
        {visual.decor === "slides" ? (
          <>
            <View style={lineStyle} />
            <View style={strongLineStyle} />
            <View style={stylesheet.aiCreationFileMiniChartRow}>
              {AI_CREATION_FILE_MINI_BARS.map((height) => (
                <View
                  key={height}
                  style={chartBarStyles[AI_CREATION_FILE_MINI_BARS.indexOf(height)]}
                />
              ))}
            </View>
          </>
        ) : null}
        {visual.decor === "image" ? (
          <View style={imageDecorSurfaceStyle}>
            <View style={imageSunStyle} />
            <View style={imageHillStyle} />
          </View>
        ) : null}
        {visual.decor === "pdf" ? (
          <View style={documentSurfaceStyle}>
            <View style={pdfRibbonStyle} />
            <View style={lineStyle} />
            {AI_CREATION_FILE_PDF_LINES.map((line) => (
              <View key={line} style={pdfLineStyles[line]} />
            ))}
          </View>
        ) : null}
        {visual.decor === "word" ? (
          <View style={documentSurfaceStyle}>
            <View style={wordMarginStyle} />
            <View style={lineStyle} />
            {AI_CREATION_FILE_WORD_LINES.map((line) => (
              <View key={line} style={wordLineStyles[line]} />
            ))}
          </View>
        ) : null}
        {visual.decor === "generic" ? (
          <>
            <View style={lineStyle} />
            <View style={mutedLineStyle} />
            <View style={stylesheet.aiCreationFileCardDotRow}>
              <View style={dotStyle} />
              <View style={dotStyle} />
              <View style={dotStyle} />
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
}

function AiCreationFileResultCard({
  onDownload,
  onOpen,
  path,
  summary,
  title,
}: {
  onDownload: (path: string) => void;
  onOpen: (path: string) => void;
  path: string;
  summary?: string;
  title?: string;
}) {
  const fileName = path.split(/[\\/]/).pop() || "document";
  const displayTitle = title?.trim() || fileName;
  const displaySummary = summary?.trim() || path;
  const visual = getAiCreationFileVisual(fileName);
  const cardVisualStyle = useMemo<StyleProp<ViewStyle>>(
    () => [{ backgroundColor: visual.cardBackground, borderColor: visual.borderColor }],
    [visual.borderColor, visual.cardBackground],
  );
  const iconWrapStyle = useMemo(
    () => [
      stylesheet.aiCreationSlidesIconWrap,
      { backgroundColor: visual.background, borderColor: visual.borderColor },
    ],
    [visual.background, visual.borderColor],
  );
  const typeBadgeStyle = useMemo(
    () => [
      stylesheet.aiCreationSlidesTypeBadge,
      { backgroundColor: visual.badgeBackground, borderColor: visual.borderColor },
    ],
    [visual.badgeBackground, visual.borderColor],
  );
  const typeBadgeTextStyle = useMemo(
    () => [stylesheet.aiCreationSlidesTypeBadgeText, { color: visual.accent }],
    [visual.accent],
  );
  const openIconColor = visual.foreground;
  const getCardStyle = useCallback(
    (state: PressableStateCallbackType) => aiCreationSlidesCardStyle(state, cardVisualStyle),
    [cardVisualStyle],
  );
  const getPrimaryButtonStyle = useCallback(
    (state: PressableStateCallbackType) => [
      ...aiCreationSlidesPrimaryButtonStyle(state),
      { borderColor: state.hovered ? visual.backgroundStrong : visual.borderColor },
    ],
    [visual.backgroundStrong, visual.borderColor],
  );
  const handlePress = useCallback(() => {
    onOpen(path);
  }, [onOpen, path]);
  const handleOpenPress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      handlePress();
    },
    [handlePress],
  );
  const handleDownloadPress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onDownload(path);
    },
    [onDownload, path],
  );

  return (
    <Pressable accessibilityRole="button" onPress={handlePress} style={getCardStyle}>
      <AiCreationFileCardDecor visual={visual} />
      <View style={iconWrapStyle}>
        <SvgXml xml={visual.svg} width={24} height={24} />
      </View>
      <View style={stylesheet.aiCreationSlidesBody}>
        <View style={stylesheet.aiCreationSlidesMetaRow}>
          <Text style={stylesheet.aiCreationSlidesFileName} numberOfLines={1}>
            {displayTitle}
          </Text>
          <View style={typeBadgeStyle}>
            <Text style={typeBadgeTextStyle}>{visual.badge}</Text>
          </View>
        </View>
        <Text style={stylesheet.aiCreationSlidesPath} numberOfLines={1}>
          {displaySummary}
        </Text>
        {displaySummary !== path ? (
          <Text style={stylesheet.aiCreationSlidesPath} numberOfLines={1}>
            {path}
          </Text>
        ) : null}
      </View>
      <View style={stylesheet.aiCreationSlidesActions}>
        <Pressable
          accessibilityRole="button"
          onPress={handleOpenPress}
          style={getPrimaryButtonStyle}
          accessibilityLabel={translateNow("aiCreation.action.openFilePreview")}
        >
          <Eye size={16} color={openIconColor} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={handleDownloadPress}
          style={aiCreationSlidesPreviewButtonStyle}
          accessibilityLabel={translateNow("ui.download.ooknmw")}
        >
          <Download size={16} color={visual.foreground} />
        </Pressable>
      </View>
    </Pressable>
  );
}

function aiCreationSlidesCardStyle(
  { hovered, pressed }: PressableStateCallbackType,
  visualStyle?: StyleProp<ViewStyle>,
) {
  return [
    stylesheet.aiCreationSlidesCard,
    visualStyle,
    hovered && stylesheet.aiCreationSlidesCardHovered,
    pressed && stylesheet.aiCreationSlidesCardPressed,
  ];
}

function aiCreationSlidesPreviewButtonStyle({ hovered, pressed }: PressableStateCallbackType) {
  return [
    stylesheet.aiCreationSlidesSecondaryButton,
    hovered && stylesheet.aiCreationSlidesSecondaryButtonHovered,
    pressed && stylesheet.aiCreationSlidesButtonPressed,
  ];
}

function aiCreationSlidesPrimaryButtonStyle({ hovered, pressed }: PressableStateCallbackType) {
  return [
    stylesheet.aiCreationSlidesPrimaryButton,
    hovered && stylesheet.aiCreationSlidesPrimaryButtonHovered,
    pressed && stylesheet.aiCreationSlidesButtonPressed,
  ];
}

function AiCreationSlidesResultCard({
  canOpenPreview,
  onDownload,
  onOpenPreview,
  path,
}: {
  canOpenPreview: boolean;
  onDownload: (path: string) => void;
  onOpenPreview: (projectName: string) => void;
  path: string;
}) {
  const fileLinkActions = useAssistantFileLinkActions();
  const fileName = path.split(/[\\/]/).pop() || "presentation.pptx";
  const visual = getAiCreationFileVisual(fileName);
  const cardVisualStyle = useMemo<StyleProp<ViewStyle>>(
    () => [{ backgroundColor: visual.cardBackground, borderColor: visual.borderColor }],
    [visual.borderColor, visual.cardBackground],
  );
  const iconWrapStyle = useMemo(
    () => [
      stylesheet.aiCreationSlidesIconWrap,
      { backgroundColor: visual.background, borderColor: visual.borderColor },
    ],
    [visual.background, visual.borderColor],
  );
  const typeBadgeStyle = useMemo(
    () => [
      stylesheet.aiCreationSlidesTypeBadge,
      { backgroundColor: visual.badgeBackground, borderColor: visual.borderColor },
    ],
    [visual.badgeBackground, visual.borderColor],
  );
  const typeBadgeTextStyle = useMemo(
    () => [stylesheet.aiCreationSlidesTypeBadgeText, { color: visual.accent }],
    [visual.accent],
  );
  const getPrimaryButtonStyle = useCallback(
    (state: PressableStateCallbackType) => [
      ...aiCreationSlidesPrimaryButtonStyle(state),
      { borderColor: state.hovered ? visual.backgroundStrong : visual.borderColor },
    ],
    [visual.backgroundStrong, visual.borderColor],
  );
  const getCardStyle = useCallback(
    (state: PressableStateCallbackType) => aiCreationSlidesCardStyle(state, cardVisualStyle),
    [cardVisualStyle],
  );
  const projectName = extractPptProjectName(path);
  const canPreview = canOpenPreview && Boolean(projectName);
  const handlePress = useCallback(() => {
    fileLinkActions.open({ href: path, text: path }, "main");
  }, [fileLinkActions, path]);
  const handleDownloadPress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onDownload(path);
    },
    [onDownload, path],
  );
  const handlePreviewPress = useCallback(() => {
    if (!projectName) return;
    onOpenPreview(projectName);
  }, [onOpenPreview, projectName]);
  const handlePreviewButtonPress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      handlePreviewPress();
    },
    [handlePreviewPress],
  );

  return (
    <Pressable accessibilityRole="button" onPress={handlePress} style={getCardStyle}>
      <AiCreationFileCardDecor visual={visual} />
      <View style={iconWrapStyle}>
        <SvgXml xml={visual.svg} width={24} height={24} />
      </View>
      <View style={stylesheet.aiCreationSlidesBody}>
        <View style={stylesheet.aiCreationSlidesMetaRow}>
          <Text style={stylesheet.aiCreationSlidesFileName} numberOfLines={1}>
            {fileName}
          </Text>
          <View style={typeBadgeStyle}>
            <Text style={typeBadgeTextStyle}>{visual.badge}</Text>
          </View>
        </View>
        <Text style={stylesheet.aiCreationSlidesPath} numberOfLines={1}>
          {path}
        </Text>
      </View>
      <View style={stylesheet.aiCreationSlidesActions}>
        {canPreview ? (
          <Pressable
            accessibilityRole="button"
            onPress={handlePreviewButtonPress}
            style={getPrimaryButtonStyle}
            accessibilityLabel={translateNow("aiCreation.action.openSlidesPreview")}
          >
            <Eye size={16} color={visual.foreground} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={handleDownloadPress}
          style={aiCreationSlidesPreviewButtonStyle}
          accessibilityLabel={translateNow("ui.download.ooknmw")}
        >
          <Download size={16} color={visual.foreground} />
        </Pressable>
      </View>
    </Pressable>
  );
}

function AiCreationLiveArtifactProgressGroup({
  activeConnection,
  agentId,
  allowConfirmSideEffects,
  canOpenPreview,
  client,
  items,
  onInlineConfirm,
  onOpenPreview,
  serverId,
  toast,
}: {
  activeConnection: { type: string; endpoint: string } | null;
  agentId: string;
  allowConfirmSideEffects: boolean;
  canOpenPreview: boolean;
  client: DaemonClient | null;
  items: Extract<StreamItem, { kind: "assistant_message" }>[];
  onInlineConfirm?: () => void;
  onOpenPreview: (projectName: string) => void;
  serverId: string;
  toast: ToastApi;
}) {
  const confirmCandidates = allowConfirmSideEffects
    ? items
    : items.filter((item) => extractAiCreationPptConfirmInlineData(item.text));
  const confirmPath = confirmCandidates
    .map((item) => extractAiCreationPptConfirmPath(item.text))
    .find(Boolean);
  const confirmData = confirmCandidates
    .map((item) => extractAiCreationPptConfirmInlineData(item.text))
    .find(Boolean);
  const previewPath = items.map((item) => extractAiCreationPptPreviewPath(item.text)).find(Boolean);
  const progressRows = items
    .flatMap((item) =>
      parseDoyaMessageCards(item.text).map((card, index) => ({
        id: `${item.id}:${index}`,
        card,
        rawMessage: item.text,
      })),
    )
    .filter((row) => isLiveArtifactProgressCard(row.card))
    .filter((row) => !isPreviewDiscoveryCard(row.card));

  return (
    <View style={stylesheet.liveArtifactProgressGroup}>
      {confirmPath ? (
        <View style={stylesheet.liveArtifactProgressPreviewSlot}>
          <AiCreationSlidesConfirmCard
            activeConnection={activeConnection}
            agentId={agentId}
            allowSideEffects={allowConfirmSideEffects}
            canOpenConfirm={canOpenPreview}
            client={client}
            inlineData={confirmData}
            onInlineConfirm={onInlineConfirm}
            path={confirmPath}
            serverId={serverId}
            toast={toast}
          />
        </View>
      ) : null}
      {previewPath && !confirmPath ? (
        <View style={stylesheet.liveArtifactProgressPreviewSlot}>
          <AiCreationSlidesPreviewCard
            canOpenPreview={canOpenPreview}
            path={previewPath}
            onOpenPreview={onOpenPreview}
          />
        </View>
      ) : null}
      {progressRows.length > 0 ? (
        <View style={stylesheet.liveArtifactProgressList}>
          {progressRows.map((row, index) => (
            <AiCreationLiveArtifactProgressRow
              key={row.id}
              card={row.card}
              rawMessage={row.rawMessage}
              withDivider={index < progressRows.length - 1}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function AiCreationLiveArtifactProgressRow({
  card,
  rawMessage,
  withDivider,
}: {
  card: DoyaMessageCard;
  rawMessage: string;
  withDivider: boolean;
}) {
  const rowStyle = useMemo(
    () =>
      withDivider
        ? [stylesheet.liveArtifactProgressRow, stylesheet.liveArtifactProgressRowWithDivider]
        : stylesheet.liveArtifactProgressRow,
    [withDivider],
  );

  return (
    <View style={rowStyle}>
      <View style={stylesheet.liveArtifactProgressCheck}>
        <Check size={14} color="#b35a18" strokeWidth={2.4} />
      </View>
      <View style={stylesheet.liveArtifactProgressBody}>
        <Text style={stylesheet.liveArtifactProgressTitle} numberOfLines={1}>
          {card.title}
        </Text>
        <Text style={stylesheet.liveArtifactProgressSummary}>{card.summary}</Text>
        <DoyaRawResponseButton rawMessage={rawMessage} />
      </View>
    </View>
  );
}

function AiCreationSlidesPreviewCard({
  canOpenPreview,
  onOpenPreview,
  path,
}: {
  canOpenPreview: boolean;
  onOpenPreview: (projectName: string) => void;
  path: string;
}) {
  const projectName = extractPptPreviewProjectName(path);
  const canPreview = canOpenPreview && Boolean(projectName);
  const visual = getAiCreationFileVisual("preview.pptx");
  const cardVisualStyle = useMemo<StyleProp<ViewStyle>>(
    () => [{ backgroundColor: visual.cardBackground, borderColor: visual.borderColor }],
    [visual.borderColor, visual.cardBackground],
  );
  const iconWrapStyle = useMemo(
    () => [
      stylesheet.aiCreationSlidesIconWrap,
      { backgroundColor: visual.background, borderColor: visual.borderColor },
    ],
    [visual.background, visual.borderColor],
  );
  const typeBadgeStyle = useMemo(
    () => [
      stylesheet.aiCreationSlidesTypeBadge,
      { backgroundColor: visual.badgeBackground, borderColor: visual.borderColor },
    ],
    [visual.badgeBackground, visual.borderColor],
  );
  const typeBadgeTextStyle = useMemo(
    () => [stylesheet.aiCreationSlidesTypeBadgeText, { color: visual.accent }],
    [visual.accent],
  );
  const getCardStyle = useCallback(
    () => [stylesheet.aiCreationSlidesCard, cardVisualStyle],
    [cardVisualStyle],
  );
  const getPrimaryButtonStyle = useCallback(
    (state: PressableStateCallbackType) => [
      ...aiCreationSlidesPrimaryButtonStyle(state),
      { backgroundColor: state.hovered ? visual.backgroundStrong : visual.background },
    ],
    [visual.background, visual.backgroundStrong],
  );
  const handlePreviewPress = useCallback(() => {
    if (!projectName) return;
    onOpenPreview(projectName);
  }, [onOpenPreview, projectName]);

  return (
    <Pressable
      accessibilityRole="button"
      disabled={!canPreview}
      onPress={handlePreviewPress}
      style={getCardStyle}
    >
      <AiCreationFileCardDecor visual={visual} />
      <View style={iconWrapStyle}>
        <SvgXml xml={visual.svg} width={24} height={24} />
      </View>
      <View style={stylesheet.aiCreationSlidesBody}>
        <View style={stylesheet.aiCreationSlidesMetaRow}>
          <Text style={stylesheet.aiCreationSlidesFileName} numberOfLines={1}>
            {translateNow("aiCreation.result.slidesPreviewReady")}
          </Text>
          <View style={typeBadgeStyle}>
            <Text style={typeBadgeTextStyle}>PREVIEW</Text>
          </View>
        </View>
        <Text style={stylesheet.aiCreationSlidesPath} numberOfLines={1}>
          {path}
        </Text>
      </View>
      {canPreview ? (
        <View style={stylesheet.aiCreationSlidesActions}>
          <Pressable
            accessibilityRole="button"
            onPress={handlePreviewPress}
            style={getPrimaryButtonStyle}
            accessibilityLabel={translateNow("aiCreation.action.openSlidesPreview")}
          >
            <Eye size={16} color={visual.foreground} />
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}

interface PptConfirmRecommendations {
  _already_confirmed?: unknown;
  _confirmed_at?: unknown;
}

interface InlinePptConfirmData {
  recommendations: PptConfirmRecommendations & Record<string, unknown>;
}

function extractAiCreationPptConfirmInlineData(text: string): InlinePptConfirmData | null {
  const value = parseDoyaMessageCards(text)
    .flatMap((card) => card.fields)
    .find((field) => field.name === "confirm_data_json")?.value;
  const rawFieldValue =
    /<doya-field\b[^>]*\bname=(?:"|')confirm_data_json(?:"|')[^>]*>([\s\S]*?)(?:<\/doya-field>|<\/|$)/u.exec(
      text,
    )?.[1] ?? null;
  return parsePptConfirmInlineDataValue(value ?? rawFieldValue);
}

function parsePptConfirmInlineDataValue(
  value: string | null | undefined,
): InlinePptConfirmData | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return { recommendations: parsed as PptConfirmRecommendations & Record<string, unknown> };
  } catch {
    return null;
  }
}

function AiCreationSlidesConfirmCard({
  activeConnection,
  agentId,
  allowSideEffects,
  canOpenConfirm,
  client,
  inlineData,
  onInlineConfirm,
  path,
  serverId,
  toast,
}: {
  activeConnection: { type: string; endpoint: string } | null;
  agentId: string;
  allowSideEffects: boolean;
  canOpenConfirm: boolean;
  client: DaemonClient | null;
  inlineData?: InlinePptConfirmData | null;
  onInlineConfirm?: () => void;
  path: string;
  serverId: string;
  toast: ToastApi;
}) {
  const { locale } = useI18n();
  const projectName = extractPptConfirmProjectName(path);
  const confirmBaseUrl = useMemo(() => {
    if (!projectName) {
      return null;
    }
    return buildWorkspacePptConfirmUrl({ activeConnection, agentId, projectName });
  }, [activeConnection, agentId, projectName]);
  const confirmUrl = useMemo(() => {
    if (!confirmBaseUrl) {
      return null;
    }
    const lang = locale === "zh" ? "zh" : "en";
    return `${confirmBaseUrl}?embed=1&lang=${lang}`;
  }, [confirmBaseUrl, locale]);
  const [inlineConfirmUrl, setInlineConfirmUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!inlineData) {
      setInlineConfirmUrl(null);
      return;
    }
    let isCurrent = true;
    setInlineConfirmUrl(null);
    void buildInlinePptConfirmDataUrl({
      locale,
      recommendations: inlineData.recommendations,
    })
      .then((url) => {
        if (isCurrent) {
          setInlineConfirmUrl(url);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setInlineConfirmUrl(null);
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [inlineData, locale]);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "confirmed">("loading");
  const sawUnconfirmedStateRef = useRef(false);
  const visual = getAiCreationFileVisual("preview.pptx");
  const cardStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      stylesheet.aiCreationSlidesCard,
      { backgroundColor: visual.cardBackground, borderColor: visual.borderColor },
      stylesheet.aiCreationConfirmFrameCard,
    ],
    [visual.borderColor, visual.cardBackground],
  );
  const iconWrapStyle = useMemo(
    () => [
      stylesheet.aiCreationSlidesIconWrap,
      { backgroundColor: visual.background, borderColor: visual.borderColor },
    ],
    [visual.background, visual.borderColor],
  );
  const typeBadgeStyle = useMemo(
    () => [
      stylesheet.aiCreationSlidesTypeBadge,
      { backgroundColor: visual.badgeBackground, borderColor: visual.borderColor },
    ],
    [visual.badgeBackground, visual.borderColor],
  );
  const typeBadgeTextStyle = useMemo(
    () => [stylesheet.aiCreationSlidesTypeBadgeText, { color: visual.accent }],
    [visual.accent],
  );
  let confirmBody: ReactNode;
  if (inlineConfirmUrl) {
    confirmBody = (
      <View style={stylesheet.aiCreationConfirmFrameWrap}>
        <PptPreviewFrame
          applyAnnotationsCompletionToken={0}
          onConfirm={onInlineConfirm}
          onApplyAnnotations={noopConfirmFrameAction}
          title={translateNow("ui.slides.confirm.title", { name: projectName ?? "" })}
          url={inlineConfirmUrl}
        />
      </View>
    );
  } else if (confirmUrl && status !== "error") {
    confirmBody = (
      <View style={stylesheet.aiCreationConfirmFrameWrap}>
        <PptPreviewFrame
          applyAnnotationsCompletionToken={0}
          onApplyAnnotations={noopConfirmFrameAction}
          title={translateNow("ui.slides.confirm.title", { name: projectName ?? "" })}
          url={confirmUrl}
        />
      </View>
    );
  } else {
    confirmBody = (
      <Text style={stylesheet.aiCreationConfirmHint}>
        {translateNow("ui.slides.confirm.loadFailed")}
      </Text>
    );
  }

  const notifyAgentConfirmed = useCallback(async (): Promise<void> => {
    if (!allowSideEffects) {
      return;
    }
    if (!projectName || !client) {
      return;
    }
    const confirmationKey = `${serverId}:${agentId}:${projectName}`;
    if (notifiedPptConfirmations.has(confirmationKey)) {
      return;
    }
    notifiedPptConfirmations.add(confirmationKey);
    const messageId = generateMessageId();
    const prompt = buildPptConfirmContinueMessage({
      defaultLocale: locale,
      messageId,
      projectName,
      projectPath: `projects/${projectName}`,
    });
    useSessionStore.getState().appendOptimisticUserMessageToAgentStream(
      serverId,
      agentId,
      buildOptimisticUserMessage({
        id: messageId,
        text: prompt,
        timestamp: new Date(),
      }),
      { placement: "active-head", skipIfUserMessageExists: true },
    );

    try {
      await client.sendAgentMessage(agentId, prompt, { messageId });
      toast.show(translateNow("ui.slides.confirm.continue.sent"), { variant: "success" });
    } catch (error) {
      notifiedPptConfirmations.delete(confirmationKey);
      toast.error(
        error instanceof Error ? error.message : translateNow("ui.slides.confirm.continue.failed"),
      );
    }
  }, [agentId, allowSideEffects, client, locale, projectName, serverId, toast]);

  useEffect(() => {
    if (inlineData) {
      setStatus(inlineData.recommendations._already_confirmed === true ? "confirmed" : "ready");
      return;
    }
    if (!confirmBaseUrl || !canOpenConfirm) {
      setStatus("error");
      return;
    }
    let canceled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const recommendationsUrl = `${confirmBaseUrl.replace(/\/$/, "")}/api/recommendations`;

    async function pollConfirmation(): Promise<void> {
      try {
        const response = await fetch(recommendationsUrl, { cache: "no-store" });
        if (!response.ok) {
          throw new Error("recommendations not found");
        }
        const data = (await response.json()) as PptConfirmRecommendations;
        if (canceled) {
          return;
        }
        if (data._already_confirmed === true) {
          setStatus("confirmed");
          if (sawUnconfirmedStateRef.current) {
            await notifyAgentConfirmed();
          }
        } else {
          sawUnconfirmedStateRef.current = true;
          setStatus("ready");
        }
      } catch {
        if (!canceled) {
          setStatus("error");
        }
      }
      if (!canceled) {
        timeout = setTimeout(() => {
          void pollConfirmation();
        }, 1000);
      }
    }

    void pollConfirmation();
    return () => {
      canceled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [canOpenConfirm, confirmBaseUrl, inlineData, notifyAgentConfirmed]);

  return (
    <View style={cardStyle}>
      <AiCreationFileCardDecor visual={visual} />
      <View style={stylesheet.aiCreationConfirmHeader}>
        <View style={iconWrapStyle}>
          <SlidersHorizontal size={24} color={visual.foreground} />
        </View>
        <View style={stylesheet.aiCreationConfirmHeaderBody}>
          <View style={stylesheet.aiCreationSlidesMetaRow}>
            <Text style={stylesheet.aiCreationSlidesFileName} numberOfLines={1}>
              {translateNow("ui.slides.confirm")}
            </Text>
            <View style={typeBadgeStyle}>
              <Text style={typeBadgeTextStyle}>CONFIRM</Text>
            </View>
          </View>
          <Text style={stylesheet.aiCreationSlidesPath} numberOfLines={1}>
            {path}
          </Text>
        </View>
        {status === "loading" ? <ThemedActivityIndicator size="small" /> : null}
        {status === "confirmed" ? (
          <View style={stylesheet.aiCreationConfirmStatusPill}>
            <Text style={stylesheet.aiCreationConfirmStatusPillText}>
              {translateNow("ui.slides.confirm.confirmed")}
            </Text>
          </View>
        ) : null}
      </View>
      {confirmBody}
    </View>
  );
}

function buildInlinePptConfirmDataUrl(input: {
  locale: Locale;
  recommendations: PptConfirmRecommendations & Record<string, unknown>;
}): Promise<string> {
  return buildInlinePptConfirmHtml(input).then(
    (html) => `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
  );
}

async function buildInlinePptConfirmHtml({
  locale,
  recommendations,
}: {
  locale: Locale;
  recommendations: PptConfirmRecommendations & Record<string, unknown>;
}): Promise<string> {
  const { PptConfirmStaticAppJs, PptConfirmStaticCatalogs, PptConfirmStaticStyleCss } =
    await import("@/data/home-prompt-recordings/ppt-confirm-static");
  const catalogsJson = escapeInlineScriptJson(JSON.stringify(PptConfirmStaticCatalogs));
  const recommendationsJson = escapeInlineScriptJson(JSON.stringify(recommendations));
  const lang = locale === "zh" ? "zh" : "en";
  const confirmAppJs = escapeInlineScriptText(
    PptConfirmStaticAppJs.replace(
      'var EMBEDDED_IN_DOYA = queryParam("embed") === "1";',
      "var EMBEDDED_IN_DOYA = true;",
    )
      .replace('var value = queryParam("lang");', `var value = ${JSON.stringify(lang)};`)
      .replace(
        "setConfirmedReadonly(REC._already_confirmed);\n        renderAll();",
        "renderAll();\n        setConfirmedReadonly(REC._already_confirmed);",
      ),
  );
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PPT Master - Confirm Design</title>
  <style>${PptConfirmStaticStyleCss}</style>
</head>
<body>
  <header id="topbar">
    <div id="topbar-inner">
      <div class="topbar-titles">
        <h1 data-i18n="page_title">PPT Master - Confirm Design</h1>
        <p id="topbar-hint" data-i18n="topbar_hint">After confirming, return to the chat and say “done”.</p>
      </div>
      <div class="topbar-art" aria-hidden="true">
        <div class="art-slide">
          <span class="art-line art-line-main"></span>
          <span class="art-line art-line-soft"></span>
          <span class="art-bar art-bar-a"></span>
          <span class="art-bar art-bar-b"></span>
          <span class="art-bar art-bar-c"></span>
        </div>
        <div class="art-control">
          <span></span><span></span><span></span>
        </div>
      </div>
      <div id="actionbar" style="display:none;">
        <span id="confirm-status"></span>
        <button id="btn-confirm" data-i18n="btn_confirm">Confirm</button>
      </div>
      <button id="btn-lang-toggle" class="btn-lang-toggle" title="Switch language">中</button>
    </div>
  </header>

  <main id="form">
    <div id="loading" data-i18n="loading">Loading recommendations…</div>
    <div id="error" style="display:none;"></div>
    <div id="sections" style="display:none;"></div>
  </main>

  <div id="confirmed-overlay" style="display:none;">
    <div class="cf-card">
      <div class="cf-title">✓ Confirmed</div>
      <div class="cf-hint">Your choices are saved. You can close this page.</div>
    </div>
  </div>

  <script>
    window.__DOYA_INLINE_CONFIRM_CATALOGS__ = ${catalogsJson};
    window.__DOYA_INLINE_CONFIRM_RECOMMENDATIONS__ = ${recommendationsJson};
    const doyaInlineConfirmResponse = (body) => ({
      ok: true,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });
    window.fetch = (url, options) => {
      const href = String(url);
      if (href === "/api/catalogs" || href === "/static/catalogs.json") {
        return Promise.resolve(doyaInlineConfirmResponse(window.__DOYA_INLINE_CONFIRM_CATALOGS__));
      }
      if (href === "/api/recommendations") {
        return Promise.resolve(
          doyaInlineConfirmResponse(window.__DOYA_INLINE_CONFIRM_RECOMMENDATIONS__),
        );
      }
      if (href === "/api/confirm") {
        window.__DOYA_INLINE_CONFIRM_LAST_RESULT__ = options && options.body;
        const message = { source: "doya-ppt-confirm", type: "doya:ppt-confirm:confirm" };
        window.parent.postMessage(message, "*");
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify(message));
        }
        return Promise.resolve(doyaInlineConfirmResponse({ ok: true }));
      }
      if (href === "/api/shutdown") {
        return Promise.resolve(doyaInlineConfirmResponse({ ok: true }));
      }
      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(""),
      });
    };
  </script>
  <script>${confirmAppJs}</script>
</body>
</html>`;
}

function escapeInlineScriptJson(value: string): string {
  return value
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeInlineScriptText(value: string): string {
  return value.replace(/<\/script/gi, "<\\/script");
}

function noopConfirmFrameAction(): void {}

function extractPptProjectName(pptxPath: string): string | null {
  const normalized = pptxPath.replace(/\\/g, "/");
  const match = /(?:^|\/)projects\/([^/]+)\/exports\/[^/]+\.pptx$/i.exec(normalized);
  return match?.[1] ?? null;
}

function buildPptConfirmContinueMessage(input: {
  defaultLocale: Locale;
  messageId: string;
  projectName: string;
  projectPath: string;
}): string {
  const escapedMessageId = escapeDoyaMarkupText(input.messageId);
  const escapedProjectName = escapeDoyaMarkupText(input.projectName);
  const escapedProjectPath = escapeDoyaMarkupText(input.projectPath);
  const escapedPreviewReadyTitle = escapeDoyaMarkupText(
    translateNow("aiCreation.progress.slidesPreviewReady"),
  );
  const escapedPreviewReadySummary = escapeDoyaMarkupText(
    translateNow("aiCreation.progress.slidesPreviewSummary"),
  );
  const escapedPreviewPathLabel = escapeDoyaMarkupText(
    translateNow("aiCreation.progress.slidesPreviewPath"),
  );
  const languageInstruction = buildDoyaResponseLanguageInstruction({
    defaultLocale: input.defaultLocale,
    userText: null,
  });
  return `${buildDoyaMessageMeta()}

<doya-ui
  version="1"
  kind="ai_creation.slides.progress"
  render="status"
  visibility="summary"
  id="${escapedMessageId}"
  desc="Human-visible PPT confirmation progress."
>
  <doya-ui-content>
    <doya-title>${translateNow("ui.slides.confirm.continue.title")}</doya-title>
    <doya-summary>${translateNow("ui.slides.confirm.continue.summary", {
      name: escapedProjectName,
    })}</doya-summary>
    <doya-field name="project" label="${translateNow("ui.slides.confirm.project")}">${escapedProjectName}</doya-field>
  </doya-ui-content>

  <doya-ai desc="Task instructions the AI must follow. Doya may hide this section from the chat UI.">
${escapeDoyaMarkupText(languageInstruction)}

The user confirmed the PPT settings inline in Doya.
Read \`${escapedProjectPath}/confirm_ui/result.json\` now and continue the PPT Master workflow using the confirmed values exactly.
Do not ask for confirmation again and do not regenerate recommendations.json.
Do not run PPT Master's scripts/svg_editor/server.py.
Do not start Flask or open localhost preview ports.
Create or reuse \`${escapedProjectPath}/svg_output/\` only after reading the confirmed result.
Immediately after \`${escapedProjectPath}/svg_output/\` exists, emit a Doya live-preview progress block with \`kind="ai_creation.slides.progress"\`, \`render="status"\`, and a \`doya-field name="preview_path"\` whose value is \`${escapedProjectPath}/svg_output/\`.
Continue without waiting for another user reply.
Write SVG pages one by one in preview order. After each previewable page is ready, emit another \`ai_creation.slides.progress\` status block with a user-visible title and summary. Keep user-visible progress to: preview ready, outline/style locked, each slide ready, export started, final PPTX ready.
Do not use plain explanatory assistant paragraphs as the main progress UI. Do not mention shell commands, script names, internal filenames, or implementation reasoning in user-visible progress.
  </doya-ai>

  <doya-reply desc="Preferred response format for the assistant after continuing from confirmation.">
Use Doya message markup for user-visible progress. Emit progress blocks like this, localized according to the response language instruction:

<doya-ui
  version="1"
  kind="ai_creation.slides.progress"
  render="status"
  visibility="summary"
  id="${escapedMessageId}"
  desc="Human-visible PPT creation progress."
>
  <doya-ui-content desc="Visible progress content.">
    <doya-title desc="Progress title.">${escapedPreviewReadyTitle}</doya-title>
    <doya-summary desc="Progress summary.">${escapedPreviewReadySummary}</doya-summary>
    <doya-field name="preview_path" label="${escapedPreviewPathLabel}" desc="Workspace-relative live preview directory.">${escapedProjectPath}/svg_output/</doya-field>
  </doya-ui-content>
</doya-ui>

Then keep emitting \`ai_creation.slides.progress\` status blocks for meaningful milestones until the final PPTX is ready. Preserve the id "${escapedMessageId}" when it is useful to correlate this continuation.
  </doya-reply>
</doya-ui>`;
}

function extractPptConfirmProjectName(confirmPath: string): string | null {
  const normalized = confirmPath.replace(/\\/g, "/");
  const match = /(?:^|\/)projects\/([^/]+)\/confirm_ui\/?$/i.exec(normalized);
  return match?.[1] ?? null;
}

function extractPptPreviewProjectName(previewPath: string): string | null {
  const normalized = previewPath.replace(/\\/g, "/");
  const match = /(?:^|\/)projects\/([^/]+)\/svg_output\/?$/i.exec(normalized);
  return match?.[1] ?? null;
}

const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
const ThemedCheckIcon = withUnistyles(Check);
const ThemedXIcon = withUnistyles(X);

const primaryColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});
const mutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const pressableStyle = ({
  pressed,
  hovered = false,
}: PressableStateCallbackType & { hovered?: boolean }) => [
  permissionStyles.optionButton,
  hovered ? permissionStyles.optionButtonHovered : null,
  pressed ? permissionStyles.optionButtonPressed : null,
];

interface PermissionActionButtonProps {
  action: AgentPermissionAction;
  isRespondingAction: boolean;
  isResponding: boolean;
  isPrimary: boolean;
  Icon: typeof ThemedCheckIcon;
  testID: string;
  onPress: (action: AgentPermissionAction) => void;
}

function PermissionActionButton({
  action,
  isRespondingAction,
  isResponding,
  isPrimary,
  Icon,
  testID,
  onPress,
}: PermissionActionButtonProps) {
  const handlePress = useCallback(() => onPress(action), [onPress, action]);
  const optionTextStyle = isPrimary ? optionTextPrimaryStyle : permissionStyles.optionText;
  const colorMapping = isPrimary ? primaryColorMapping : mutedColorMapping;
  return (
    <Pressable testID={testID} style={pressableStyle} onPress={handlePress} disabled={isResponding}>
      {isRespondingAction ? (
        <ThemedActivityIndicator size="small" uniProps={colorMapping} />
      ) : (
        <View style={permissionStyles.optionContent}>
          <Icon size={14} uniProps={colorMapping} />
          <Text style={optionTextStyle}>{action.label}</Text>
        </View>
      )}
    </Pressable>
  );
}

function PermissionRequestCard({
  permission,
  client,
}: {
  permission: PendingPermission;
  client: DaemonClient | null;
}) {
  const isMobile = useIsCompactFormFactor();

  const { request } = permission;
  const isPlanRequest = request.kind === "plan";
  const title = isPlanRequest ? "Plan" : (request.title ?? request.name ?? "Permission Required");
  const description = request.description ?? "";
  const resolvedToolCallDetail = useMemo(
    () =>
      request.detail ?? {
        type: "unknown" as const,
        input: request.input ?? null,
        output: null,
      },
    [request.detail, request.input],
  );
  const resolvedActions = useMemo((): AgentPermissionAction[] => {
    if (request.kind === "question") {
      return [];
    }
    if (Array.isArray(request.actions) && request.actions.length > 0) {
      return request.actions;
    }
    return [
      {
        id: "reject",
        label: translateNow("ui.deny.19kq4"),
        behavior: "deny",
        variant: "danger",
        intent: "dismiss",
      },
      {
        id: "accept",
        label: isPlanRequest ? translateNow("ui.implement") : translateNow("ui.accept.1v7h7h8"),
        behavior: "allow",
        variant: "primary",
      },
    ];
  }, [isPlanRequest, request]);

  const planMarkdown = useMemo(() => {
    if (!request) {
      return undefined;
    }
    const planFromMetadata =
      typeof request.metadata?.planText === "string" ? request.metadata.planText : undefined;
    if (planFromMetadata) {
      return planFromMetadata;
    }
    const candidate = request.input?.["plan"];
    if (typeof candidate === "string") {
      return candidate;
    }
    return undefined;
  }, [request]);

  const permissionMutation = useMutation({
    mutationFn: async (input: {
      agentId: string;
      requestId: string;
      response: AgentPermissionResponse;
    }) => {
      if (!client) {
        throw new Error("Daemon client unavailable");
      }
      return client.respondToPermissionAndWait(
        input.agentId,
        input.requestId,
        input.response,
        15000,
      );
    },
  });
  const {
    reset: resetPermissionMutation,
    mutateAsync: respondToPermission,
    isPending: isResponding,
  } = permissionMutation;

  const [respondingActionId, setRespondingActionId] = useState<string | null>(null);

  useEffect(() => {
    resetPermissionMutation();
    setRespondingActionId(null);
  }, [permission.request.id, resetPermissionMutation]);
  const handleResponse = useCallback(
    (response: AgentPermissionResponse) => {
      respondToPermission({
        agentId: permission.agentId,
        requestId: permission.request.id,
        response,
      }).catch((error) => {
        console.error("[PermissionRequestCard] Failed to respond to permission:", error);
      });
    },
    [permission.agentId, permission.request.id, respondToPermission],
  );
  const handleActionPress = useCallback(
    (action: AgentPermissionAction) => {
      setRespondingActionId(action.id);
      if (action.behavior === "allow") {
        handleResponse({
          behavior: "allow",
          selectedActionId: action.id,
        });
        return;
      }
      handleResponse({
        behavior: "deny",
        selectedActionId: action.id,
        message: translateNow("ui.denied.by.user.1m1h6z3"),
      });
    },
    [handleResponse],
  );

  const optionsContainerStyle = useMemo(
    () => [
      permissionStyles.optionsContainer,
      !isMobile && permissionStyles.optionsContainerDesktop,
    ],
    [isMobile],
  );

  if (request.kind === "question") {
    return (
      <QuestionFormCard
        permission={permission}
        onRespond={handleResponse}
        isResponding={isResponding}
      />
    );
  }

  const footer = (
    <>
      <Text testID="permission-request-question" style={permissionStyles.question}>
        {translateNow("ui.how.would.you.like.to.proceed.1g5qhzd")}
      </Text>

      <View style={optionsContainerStyle}>
        {resolvedActions.map((action) => {
          const isPrimary = action.variant === "primary";
          const isRespondingAction = respondingActionId === action.id;
          const Icon = action.behavior === "allow" ? ThemedCheckIcon : ThemedXIcon;
          let testID: string;
          if (action.behavior === "deny") testID = "permission-request-deny";
          else if (action.id === "accept" || action.id === "implement")
            testID = "permission-request-accept";
          else testID = `permission-request-action-${action.id}`;

          return (
            <PermissionActionButton
              key={action.id}
              action={action}
              isRespondingAction={isRespondingAction}
              isResponding={isResponding}
              isPrimary={isPrimary}
              Icon={Icon}
              testID={testID}
              onPress={handleActionPress}
            />
          );
        })}
      </View>
    </>
  );

  if (isPlanRequest && planMarkdown) {
    return (
      <PlanCard
        title={title}
        description={description}
        text={planMarkdown}
        footer={footer}
        testID="permission-plan-card"
        disableOuterSpacing
      />
    );
  }

  return (
    <View style={permissionStyles.container}>
      <Text style={permissionStyles.title}>{title}</Text>

      {description ? <Text style={permissionStyles.description}>{description}</Text> : null}

      {planMarkdown ? (
        <PlanCard
          title={translateNow("ui.proposed.plan.1rfkkg3")}
          text={planMarkdown}
          testID="permission-plan-card"
          disableOuterSpacing
        />
      ) : null}

      {!isPlanRequest ? (
        <React.Suspense fallback={null}>
          <LazyToolCallDetailsContent detail={resolvedToolCallDetail} maxHeight={200} />
        </React.Suspense>
      ) : null}

      {footer}
    </View>
  );
}

const stylesheet = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: RIGHT_PANEL_BACKGROUND,
  },
  contentWrapper: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
    paddingHorizontal: theme.spacing[2],
  },
  listContentContainer: {
    paddingVertical: 0,
    flexGrow: 1,
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[4],
    },
  },
  forwardListContentContainer: {
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[4],
  },
  list: {
    flex: 1,
  },
  streamItemWrapper: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
    paddingHorizontal: theme.spacing[2],
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[12],
  },
  permissionsContainer: {
    gap: theme.spacing[2],
  },
  listHeaderContent: {
    gap: theme.spacing[3],
  },
  syncingIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    paddingLeft: theme.spacing[2],
  },
  syncingIndicatorText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  invertedWrapper: {
    transform: [{ scaleY: -1 }],
    width: "100%",
  },
  emptyStateText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  scrollToBottomContainer: {
    position: "absolute",
    bottom: 16,
    left: 0,
    right: 0,
    alignItems: "center",
    pointerEvents: "box-none",
  },
  scrollToBottomInner: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
    alignItems: "center",
  },
  scrollToBottomButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadow.sm,
  },
  scrollToBottomIcon: {
    color: theme.colors.foreground,
  },
  aiCreationPlaceholder: {
    width: "100%",
    maxWidth: 760,
    minHeight: 360,
    borderRadius: theme.borderRadius.xl,
    borderWidth: theme.borderWidth[1],
    borderColor: "rgba(148, 163, 184, 0.22)",
    backgroundColor: theme.colors.surface1,
    padding: theme.spacing[6],
    gap: theme.spacing[6],
    position: "relative",
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  aiCreationPlaceholderHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    zIndex: 1,
  },
  aiCreationPlaceholderIconWrap: {
    width: 58,
    height: 58,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: "rgba(148, 163, 184, 0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  aiCreationPlaceholderTitleGroup: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  aiCreationPlaceholderTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  aiCreationPlaceholderTitle: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
  },
  aiCreationPlaceholderSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  aiCreationPlaceholderBadge: {
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  aiCreationPlaceholderBadgeText: {
    fontSize: 9,
    fontWeight: theme.fontWeight.semibold,
  },
  aiCreationDotField: {
    flex: 1,
    minHeight: 210,
    position: "relative",
    overflow: "hidden",
    zIndex: 1,
    opacity: 0.74,
  },
  aiCreationDot: {
    position: "absolute",
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.colors.foregroundMuted,
  },
  liveArtifactProgressGroup: {
    alignSelf: "flex-start",
    width: "100%",
    maxWidth: 620,
    minWidth: 280,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: "rgba(179, 90, 24, 0.16)",
    backgroundColor: "rgba(255, 253, 249, 0.82)",
    padding: theme.spacing[3],
    gap: theme.spacing[2],
    shadowColor: "#000000",
    shadowOpacity: 0.04,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  liveArtifactProgressPreviewSlot: {
    overflow: "hidden",
    borderRadius: theme.borderRadius.md,
  },
  liveArtifactProgressList: {
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: "rgba(179, 90, 24, 0.11)",
    backgroundColor: "rgba(255, 255, 255, 0.64)",
    overflow: "hidden",
  },
  liveArtifactProgressRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
  liveArtifactProgressRowWithDivider: {
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: "rgba(179, 90, 24, 0.1)",
  },
  liveArtifactProgressCheck: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(179, 90, 24, 0.1)",
    borderWidth: theme.borderWidth[1],
    borderColor: "rgba(179, 90, 24, 0.18)",
    marginTop: 1,
  },
  liveArtifactProgressBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  liveArtifactProgressTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 21,
  },
  liveArtifactProgressSummary: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  aiCreationSlidesCard: {
    alignSelf: "flex-start",
    width: "100%",
    maxWidth: 620,
    minWidth: 280,
    minHeight: 96,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: "rgba(148, 163, 184, 0.22)",
    backgroundColor: "rgba(248, 250, 252, 0.9)",
    padding: theme.spacing[4],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    position: "relative",
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOpacity: 0.05,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  aiCreationSlidesCardHovered: {
    borderColor: "rgba(148, 163, 184, 0.36)",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    transform: [{ translateY: -2 }],
  },
  aiCreationSlidesCardPressed: {
    opacity: 0.78,
    transform: [{ translateY: 0 }, { scale: 0.992 }],
  },
  aiCreationSlidesIconWrap: {
    width: 42,
    height: 42,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fee2e2",
    borderWidth: theme.borderWidth[1],
    borderColor: "rgba(148, 163, 184, 0.18)",
    zIndex: 1,
  },
  aiCreationSlidesBody: {
    flex: 1,
    minWidth: 0,
    gap: 4,
    zIndex: 1,
    paddingRight: 92,
  },
  aiCreationSlidesHeader: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: theme.spacing[2],
    rowGap: theme.spacing[1],
  },
  aiCreationSlidesMetaRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  aiCreationSlidesTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  aiCreationSlidesTypeBadge: {
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    paddingHorizontal: 8,
    paddingVertical: 1,
    backgroundColor: "rgba(226, 232, 240, 0.72)",
  },
  aiCreationSlidesTypeBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: 9,
    fontWeight: theme.fontWeight.semibold,
  },
  aiCreationSlidesFileName: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  aiCreationSlidesPath: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    minWidth: 0,
  },
  aiCreationSlidesActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    flexShrink: 0,
    zIndex: 1,
  },
  aiCreationSlidesPrimaryButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: "rgba(15, 23, 42, 0.1)",
    backgroundColor: "rgba(255, 255, 255, 0.88)",
  },
  aiCreationSlidesPrimaryButtonHovered: {
    borderColor: "rgba(15, 23, 42, 0.16)",
    backgroundColor: "#ffffff",
  },
  aiCreationSlidesSecondaryButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: "rgba(15, 23, 42, 0.1)",
    backgroundColor: "rgba(255, 255, 255, 0.88)",
  },
  aiCreationSlidesSecondaryButtonHovered: {
    borderColor: "rgba(15, 23, 42, 0.16)",
    backgroundColor: "#ffffff",
  },
  aiCreationSlidesButtonPressed: {
    opacity: 0.76,
    transform: [{ scale: 0.94 }],
  },
  aiCreationSlidesButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  aiCreationSlidesPrimaryButtonText: {
    color: "#2563eb",
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  aiCreationSlidesSecondaryButtonText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  aiCreationConfirmFrameCard: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 0,
    padding: 0,
    maxWidth: 900,
    overflow: "hidden",
    backgroundColor: "#fffdf9",
    borderColor: "rgba(179, 90, 24, 0.16)",
  },
  aiCreationConfirmHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    paddingRight: theme.spacing[5],
    zIndex: 1,
  },
  aiCreationConfirmHeaderBody: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  aiCreationConfirmFrameWrap: {
    height: 640,
    minHeight: 480,
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: "rgba(179, 90, 24, 0.12)",
    backgroundColor: "#fffdf9",
    overflow: "hidden",
    zIndex: 1,
  },
  aiCreationConfirmHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[4],
    zIndex: 1,
  },
  aiCreationConfirmStatusPill: {
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: "rgba(179, 90, 24, 0.24)",
    backgroundColor: "rgba(179, 90, 24, 0.1)",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 3,
  },
  aiCreationConfirmStatusPillText: {
    color: "#92400e",
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
  },
  aiCreationFileCardDecor: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: 152,
    opacity: 0.78,
  },
  aiCreationFileCardWash: {
    position: "absolute",
    right: -56,
    top: -54,
    width: 172,
    height: 172,
    borderRadius: 86,
  },
  aiCreationFileCardPanel: {
    position: "absolute",
    right: 18,
    top: 20,
    width: 88,
    height: 58,
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    paddingHorizontal: 7,
    paddingVertical: 6,
    gap: 3,
    opacity: 0.78,
    transform: [{ rotate: "-2deg" }],
  },
  aiCreationFileMiniDocumentSurface: {
    flex: 1,
    borderWidth: theme.borderWidth[1],
    borderRadius: theme.borderRadius.sm,
    backgroundColor: "rgba(255, 255, 255, 0.7)",
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 6,
    gap: 3,
  },
  aiCreationFileCardLine: {
    width: 40,
    height: 4,
    borderRadius: 3,
  },
  aiCreationFileCardMutedLine: {
    width: 48,
    height: 4,
    borderRadius: 3,
  },
  aiCreationFileCardStrongLine: {
    width: 30,
    height: 4,
    borderRadius: 3,
  },
  aiCreationFileCardShortLine: {
    width: 34,
  },
  aiCreationFileCardDotRow: {
    flexDirection: "row",
    gap: 4,
    marginTop: 1,
  },
  aiCreationFileCardDot: {
    width: 4,
    height: 4,
    borderRadius: 3,
    opacity: 0.8,
  },
  aiCreationFileMiniSurface: {
    flex: 1,
    borderWidth: theme.borderWidth[1],
    borderRadius: theme.borderRadius.sm,
    backgroundColor: "rgba(255, 255, 255, 0.7)",
    overflow: "hidden",
  },
  aiCreationFileMiniSheetHeader: {
    height: 9,
    marginHorizontal: -8,
    marginTop: -7,
    marginBottom: 4,
  },
  aiCreationFileMiniSheetFormula: {
    width: 38,
    height: 5,
    borderRadius: 3,
    marginBottom: 1,
  },
  aiCreationFileMiniSheetGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 3,
  },
  aiCreationFileMiniSheetCell: {
    width: 20,
    height: 7,
    borderRadius: 2,
  },
  aiCreationFileMiniChartRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 5,
    marginTop: 2,
  },
  aiCreationFileMiniChartBar: {
    width: 9,
    borderRadius: 4,
  },
  aiCreationFileMiniImage: {
    marginTop: -1,
  },
  aiCreationFileMiniImageFrame: {
    borderWidth: theme.borderWidth[1],
  },
  aiCreationFileMiniImageSun: {
    position: "absolute",
    right: 8,
    top: 7,
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  aiCreationFileMiniImageHill: {
    position: "absolute",
    left: -6,
    right: -6,
    bottom: -5,
    height: 22,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  aiCreationFileMiniPdfRibbon: {
    position: "absolute",
    right: 12,
    top: 0,
    width: 12,
    height: 28,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    zIndex: 2,
    elevation: 2,
  },
  aiCreationFileMiniWordMargin: {
    position: "absolute",
    left: 9,
    top: 10,
    bottom: 10,
    width: 4,
    borderRadius: 2,
  },
}));

const permissionStyles = StyleSheet.create((theme) => ({
  container: {
    marginVertical: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: theme.spacing[2],
    borderWidth: 1,
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
    borderColor: theme.colors.border,
  },
  title: {
    fontSize: theme.fontSize.base,
    lineHeight: 22,
    color: theme.colors.foreground,
  },
  description: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.foregroundMuted,
  },
  section: {
    gap: theme.spacing[2],
  },
  sectionTitle: {
    fontSize: theme.fontSize.xs,
  },
  question: {
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
    marginBottom: theme.spacing[1],
    color: theme.colors.foregroundMuted,
  },
  optionsContainer: {
    gap: theme.spacing[2],
  },
  optionsContainerDesktop: {
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    width: "100%",
  },
  optionButton: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    borderWidth: theme.borderWidth[1],
    backgroundColor: theme.colors.surface1,
    borderColor: theme.colors.borderAccent,
  },
  optionButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  optionButtonPressed: {
    opacity: 0.9,
  },
  optionContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  optionText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  optionTextPrimary: {
    color: theme.colors.foreground,
  },
}));

const optionTextPrimaryStyle = [permissionStyles.optionText, permissionStyles.optionTextPrimary];

interface StreamItemWrapperProps {
  gapBelow: number;
  children: ReactNode;
}

function StreamItemWrapper({ gapBelow, children }: StreamItemWrapperProps) {
  const wrapperStyle = useMemo(
    () => [stylesheet.streamItemWrapper, { marginBottom: gapBelow }],
    [gapBelow],
  );
  return <View style={wrapperStyle}>{children}</View>;
}

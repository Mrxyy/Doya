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
  type ViewStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SvgXml } from "react-native-svg";
import { MAX_CONTENT_WIDTH, useIsCompactFormFactor } from "@/constants/layout";
import { useMutation } from "@tanstack/react-query";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Check, ChevronDown, Download, Eye, X } from "lucide-react-native";
import { usePanelStore } from "@/stores/panel-store";
import {
  AssistantMessage,
  SpeakMessage,
  UserMessage,
  ActivityLog,
  ToolCall,
  TodoListCard,
  CompactionMarker,
  MessageOuterSpacingProvider,
  type InlinePathTarget,
} from "@/components/message";
import { PlanCard } from "@/components/plan-card";
import type { StreamItem } from "@/types/stream";
import type { PendingPermission } from "@/types/shared";
import type {
  AgentCapabilityFlags,
  AgentPermissionAction,
  AgentPermissionResponse,
} from "@getpaseo/protocol/agent-types";
import type { AgentScreenAgent } from "@/hooks/use-agent-screen-state-machine";
import { useSessionStore } from "@/stores/session-store";
import { useFileExplorerActions } from "@/hooks/use-file-explorer-actions";
import { useLoadOlderAgentHistory } from "@/hooks/use-load-older-agent-history";
import type { ToastApi } from "@/components/toast-host";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { ToolCallDetailsContent } from "@/components/tool-call-details";
import { QuestionFormCard } from "@/components/question-form-card";
import { ToolCallSheetProvider } from "@/components/tool-call-sheet";
import { type AgentStreamRenderModel, buildAgentStreamRenderModel } from "./model";
import { resolveStreamRenderStrategy } from "./strategy-resolver";
import { type StreamSegmentRenderers, type StreamViewportHandle } from "./strategy";
import { CompletedTurnFooterRow, TurnFooter, type TurnContentStrategy } from "./turn-footer";
import { layoutStream, type StreamLayoutItem } from "./layout";
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
  normalizeWorkspaceFileLocation,
  type OpenFileDisposition,
  type WorkspaceFileOpenRequest,
} from "@/workspace/file-open";
import { resolveWorkspaceIdByExecutionDirectory } from "@/utils/workspace-execution";
import { navigateToPreparedWorkspaceTab } from "@/utils/workspace-navigation";
import { useStableEvent } from "@/hooks/use-stable-event";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import { recordRenderProfileReasons } from "@/utils/render-profiler";
import { translateNow } from "@/i18n/i18n";
import type { AttachmentMetadata } from "@/attachments/types";
import { setAiCreationEditSource } from "@/stores/ai-creation-edit-source-store";
import { buildHostAiCreationRoute } from "@/utils/host-routes";
import { createWorkspacePptPreviewTabTarget } from "@/workspace/ppt-preview";
import { useDownloadStore } from "@/stores/download-store";
import { useHosts } from "@/runtime/host-runtime";
import {
  AI_CREATION_PLACEHOLDER_ID,
  applyAiCreationMessageDisplayMetadata,
  extractAiCreationFinalDocumentPath,
  extractAiCreationFinalPptxPath,
  extractAiCreationPptPreviewPath,
  getAiCreationIntent,
  isAiCreationLabels,
  normalizeAiCreationStream,
} from "./ai-creation";
import {
  loadAiCreationServerMessageDisplayMetadata,
  type AiCreationMessageDisplayEntry,
} from "@/stores/ai-creation-message-display-store";

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
}): ReactNode {
  if (!input.content) {
    return null;
  }

  const footerHost = input.layoutItem.completedFooter;
  const footer = footerHost ? (
    <CompletedTurnFooterRow
      strategy={input.strategy}
      items={footerHost.items}
      timing={footerHost.timing}
      startIndex={footerHost.startIndex}
    />
  ) : null;
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
  pendingPermissions: Map<string, PendingPermission>;
  routeBottomAnchorRequest?: BottomAnchorRouteRequest | null;
  isAuthoritativeHistoryReady?: boolean;
  toast?: ToastApi | null;
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
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
const AI_CREATION_PLACEHOLDER_DOT_KEYS = Array.from({ length: 220 }, (_, index) => `dot-${index}`);
const PDF_FILE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#ef5350" d="M13 9h5.5L13 3.5zM6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m4.93 10.44c.41.9.93 1.64 1.53 2.15l.41.32c-.87.16-2.07.44-3.34.93l-.11.04.5-1.04c.45-.87.78-1.66 1.01-2.4m6.48 3.81c.18-.18.27-.41.28-.66.03-.2-.02-.39-.12-.55-.29-.47-1.04-.69-2.28-.69l-1.29.07-.87-.58c-.63-.52-1.2-1.43-1.6-2.56l.04-.14c.33-1.33.64-2.94-.02-3.6a.85.85 0 0 0-.61-.24h-.24c-.37 0-.7.39-.79.77-.37 1.33-.15 2.06.22 3.27v.01c-.25.88-.57 1.9-1.08 2.93l-.96 1.8-.89.49c-1.2.75-1.77 1.59-1.88 2.12-.04.19-.02.36.05.54l.03.05.48.31.44.11c.81 0 1.73-.95 2.97-3.07l.18-.07c1.03-.33 2.31-.56 4.03-.75 1.03.51 2.24.74 3 .74.44 0 .74-.11.91-.3m-.41-.71.09.11c-.01.1-.04.11-.09.13h-.04l-.19.02c-.46 0-1.17-.19-1.9-.51.09-.1.13-.1.23-.1 1.4 0 1.8.25 1.9.35M7.83 17c-.65 1.19-1.24 1.85-1.69 2 .05-.38.5-1.04 1.21-1.69zm3.02-6.91c-.23-.9-.24-1.63-.07-2.05l.07-.12.15.05c.17.24.19.56.09 1.1l-.03.16-.16.82z"/></svg>';
const WORD_FILE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#2563eb" d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zm0 2.8L17.2 9H13zM7 12h10v2H7zm0 4h10v2H7zm0-8h4v2H7z"/></svg>';
const SPREADSHEET_FILE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#16a34a" d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zm0 2.8L17.2 9H13zM7 12h10v7H7zm2 2v1h2v-1zm4 0v1h2v-1zm-4 3h2v-1H9zm4 0h2v-1h-2z"/></svg>';
const PRESENTATION_FILE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#f97316" d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zm0 2.8L17.2 9H13zM7 12h10v5H7zm2 7h6v1H9z"/></svg>';
const DEFAULT_AI_CREATION_FILE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#64748b" d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zm0 2.8L17.2 9H13z"/></svg>';

const AgentStreamViewComponent = forwardRef<AgentStreamViewHandle, AgentStreamViewProps>(
  function AgentStreamView(
    {
      agentId,
      serverId,
      agent,
      streamItems,
      pendingPermissions,
      routeBottomAnchorRequest = null,
      isAuthoritativeHistoryReady = true,
      toast,
      onOpenWorkspaceFile,
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
    const [isNearBottom, setIsNearBottom] = useState(true);
    const [expandedInlineToolCallIds, setExpandedInlineToolCallIds] = useState<Set<string>>(
      new Set(),
    );
    const openFileExplorerForCheckout = usePanelStore((state) => state.openFileExplorerForCheckout);
    const setExplorerTabForCheckout = usePanelStore((state) => state.setExplorerTabForCheckout);

    // Get serverId (fallback to agent's serverId if not provided)
    const resolvedServerId = serverId ?? agent.serverId ?? "";

    const client = useSessionStore((state) => state.sessions[resolvedServerId]?.client ?? null);
    const streamHead = useSessionStore((state) =>
      state.sessions[resolvedServerId]?.agentStreamHead?.get(agentId),
    );
    const agentLabels = useSessionStore(
      (state) => state.sessions[resolvedServerId]?.agents.get(agentId)?.labels,
    );
    const [aiCreationMessageDisplayMetadata, setAiCreationMessageDisplayMetadata] = useState<
      AiCreationMessageDisplayEntry[]
    >([]);

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
          const location = normalizeWorkspaceFileLocation({
            path: normalized.file,
            lineStart: target.lineStart,
            lineEnd: target.lineEnd,
          });
          if (!location) {
            return;
          }

          if (onOpenWorkspaceFile) {
            onOpenWorkspaceFile({
              location,
              disposition,
            });
            return;
          }

          if (workspaceId) {
            navigateToPreparedWorkspaceTab({
              serverId: resolvedServerId,
              workspaceId,
              target: createWorkspaceFileTabTarget(location),
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
        router.push(buildHostAiCreationRoute(resolvedServerId));
      },
    );

    const handleOpenPptPreview = useStableEvent((projectName: string) => {
      if (!workspaceId) {
        return;
      }
      navigateToPreparedWorkspaceTab({
        serverId: resolvedServerId,
        workspaceId,
        target: createWorkspacePptPreviewTabTarget({ agentId, projectName }),
      });
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

    const shouldNormalizeAiCreationStream = isAiCreationLabels(agentLabels);
    const aiCreationIntent = getAiCreationIntent(agentLabels);
    useEffect(() => {
      let canceled = false;
      void loadAiCreationServerMessageDisplayMetadata({
        serverId: resolvedServerId,
        preferredAgentId: agentId,
      }).then((metadata) => {
        if (!canceled) {
          setAiCreationMessageDisplayMetadata(metadata);
        }
        return undefined;
      });
      return () => {
        canceled = true;
      };
    }, [agentId, resolvedServerId]);

    const visibleAiCreationStream = useMemo(() => {
      const tail = applyAiCreationMessageDisplayMetadata(
        streamItems,
        aiCreationMessageDisplayMetadata,
      );
      const head = applyAiCreationMessageDisplayMetadata(
        streamHead ?? EMPTY_STREAM_HEAD,
        aiCreationMessageDisplayMetadata,
      );
      if (!shouldNormalizeAiCreationStream) {
        if (tail === streamItems && head === (streamHead ?? EMPTY_STREAM_HEAD)) {
          return null;
        }
        return { tail, head };
      }
      return normalizeAiCreationStream({
        agentStatus: agent.status,
        intent: aiCreationIntent,
        tail,
        head,
      });
    }, [
      agent.status,
      aiCreationMessageDisplayMetadata,
      aiCreationIntent,
      shouldNormalizeAiCreationStream,
      streamHead,
      streamItems,
    ]);
    const visibleStreamItems = visibleAiCreationStream?.tail ?? streamItems;
    const visibleStreamHead = visibleAiCreationStream?.head ?? streamHead ?? EMPTY_STREAM_HEAD;

    const baseRenderModel = useMemo(() => {
      return buildAgentStreamRenderModel({
        agentStatus: agent.status,
        tail: visibleStreamItems,
        head: visibleStreamHead,
        platform: isWeb ? "web" : "native",
        isMobileBreakpoint: isMobile,
      });
    }, [agent.status, isMobile, visibleStreamHead, visibleStreamItems]);
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
        return (
          <UserMessage
            serverId={resolvedServerId}
            agentId={agentId}
            messageId={item.id}
            workspaceRoot={workspaceRoot}
            message={item.text}
            images={item.images}
            attachments={item.displayAttachments ?? item.attachments}
            selectionPreviewUri={item.selectionPreviewUri}
            selectionImageSource={item.selectionImageSource}
            selectionImage={item.selectionImage}
            timestamp={item.timestamp.getTime()}
            capabilities={agent.capabilities}
            client={client}
            isFirstInGroup={layoutItem.isFirstInUserGroup}
            isLastInGroup={layoutItem.isLastInUserGroup}
          />
        );
      },
      [agent.capabilities, agentId, client, resolvedServerId, workspaceRoot],
    );

    const renderAssistantMessageItem = useCallback(
      (layoutItem: StreamLayoutItem, item: Extract<StreamItem, { kind: "assistant_message" }>) => {
        if (item.id === AI_CREATION_PLACEHOLDER_ID) {
          return <AiCreationPlaceholder intent={aiCreationIntent} />;
        }
        const pptxPath =
          aiCreationIntent === "ppt_creation" ? extractAiCreationFinalPptxPath(item.text) : null;
        const pptPreviewPath =
          aiCreationIntent === "ppt_creation" ? extractAiCreationPptPreviewPath(item.text) : null;
        const documentPath =
          aiCreationIntent === "pdf_creation" ||
          aiCreationIntent === "word_creation" ||
          aiCreationIntent === "spreadsheet_creation"
            ? extractAiCreationFinalDocumentPath(item.text)
            : null;
        let messageContent: ReactNode;
        if (pptxPath) {
          messageContent = (
            <AiCreationSlidesResultCard
              canOpenPreview={Boolean(workspaceId)}
              path={pptxPath}
              onDownload={handleDownloadPptx}
              onOpenPreview={handleOpenPptPreview}
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
        } else if (pptPreviewPath) {
          messageContent = (
            <AiCreationSlidesPreviewCard
              canOpenPreview={Boolean(workspaceId)}
              path={pptPreviewPath}
              onOpenPreview={handleOpenPptPreview}
            />
          );
        } else {
          messageContent = (
            <AssistantMessage
              message={item.text}
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
        aiCreationIntent,
        client,
        handleEditAiCreationImage,
        handleToolCallOpenFile,
        handleInlinePathPress,
        handleDownloadPptx,
        handleOpenPptPreview,
        resolvedServerId,
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

          if (
            data.name === "speak" &&
            data.detail.type === "unknown" &&
            typeof data.detail.input === "string" &&
            data.detail.input.trim()
          ) {
            return (
              <SpeakMessage message={data.detail.input} timestamp={item.timestamp.getTime()} />
            );
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
        });
      },
      [renderStreamItemContent, streamRenderStrategy],
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
          />
        ) : null,
      [
        showRunningTurnFooter,
        baseRenderModel.turnTiming.runningStartedAt,
        bottomTurnFooterHost,
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

function AiCreationPlaceholder({ intent }: { intent: ReturnType<typeof getAiCreationIntent> }) {
  let title = translateNow("ui.creating.image");
  if (intent === "ppt_creation") {
    title = translateNow("ui.creating.slides");
  } else if (intent === "pdf_creation") {
    title = translateNow("ui.creating.pdf");
  } else if (intent === "word_creation") {
    title = translateNow("ui.creating.document");
  } else if (intent === "spreadsheet_creation") {
    title = translateNow("ui.creating.spreadsheet");
  }
  return (
    <View style={stylesheet.aiCreationPlaceholder}>
      <Text style={stylesheet.aiCreationPlaceholderTitle}>{title}</Text>
      <View style={stylesheet.aiCreationDotField}>
        {AI_CREATION_PLACEHOLDER_DOT_KEYS.map((dotKey) => (
          <View key={dotKey} style={stylesheet.aiCreationDot} />
        ))}
      </View>
    </View>
  );
}

function getAiCreationFileVisual(fileName: string): { svg: string; background: string } {
  const extension = fileName.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase();
  if (extension === "pdf") {
    return { svg: PDF_FILE_ICON_SVG, background: "#fee2e2" };
  }
  if (extension === "docx" || extension === "doc") {
    return { svg: WORD_FILE_ICON_SVG, background: "#dbeafe" };
  }
  if (extension === "xlsx" || extension === "xls" || extension === "csv") {
    return { svg: SPREADSHEET_FILE_ICON_SVG, background: "#dcfce7" };
  }
  if (extension === "pptx" || extension === "ppt") {
    return { svg: PRESENTATION_FILE_ICON_SVG, background: "#ffedd5" };
  }
  return { svg: DEFAULT_AI_CREATION_FILE_ICON_SVG, background: "#e2e8f0" };
}

function AiCreationFileResultCard({
  onDownload,
  onOpen,
  path,
}: {
  onDownload: (path: string) => void;
  onOpen: (path: string) => void;
  path: string;
}) {
  const fileName = path.split(/[\\/]/).pop() || "document";
  const extension = fileName.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toUpperCase() || "FILE";
  const visual = getAiCreationFileVisual(fileName);
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
    <Pressable accessibilityRole="button" onPress={handlePress} style={aiCreationSlidesCardStyle}>
      <View style={[stylesheet.aiCreationSlidesIconWrap, { backgroundColor: visual.background }]}>
        <SvgXml xml={visual.svg} width={24} height={24} />
      </View>
      <View style={stylesheet.aiCreationSlidesBody}>
        <View style={stylesheet.aiCreationSlidesMetaRow}>
          <Text style={stylesheet.aiCreationSlidesFileName} numberOfLines={1}>
            {fileName}
          </Text>
          <View style={stylesheet.aiCreationSlidesTypeBadge}>
            <Text style={stylesheet.aiCreationSlidesTypeBadgeText}>{extension}</Text>
          </View>
        </View>
        <Text style={stylesheet.aiCreationSlidesPath} numberOfLines={1}>
          {path}
        </Text>
      </View>
      <View style={stylesheet.aiCreationSlidesActions}>
        <Pressable
          accessibilityRole="button"
          onPress={handleOpenPress}
          style={aiCreationSlidesPrimaryButtonStyle}
          accessibilityLabel={translateNow("aiCreation.action.openFilePreview")}
        >
          <Eye size={16} color={stylesheet.aiCreationSlidesPrimaryButtonText.color} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={handleDownloadPress}
          style={aiCreationSlidesPreviewButtonStyle}
          accessibilityLabel={translateNow("ui.download.ooknmw")}
        >
          <Download size={16} color={stylesheet.aiCreationSlidesSecondaryButtonText.color} />
        </Pressable>
      </View>
    </Pressable>
  );
}

function aiCreationSlidesCardStyle({ hovered, pressed }: PressableStateCallbackType) {
  return [
    stylesheet.aiCreationSlidesCard,
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
    <Pressable accessibilityRole="button" onPress={handlePress} style={aiCreationSlidesCardStyle}>
      <View style={[stylesheet.aiCreationSlidesIconWrap, { backgroundColor: visual.background }]}>
        <SvgXml xml={visual.svg} width={24} height={24} />
      </View>
      <View style={stylesheet.aiCreationSlidesBody}>
        <View style={stylesheet.aiCreationSlidesMetaRow}>
          <Text style={stylesheet.aiCreationSlidesFileName} numberOfLines={1}>
            {fileName}
          </Text>
          <View style={stylesheet.aiCreationSlidesTypeBadge}>
            <Text style={stylesheet.aiCreationSlidesTypeBadgeText}>PPTX</Text>
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
            style={aiCreationSlidesPrimaryButtonStyle}
            accessibilityLabel={translateNow("aiCreation.action.openSlidesPreview")}
          >
            <Eye size={16} color={stylesheet.aiCreationSlidesPrimaryButtonText.color} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={handleDownloadPress}
          style={aiCreationSlidesPreviewButtonStyle}
          accessibilityLabel={translateNow("ui.download.ooknmw")}
        >
          <Download size={16} color={stylesheet.aiCreationSlidesSecondaryButtonText.color} />
        </Pressable>
      </View>
    </Pressable>
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
  const handlePreviewPress = useCallback(() => {
    if (!projectName) return;
    onOpenPreview(projectName);
  }, [onOpenPreview, projectName]);

  return (
    <Pressable
      accessibilityRole="button"
      disabled={!canPreview}
      onPress={handlePreviewPress}
      style={aiCreationSlidesCardStyle}
    >
      <View style={[stylesheet.aiCreationSlidesIconWrap, { backgroundColor: "#ffedd5" }]}>
        <SvgXml xml={PRESENTATION_FILE_ICON_SVG} width={34} height={34} />
      </View>
      <View style={stylesheet.aiCreationSlidesBody}>
        <Text style={stylesheet.aiCreationSlidesTitle}>
          {translateNow("aiCreation.result.slidesPreviewReady")}
        </Text>
        <Text style={stylesheet.aiCreationSlidesPath} numberOfLines={1}>
          {path}
        </Text>
      </View>
      {canPreview ? (
        <View style={stylesheet.aiCreationSlidesActions}>
          <Pressable
            accessibilityRole="button"
            onPress={handlePreviewPress}
            style={aiCreationSlidesPrimaryButtonStyle}
            accessibilityLabel={translateNow("aiCreation.action.openSlidesPreview")}
          >
            <Eye size={16} color={stylesheet.aiCreationSlidesPrimaryButtonText.color} />
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}

function extractPptProjectName(pptxPath: string): string | null {
  const normalized = pptxPath.replace(/\\/g, "/");
  const match = /(?:^|\/)projects\/([^/]+)\/exports\/[^/]+\.pptx$/i.exec(normalized);
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
        <ToolCallDetailsContent detail={resolvedToolCallDetail} maxHeight={200} />
      ) : null}

      {footer}
    </View>
  );
}

const stylesheet = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
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
    minHeight: 520,
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface1,
    padding: theme.spacing[8],
    gap: theme.spacing[6],
  },
  aiCreationPlaceholderTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.medium,
  },
  aiCreationDotField: {
    flex: 1,
    minHeight: 360,
    flexDirection: "row",
    flexWrap: "wrap",
    alignContent: "flex-start",
    gap: 18,
    opacity: 0.5,
  },
  aiCreationDot: {
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.colors.foregroundMuted,
  },
  aiCreationSlidesCard: {
    alignSelf: "flex-start",
    width: "100%",
    maxWidth: 560,
    minWidth: 280,
    minHeight: 58,
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: "rgba(148, 163, 184, 0.22)",
    backgroundColor: "rgba(248, 250, 252, 0.9)",
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  aiCreationSlidesCardHovered: {
    borderColor: "rgba(148, 163, 184, 0.36)",
    backgroundColor: "rgba(241, 245, 249, 0.95)",
  },
  aiCreationSlidesCardPressed: {
    opacity: 0.72,
  },
  aiCreationSlidesIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fee2e2",
  },
  aiCreationSlidesBody: {
    flex: 1,
    minWidth: 0,
    gap: 0,
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
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 0,
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
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  aiCreationSlidesPath: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    minWidth: 0,
  },
  aiCreationSlidesActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },
  aiCreationSlidesPrimaryButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    backgroundColor: "rgba(37, 99, 235, 0.1)",
  },
  aiCreationSlidesPrimaryButtonHovered: {
    backgroundColor: "rgba(37, 99, 235, 0.16)",
  },
  aiCreationSlidesSecondaryButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    backgroundColor: "rgba(100, 116, 139, 0.1)",
  },
  aiCreationSlidesSecondaryButtonHovered: {
    backgroundColor: "rgba(100, 116, 139, 0.16)",
  },
  aiCreationSlidesButtonPressed: {
    opacity: 0.76,
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

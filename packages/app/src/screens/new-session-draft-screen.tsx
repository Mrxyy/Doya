import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Image,
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type ImageSourcePropType,
  type PressableStateCallbackType,
} from "react-native";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Check, Copy, Download, Link2, Share2, Sparkles } from "lucide-react-native";
import type { DaemonClient } from "@getdoya/client/internal/daemon-client";
import type { AgentProvider } from "@getdoya/protocol/agent-types";
import { saveAccountBootstrapSession, type AccountBootstrapSession } from "@/account/account-api";
import { createAccountProject } from "@/account/account-project-api";
import { applyAccountProjectDisplay } from "@/account/account-workspace-display";
import type { ComposerAttachment } from "@/attachments/types";
import {
  materializeWorkspaceFileAttachments,
  materializeWorkspaceImageAttachmentsForSubmit,
} from "@/attachments/workspace-materialize";
import { Composer } from "@/composer";
import { splitComposerAttachmentsForSubmit } from "@/composer/attachments/submit";
import { useAgentInputDraft } from "@/composer/draft/input-draft";
import type { ImageAttachment, MessagePayload } from "@/composer/types";
import { FileDropZone } from "@/components/file-drop-zone";
import { SidebarMenuToggle } from "@/components/headers/menu-header";
import {
  HEADER_HORIZONTAL_PADDING,
  HEADER_INNER_HEIGHT,
  useIsCompactFormFactor,
} from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import { translateNow, useI18n, type Locale } from "@/i18n/i18n";
import { translate } from "@/i18n/translate";
import type { TranslationKey, TranslationParams } from "@/i18n/translations";
import {
  getHostRuntimeStore,
  isHostRuntimeConnected,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
  useHostRuntimeSnapshot,
} from "@/runtime/host-runtime";
import { buildWorkspaceDraftAgentConfig } from "@/screens/workspace/workspace-draft-agent-config";
import { normalizeWorkspaceDescriptor, useSessionStore } from "@/stores/session-store";
import { saveAiCreationMessageDisplayMetadata } from "@/stores/ai-creation-message-display-store";
import { buildOptimisticUserMessage, generateMessageId } from "@/types/stream";
import { encodeImages } from "@/utils/encode-images";
import { normalizeHostPort } from "@/utils/daemon-endpoints";
import { getAttachmentStore } from "@/attachments/store";
import {
  buildDoyaMessageMeta,
  buildDoyaResponseLanguageInstruction,
  escapeDoyaMarkupText,
} from "@/utils/doya-message-markup";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import { normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import { useAccountLoginModalStore } from "@/stores/account-login-modal-store";
import { useBillingUpgradeModalStore } from "@/stores/billing-upgrade-modal-store";
import { getBillingUpgradeReason } from "@/utils/billing-errors";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { useWindowControlsPadding } from "@/utils/desktop-window";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { ConversationReplayDraftControls } from "@/replay/conversation-replay-composer-controls";
import {
  appendControlSessionMessage,
  allocateControlSessionWorkDir,
  controlApiBaseUrl,
  createControlFileSnapshot,
  createControlSession,
  deleteControlSession,
  ensureControlUserDaemonWorkspace,
  getControlAdminOverview,
  isControlApiConfigured,
  preflightControlBilling,
  registerControlNode,
  upsertControlAgentBinding,
  type WorkingContext,
} from "@/control/control-api";
import { buildControlAgentLabels as buildBaseControlAgentLabels } from "@/control/control-agent-labels";
import { notifyControlSessionsChanged } from "@/control/control-session-events";

const MAX_SESSION_TITLE_LENGTH = 60;
const RIGHT_PANEL_BACKGROUND = "#fcfcfc";
const HOME_CONTENT_WIDTH = 800;
const SHARE_LINK = "https://doya.sh";
const SHARE_MODAL_HERO_SOURCE = require("../../assets/images/share-link-modal-hero.png");
const HOME_IMAGE_ICON_SOURCE = require("../../assets/images/new-session-icon-image.png");
const HOME_SLIDES_ICON_SOURCE = require("../../assets/images/new-session-icon-slides.png");
const HOME_PDF_ICON_SOURCE = require("../../assets/images/new-session-icon-pdf.png");
const HOME_DOCUMENT_ICON_SOURCE = require("../../assets/images/new-session-icon-document.png");
const HOME_SHEET_ICON_SOURCE = require("../../assets/images/new-session-icon-sheet.png");
const HOME_SEARCH_ICON_SOURCE = require("../../assets/images/new-session-icon-search.png");
const SHARE_MODAL_SNAP_POINTS = ["58%", "86%"];
const HOME_TITLE_GRADIENT_KEYFRAME_ID = "doya-home-title-gradient-keyframes";
const HOME_TITLE_GRADIENT_ANIMATION_NAME = "doya-home-title-gradient";
const HOME_TITLE_GRADIENT_KEYFRAME_CSS = `
  @keyframes ${HOME_TITLE_GRADIENT_ANIMATION_NAME} {
    0% {
      background-position: 0% 50%;
    }
    50% {
      background-position: 100% 50%;
    }
    100% {
      background-position: 0% 50%;
    }
  }
`;

type HomeAiCreationMode = "image" | "slides" | "pdf" | "word" | "spreadsheet";
type HomeAiCreationIntent =
  | "imagegen"
  | "ppt_creation"
  | "pdf_creation"
  | "word_creation"
  | "spreadsheet_creation";

const HOME_AI_CREATION_RATIO = "16:9";
const HOME_AI_CREATION_STYLE = "auto";

const HOME_STYLE_PROMPT_LABELS = {
  auto: "auto",
} as const;
const FIREWORK_PARTICLES = [
  { color: "#f97316", x: -112, y: -72, size: 8, delay: 0 },
  { color: "#facc15", x: -84, y: -118, size: 7, delay: 18 },
  { color: "#22c55e", x: -46, y: -98, size: 6, delay: 36 },
  { color: "#06b6d4", x: 0, y: -130, size: 8, delay: 8 },
  { color: "#3b82f6", x: 52, y: -104, size: 6, delay: 30 },
  { color: "#8b5cf6", x: 96, y: -82, size: 8, delay: 12 },
  { color: "#ec4899", x: 118, y: -36, size: 7, delay: 44 },
  { color: "#ef4444", x: 72, y: -18, size: 6, delay: 24 },
  { color: "#14b8a6", x: -72, y: -24, size: 7, delay: 52 },
  { color: "#f59e0b", x: -28, y: -142, size: 5, delay: 64 },
  { color: "#84cc16", x: 24, y: -70, size: 5, delay: 74 },
  { color: "#a855f7", x: 132, y: -106, size: 5, delay: 84 },
] as const;

interface HomePromptSuggestion {
  id: string;
  promptKey: TranslationKey;
  iconSource: ImageSourcePropType;
  accentColor: string;
  borderColor: string;
  aiCreationMode?: HomeAiCreationMode;
}

interface HomeAiCreationSubmitContext {
  mode: HomeAiCreationMode;
  displayText: string;
}

const HOME_PROMPT_SUGGESTIONS: readonly HomePromptSuggestion[] = [
  {
    id: "image-landing",
    promptKey: "home.newSession.prompt.imageFashionLanding",
    iconSource: HOME_IMAGE_ICON_SOURCE,
    accentColor: "#8b5cf6",
    borderColor: "rgba(139, 92, 246, 0.22)",
    aiCreationMode: "image",
  },
  {
    id: "slides-roadshow",
    promptKey: "home.newSession.prompt.slidesSaasRoadshow",
    iconSource: HOME_SLIDES_ICON_SOURCE,
    accentColor: "#f97316",
    borderColor: "rgba(249, 115, 22, 0.22)",
    aiCreationMode: "slides",
  },
  {
    id: "pdf-brief",
    promptKey: "home.newSession.prompt.pdfRetailBrief",
    iconSource: HOME_PDF_ICON_SOURCE,
    accentColor: "#ef4444",
    borderColor: "rgba(239, 68, 68, 0.22)",
    aiCreationMode: "pdf",
  },
  {
    id: "document-prd",
    promptKey: "home.newSession.prompt.documentOpsPrd",
    iconSource: HOME_DOCUMENT_ICON_SOURCE,
    accentColor: "#2563eb",
    borderColor: "rgba(37, 99, 235, 0.22)",
    aiCreationMode: "word",
  },
  {
    id: "sheet-budget",
    promptKey: "home.newSession.prompt.sheetRestaurantBudget",
    iconSource: HOME_SHEET_ICON_SOURCE,
    accentColor: "#16a34a",
    borderColor: "rgba(22, 163, 74, 0.22)",
    aiCreationMode: "spreadsheet",
  },
  {
    id: "search-ai-funding",
    promptKey: "home.newSession.prompt.searchAiFunding",
    iconSource: HOME_SEARCH_ICON_SOURCE,
    accentColor: "#0891b2",
    borderColor: "rgba(8, 145, 178, 0.22)",
  },
] as const;

function ensureHomeTitleGradientKeyframes() {
  if (!isWeb || typeof document === "undefined") {
    return;
  }
  const existing = document.getElementById(HOME_TITLE_GRADIENT_KEYFRAME_ID);
  if (existing) {
    if (existing.textContent !== HOME_TITLE_GRADIENT_KEYFRAME_CSS) {
      existing.textContent = HOME_TITLE_GRADIENT_KEYFRAME_CSS;
    }
    return;
  }
  const styleElement = document.createElement("style");
  styleElement.id = HOME_TITLE_GRADIENT_KEYFRAME_ID;
  styleElement.textContent = HOME_TITLE_GRADIENT_KEYFRAME_CSS;
  document.head.appendChild(styleElement);
}

function summarizeControlAttachment(attachment: ComposerAttachment) {
  switch (attachment.kind) {
    case "image":
    case "file":
      return {
        kind: attachment.kind,
        id: attachment.metadata.id,
        name: attachment.metadata.fileName ?? null,
        mimeType: attachment.metadata.mimeType,
      };
    case "github_issue":
    case "github_pr":
      return {
        kind: attachment.kind,
        title: attachment.item.title,
        url: attachment.item.url,
      };
    case "browser_element":
      return {
        kind: attachment.kind,
        url: attachment.attachment.url,
        tag: attachment.attachment.tag,
        text: attachment.attachment.text,
      };
    case "review":
      return {
        kind: attachment.kind,
        reviewDraftKey: attachment.reviewDraftKey,
        commentCount: attachment.commentCount,
      };
  }
}

function buildControlAgentConfig(input: {
  provider: AgentProvider;
  modeId?: string;
  model?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
}) {
  return {
    provider: input.provider,
    ...(input.modeId ? { modeId: input.modeId } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.thinkingOptionId ? { thinkingOptionId: input.thinkingOptionId } : {}),
    ...(input.featureValues && Object.keys(input.featureValues).length > 0
      ? { featureValues: input.featureValues }
      : {}),
  };
}

function buildControlAgentLabels(input: {
  sessionId: string;
  nodeId: string;
  runtimeId: string;
  aiCreationContext?: HomeAiCreationSubmitContext;
}): Record<string, string> {
  const aiCreationLabels = buildHomeAiCreationLabels(input.aiCreationContext).labels ?? {};
  return buildBaseControlAgentLabels({ ...input, baseLabels: aiCreationLabels });
}

async function createWorkingContextFromAttachments(input: {
  accountSession: AccountBootstrapSession;
  attachments: readonly ComposerAttachment[];
}): Promise<WorkingContext> {
  const fileAttachments = input.attachments.filter(
    (attachment): attachment is Extract<ComposerAttachment, { kind: "image" | "file" }> =>
      attachment.kind === "image" || attachment.kind === "file",
  );
  if (fileAttachments.length === 0) {
    return { type: "generated_workspace" };
  }

  const store = await getAttachmentStore();
  const files = await Promise.all(
    fileAttachments.map(async (attachment) => {
      const metadata = attachment.metadata;
      const contentBase64 = await store.encodeBase64({ attachment: metadata });
      return {
        path: buildControlSnapshotAttachmentPath({
          id: metadata.id,
          fileName: metadata.fileName,
          fallbackKind: attachment.kind,
        }),
        contentBase64,
        mode: null,
      };
    }),
  );
  const snapshot = await createControlFileSnapshot({
    accountSession: input.accountSession,
    files,
  });
  return { type: "uploaded_files", snapshotId: snapshot.id };
}

function buildControlSnapshotAttachmentPath(input: {
  id: string;
  fileName?: string | null;
  fallbackKind: "image" | "file";
}): string {
  const id = sanitizeSnapshotPathSegment(input.id) || "attachment";
  const fileName =
    sanitizeSnapshotPathSegment(input.fileName) ||
    (input.fallbackKind === "image" ? "image" : "file");
  return `attachments/${id}-${fileName}`;
}

function sanitizeSnapshotPathSegment(value: string | null | undefined): string {
  return (
    value
      ?.replace(/[/\\:]/g, "-")
      .replace(/^\.+$/, "")
      .trim()
      .slice(0, 120) ?? ""
  );
}

function findDirectHostRuntimeAuthToken(input: {
  serverId: string;
  endpoint: string;
}): string | null {
  const normalizedEndpoint = normalizeHostPort(input.endpoint);
  const host = getHostRuntimeStore()
    .getHosts()
    .find((entry) => entry.serverId === input.serverId);
  const connection = host?.connections.find(
    (entry) =>
      entry.type === "directTcp" && normalizeHostPort(entry.endpoint) === normalizedEndpoint,
  );
  return connection?.type === "directTcp" ? (connection.password ?? null) : null;
}

function findConnectedRuntime(preferredServerId: string): {
  serverId: string;
  client: DaemonClient;
  snapshot: ReturnType<ReturnType<typeof getHostRuntimeStore>["getSnapshot"]>;
} | null {
  const store = getHostRuntimeStore();
  const preferredSnapshot = store.getSnapshot(preferredServerId);
  if (preferredSnapshot?.connectionStatus === "online" && preferredSnapshot.client) {
    return {
      serverId: preferredServerId,
      client: preferredSnapshot.client,
      snapshot: preferredSnapshot,
    };
  }
  for (const host of store.getHosts()) {
    const snapshot = store.getSnapshot(host.serverId);
    if (snapshot?.connectionStatus === "online" && snapshot.client) {
      return {
        serverId: host.serverId,
        client: snapshot.client,
        snapshot,
      };
    }
  }
  return null;
}

async function resolvePreferredControlRuntimeServerId(input: {
  accountSession: AccountBootstrapSession;
  fallbackServerId: string;
}): Promise<string> {
  if (
    !isControlApiConfigured() ||
    !input.accountSession.workspace.workspaceId.startsWith("control:")
  ) {
    return input.fallbackServerId;
  }
  try {
    const overview = await getControlAdminOverview({ accountSession: input.accountSession });
    return overview.settings.defaultDaemonNodeId ?? input.fallbackServerId;
  } catch {
    return input.fallbackServerId;
  }
}

export function NewSessionDraftScreen({
  serverId,
  accountSession,
}: {
  serverId: string;
  accountSession: AccountBootstrapSession | null;
}) {
  const { locale, t } = useI18n();
  const toast = useToast();
  const openBillingUpgrade = useBillingUpgradeModalStore((state) => state.open);
  const isCompact = useIsCompactFormFactor();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const hostRuntimeSnapshot = useHostRuntimeSnapshot(serverId);
  const mergeWorkspaces = useSessionStore((state) => state.mergeWorkspaces);
  const setAgents = useSessionStore((state) => state.setAgents);
  const setHasHydratedWorkspaces = useSessionStore((state) => state.setHasHydratedWorkspaces);
  const appendOptimisticUserMessageToAgentStream = useSessionStore(
    (state) => state.appendOptimisticUserMessageToAgentStream,
  );
  const supportsConversationReplay = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.conversationReplay === true,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isShareModalVisible, setIsShareModalVisible] = useState(false);
  const [recordConversation, setRecordConversation] = useState(false);
  const accountWorkspaceCwd = accountSession?.workspace.runtime?.cwd ?? "";
  const draft = useAgentInputDraft({
    draftKey: `new-session:${serverId}`,
    composer: {
      initialServerId: serverId,
      isVisible: true,
      onlineServerIds: isConnected ? [serverId] : [],
      initialValues: {
        provider: "codex",
        ...(accountWorkspaceCwd ? { workingDir: accountWorkspaceCwd } : {}),
      },
      lockedWorkingDir: accountWorkspaceCwd || undefined,
    },
  });
  const composerState = draft.composerState;
  const openAccountLogin = useAccountLoginModalStore((state) => state.open);
  const mobileHeaderLeft = useMemo(() => <SidebarMenuToggle />, []);
  const agentControlsWithDisabled = useMemo(
    () =>
      composerState
        ? {
            ...composerState.agentControls,
            disabled: isSubmitting,
          }
        : undefined,
    [composerState, isSubmitting],
  );

  const handleSubmit = useCallback(
    async (payload: MessagePayload, aiCreationContext?: HomeAiCreationSubmitContext) => {
      if (!composerState) {
        toast.error(t("openProject.error.openProjectDaemon"));
        return;
      }
      if (!accountSession) {
        toast.error(t("home.newSession.loginRequired"));
        openAccountLogin(serverId);
        return;
      }
      const preferredRuntimeServerId = await resolvePreferredControlRuntimeServerId({
        accountSession,
        fallbackServerId: serverId,
      });
      const runtimeStore = getHostRuntimeStore();
      await runtimeStore.ensureStarted(preferredRuntimeServerId);
      const startedSnapshot = runtimeStore.getSnapshot(preferredRuntimeServerId);
      const useCurrentRuntime =
        preferredRuntimeServerId === serverId &&
        Boolean(startedSnapshot?.client ?? client) &&
        (isHostRuntimeConnected(startedSnapshot) || isConnected);
      const fallbackRuntime = useCurrentRuntime
        ? null
        : findConnectedRuntime(preferredRuntimeServerId);
      const runtimeClient = useCurrentRuntime
        ? (startedSnapshot?.client ?? client)
        : (fallbackRuntime?.client ?? null);
      const runtimeServerId = useCurrentRuntime
        ? serverId
        : (fallbackRuntime?.serverId ?? preferredRuntimeServerId);
      const runtimeSnapshot = useCurrentRuntime
        ? (startedSnapshot ?? hostRuntimeSnapshot)
        : (fallbackRuntime?.snapshot ?? hostRuntimeSnapshot);
      if (!runtimeClient) {
        toast.error(t("openProject.error.openProjectDaemon"));
        return;
      }
      const provider = composerState.selectedProvider;
      if (!provider) {
        toast.error(t("openProject.error.selectModel"));
        return;
      }
      const clientMessageId = generateMessageId();
      const effectiveAiCreationContext = resolveHomeAiCreationContext(
        payload.text,
        aiCreationContext,
      );
      const submitText = resolveHomeSubmitText(
        payload,
        effectiveAiCreationContext,
        clientMessageId,
        locale,
      );
      if (!hasHomeSubmitContent(submitText, payload.attachments)) {
        return;
      }
      setIsSubmitting(true);
      let pendingControlSessionId: string | null = null;
      try {
        const sessionTitle = buildNewSessionTitle({
          text: submitText.displayText,
          attachments: payload.attachments,
          fallback: t("account.project.defaultName"),
          t,
        });
        if (
          isControlApiConfigured() &&
          accountSession.workspace.workspaceId.startsWith("control:")
        ) {
          const controlAgentConfig = buildControlAgentConfig({
            provider: provider as AgentProvider,
            ...(composerState.modeOptions.length > 0 && composerState.selectedMode
              ? { modeId: composerState.selectedMode }
              : {}),
            model: composerState.effectiveModelId || undefined,
            thinkingOptionId: composerState.effectiveThinkingOptionId || undefined,
            featureValues: composerState.featureValues,
          });
          await preflightControlBilling({
            accountSession,
            providerId: controlAgentConfig.provider,
            modelId: controlAgentConfig.model ?? null,
          });
          const preferredNodeEndpoint =
            runtimeSnapshot?.activeConnection?.type === "directTcp"
              ? normalizeHostPort(runtimeSnapshot.activeConnection.endpoint)
              : null;
          if (!preferredNodeEndpoint) {
            throw new Error(t("openProject.error.openProjectDaemon"));
          }
          const runtimeAuthToken = findDirectHostRuntimeAuthToken({
            serverId: runtimeServerId,
            endpoint: preferredNodeEndpoint,
          });
          if (preferredNodeEndpoint) {
            await registerControlNode({
              accountSession,
              nodeId: runtimeServerId,
              endpoint: preferredNodeEndpoint,
              runtimeAuthToken,
              status: "online",
            });
          }
          const userWorkspace = await ensureControlUserDaemonWorkspace({
            accountSession,
            nodeId: runtimeServerId,
          });
          const workingContext = await createWorkingContextFromAttachments({
            accountSession,
            attachments: payload.attachments,
          });
          const controlSession = await createControlSession({
            accountSession,
            title: sessionTitle,
            workingContext,
          });
          pendingControlSessionId = controlSession.id;
          notifyControlSessionsChanged();
          await appendControlSessionMessage({
            accountSession,
            sessionId: controlSession.id,
            role: "user",
            externalId: clientMessageId,
            content: {
              text: submitText.displayText,
              workingContext,
              agentConfig: controlAgentConfig,
              attachments: payload.attachments.map(summarizeControlAttachment),
            },
          });
          const sessionWorkDir = await allocateControlSessionWorkDir({
            accountSession,
            sessionId: controlSession.id,
            nodeId: runtimeServerId,
            runtimeId: `rt_${controlSession.id}`,
            providerId: controlAgentConfig.provider,
            modelId: controlAgentConfig.model ?? null,
            selectionReason: "preferred_node_direct",
          });
          const openPayload = await runtimeClient.openProject(sessionWorkDir.runtime.workspaceDir);
          if (openPayload.error || !openPayload.workspace) {
            throw new Error(openPayload.error ?? t("openProject.error.createProject"));
          }
          const workspace = normalizeWorkspaceDescriptor(openPayload.workspace);
          mergeWorkspaces(runtimeServerId, [workspace]);
          setHasHydratedWorkspaces(runtimeServerId, true);

          const wirePayload = await splitComposerAttachmentsForSubmit(payload.attachments, {
            materializeImages: (images) =>
              materializeWorkspaceImageAttachmentsForSubmit({
                client: runtimeClient,
                cwd: workspace.workspaceDirectory,
                images,
              }),
            materializeFiles: (files) =>
              materializeWorkspaceFileAttachments({
                client: runtimeClient,
                cwd: workspace.workspaceDirectory,
                files,
              }),
          });
          const images = await encodeImages(wirePayload.images);
          const agent = await runtimeClient.createAgent({
            config: buildWorkspaceDraftAgentConfig({
              provider: provider as AgentProvider,
              cwd: workspace.workspaceDirectory,
              title: sessionTitle,
              ...(composerState.modeOptions.length > 0 && composerState.selectedMode
                ? { modeId: composerState.selectedMode }
                : {}),
              model: composerState.effectiveModelId || undefined,
              thinkingOptionId: composerState.effectiveThinkingOptionId || undefined,
              featureValues: composerState.featureValues,
            }),
            workspaceId: workspace.id,
            ...(submitText.agentText ? { initialPrompt: submitText.agentText } : {}),
            clientMessageId,
            recordConversation,
            labels: buildControlAgentLabels({
              sessionId: controlSession.id,
              nodeId: runtimeServerId,
              runtimeId: sessionWorkDir.runtime.runtimeId,
              aiCreationContext: effectiveAiCreationContext,
            }),
            ...(images && images.length > 0 ? { images } : {}),
            ...(wirePayload.attachments.length > 0 ? { attachments: wirePayload.attachments } : {}),
          });
          await upsertControlAgentBinding({
            accountSession,
            sessionId: controlSession.id,
            nodeId: runtimeServerId,
            agentId: agent.id,
            userWorkspaceId: userWorkspace.id,
            workspaceId: workspace.id,
            cwd: workspace.workspaceDirectory,
          });
          pendingControlSessionId = null;
          await appendControlSessionMessage({
            accountSession,
            sessionId: controlSession.id,
            role: "system",
            externalId: `agent:${agent.id}:binding`,
            content: {
              kind: "control_agent_binding",
              nodeId: runtimeServerId,
              agentId: agent.id,
              workspaceId: workspace.id,
              workspaceDir: workspace.workspaceDirectory,
            },
          });
          notifyControlSessionsChanged();
          setAgents(runtimeServerId, (previous) => {
            const next = new Map(previous);
            next.set(agent.id, normalizeAgentSnapshot(agent, runtimeServerId));
            return next;
          });
          await saveAiCreationMessageDisplayMetadata({
            serverId: runtimeServerId,
            agentId: agent.id,
            messageId: clientMessageId,
            text: submitText.agentText,
            metadata: {
              images: wirePayload.displayImages,
              displayAttachments: wirePayload.displayAttachments,
            },
          }).catch((error) => {
            console.warn("[NewSessionDraft] Failed to persist message display metadata", error);
          });
          appendOptimisticUserMessageToAgentStream(
            runtimeServerId,
            agent.id,
            buildOptimisticUserMessage({
              id: clientMessageId,
              text: submitText.agentText,
              timestamp: new Date(),
              images: wirePayload.displayImages,
              attachments: wirePayload.attachments,
              displayAttachments: wirePayload.displayAttachments,
            }),
            { placement: "tail" },
          );
          await composerState.persistFormPreferences();
          draft.clear("sent");
          router.replace(buildHostAgentDetailRoute(runtimeServerId, agent.id));
          return;
        }
        const project = await createAccountProject({
          userId: accountSession.user.userId,
          workspaceId: accountSession.workspace.workspaceId,
          accessToken: accountSession.accessToken,
          displayName: sessionTitle,
        });
        const nextSession = {
          ...accountSession,
          projects: [
            ...accountSession.projects.filter((item) => item.projectId !== project.projectId),
            project,
          ],
        };
        await saveAccountBootstrapSession(nextSession);

        const openPayload = await runtimeClient.openProject(project.cwd);
        if (openPayload.error || !openPayload.workspace) {
          throw new Error(openPayload.error ?? t("openProject.error.createProject"));
        }
        const workspace = applyAccountProjectDisplay({
          workspace: normalizeWorkspaceDescriptor(openPayload.workspace),
          session: nextSession,
          project,
        });
        mergeWorkspaces(runtimeServerId, [workspace]);
        setHasHydratedWorkspaces(runtimeServerId, true);

        const wirePayload = await splitComposerAttachmentsForSubmit(payload.attachments, {
          materializeImages: (images) =>
            materializeWorkspaceImageAttachmentsForSubmit({
              client: runtimeClient,
              cwd: workspace.workspaceDirectory,
              images,
            }),
          materializeFiles: (files) =>
            materializeWorkspaceFileAttachments({
              client: runtimeClient,
              cwd: workspace.workspaceDirectory,
              files,
            }),
        });
        const images = await encodeImages(wirePayload.images);
        const config = buildWorkspaceDraftAgentConfig({
          provider: provider as AgentProvider,
          cwd: workspace.workspaceDirectory,
          title: sessionTitle,
          ...(composerState.modeOptions.length > 0 && composerState.selectedMode
            ? { modeId: composerState.selectedMode }
            : {}),
          model: composerState.effectiveModelId || undefined,
          thinkingOptionId: composerState.effectiveThinkingOptionId || undefined,
          featureValues: composerState.featureValues,
        });
        const agent = await runtimeClient.createAgent({
          config,
          workspaceId: workspace.id,
          ...(submitText.agentText ? { initialPrompt: submitText.agentText } : {}),
          clientMessageId,
          recordConversation,
          ...buildHomeAiCreationLabels(effectiveAiCreationContext),
          ...(images && images.length > 0 ? { images } : {}),
          ...(wirePayload.attachments.length > 0 ? { attachments: wirePayload.attachments } : {}),
        });
        await saveAiCreationMessageDisplayMetadata({
          serverId: runtimeServerId,
          agentId: agent.id,
          messageId: clientMessageId,
          text: submitText.agentText,
          metadata: {
            images: wirePayload.displayImages,
            displayAttachments: wirePayload.displayAttachments,
          },
        }).catch((error) => {
          console.warn("[NewSessionDraft] Failed to persist message display metadata", error);
        });
        appendOptimisticUserMessageToAgentStream(
          runtimeServerId,
          agent.id,
          buildOptimisticUserMessage({
            id: clientMessageId,
            text: submitText.agentText,
            timestamp: new Date(),
            images: wirePayload.displayImages,
            attachments: wirePayload.attachments,
            displayAttachments: wirePayload.displayAttachments,
          }),
          { placement: "tail" },
        );
        await composerState.persistFormPreferences();
        draft.clear("sent");
        router.replace(buildHostAgentDetailRoute(runtimeServerId, agent.id));
      } catch (error) {
        if (pendingControlSessionId) {
          await deleteControlSession({
            accountSession,
            sessionId: pendingControlSessionId,
          }).catch(() => undefined);
          notifyControlSessionsChanged();
        }
        const billingReason = getBillingUpgradeReason(error);
        if (billingReason) {
          openBillingUpgrade(billingReason);
        }
        toast.error(error instanceof Error ? error.message : t("openProject.error.createProject"));
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      accountSession,
      appendOptimisticUserMessageToAgentStream,
      client,
      composerState,
      draft,
      hostRuntimeSnapshot,
      isConnected,
      locale,
      mergeWorkspaces,
      openBillingUpgrade,
      openAccountLogin,
      recordConversation,
      serverId,
      setAgents,
      setHasHydratedWorkspaces,
      t,
      toast,
    ],
  );

  const addImagesRef = useRef<((images: ImageAttachment[]) => void) | null>(null);
  const handleFilesDropped = useCallback((files: ImageAttachment[]) => {
    addImagesRef.current?.(files);
  }, []);
  const handleAddImagesCallback = useCallback((addImages: (images: ImageAttachment[]) => void) => {
    addImagesRef.current = addImages;
  }, []);
  const handleOpenShareModal = useCallback(() => {
    setIsShareModalVisible(true);
  }, []);
  const handleCloseShareModal = useCallback(() => {
    setIsShareModalVisible(false);
  }, []);
  const handleCapabilitySelect = useCallback(
    (suggestion: HomePromptSuggestion, text: string) => {
      void handleSubmit(
        {
          text,
          attachments: [],
          cwd: accountWorkspaceCwd,
        },
        suggestion.aiCreationMode
          ? {
              mode: suggestion.aiCreationMode,
              displayText: text,
            }
          : undefined,
      );
    },
    [accountWorkspaceCwd, handleSubmit],
  );
  const conversationReplayDraftControls = useMemo(
    () =>
      supportsConversationReplay ? (
        <ConversationReplayDraftControls
          recordConversation={recordConversation}
          onChangeRecordConversation={setRecordConversation}
        />
      ) : null,
    [recordConversation, supportsConversationReplay],
  );

  return (
    <FileDropZone onFilesDropped={handleFilesDropped}>
      <View style={styles.container}>
        <NewSessionHomeHeader
          left={isCompact ? mobileHeaderLeft : undefined}
          onShare={handleOpenShareModal}
        />
        <View style={styles.content}>
          <NewSessionHomeHero disabled={isSubmitting} onSelectPrompt={handleCapabilitySelect} />
          <View style={styles.composerDock}>
            <View style={styles.centered}>
              <Composer
                agentId={`new-session:${serverId}`}
                serverId={serverId}
                isPaneFocused={true}
                onSubmitMessage={handleSubmit}
                isSubmitLoading={isSubmitting}
                submitBehavior="preserve-and-lock"
                blurOnSubmit={true}
                value={draft.text}
                onChangeText={draft.setText}
                attachments={draft.attachments}
                onChangeAttachments={draft.setAttachments}
                cwd={accountWorkspaceCwd}
                clearDraft={draft.clear}
                onAddImages={handleAddImagesCallback}
                autoFocus
                commandDraftConfig={composerState?.commandDraftConfig}
                agentControls={agentControlsWithDisabled}
                extraRightContent={conversationReplayDraftControls}
              />
            </View>
          </View>
        </View>
        <ShareLinkModal visible={isShareModalVisible} onClose={handleCloseShareModal} />
      </View>
    </FileDropZone>
  );
}

function hasHomeSubmitContent(
  submitText: { displayText: string },
  attachments: readonly unknown[],
): boolean {
  return Boolean(submitText.displayText || attachments.length > 0);
}

function NewSessionHomeHeader({ left, onShare }: { left?: ReactNode; onShare: () => void }) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const isCompact = useIsCompactFormFactor();
  const showDownloadButton = isWeb && !isCompact;
  const padding = useWindowControlsPadding("header");
  const headerStyle = useMemo(() => [styles.homeHeader, { paddingTop: insets.top }], [insets.top]);
  const rowStyle = useMemo(
    () => [
      styles.homeHeaderRow,
      {
        paddingLeft: HEADER_HORIZONTAL_PADDING + padding.left,
        paddingRight: HEADER_HORIZONTAL_PADDING + padding.right,
      },
    ],
    [padding.left, padding.right],
  );

  return (
    <View style={headerStyle}>
      <View style={rowStyle}>
        <TitlebarDragRegion />
        <View style={styles.homeHeaderLeft}>
          {left ?? <SidebarMenuToggle style={styles.homeHeaderIconButton} />}
        </View>
        <View style={styles.homeHeaderTitleGroup} pointerEvents="none">
          <Text style={styles.homeHeaderTitle}>{t("home.newSession.title")}</Text>
          <Text style={styles.homeHeaderSubtitle}>{t("home.newSession.disclaimer")}</Text>
        </View>
        <View style={styles.homeHeaderRight}>
          <ShareButton label={t("home.newSession.share.accessibility")} onPress={onShare} />
          {showDownloadButton ? <DownloadComingSoonButton /> : null}
        </View>
      </View>
    </View>
  );
}

function ShareButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { theme } = useUnistyles();
  const motion = usePressMotion({ hoverScale: 1.06, pressScale: 0.92 });
  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.homeHeaderIconButton,
      (hovered || pressed) && styles.homeHeaderIconButtonActive,
    ],
    [],
  );
  const motionLayerStyle = useMemo(
    () => [styles.headerIconMotionLayer, motion.animatedStyle],
    [motion.animatedStyle],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onHoverIn={motion.handleHoverIn}
      onHoverOut={motion.handleHoverOut}
      onPressIn={motion.handlePressIn}
      onPressOut={motion.handlePressOut}
      style={pressableStyle}
      testID="new-session-share-button"
    >
      {({ hovered, pressed }) => (
        <Animated.View style={motionLayerStyle}>
          <Share2
            size={theme.iconSize.md}
            color={hovered || pressed ? theme.colors.foreground : theme.colors.foregroundMuted}
          />
        </Animated.View>
      )}
    </Pressable>
  );
}

function ShareLinkModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const header = useMemo<SheetHeader>(
    () => ({
      title: t("home.newSession.share.title"),
      subtitle: t("home.newSession.share.subtitle"),
      leading: (
        <View style={styles.shareModalHeaderIcon}>
          <Share2 size={18} color="#2563eb" />
        </View>
      ),
    }),
    [t],
  );
  const handleCopyShareLink = useCallback(() => {
    void Clipboard.setStringAsync(SHARE_LINK);
  }, []);

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={onClose}
      header={header}
      desktopMaxWidth={440}
      snapPoints={SHARE_MODAL_SNAP_POINTS}
      testID="new-session-share-modal"
    >
      <View style={styles.shareModalContent}>
        <View style={styles.shareHeroCard}>
          <Image
            source={SHARE_MODAL_HERO_SOURCE}
            resizeMode="cover"
            style={styles.shareHeroImage}
          />
          <View style={styles.shareHeroBadge}>
            <Sparkles size={15} color="#f59e0b" />
            <Text style={styles.shareHeroBadgeText}>{t("home.newSession.share.badge")}</Text>
          </View>
        </View>
        <View style={styles.shareIntro}>
          <Text style={styles.shareIntroTitle}>{t("home.newSession.share.introTitle")}</Text>
          <Text style={styles.shareIntroText}>{t("home.newSession.share.introText")}</Text>
        </View>
        <View style={styles.shareLinkCard}>
          <View style={styles.shareLinkIcon}>
            <Link2 size={18} color="#16a34a" />
          </View>
          <View style={styles.shareLinkTextGroup}>
            <Text style={styles.shareLinkLabel}>{t("home.newSession.share.linkLabel")}</Text>
            <Text style={styles.shareMenuLink} numberOfLines={1}>
              {SHARE_LINK}
            </Text>
          </View>
          <AnimatedCopyButton
            accessibilityLabel={t("home.newSession.share.copyAccessibility")}
            label={t("home.newSession.share.copy")}
            onPress={handleCopyShareLink}
          />
        </View>
        <View style={styles.shareFeatureRow}>
          <View style={styles.shareFeaturePill}>
            <Text style={styles.shareFeaturePillText}>
              {t("home.newSession.share.featureEncrypted")}
            </Text>
          </View>
          <View style={styles.shareFeaturePillAccent}>
            <Text style={styles.shareFeaturePillAccentText}>
              {t("home.newSession.share.featureRemote")}
            </Text>
          </View>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

function DownloadComingSoonButton() {
  const { t } = useI18n();
  const { theme } = useUnistyles();
  const toast = useToast();
  const motion = usePressMotion({ hoverScale: 1.025, pressScale: 0.97 });
  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.downloadButton,
      (hovered || pressed) && styles.downloadButtonActive,
    ],
    [],
  );
  const motionLayerStyle = useMemo(
    () => [styles.downloadButtonMotionLayer, motion.animatedStyle],
    [motion.animatedStyle],
  );
  const comingSoonIcon = useMemo(
    () => (
      <View style={styles.comingSoonToastIcon}>
        <Sparkles size={15} color="#f59e0b" />
      </View>
    ),
    [],
  );
  const handlePress = useCallback(() => {
    toast.show(t("home.newSession.downloadComingSoon"), { icon: comingSoonIcon });
  }, [comingSoonIcon, t, toast]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("home.newSession.downloadDesktop")}
      onPress={handlePress}
      onHoverIn={motion.handleHoverIn}
      onHoverOut={motion.handleHoverOut}
      onPressIn={motion.handlePressIn}
      onPressOut={motion.handlePressOut}
      style={pressableStyle}
      testID="new-session-download-desktop"
    >
      {({ hovered, pressed }) => {
        const isActive = hovered || pressed;
        const color = isActive ? theme.colors.foreground : theme.colors.foregroundMuted;
        return (
          <Animated.View style={motionLayerStyle}>
            <Download size={theme.iconSize.md} color={color} />
            <Text style={isActive ? styles.downloadButtonTextActive : styles.downloadButtonText}>
              {t("home.newSession.downloadDesktop")}
            </Text>
          </Animated.View>
        );
      }}
    </Pressable>
  );
}

function AnimatedCopyButton({
  accessibilityLabel,
  label,
  onPress,
}: {
  accessibilityLabel: string;
  label: string;
  onPress: () => void;
}) {
  const motion = usePressMotion({ hoverScale: 1.04, pressScale: 0.94 });
  const [fireworkKey, setFireworkKey] = useState(0);
  const [fireworkOrigin, setFireworkOrigin] = useState({ x: 0, y: 0 });
  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.shareCopyButton,
      (hovered || pressed) && styles.shareCopyButtonActive,
    ],
    [],
  );
  const motionLayerStyle = useMemo(
    () => [styles.shareCopyButtonMotionLayer, motion.animatedStyle],
    [motion.animatedStyle],
  );
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      setFireworkOrigin({
        x: event.nativeEvent.locationX,
        y: event.nativeEvent.locationY,
      });
      setFireworkKey((value) => value + 1);
      onPress();
    },
    [onPress],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={handlePress}
      onHoverIn={motion.handleHoverIn}
      onHoverOut={motion.handleHoverOut}
      onPressIn={motion.handlePressIn}
      onPressOut={motion.handlePressOut}
      style={pressableStyle}
      testID="new-session-share-copy"
    >
      {({ hovered, pressed }) => (
        <>
          <Animated.View style={motionLayerStyle}>
            {hovered || pressed ? (
              <Check size={16} color="#ffffff" />
            ) : (
              <Copy size={16} color="#ffffff" />
            )}
            <Text style={styles.shareCopyText}>{label}</Text>
          </Animated.View>
          <CopyFireworksBurst burstKey={fireworkKey} origin={fireworkOrigin} />
        </>
      )}
    </Pressable>
  );
}

function CopyFireworksBurst({
  burstKey,
  origin,
}: {
  burstKey: number;
  origin: { x: number; y: number };
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const animatedContainerStyle = useMemo(
    () => [
      styles.fireworksLayer,
      {
        left: origin.x,
        top: origin.y,
      },
      {
        opacity: progress.interpolate({
          inputRange: [0, 0.12, 0.72, 1],
          outputRange: [0, 1, 1, 0],
        }),
        transform: [
          {
            scale: progress.interpolate({
              inputRange: [0, 0.25, 1],
              outputRange: [0.82, 1, 1.03],
            }),
          },
        ],
      },
    ],
    [origin.x, origin.y, progress],
  );
  const particleStyles = useMemo(
    () =>
      FIREWORK_PARTICLES.map((particle) => {
        const delayStart = Math.max(particle.delay / 820, 0.001);
        const delayMid = Math.min(delayStart + 0.28, 0.78);
        return {
          key: `${particle.color}-${particle.x}-${particle.y}`,
          style: [
            styles.fireworkParticle,
            {
              width: particle.size,
              height: particle.size,
              borderRadius: particle.size / 2,
              backgroundColor: particle.color,
              opacity: progress.interpolate({
                inputRange: [0, delayStart, delayMid, 1],
                outputRange: [0, 0, 1, 0],
              }),
              transform: [
                {
                  translateX: progress.interpolate({
                    inputRange: [0, delayStart, 1],
                    outputRange: [0, 0, particle.x],
                  }),
                },
                {
                  translateY: progress.interpolate({
                    inputRange: [0, delayStart, 1],
                    outputRange: [0, 0, particle.y],
                  }),
                },
                {
                  scale: progress.interpolate({
                    inputRange: [0, delayStart, delayMid, 1],
                    outputRange: [0.4, 0.4, 1.25, 0.1],
                  }),
                },
              ],
            },
          ],
        };
      }),
    [progress],
  );
  useEffect(() => {
    if (burstKey === 0) {
      return;
    }
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 820,
      useNativeDriver: true,
    }).start();
  }, [burstKey, progress]);

  return (
    <Animated.View pointerEvents="none" style={animatedContainerStyle}>
      {particleStyles.map((particle) => (
        <Animated.View key={particle.key} style={particle.style} />
      ))}
    </Animated.View>
  );
}

function usePressMotion({ hoverScale, pressScale }: { hoverScale: number; pressScale: number }) {
  const scale = useRef(new Animated.Value(1)).current;
  const isHoveredRef = useRef(false);
  const animateScale = useCallback(
    (toValue: number) => {
      Animated.spring(scale, {
        toValue,
        damping: 17,
        stiffness: 260,
        mass: 0.8,
        useNativeDriver: true,
      }).start();
    },
    [scale],
  );
  const handleHoverIn = useCallback(() => {
    isHoveredRef.current = true;
    animateScale(hoverScale);
  }, [animateScale, hoverScale]);
  const handleHoverOut = useCallback(() => {
    isHoveredRef.current = false;
    animateScale(1);
  }, [animateScale]);
  const handlePressIn = useCallback(() => {
    animateScale(pressScale);
  }, [animateScale, pressScale]);
  const handlePressOut = useCallback(() => {
    animateScale(isHoveredRef.current ? hoverScale : 1);
  }, [animateScale, hoverScale]);
  const animatedStyle = useMemo(() => ({ transform: [{ scale }] }), [scale]);

  return {
    animatedStyle,
    handleHoverIn,
    handleHoverOut,
    handlePressIn,
    handlePressOut,
  };
}

function NewSessionHomeHero({
  disabled,
  onSelectPrompt,
}: {
  disabled: boolean;
  onSelectPrompt: (suggestion: HomePromptSuggestion, prompt: string) => void;
}) {
  const { t } = useI18n();

  return (
    <View style={styles.hero}>
      <View style={styles.heroInner}>
        <HomeHeroTitle title={t("home.newSession.heroTitle")} />
        <View style={styles.promptSuggestionGrid}>
          {HOME_PROMPT_SUGGESTIONS.map((suggestion) => (
            <HomePromptSuggestionPill
              key={suggestion.id}
              suggestion={suggestion}
              disabled={disabled}
              onSelect={onSelectPrompt}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

function HomeHeroTitle({ title }: { title: string }) {
  const [visibleLength, setVisibleLength] = useState(0);
  const characters = useMemo(() => Array.from(title), [title]);

  useEffect(() => {
    ensureHomeTitleGradientKeyframes();
  }, []);

  useEffect(() => {
    setVisibleLength(0);
    let nextLength = 0;
    let characterTimer: ReturnType<typeof setInterval> | null = null;
    let cycleTimer: ReturnType<typeof setTimeout> | null = null;

    const startTyping = () => {
      nextLength = 0;
      setVisibleLength(0);
      characterTimer = setInterval(() => {
        nextLength += 1;
        setVisibleLength(nextLength);
        if (nextLength >= characters.length && characterTimer) {
          clearInterval(characterTimer);
          characterTimer = null;
        }
      }, 42);
    };

    startTyping();
    cycleTimer = setInterval(() => {
      if (characterTimer) {
        clearInterval(characterTimer);
        characterTimer = null;
      }
      startTyping();
    }, 5000);

    return () => {
      if (characterTimer) {
        clearInterval(characterTimer);
      }
      if (cycleTimer) {
        clearInterval(cycleTimer);
      }
    };
  }, [characters.length, title]);

  const text = characters.slice(0, visibleLength).join("");
  const showCursor = visibleLength < characters.length;

  return (
    <Text accessibilityLabel={title} style={styles.heroTitle}>
      {text}
      {showCursor ? "｜" : null}
    </Text>
  );
}

function HomePromptSuggestionPill({
  suggestion,
  disabled,
  onSelect,
}: {
  suggestion: HomePromptSuggestion;
  disabled: boolean;
  onSelect: (suggestion: HomePromptSuggestion, prompt: string) => void;
}) {
  const { t } = useI18n();
  const motion = usePressMotion({ hoverScale: 1.018, pressScale: 0.975 });
  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.promptSuggestionPill,
      {
        borderColor: hovered || pressed ? suggestion.borderColor : "rgba(0, 0, 0, 0.06)",
        shadowColor: suggestion.accentColor,
      },
      (hovered || pressed) && {
        shadowOpacity: 0.12,
        transform: [{ translateY: -1 }],
      },
      disabled && styles.promptSuggestionPillDisabled,
    ],
    [disabled, suggestion.accentColor, suggestion.borderColor],
  );
  const motionLayerStyle = useMemo(
    () => [styles.promptSuggestionMotionLayer, motion.animatedStyle],
    [motion.animatedStyle],
  );
  const iconWrapStyle = useMemo(
    () => [
      styles.promptSuggestionIconWrap,
      {
        backgroundColor: suggestion.borderColor,
      },
    ],
    [suggestion.borderColor],
  );
  const handlePress = useCallback(() => {
    onSelect(suggestion, t(suggestion.promptKey));
  }, [onSelect, suggestion, t]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(suggestion.promptKey)}
      disabled={disabled}
      onPress={handlePress}
      onHoverIn={motion.handleHoverIn}
      onHoverOut={motion.handleHoverOut}
      onPressIn={motion.handlePressIn}
      onPressOut={motion.handlePressOut}
      style={pressableStyle}
      testID={`new-session-prompt-${suggestion.id}`}
    >
      <Animated.View style={motionLayerStyle}>
        <View style={iconWrapStyle}>
          <Image
            source={suggestion.iconSource}
            resizeMode="cover"
            style={styles.promptSuggestionIconImage}
          />
        </View>
        <Text style={styles.promptSuggestionText}>{t(suggestion.promptKey)}</Text>
      </Animated.View>
    </Pressable>
  );
}

function buildNewSessionTitle(input: {
  text: string;
  attachments: ComposerAttachment[];
  fallback: string;
  t: (key: TranslationKey, params?: TranslationParams) => string;
}): string {
  const firstLine = input.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const normalizedText = firstLine?.replace(/\s+/g, " ").trim();
  if (normalizedText) {
    return clampSessionTitle(normalizedText);
  }

  const attachmentTitle = buildAttachmentSessionTitle(input.attachments, input.t);
  return attachmentTitle ?? input.fallback;
}

function buildAttachmentSessionTitle(
  attachments: ComposerAttachment[],
  t: (key: TranslationKey, params?: TranslationParams) => string,
): string | null {
  const firstAttachment = attachments[0];
  if (!firstAttachment) {
    return null;
  }
  if (firstAttachment.kind === "image") {
    return clampSessionTitle(
      t("openProject.attachmentTitle.image", {
        name: firstAttachment.metadata.fileName ?? t("openProject.attachmentTitle.imageFallback"),
      }),
    );
  }
  if (firstAttachment.kind === "file") {
    return clampSessionTitle(
      t("openProject.attachmentTitle.file", {
        name: firstAttachment.metadata.fileName ?? t("openProject.attachmentTitle.fileFallback"),
      }),
    );
  }
  if (firstAttachment.kind === "github_issue") {
    return clampSessionTitle(`Issue：${firstAttachment.item.title}`);
  }
  if (firstAttachment.kind === "github_pr") {
    return clampSessionTitle(`PR：${firstAttachment.item.title}`);
  }
  if (firstAttachment.kind === "browser_element") {
    return clampSessionTitle(
      t("openProject.attachmentTitle.browserElement", {
        text: firstAttachment.attachment.text,
      }),
    );
  }
  return null;
}

function clampSessionTitle(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const clamped = normalized.slice(0, MAX_SESSION_TITLE_LENGTH).trim();
  return clamped || normalized;
}

function resolveHomeSubmitText(
  payload: MessagePayload,
  aiCreationContext: HomeAiCreationSubmitContext | undefined,
  messageId: string,
  defaultLocale: Locale,
): { agentText: string; displayText: string } {
  const rawText = payload.text.trim();
  const displayText = aiCreationContext?.displayText.trim() || rawText;
  return {
    displayText,
    agentText: aiCreationContext
      ? buildHomeAiCreationPrompt({
          messageId,
          mode: aiCreationContext.mode,
          prompt: displayText,
          referenceCount: payload.attachments.length,
          defaultLocale,
        })
      : rawText,
  };
}

function resolveHomeAiCreationContext(
  text: string,
  explicitContext: HomeAiCreationSubmitContext | undefined,
): HomeAiCreationSubmitContext | undefined {
  return explicitContext ?? inferHomeAiCreationContextFromText(text);
}

function buildHomeAiCreationLabels(aiCreationContext: HomeAiCreationSubmitContext | undefined): {
  labels?: { surface: "ai_creation"; intent: HomeAiCreationIntent };
} {
  if (!aiCreationContext) {
    return {};
  }
  return {
    labels: {
      surface: "ai_creation",
      intent: getHomeAiCreationIntentForMode(aiCreationContext.mode),
    },
  };
}

function getHomeAiCreationIntentForMode(mode: HomeAiCreationMode): HomeAiCreationIntent {
  if (mode === "slides") {
    return "ppt_creation";
  }
  if (mode === "pdf") {
    return "pdf_creation";
  }
  if (mode === "word") {
    return "word_creation";
  }
  if (mode === "spreadsheet") {
    return "spreadsheet_creation";
  }
  return "imagegen";
}

function inferHomeAiCreationContextFromText(text: string): HomeAiCreationSubmitContext | undefined {
  const displayText = text.trim();
  if (!displayText) {
    return undefined;
  }
  const normalized = displayText.toLowerCase();
  const mode = inferHomeAiCreationModeFromText(normalized);
  return mode ? { mode, displayText } : undefined;
}

function inferHomeAiCreationModeFromText(normalizedText: string): HomeAiCreationMode | null {
  if (
    /(?:pptx?|幻灯片|演示文稿|路演稿|投资人路演|pitch\s*deck|slide\s*deck|presentation)/i.test(
      normalizedText,
    )
  ) {
    return "slides";
  }
  if (/(?:xlsx?|excel|spreadsheet|电子表格|预算表|数据表|表格|公式)/i.test(normalizedText)) {
    return "spreadsheet";
  }
  if (/(?:pdf|白皮书|报告书)/i.test(normalizedText)) {
    return "pdf";
  }
  if (/(?:docx?|word|prd|需求文档|产品需求|文档|方案书)/i.test(normalizedText)) {
    return "word";
  }
  if (
    /(?:图片|图像|海报|插画|logo|头像|封面图|配图|image|poster|illustration)/i.test(normalizedText)
  ) {
    return "image";
  }
  return null;
}

function buildHomeAiCreationPrompt(input: {
  messageId: string;
  mode: HomeAiCreationMode;
  prompt: string;
  referenceCount: number;
  defaultLocale: Locale;
}): string {
  const baseInput = {
    messageId: input.messageId,
    mode: input.mode,
    prompt: input.prompt,
  };
  if (input.mode === "slides") {
    return buildHomeAiCreationMarkupPrompt({
      ...baseInput,
      ratio: HOME_AI_CREATION_RATIO,
      sourceCount: input.referenceCount,
      includeExpectedTarget: false,
      defaultLocale: input.defaultLocale,
      aiInstructions: buildHomeSlidesPrompt({
        prompt: input.prompt,
        sourceFileCount: input.referenceCount,
        defaultLocale: input.defaultLocale,
      }),
    });
  }
  if (input.mode === "pdf") {
    return buildHomeAiCreationMarkupPrompt({
      ...baseInput,
      sourceCount: input.referenceCount,
      defaultLocale: input.defaultLocale,
      aiInstructions: buildHomeDocumentCreationPrompt({
        kind: "pdf",
        prompt: input.prompt,
        sourceFileCount: input.referenceCount,
      }),
    });
  }
  if (input.mode === "word") {
    return buildHomeAiCreationMarkupPrompt({
      ...baseInput,
      sourceCount: input.referenceCount,
      defaultLocale: input.defaultLocale,
      aiInstructions: buildHomeDocumentCreationPrompt({
        kind: "word",
        prompt: input.prompt,
        sourceFileCount: input.referenceCount,
      }),
    });
  }
  if (input.mode === "spreadsheet") {
    return buildHomeAiCreationMarkupPrompt({
      ...baseInput,
      sourceCount: input.referenceCount,
      defaultLocale: input.defaultLocale,
      aiInstructions: buildHomeDocumentCreationPrompt({
        kind: "spreadsheet",
        prompt: input.prompt,
        sourceFileCount: input.referenceCount,
      }),
    });
  }
  return buildHomeAiCreationMarkupPrompt({
    ...baseInput,
    ratio: HOME_AI_CREATION_RATIO,
    style: HOME_STYLE_PROMPT_LABELS[HOME_AI_CREATION_STYLE],
    sourceCount: input.referenceCount,
    defaultLocale: input.defaultLocale,
    aiInstructions: buildHomeImagegenPrompt({
      prompt: input.prompt,
      referenceCount: input.referenceCount,
    }),
  });
}

function buildHomeAiCreationMarkupPrompt(input: {
  messageId: string;
  mode: HomeAiCreationMode;
  prompt: string;
  aiInstructions: string;
  defaultLocale: Locale;
  ratio?: string;
  style?: string;
  sourceCount?: number;
  includeExpectedTarget?: boolean;
}): string {
  const config = getHomeAiCreationMarkupConfig(input.mode);
  const escapedMessageId = escapeDoyaMarkupText(input.messageId);
  const escapedPrompt = escapeDoyaMarkupText(input.prompt);
  const languageInstruction = buildDoyaResponseLanguageInstruction({
    defaultLocale: input.defaultLocale,
    userText: input.prompt,
  });
  const expectedTarget =
    input.includeExpectedTarget === false
      ? ""
      : `
<doya-expected-target
  version="1"
  kind="${config.kind}"
  goal="${config.goal}"
  id="${escapedMessageId}"
  text="${config.targetText}"
  desc="Exact target handshake that the assistant must emit before doing any work."
/>
`;
  const fields = [
    `<doya-field name="request" label="${escapeDoyaMarkupText(translateNow("aiCreation.markup.field.request"))}" desc="Original user creation request.">${escapedPrompt}</doya-field>`,
    input.ratio
      ? `<doya-field name="ratio" label="${escapeDoyaMarkupText(translateNow("aiCreation.markup.field.ratio"))}" desc="Requested output aspect ratio.">${escapeDoyaMarkupText(input.ratio)}</doya-field>`
      : null,
    input.style
      ? `<doya-field name="style" label="${escapeDoyaMarkupText(translateNow("aiCreation.markup.field.style"))}" desc="Requested visual style.">${escapeDoyaMarkupText(input.style)}</doya-field>`
      : null,
    typeof input.sourceCount === "number" && input.sourceCount > 0
      ? `<doya-field name="source_count" label="${escapeDoyaMarkupText(translateNow("aiCreation.markup.field.sourceCount"))}" desc="Number of attached source files or images.">${input.sourceCount}</doya-field>`
      : null,
  ].filter((field): field is string => Boolean(field));

  return `${buildDoyaMessageMeta()}

${config.normalInstruction}
${expectedTarget}
<doya-ui
  version="1"
  kind="${config.kind}"
  render="card"
  visibility="summary"
  id="${escapedMessageId}"
  desc="${config.cardDesc}"
>
  <doya-ui-content desc="User-visible card content. Doya may render this instead of the full prompt.">
    <doya-title desc="Title shown in the user message card.">${config.title}</doya-title>
    <doya-summary desc="Short user-visible summary of this task.">${escapedPrompt}</doya-summary>
    ${fields.join("\n    ")}
  </doya-ui-content>

  <doya-ai desc="Task instructions the AI must follow. Doya may hide this section from the chat UI.">
${escapeDoyaMarkupText(languageInstruction)}

${escapeDoyaMarkupText(input.aiInstructions)}
  </doya-ai>

  <doya-reply desc="Preferred response format. Doya may render a matching result block specially.">
Follow the final reply requirements in <doya-ai>. Preserve the request id "${escapedMessageId}" if you emit a matching result block.
  </doya-reply>
</doya-ui>`;
}

function getHomeAiCreationMarkupConfig(mode: HomeAiCreationMode): {
  kind: string;
  goal: string;
  targetText: string;
  title: string;
  normalInstruction: string;
  cardDesc: string;
} {
  if (mode === "slides") {
    return {
      kind: "ai_creation.slides.create",
      goal: "create_pptx",
      targetText: translateNow("aiCreation.display.slidesPrefix"),
      title: translateNow("aiCreation.display.slidesPrefix"),
      normalInstruction: translateNow("aiCreation.markup.instruction.slides"),
      cardDesc: "A Doya-renderable task card for an AI slide deck creation request.",
    };
  }
  if (mode === "pdf") {
    return {
      kind: "ai_creation.document.pdf.create",
      goal: "create_pdf",
      targetText: translateNow("aiCreation.display.pdfPrefix"),
      title: translateNow("aiCreation.display.pdfPrefix"),
      normalInstruction: translateNow("aiCreation.markup.instruction.pdf"),
      cardDesc: "A Doya-renderable task card for an AI PDF creation request.",
    };
  }
  if (mode === "word") {
    return {
      kind: "ai_creation.document.word.create",
      goal: "create_docx",
      targetText: translateNow("aiCreation.display.wordPrefix"),
      title: translateNow("aiCreation.display.wordPrefix"),
      normalInstruction: translateNow("aiCreation.markup.instruction.word"),
      cardDesc: "A Doya-renderable task card for an AI Word document creation request.",
    };
  }
  if (mode === "spreadsheet") {
    return {
      kind: "ai_creation.spreadsheet.create",
      goal: "create_spreadsheet",
      targetText: translateNow("aiCreation.display.spreadsheetPrefix"),
      title: translateNow("aiCreation.display.spreadsheetPrefix"),
      normalInstruction: translateNow("aiCreation.markup.instruction.spreadsheet"),
      cardDesc: "A Doya-renderable task card for an AI spreadsheet creation request.",
    };
  }
  return {
    kind: "ai_creation.image.generate",
    goal: "generate_image",
    targetText: translateNow("aiCreation.display.createPrefix"),
    title: translateNow("aiCreation.display.createPrefix"),
    normalInstruction: translateNow("aiCreation.markup.instruction.create"),
    cardDesc: "A Doya-renderable task card for an AI image generation request.",
  };
}

function buildHomeImagegenPrompt(input: { prompt: string; referenceCount: number }): string {
  const lines = [
    "Use the Codex imagegen skill for this request. Follow the default built-in image_gen workflow unless the user explicitly asks for a CLI fallback.",
    "This is an AI creation surface. Do not explain your reasoning, workflow, skill usage, shell commands, or implementation steps in the final conversation.",
    "Reply only with the generated image result when available. If you must send text while generating, keep it to one short user-facing sentence in Chinese.",
    "",
    "Create a raster image from this prompt:",
    input.prompt,
    "",
    `Aspect ratio: ${HOME_AI_CREATION_RATIO}`,
    `Style: ${HOME_STYLE_PROMPT_LABELS[HOME_AI_CREATION_STYLE]}`,
    "Save the final image into the current workspace if a workspace-bound asset is produced.",
    "When the final image is saved, reply with Markdown image syntax only, using the workspace-relative path, for example: ![](assets/generated-image.png)",
  ];
  if (input.referenceCount > 0) {
    lines.push(
      `Reference images attached: ${input.referenceCount}. Treat them as visual references unless the user asks for an edit.`,
    );
  }
  return lines.join("\n");
}

function buildHomeSlidesPrompt(input: {
  prompt: string;
  sourceFileCount: number;
  defaultLocale: Locale;
}): string {
  const previewReadyTitle = translate(
    "aiCreation.progress.slidesPreviewReady",
    input.defaultLocale,
  );
  const slideReadyTitle = translate("aiCreation.progress.slidesPageReady", input.defaultLocale, {
    number: 1,
  });
  const coverReadySummary = translate("aiCreation.progress.slidesCoverReady", input.defaultLocale);
  const lines = [
    "You are creating a PowerPoint deck for the Doya AI Creation slides surface.",
    "Doya has already prepared the bundled PPT Master skill link at `.doya/skills/ppt-master` before this agent starts.",
    "This is an AI creation surface. Keep user-facing progress minimal.",
    "Do not narrate skill reading, dependency installation, shell commands, file inspection, design reasoning, or implementation steps.",
    'Human-visible progress protocol: before the final reply, only send progress by emitting a `<doya-ui kind="ai_creation.slides.progress">` block.',
    "Only mark information as human-visible when it helps the user follow PPT creation: confirmation readiness, preview readiness, deck outline, design direction, source processing, each slide becoming ready, export start, or PPTX readiness.",
    "Do not expose implementation details in human-visible progress: no SVG, .svg filenames, shell commands, script names, dependency names, or internal file inspection.",
    "All human-visible progress titles and summaries must follow the response-language instruction above. Do not copy English titles such as `Slide 1 ready`, `Deck outline ready`, or `Preview ready` when the response language is Chinese.",
    "Use this protocol shape for progress:",
    `<doya-ui version="1" kind="ai_creation.slides.progress" render="status" visibility="summary" desc="Human-visible PPT creation progress."><doya-ui-content desc="Visible progress content."><doya-title desc="Progress title.">${slideReadyTitle}</doya-title><doya-summary desc="Progress summary.">${coverReadySummary}</doya-summary></doya-ui-content></doya-ui>`,
    "For preview readiness, include the preview path in a field named `preview_path` inside the same progress block.",
    "Do not search for PPT Master in other directories.",
    "Do not use web search for PPT Master.",
    "Do not git clone, fetch, or download PPT Master.",
    'If `.doya/skills/ppt-master/SKILL.md` is missing, stop immediately and reply exactly: "PPT Master skill link missing: .doya/skills/ppt-master/SKILL.md".',
    "Read `.doya/skills/ppt-master/SKILL.md` and follow that workflow exactly.",
    "Begin the PPT Master workflow immediately. Do not wait for a target handshake, confirmation, or user reply before creating the project.",
    "Doya provides its own built-in slide preview service. Do not run PPT Master's `scripts/svg_editor/server.py`, do not start Flask, and do not open localhost preview ports yourself.",
    "Doya also provides its own built-in Confirm UI. When PPT Master Step 4 asks you to run `scripts/confirm_ui/server.py`, do not run that local server, do not start Flask, and do not open localhost confirmation ports.",
    "Instead, write `projects/<project>/confirm_ui/recommendations.json`, then send a human-visible progress block with a `confirm_path` field set to `projects/<project>/confirm_ui/`. Doya will render the inline confirmation card in chat and write `projects/<project>/confirm_ui/result.json` when the user confirms.",
    "After sending the confirmation progress block, stop at the confirmation barrier. Until `projects/<project>/confirm_ui/result.json` exists or the user replies in chat with explicit choices, do not create the design spec, do not create `svg_output`, do not send a `preview_path`, do not generate slide SVGs, and do not continue to any later PPT Master step.",
    "When the confirmation barrier resolves, read `result.json` if it exists, honor the confirmed values exactly, and only then continue the PPT Master workflow.",
    `Streaming preview contract: after confirmation is resolved and project initialization creates \`projects/<project>/\`, ensure \`projects/<project>/svg_output/\` exists even if it is still empty, then immediately send a human-visible progress block titled \`${previewReadyTitle}\` with a \`preview_path\` field set to \`projects/<project>/svg_output/\`.`,
    "You must send the preview-ready progress block before generating or writing the first slide.",
    "After sending preview progress, continue the PPT Master workflow without waiting for the user.",
    "Write generated SVG pages into `projects/<project>/svg_output/` strictly one page at a time. Save `slide_01.svg` as soon as it is complete, then continue to `slide_02.svg`, and so on.",
    "Do not batch-generate all slide SVG files before writing them to disk. Do not wait until all slides are ready before exposing the preview directory.",
    `After each slide page is saved, send one human-visible progress block titled like \`${slideReadyTitle}\`, with a summary using the user-facing slide title, for example \`${coverReadySummary}\` Then continue with the next page.`,
    "Doya polls the preview directory and will show new slides as they appear.",
    "Treat tasteful animation as part of a finished AI-generated presentation, not as a user-only advanced option. Independently choose whether each deck should have page transitions, per-element entrance animation, or no motion based on the content, audience, and visual style.",
    "For most generated decks, export the final PPTX with subtle per-element animation enabled by passing `-a auto` to `svg_to_pptx.py`. Use `--animation-trigger after-previous` for click-free presentation flow unless the user explicitly asks for presenter-paced click reveals.",
    'When a slide has clear semantic sections, make sure the SVG uses top-level `<g id="...">` groups so PPT Master can animate meaningful regions such as title, chart, cards, timeline steps, image hero, and takeaway instead of animating tiny atoms. Keep chrome/background/header/footer groups named as chrome so they do not animate.',
    "If the deck is highly formal, print-oriented, compliance-heavy, or the user asks for no animation, keep element animation off and rely on the default page transition. If a specific reveal order matters, create and validate `animations.json` before export instead of relying only on `-a auto`.",
    "Only after the skill link exists, install Python requirements if needed: `pip install -r .doya/skills/ppt-master/requirements.txt`.",
    "",
    "User request:",
    input.prompt,
    "",
    "Canvas format: ppt169",
    `Source file count: ${input.sourceFileCount}`,
    "If source files are attached, the daemon writes them into `attachments/` and includes their paths in the structured attachment text. Use those workspace paths as PPT Master source files.",
    "",
    "Run the PPT Master pipeline end to end:",
    "source_to_md -> project_manager init/import-sources -> Strategist design_spec/spec_lock -> sequential SVG pages -> svg_quality_checker -> total_md_split -> finalize_svg -> svg_to_pptx.",
    "",
    "The output must be a native editable PPTX in `projects/<project>/exports/`.",
    "Do not create a screenshot-only deck.",
    "Do not explain internal commands in the final reply unless a blocking error occurs.",
    "Final reply: only provide the PPTX path and optional preview path.",
  ];
  return lines.join("\n");
}

function buildHomeDocumentCreationPrompt(input: {
  kind: "pdf" | "word" | "spreadsheet";
  prompt: string;
  sourceFileCount: number;
}): string {
  const config = {
    pdf: {
      surface: "PDF document",
      skill: "PDF/document generation",
      output: "PDF",
      directory: "output/documents/",
      extension: ".pdf",
      example: "[output/documents/report.pdf](output/documents/report.pdf)",
    },
    word: {
      surface: "Word document",
      skill: "document generation",
      output: "DOCX",
      directory: "output/documents/",
      extension: ".docx",
      example: "[output/documents/report.docx](output/documents/report.docx)",
    },
    spreadsheet: {
      surface: "spreadsheet",
      skill: "spreadsheet generation",
      output: "XLSX workbook",
      directory: "output/spreadsheets/",
      extension: ".xlsx",
      example: "[output/spreadsheets/workbook.xlsx](output/spreadsheets/workbook.xlsx)",
    },
  }[input.kind];
  const lines = [
    `You are creating a ${config.surface} for the Doya AI Creation surface.`,
    `Use the agent's available built-in ${config.skill} skill or workflow. Codex and Claude Code both have default capabilities for this artifact type; choose the appropriate one for the current provider.`,
    "This is an AI creation surface. Do not explain your reasoning, workflow, skill usage, shell commands, or implementation steps in the final conversation.",
    "If you must send progress text while creating, keep it to one short user-facing sentence in Chinese.",
    "",
    "User request:",
    input.prompt,
    "",
    `Source file count: ${input.sourceFileCount}`,
    "If source files are attached, the daemon writes them into `attachments/` and includes their paths in the structured attachment text. Use those workspace paths as source materials.",
    "",
    `Create a real ${config.output} file, not a screenshot or placeholder.`,
    `Write the final file under \`${config.directory}\` with a \`${config.extension}\` extension.`,
    "Use a clear, filesystem-safe file name based on the user's request.",
    "When the final file is saved, reply with Markdown file-link syntax only, using the workspace-relative path.",
    `Example final reply: ${config.example}`,
  ];
  return lines.join("\n");
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: RIGHT_PANEL_BACKGROUND,
  },
  homeHeader: {
    backgroundColor: RIGHT_PANEL_BACKGROUND,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0, 0, 0, 0.07)",
  },
  homeHeaderRow: {
    position: "relative",
    height: HEADER_INNER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  homeHeaderLeft: {
    width: 160,
    flexDirection: "row",
    alignItems: "center",
  },
  homeHeaderRight: {
    width: 220,
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  homeHeaderTitleGroup: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  homeHeaderTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 22,
    fontWeight: theme.fontWeight.medium,
  },
  homeHeaderSubtitle: {
    color: "rgba(0, 0, 0, 0.2)",
    fontSize: 10,
    lineHeight: 16,
    letterSpacing: 0.12,
    fontWeight: theme.fontWeight.medium,
  },
  homeHeaderIconButton: {
    width: 36,
    height: 36,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  homeHeaderIconButtonActive: {
    backgroundColor: "rgba(0, 0, 0, 0.045)",
  },
  headerIconMotionLayer: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  downloadButton: {
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 11,
    paddingRight: 13,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.08)",
    borderRadius: theme.borderRadius.xl,
    backgroundColor: RIGHT_PANEL_BACKGROUND,
  },
  downloadButtonActive: {
    borderColor: "rgba(0, 0, 0, 0.14)",
    backgroundColor: "#ffffff",
    ...theme.shadow.sm,
  },
  downloadButtonMotionLayer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
  },
  downloadButtonText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 22,
    fontWeight: theme.fontWeight.medium,
  },
  downloadButtonTextActive: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 22,
    fontWeight: theme.fontWeight.medium,
  },
  comingSoonToastIcon: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fef3c7",
  },
  shareModalHeaderIcon: {
    width: 36,
    height: 36,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#dbeafe",
  },
  shareModalContent: {
    position: "relative",
    gap: theme.spacing[4],
  },
  fireworksLayer: {
    position: "absolute",
    zIndex: 5,
    width: 1,
    height: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  fireworkParticle: {
    position: "absolute",
  },
  shareHeroCard: {
    height: 178,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#eef2ff",
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.12)",
  },
  shareHeroImage: {
    width: "100%",
    height: "100%",
  },
  shareHeroBadge: {
    position: "absolute",
    left: theme.spacing[3],
    bottom: theme.spacing[3],
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.full,
    backgroundColor: "rgba(255, 255, 255, 0.88)",
  },
  shareHeroBadgeText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  shareIntro: {
    gap: theme.spacing[1],
  },
  shareIntroTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    lineHeight: 26,
    fontWeight: theme.fontWeight.semibold,
  },
  shareIntroText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 22,
  },
  shareLinkCard: {
    position: "relative",
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.xl,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.08)",
    ...theme.shadow.sm,
  },
  shareLinkIcon: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#dcfce7",
  },
  shareLinkTextGroup: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  shareLinkLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 18,
  },
  shareMenuLink: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  shareCopyButton: {
    position: "relative",
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.full,
    backgroundColor: "#2563eb",
    overflow: "visible",
  },
  shareCopyButtonActive: {
    backgroundColor: "#1d4ed8",
    ...theme.shadow.sm,
  },
  shareCopyButtonMotionLayer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
  },
  shareCopyText: {
    color: "#ffffff",
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  shareFeatureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  shareFeaturePill: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1.5],
    borderRadius: theme.borderRadius.full,
    backgroundColor: "#eef2ff",
  },
  shareFeaturePillText: {
    color: "#4f46e5",
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  shareFeaturePillAccent: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1.5],
    borderRadius: theme.borderRadius.full,
    backgroundColor: "#ecfdf5",
  },
  shareFeaturePillAccentText: {
    color: "#059669",
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 0,
  },
  hero: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[12],
  },
  heroInner: {
    width: "100%",
    maxWidth: HOME_CONTENT_WIDTH,
    alignItems: "center",
  },
  heroTitle: {
    alignSelf: "flex-start",
    color: "#5b21b6",
    fontSize: 30,
    lineHeight: 44,
    fontWeight: theme.fontWeight.semibold,
    marginBottom: 0,
    ...(isWeb
      ? ({
          backgroundImage:
            "linear-gradient(90deg, #15803D 0%, #FACC15 32%, #0EA5E9 68%, #F97316 100%)",
          backgroundSize: "240% 100%",
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          animation: `${HOME_TITLE_GRADIENT_ANIMATION_NAME} 6.5s ease-in-out infinite`,
        } as object)
      : {}),
  },
  promptSuggestionGrid: {
    width: "100%",
    marginTop: theme.spacing[8],
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    alignItems: "flex-start",
  },
  promptSuggestionPill: {
    minHeight: 48,
    maxWidth: "100%",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[1.5],
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: "rgba(255, 255, 255, 0.86)",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    overflow: "visible",
  },
  promptSuggestionPillDisabled: {
    opacity: theme.opacity[50],
  },
  promptSuggestionMotionLayer: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    maxWidth: "100%",
  },
  promptSuggestionIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  promptSuggestionIconImage: {
    width: "100%",
    height: "100%",
  },
  promptSuggestionText: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 22,
    fontWeight: theme.fontWeight.normal,
  },
  composerDock: {
    width: "100%",
    alignItems: "center",
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[4],
  },
  centered: {
    width: "100%",
    maxWidth: HOME_CONTENT_WIDTH,
  },
}));

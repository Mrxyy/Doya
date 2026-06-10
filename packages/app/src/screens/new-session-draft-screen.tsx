import { useCallback, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import {
  createAccountProject,
  saveAccountBootstrapSession,
  type AccountBootstrapSession,
} from "@/account/account-api";
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
import { useIsCompactFormFactor, MAX_CONTENT_WIDTH } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { useI18n } from "@/i18n/i18n";
import type { TranslationKey, TranslationParams } from "@/i18n/translations";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { buildWorkspaceDraftAgentConfig } from "@/screens/workspace/workspace-draft-agent-config";
import { normalizeWorkspaceDescriptor, useSessionStore } from "@/stores/session-store";
import { saveAiCreationMessageDisplayMetadata } from "@/stores/ai-creation-message-display-store";
import { buildOptimisticUserMessage, generateMessageId } from "@/types/stream";
import { encodeImages } from "@/utils/encode-images";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import { ScreenHeader } from "@/components/headers/screen-header";

const MAX_SESSION_TITLE_LENGTH = 60;

export function NewSessionDraftScreen({
  serverId,
  accountSession,
}: {
  serverId: string;
  accountSession: AccountBootstrapSession;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const isCompact = useIsCompactFormFactor();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const mergeWorkspaces = useSessionStore((state) => state.mergeWorkspaces);
  const setHasHydratedWorkspaces = useSessionStore((state) => state.setHasHydratedWorkspaces);
  const appendOptimisticUserMessageToAgentStream = useSessionStore(
    (state) => state.appendOptimisticUserMessageToAgentStream,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const draft = useAgentInputDraft({
    draftKey: `new-session:${serverId}`,
    composer: {
      initialServerId: serverId,
      isVisible: true,
      onlineServerIds: isConnected ? [serverId] : [],
      initialValues: {
        provider: "codex",
        ...(accountSession.workspace.runtime?.cwd
          ? { workingDir: accountSession.workspace.runtime.cwd }
          : {}),
      },
      lockedWorkingDir: accountSession.workspace.runtime?.cwd,
    },
  });
  const composerState = draft.composerState;
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
    async (payload: MessagePayload) => {
      if (!client || !isConnected || !composerState) {
        toast.error(t("openProject.error.openProjectDaemon"));
        return;
      }
      const provider = composerState.selectedProvider;
      if (!provider) {
        toast.error(t("openProject.error.selectModel"));
        return;
      }
      const text = payload.text.trim();
      if (!text && payload.attachments.length === 0) {
        return;
      }
      setIsSubmitting(true);
      try {
        const sessionTitle = buildNewSessionTitle({
          text,
          attachments: payload.attachments,
          fallback: t("account.project.defaultName"),
          t,
        });
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

        const openPayload = await client.openProject(project.cwd);
        if (openPayload.error || !openPayload.workspace) {
          throw new Error(openPayload.error ?? t("openProject.error.createProject"));
        }
        const workspace = applyAccountProjectDisplay({
          workspace: normalizeWorkspaceDescriptor(openPayload.workspace),
          session: nextSession,
          project,
        });
        mergeWorkspaces(serverId, [workspace]);
        setHasHydratedWorkspaces(serverId, true);

        const wirePayload = await splitComposerAttachmentsForSubmit(payload.attachments, {
          materializeImages: (images) =>
            materializeWorkspaceImageAttachmentsForSubmit({
              client,
              cwd: workspace.workspaceDirectory,
              images,
            }),
          materializeFiles: (files) =>
            materializeWorkspaceFileAttachments({
              client,
              cwd: workspace.workspaceDirectory,
              files,
            }),
        });
        const images = await encodeImages(wirePayload.images);
        const clientMessageId = generateMessageId();
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
        const agent = await client.createAgent({
          config,
          workspaceId: workspace.id,
          ...(text ? { initialPrompt: text } : {}),
          clientMessageId,
          ...(images && images.length > 0 ? { images } : {}),
          ...(wirePayload.attachments.length > 0 ? { attachments: wirePayload.attachments } : {}),
        });
        await saveAiCreationMessageDisplayMetadata({
          serverId,
          agentId: agent.id,
          messageId: clientMessageId,
          text,
          metadata: {
            images: wirePayload.displayImages,
            displayAttachments: wirePayload.displayAttachments,
          },
        }).catch((error) => {
          console.warn("[NewSessionDraft] Failed to persist message display metadata", error);
        });
        appendOptimisticUserMessageToAgentStream(
          serverId,
          agent.id,
          buildOptimisticUserMessage({
            id: clientMessageId,
            text,
            timestamp: new Date(),
            images: wirePayload.displayImages,
            attachments: wirePayload.attachments,
            displayAttachments: wirePayload.displayAttachments,
          }),
          { placement: "tail" },
        );
        await composerState.persistFormPreferences();
        draft.clear("sent");
        router.replace(buildHostAgentDetailRoute(serverId, agent.id));
      } catch (error) {
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
      isConnected,
      mergeWorkspaces,
      serverId,
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

  return (
    <FileDropZone onFilesDropped={handleFilesDropped}>
      <View style={styles.container}>
        {isCompact ? <ScreenHeader left={mobileHeaderLeft} borderless /> : null}
        <View style={styles.content}>
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
              cwd={accountSession.workspace.runtime?.cwd ?? ""}
              clearDraft={draft.clear}
              onAddImages={handleAddImagesCallback}
              autoFocus
              commandDraftConfig={composerState?.commandDraftConfig}
              agentControls={agentControlsWithDisabled}
            />
          </View>
        </View>
      </View>
    </FileDropZone>
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

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[4],
  },
  centered: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
  },
}));

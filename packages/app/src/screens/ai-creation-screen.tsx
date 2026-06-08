import { Buffer } from "buffer";
import { useRouter } from "expo-router";
import {
  ArrowUp,
  Download,
  ImagePlus,
  Mic,
  MoreHorizontal,
  Paperclip,
  Redo2,
  Share2,
  Sparkles,
  Undo2,
  WandSparkles,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PressableStateCallbackType,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import {
  createAccountProject,
  saveAccountBootstrapSession,
  type AccountBootstrapSession,
} from "@/account/account-api";
import { applyAccountProjectDisplay } from "@/account/account-workspace-display";
import { useAccountWorkspaceMetadata } from "@/account/use-account-workspace-metadata";
import {
  persistAttachmentFromBlob,
  persistAttachmentFromDataUrl,
  persistAttachmentFromFileUri,
} from "@/attachments/service";
import type { AttachmentMetadata } from "@/attachments/types";
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";
import { pickAndPersistImages } from "@/composer/actions";
import { useAgentInputDraft } from "@/composer/draft/input-draft";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { buildWorkspaceDraftAgentConfig } from "@/screens/workspace/workspace-draft-agent-config";
import { takeAiCreationEditSource } from "@/stores/ai-creation-edit-source-store";
import { useLastWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import {
  normalizeWorkspaceDescriptor,
  useSessionStore,
  type WorkspaceDescriptor,
} from "@/stores/session-store";
import { useRecommendedProjectPaths, useWorkspaceFields } from "@/stores/session-store-hooks";
import { buildAiCreationTitle } from "@/utils/ai-creation-display";
import { encodeImages } from "@/utils/encode-images";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import { useImageAttachmentPicker } from "@/hooks/use-image-attachment-picker";
import { buildOptimisticUserMessage, generateMessageId } from "@/types/stream";

type CreationMode = "image" | "edit";
type AspectRatio = "1:1" | "3:4" | "4:3" | "16:9" | "9:16";
type VisualStyle = "auto" | "photo" | "illustration" | "poster" | "product";

interface SelectionPoint {
  x: number;
  y: number;
}

interface SelectionStroke {
  points: SelectionPoint[];
  width: number;
}

interface CanvasLayout {
  width: number;
  height: number;
}

interface InitialAiCreationEditState {
  mode: CreationMode;
  references: AttachmentMetadata[];
  previewUri: string | null;
  sourceAgentId: string | null;
  sourceServerId: string | null;
}

interface EncodedAiCreationImages {
  images?: Array<{ data: string; mimeType: string; fileName?: string }>;
  hasSelectionMask: boolean;
}

interface AiCreationWorkspace {
  cwd: string;
  workspaceId: string;
}

interface CreateAiCreationWorkspaceInput {
  accountSession: AccountBootstrapSession | null;
  client: Pick<DaemonClient, "openProject">;
  displayName: string;
  mergeWorkspaces: (serverId: string, workspaces: Iterable<WorkspaceDescriptor>) => void;
  serverId: string;
  setHasHydratedWorkspaces: (serverId: string, hydrated: boolean) => void;
}

const FEATURE_CARDS = [
  {
    id: "draw",
    title: "AI 抠图",
    image: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=320&h=220&fit=crop",
  },
  {
    id: "erase",
    title: "擦除",
    image: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=320&h=220&fit=crop",
  },
  {
    id: "region",
    title: "区域重绘",
    image: "https://images.unsplash.com/photo-1496449903678-68ddcb189a24?w=320&h=220&fit=crop",
  },
  {
    id: "expand",
    title: "扩图",
    image: "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=320&h=220&fit=crop",
  },
  {
    id: "enhance",
    title: "变清晰",
    image: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=320&h=220&fit=crop",
  },
] as const;

const GALLERY_ITEMS = [
  "https://images.unsplash.com/photo-1494526585095-c41746248156?w=720&h=920&fit=crop",
  "https://images.unsplash.com/photo-1518791841217-8f162f1e1131?w=720&h=920&fit=crop",
  "https://images.unsplash.com/photo-1524230572899-a752b3835840?w=720&h=920&fit=crop",
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=720&h=920&fit=crop",
  "https://images.unsplash.com/photo-1493558103817-58b2924bce98?w=720&h=920&fit=crop",
  "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=720&h=720&fit=crop",
  "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=720&h=720&fit=crop",
  "https://images.unsplash.com/photo-1481349518771-20055b2a7b24?w=720&h=720&fit=crop",
] as const;

const MODE_OPTIONS = [
  { value: "image" as const, label: "图像" },
  { value: "edit" as const, label: "编辑" },
];

const RATIO_OPTIONS: AspectRatio[] = ["1:1", "3:4", "4:3", "16:9", "9:16"];
const MASK_VIEWBOX_SIZE = 1000;
const SELECTION_BRUSH_SIZE_MIN = 18;
const SELECTION_BRUSH_SIZE_MAX = 110;
const SELECTION_BRUSH_SIZE_DEFAULT = 58;

const STYLE_LABELS: Record<VisualStyle, string> = {
  auto: "自动",
  photo: "写实",
  illustration: "插画",
  poster: "海报",
  product: "产品",
};

const IMAGE_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/svg+xml": "svg",
};

export function AiCreationScreen({ serverId }: { serverId: string }) {
  const router = useRouter();
  const { theme } = useUnistyles();
  const toast = useToast();
  const isCompact = useIsCompactFormFactor();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const accountSession = useAccountWorkspaceMetadata(serverId);
  const mergeWorkspaces = useSessionStore((state) => state.mergeWorkspaces);
  const setHasHydratedWorkspaces = useSessionStore((state) => state.setHasHydratedWorkspaces);
  const appendOptimisticUserMessageToAgentStream = useSessionStore(
    (state) => state.appendOptimisticUserMessageToAgentStream,
  );
  const { pickImages } = useImageAttachmentPicker();
  const lastWorkspaceSelection = useLastWorkspaceSelection();
  const selectedWorkspaceId =
    lastWorkspaceSelection?.serverId === serverId ? lastWorkspaceSelection.workspaceId : null;
  const selectedWorkspace = useWorkspaceFields(serverId, selectedWorkspaceId, (workspace) => ({
    id: workspace.id,
    workspaceDirectory: workspace.workspaceDirectory,
  }));
  const recommendedProjectPaths = useRecommendedProjectPaths(serverId);
  const creationCwd = selectedWorkspace?.workspaceDirectory ?? recommendedProjectPaths[0] ?? "";
  const composerInitialValues = useMemo(
    () => ({
      provider: "codex" as const,
      ...(creationCwd ? { workingDir: creationCwd } : {}),
    }),
    [creationCwd],
  );
  const [initialEditState] = useState(takeInitialAiCreationEditState);
  const [mode, setMode] = useState<CreationMode>(initialEditState.mode);
  const [ratio, setRatio] = useState<AspectRatio>("1:1");
  const [style, setStyle] = useState<VisualStyle>("auto");
  const [references, setReferences] = useState<AttachmentMetadata[]>(initialEditState.references);
  const [conversationEditImages, setConversationEditImages] = useState<AttachmentMetadata[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectionStrokes, setSelectionStrokes] = useState<SelectionStroke[]>([]);
  const [redoSelectionStrokes, setRedoSelectionStrokes] = useState<SelectionStroke[]>([]);
  const [selectionBrushSize, setSelectionBrushSize] = useState(SELECTION_BRUSH_SIZE_DEFAULT);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const editImage = mode === "edit" ? (references[0] ?? null) : null;
  const editTargetAgentId =
    mode === "edit" && initialEditState.sourceServerId === serverId
      ? initialEditState.sourceAgentId
      : null;
  const draft = useAgentInputDraft({
    draftKey: `ai-creation:${serverId}`,
    composer: {
      initialServerId: serverId,
      isVisible: true,
      onlineServerIds: isConnected ? [serverId] : [],
      initialValues: composerInitialValues,
      lockedWorkingDir: creationCwd || undefined,
    },
  });
  const prompt = draft.text;
  const setPrompt = draft.setText;
  const composerState = draft.composerState;
  const selectedProvider = composerState?.selectedProvider ?? "";
  const selectedModel = composerState?.selectedModel ?? "";
  const conversationEditTitle = getConversationEditTitle(initialEditState.references[0]);
  const selectionPreviewUri = initialEditState.previewUri ?? undefined;

  const handleSelectModel = useCallback(
    (provider: AgentProvider, modelId: string) => {
      composerState?.setProviderAndModelFromUser(provider, modelId);
    },
    [composerState],
  );

  const handlePickReference = useCallback(async () => {
    const images = await pickAndPersistImages({
      pickImages,
      persister: {
        persistFromBlob: ({ blob, mimeType, fileName }) =>
          persistAttachmentFromBlob({ blob, mimeType, fileName }),
        persistFromFileUri: ({ uri, mimeType, fileName }) =>
          persistAttachmentFromFileUri({ uri, mimeType, fileName }),
      },
    });
    if (images.length === 0) return;
    setReferences((current) => [...current, ...images]);
  }, [pickImages]);

  const handlePickEditImage = useCallback(async () => {
    const images = await pickAndPersistImages({
      pickImages,
      persister: {
        persistFromBlob: ({ blob, mimeType, fileName }) =>
          persistAttachmentFromBlob({ blob, mimeType, fileName }),
        persistFromFileUri: ({ uri, mimeType, fileName }) =>
          persistAttachmentFromFileUri({ uri, mimeType, fileName }),
      },
    });
    const image = images[0];
    if (!image) return;
    setReferences([image]);
    setSelectionStrokes([]);
    setRedoSelectionStrokes([]);
    setMode("edit");
  }, [pickImages]);

  const handlePickConversationEditImage = useCallback(async () => {
    const images = await pickAndPersistImages({
      pickImages,
      persister: {
        persistFromBlob: ({ blob, mimeType, fileName }) =>
          persistAttachmentFromBlob({ blob, mimeType, fileName }),
        persistFromFileUri: ({ uri, mimeType, fileName }) =>
          persistAttachmentFromFileUri({ uri, mimeType, fileName }),
      },
    });
    if (images.length === 0) return;
    setConversationEditImages((current) => [...current, ...images]);
  }, [pickImages]);

  const handleRemoveReference = useCallback((id: string) => {
    setReferences((current) => current.filter((image) => image.id !== id));
  }, []);

  const handleRemoveConversationEditImage = useCallback((id: string) => {
    setConversationEditImages((current) => current.filter((image) => image.id !== id));
  }, []);

  const handleChangeMode = useCallback((nextMode: CreationMode) => {
    setMode(nextMode);
  }, []);

  const handleToggleSelectionMode = useCallback(() => {
    setMode("edit");
    setSelectionMode((current) => !current);
  }, []);

  const handleChangeSelectionStrokes = useCallback((nextStrokes: SelectionStroke[]) => {
    setSelectionStrokes(nextStrokes);
    setRedoSelectionStrokes([]);
  }, []);

  const handleUndoSelection = useCallback(() => {
    setSelectionStrokes((current) => {
      const lastStroke = current[current.length - 1];
      if (!lastStroke) return current;
      setRedoSelectionStrokes((redoCurrent) => [lastStroke, ...redoCurrent]);
      return current.slice(0, -1);
    });
  }, []);

  const handleRedoSelection = useCallback(() => {
    setRedoSelectionStrokes((current) => {
      const [nextStroke, ...rest] = current;
      if (!nextStroke) return current;
      setSelectionStrokes((strokesCurrent) => [...strokesCurrent, nextStroke]);
      return rest;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectionStrokes([]);
    setRedoSelectionStrokes([]);
  }, []);
  const handleCloseConversationEdit = useCallback(() => {
    if (editTargetAgentId) {
      router.push(buildHostAgentDetailRoute(serverId, editTargetAgentId));
      return;
    }
    router.back();
  }, [editTargetAgentId, router, serverId]);

  const canSubmit =
    prompt.trim().length > 0 &&
    Boolean(client) &&
    isConnected &&
    Boolean(composerState) &&
    (mode === "image" || Boolean(editImage));

  const handleCreate = useCallback(async () => {
    if (!client || !composerState) return;
    const provider = composerState.selectedProvider;
    if (!provider && !editTargetAgentId) {
      toast.error("Select a Codex model first.");
      return;
    }
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;

    setIsSubmitting(true);
    try {
      const title = buildAiCreationTitle({ mode, prompt: trimmedPrompt });
      const clientMessageId = generateMessageId();
      const submittedReferences = references;
      const submittedEditImage = editImage;
      const { images, hasSelectionMask } = await encodeAiCreationImagesForSubmit({
        mode,
        references,
        conversationEditImages: editTargetAgentId ? conversationEditImages : [],
        selectionStrokes,
      });
      const initialPrompt = buildAiCreationPrompt({
        mode,
        prompt: trimmedPrompt,
        ratio,
        style,
        referenceCount: references.length,
        extraImageCount: editTargetAgentId ? conversationEditImages.length : 0,
        hasSelectionMask,
      });

      if (editTargetAgentId) {
        appendOptimisticUserMessageToAgentStream(
          serverId,
          editTargetAgentId,
          buildOptimisticUserMessage({
            id: clientMessageId,
            text: buildAiCreationUserMessageText({ mode, prompt: trimmedPrompt }),
            timestamp: new Date(),
            images: conversationEditImages,
            selectionPreviewUri,
          }),
          { placement: "active-head" },
        );
        await client.sendAgentMessage(editTargetAgentId, initialPrompt, {
          messageId: clientMessageId,
          ...(images && images.length > 0 ? { images } : {}),
        });
        await composerState.persistFormPreferences();
        draft.clear("sent");
        setSelectionStrokes([]);
        setRedoSelectionStrokes([]);
        setConversationEditImages([]);
        setSelectionMode(false);
        router.push(buildHostAgentDetailRoute(serverId, editTargetAgentId));
        return;
      }

      const workspace = await createAiCreationWorkspace({
        accountSession,
        client,
        displayName: title,
        mergeWorkspaces,
        serverId,
        setHasHydratedWorkspaces,
      });
      const config = buildWorkspaceDraftAgentConfig({
        provider: provider ?? "codex",
        cwd: workspace.cwd,
        title,
        ...(composerState.modeOptions.length > 0 && composerState.selectedMode
          ? { modeId: composerState.selectedMode }
          : {}),
        model: composerState.effectiveModelId || undefined,
        thinkingOptionId: composerState.effectiveThinkingOptionId || undefined,
        featureValues: composerState.featureValues,
      });
      const result = await client.createAgent({
        config,
        workspaceId: workspace.workspaceId,
        initialPrompt,
        clientMessageId,
        ...(images && images.length > 0 ? { images } : {}),
        labels: { surface: "ai_creation", intent: mode === "edit" ? "image_edit" : "imagegen" },
      });
      const optimisticImages =
        mode === "edit" ? buildEditOptimisticImages(submittedEditImage, []) : submittedReferences;
      appendOptimisticUserMessageToAgentStream(
        serverId,
        result.id,
        buildOptimisticUserMessage({
          id: clientMessageId,
          text: buildAiCreationUserMessageText({ mode, prompt: trimmedPrompt }),
          timestamp: new Date(),
          images: optimisticImages,
          selectionPreviewUri: mode === "edit" ? selectionPreviewUri : undefined,
        }),
        { placement: "tail" },
      );
      await composerState.persistFormPreferences();
      draft.clear("sent");
      setReferences([]);
      setConversationEditImages([]);
      setSelectionStrokes([]);
      setRedoSelectionStrokes([]);
      setSelectionMode(false);
      router.push(buildHostAgentDetailRoute(serverId, result.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start AI creation.");
    } finally {
      setIsSubmitting(false);
    }
  }, [
    client,
    composerState,
    accountSession,
    appendOptimisticUserMessageToAgentStream,
    draft,
    editImage,
    editTargetAgentId,
    conversationEditImages,
    mergeWorkspaces,
    prompt,
    ratio,
    references,
    router,
    serverId,
    setHasHydratedWorkspaces,
    style,
    toast,
    mode,
    selectionStrokes,
    selectionPreviewUri,
  ]);

  const modelSelector = composerState ? (
    <CombinedModelSelector
      providers={composerState.modelSelectorProviders}
      selectedProvider={selectedProvider}
      selectedModel={selectedModel}
      onSelect={handleSelectModel}
      isLoading={composerState.isAllModelsLoading}
      onOpen={composerState.refetchProviderModelsIfStale}
      onRetryProvider={composerState.refreshProviderModels}
      isRetryingProvider={composerState.isProviderModelsRefreshing}
      serverId={serverId}
      renderTrigger={({ selectedModelLabel }) => (
        <View style={styles.modelTrigger}>
          <Sparkles size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
          <Text style={styles.modelTriggerText} numberOfLines={1}>
            {selectedModelLabel}
          </Text>
        </View>
      )}
    />
  ) : null;

  if (editTargetAgentId) {
    return (
      <View style={styles.conversationEditRoot}>
        <View style={styles.conversationEditTopBar}>
          <View style={styles.conversationEditTopLeft}>
            <Pressable
              style={styles.conversationEditIconButton}
              onPress={handleCloseConversationEdit}
              accessibilityRole="button"
              accessibilityLabel="Close image editor"
            >
              <X size={theme.iconSize.md} color={theme.colors.foreground} />
            </Pressable>
            <Text style={styles.conversationEditTitle} numberOfLines={1}>
              {conversationEditTitle}
            </Text>
          </View>
          <View style={styles.conversationEditTopActions}>
            <Button
              variant={selectionMode ? "secondary" : "ghost"}
              size="sm"
              leftIcon={WandSparkles}
              onPress={handleToggleSelectionMode}
              disabled={!editImage}
            >
              Select
            </Button>
            <ChoiceStrip
              label="Aspect ratio"
              value={ratio}
              options={RATIO_OPTIONS}
              onChange={setRatio}
            />
            <View style={styles.conversationEditDivider} />
            <Button variant="default" size="sm" leftIcon={Share2}>
              Share
            </Button>
            <Pressable
              style={styles.conversationEditIconButton}
              accessibilityRole="button"
              accessibilityLabel="Download image"
            >
              <Download size={theme.iconSize.md} color={theme.colors.foreground} />
            </Pressable>
            <Pressable
              style={styles.conversationEditIconButton}
              accessibilityRole="button"
              accessibilityLabel="More image actions"
            >
              <MoreHorizontal size={theme.iconSize.md} color={theme.colors.foreground} />
            </Pressable>
          </View>
        </View>
        {selectionMode ? (
          <SelectionBrushToolbar
            brushSize={selectionBrushSize}
            canUndo={selectionStrokes.length > 0}
            canRedo={redoSelectionStrokes.length > 0}
            canClear={selectionStrokes.length > 0}
            onChangeBrushSize={setSelectionBrushSize}
            onUndo={handleUndoSelection}
            onRedo={handleRedoSelection}
            onClear={handleClearSelection}
          />
        ) : null}
        <View style={styles.conversationEditContent}>
          <View style={styles.conversationEditStage}>
            <EditCanvas
              image={editImage}
              selectionMode={selectionMode}
              strokes={selectionStrokes}
              brushSize={selectionBrushSize}
              onChangeStrokes={handleChangeSelectionStrokes}
              onPickImage={handlePickEditImage}
              variant="conversation"
            />
          </View>
          <View style={styles.conversationEditComposer}>
            <TextInput
              nativeID="ai-creation-prompt"
              value={prompt}
              onChangeText={setPrompt}
              placeholder="Describe edits"
              placeholderTextColor={theme.colors.foregroundMuted}
              multiline
              style={styles.conversationEditPromptInput}
              textAlignVertical="top"
            />
            {conversationEditImages.length > 0 ? (
              <View style={styles.referenceRow}>
                {conversationEditImages.map((image) => (
                  <ReferenceThumb
                    key={image.id}
                    image={image}
                    onRemove={handleRemoveConversationEditImage}
                  />
                ))}
              </View>
            ) : null}
            <View style={styles.conversationEditComposerToolbar}>
              <Pressable
                style={styles.conversationEditAddButton}
                onPress={handlePickConversationEditImage}
                accessibilityRole="button"
                accessibilityLabel="Upload image"
              >
                <Text style={styles.conversationEditAddText}>+</Text>
              </Pressable>
              <View style={styles.toolbarSpacer} />
              {modelSelector}
              <Pressable
                style={styles.micButton}
                accessibilityRole="button"
                accessibilityLabel="Voice prompt"
              >
                <Mic size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
              </Pressable>
              <Button
                variant="default"
                size="sm"
                disabled={!canSubmit || isSubmitting}
                loading={isSubmitting}
                onPress={handleCreate}
                leftIcon={ArrowUp}
                style={styles.conversationEditSubmitButton}
                testID="ai-creation-submit"
              />
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {isCompact ? <MenuHeader title="AI 创作" /> : null}
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Text style={styles.title}>AI 创作</Text>
          <Text style={styles.subtitle}>让创作随灵感而生</Text>

          {mode === "edit" ? (
            <EditCanvas
              image={editImage}
              selectionMode={selectionMode}
              strokes={selectionStrokes}
              brushSize={selectionBrushSize}
              onChangeStrokes={handleChangeSelectionStrokes}
              onPickImage={handlePickEditImage}
            />
          ) : null}

          <View style={styles.composer} testID="ai-creation-composer">
            <TextInput
              nativeID="ai-creation-prompt"
              value={prompt}
              onChangeText={setPrompt}
              placeholder={mode === "edit" ? "Describe edits" : "描述你想要的图片"}
              placeholderTextColor={theme.colors.foregroundMuted}
              multiline
              style={styles.promptInput}
              textAlignVertical="top"
            />
            {references.length > 0 ? (
              <View style={styles.referenceRow}>
                {references.map((image) => (
                  <ReferenceThumb key={image.id} image={image} onRemove={handleRemoveReference} />
                ))}
              </View>
            ) : null}
            <View style={styles.toolbar}>
              <SegmentedControl
                value={mode}
                onValueChange={handleChangeMode}
                options={MODE_OPTIONS}
                size="sm"
                testID="ai-creation-mode"
              />
              <Button
                variant="ghost"
                size="sm"
                onPress={mode === "edit" ? handlePickEditImage : handlePickReference}
                leftIcon={mode === "edit" ? ImagePlus : Paperclip}
              >
                {mode === "edit" ? "原图" : "参考图"}
              </Button>
              {mode === "edit" ? (
                <Button
                  variant={selectionMode ? "secondary" : "ghost"}
                  size="sm"
                  leftIcon={WandSparkles}
                  onPress={handleToggleSelectionMode}
                  disabled={!editImage}
                >
                  Select
                </Button>
              ) : null}
              {mode === "edit" && selectionStrokes.length > 0 ? (
                <Button variant="ghost" size="sm" onPress={handleClearSelection}>
                  Clear
                </Button>
              ) : null}
              <ChoiceStrip
                label={mode === "edit" ? "Aspect ratio" : "比例"}
                value={ratio}
                options={RATIO_OPTIONS}
                onChange={setRatio}
              />
              {mode === "image" ? (
                <ChoiceStrip
                  label="风格"
                  value={STYLE_LABELS[style]}
                  options={Object.keys(STYLE_LABELS) as VisualStyle[]}
                  getLabel={(value) => STYLE_LABELS[value]}
                  onChange={(nextStyle) => setStyle(nextStyle)}
                />
              ) : null}
              <View style={styles.toolbarSpacer} />
              {modelSelector}
              <Pressable
                style={styles.micButton}
                accessibilityRole="button"
                accessibilityLabel="Voice prompt"
              >
                <Mic size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
              </Pressable>
            </View>
          </View>

          <Button
            variant="default"
            size="md"
            disabled={!canSubmit || isSubmitting}
            loading={isSubmitting}
            onPress={handleCreate}
            leftIcon={WandSparkles}
            testID="ai-creation-submit"
          >
            {mode === "edit" ? "开始编辑" : "开始创作"}
          </Button>
        </View>

        {mode === "image" ? (
          <View style={styles.featureGrid}>
            {FEATURE_CARDS.map((card) => (
              <Pressable
                key={card.id}
                style={featureCardStyle}
                onPress={() => {
                  setMode("edit");
                }}
                accessibilityRole="button"
              >
                <Text style={styles.featureTitle}>{card.title}</Text>
                <Image source={{ uri: card.image }} style={styles.featureImage} />
              </Pressable>
            ))}
          </View>
        ) : null}

        {mode === "image" ? (
          <View style={styles.gallery}>
            {GALLERY_ITEMS.map((uri, index) => (
              <Image
                key={uri}
                source={{ uri }}
                style={[styles.galleryImage, index % 3 === 1 ? styles.galleryImageTall : null]}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function EditCanvas({
  image,
  selectionMode,
  strokes,
  brushSize,
  onChangeStrokes,
  onPickImage,
  variant = "default",
}: {
  image: AttachmentMetadata | null;
  selectionMode: boolean;
  strokes: SelectionStroke[];
  brushSize: number;
  onChangeStrokes: (strokes: SelectionStroke[]) => void;
  onPickImage: () => void;
  variant?: "default" | "conversation";
}) {
  const uri = useAttachmentPreviewUrl(image);
  const [containerLayout, setContainerLayout] = useState<CanvasLayout>({ width: 0, height: 0 });
  const [canvasLayout, setCanvasLayout] = useState<CanvasLayout>({ width: 0, height: 0 });
  const [imageAspectRatio, setImageAspectRatio] = useState<number | null>(null);
  const [draftStroke, setDraftStroke] = useState<SelectionStroke>({
    points: [],
    width: brushSize,
  });
  const allStrokes =
    draftStroke.points.length > 0 ? [...strokes, { ...draftStroke, width: brushSize }] : strokes;
  const imageSource = useMemo(() => (uri ? { uri } : null), [uri]);
  const fittedConversationImageSize = useMemo(() => {
    if (variant !== "conversation" || !imageAspectRatio) return null;
    return fitAspectRatioWithinBox({
      aspectRatio: imageAspectRatio,
      boxWidth: containerLayout.width,
      boxHeight: containerLayout.height,
    });
  }, [containerLayout.height, containerLayout.width, imageAspectRatio, variant]);
  const imageFrameStyle = useMemo(
    () => [
      variant === "conversation" ? styles.conversationEditImageFrame : styles.editImageFrame,
      fittedConversationImageSize ?? (imageAspectRatio ? { aspectRatio: imageAspectRatio } : null),
    ],
    [fittedConversationImageSize, imageAspectRatio, variant],
  );

  useEffect(() => {
    if (!uri) {
      setImageAspectRatio(null);
      return;
    }
    let cancelled = false;
    Image.getSize(uri, (width, height) => {
      if (!cancelled && width > 0 && height > 0) {
        setImageAspectRatio(width / height);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  const handleCanvasLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setCanvasLayout({ width, height });
  }, []);
  const handleContainerLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setContainerLayout({ width, height });
  }, []);
  const pointFromEvent = useCallback(
    (event: GestureResponderEvent): SelectionPoint | null => {
      if (canvasLayout.width <= 0 || canvasLayout.height <= 0) {
        return null;
      }
      const { locationX, locationY } = event.nativeEvent;
      return {
        x: clamp(locationX / canvasLayout.width, 0, 1),
        y: clamp(locationY / canvasLayout.height, 0, 1),
      };
    },
    [canvasLayout.height, canvasLayout.width],
  );
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => selectionMode,
        onMoveShouldSetPanResponder: () => selectionMode,
        onPanResponderGrant: (event) => {
          const point = pointFromEvent(event);
          setDraftStroke({ points: point ? [point] : [], width: brushSize });
        },
        onPanResponderMove: (event) => {
          const point = pointFromEvent(event);
          if (!point) return;
          setDraftStroke((current) => ({
            points: [...current.points, point],
            width: brushSize,
          }));
        },
        onPanResponderRelease: () => {
          setDraftStroke((current) => {
            if (current.points.length > 1) {
              onChangeStrokes([...strokes, current]);
            }
            return { points: [], width: brushSize };
          });
        },
        onPanResponderTerminate: () => {
          setDraftStroke({ points: [], width: brushSize });
        },
      }),
    [brushSize, onChangeStrokes, pointFromEvent, selectionMode, strokes],
  );
  return (
    <View
      style={variant === "conversation" ? styles.conversationEditCanvas : styles.editStage}
      onLayout={handleContainerLayout}
    >
      {imageSource ? (
        <View style={imageFrameStyle} onLayout={handleCanvasLayout}>
          <Image source={imageSource} style={styles.editImage} resizeMode="contain" />
          <View
            style={styles.selectionOverlay}
            pointerEvents={selectionMode ? "auto" : "none"}
            {...panResponder.panHandlers}
          >
            {allStrokes.length > 0 ? (
              <Svg
                style={styles.selectionCanvas}
                viewBox={`0 0 ${MASK_VIEWBOX_SIZE} ${MASK_VIEWBOX_SIZE}`}
                preserveAspectRatio="none"
              >
                {allStrokes.map((stroke) => (
                  <Path
                    key={selectionStrokeKey(stroke)}
                    d={selectionStrokePath(stroke)}
                    fill="none"
                    stroke={styles.selectionStroke.color}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={stroke.width}
                  />
                ))}
              </Svg>
            ) : null}
          </View>
        </View>
      ) : (
        <Pressable style={styles.editUploadTarget} onPress={onPickImage} accessibilityRole="button">
          <ImagePlus size={28} color={styles.editUploadIcon.color} />
          <Text style={styles.editUploadText}>上传一张图片开始编辑</Text>
        </Pressable>
      )}
    </View>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fitAspectRatioWithinBox({
  aspectRatio,
  boxWidth,
  boxHeight,
}: {
  aspectRatio: number;
  boxWidth: number;
  boxHeight: number;
}): CanvasLayout | null {
  if (aspectRatio <= 0 || boxWidth <= 0 || boxHeight <= 0) {
    return null;
  }
  const boxAspectRatio = boxWidth / boxHeight;
  if (boxAspectRatio > aspectRatio) {
    const height = boxHeight;
    return { width: height * aspectRatio, height };
  }
  const width = boxWidth;
  return { width, height: width / aspectRatio };
}

function selectionCoordinate(value: number): number {
  return Math.round(clamp(value, 0, 1) * MASK_VIEWBOX_SIZE);
}

function selectionStrokePath(stroke: SelectionStroke): string {
  const [first, ...rest] = stroke.points;
  if (!first) {
    return "";
  }
  const head = `M ${selectionCoordinate(first.x)} ${selectionCoordinate(first.y)}`;
  const tail = rest
    .map((point) => `L ${selectionCoordinate(point.x)} ${selectionCoordinate(point.y)}`)
    .join(" ");
  return tail ? `${head} ${tail}` : head;
}

function selectionStrokeKey(stroke: SelectionStroke): string {
  const first = stroke.points[0];
  const last = stroke.points[stroke.points.length - 1];
  return `${stroke.points.length}:${stroke.width}:${first ? selectionCoordinate(first.x) : 0}:${first ? selectionCoordinate(first.y) : 0}:${last ? selectionCoordinate(last.x) : 0}:${last ? selectionCoordinate(last.y) : 0}`;
}

function selectionMaskSvg(strokes: SelectionStroke[]): string {
  const paths = strokes
    .map((stroke) => ({ path: selectionStrokePath(stroke), width: stroke.width }))
    .filter((stroke) => stroke.path.length > 0)
    .map(
      (stroke) =>
        `<path d="${stroke.path}" fill="none" stroke="white" stroke-linecap="round" stroke-linejoin="round" stroke-width="${stroke.width}"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${MASK_VIEWBOX_SIZE}" height="${MASK_VIEWBOX_SIZE}" viewBox="0 0 ${MASK_VIEWBOX_SIZE} ${MASK_VIEWBOX_SIZE}"><rect width="100%" height="100%" fill="black"/>${paths}</svg>`;
}

async function createSelectionMaskAttachment(
  strokes: SelectionStroke[],
): Promise<AttachmentMetadata | null> {
  if (strokes.length === 0) {
    return null;
  }
  const svg = selectionMaskSvg(strokes);
  const base64 = Buffer.from(svg, "utf8").toString("base64");
  return await persistAttachmentFromDataUrl({
    dataUrl: `data:image/svg+xml;base64,${base64}`,
    mimeType: "image/svg+xml",
    fileName: "selection-mask.svg",
  });
}

async function encodeAiCreationImagesForSubmit(input: {
  mode: CreationMode;
  references: AttachmentMetadata[];
  conversationEditImages: AttachmentMetadata[];
  selectionStrokes: SelectionStroke[];
}): Promise<EncodedAiCreationImages> {
  const selectionMask =
    input.mode === "edit" && input.selectionStrokes.length > 0
      ? await createSelectionMaskAttachment(input.selectionStrokes)
      : null;
  const imageInputs =
    input.mode === "edit"
      ? buildImageEditInputs(input.references[0], selectionMask, input.conversationEditImages)
      : input.references.map((reference, index) =>
          withAttachmentFileName(reference, `ai-reference-${index + 1}`),
        );
  return {
    images: await encodeImages(imageInputs),
    hasSelectionMask: selectionMask !== null,
  };
}

function buildImageEditInputs(
  sourceImage: AttachmentMetadata | undefined,
  selectionMask: AttachmentMetadata | null,
  extraImages: AttachmentMetadata[],
): AttachmentMetadata[] {
  if (!sourceImage) {
    return [];
  }
  const inputs = [withAttachmentFileName(sourceImage, "ai-edit-source")];
  if (selectionMask) {
    inputs.push(withAttachmentFileName(selectionMask, "ai-edit-selection-mask"));
  }
  inputs.push(
    ...extraImages.map((image, index) =>
      withAttachmentFileName(image, `ai-edit-reference-${index + 1}`),
    ),
  );
  return inputs;
}

function withAttachmentFileName(
  attachment: AttachmentMetadata,
  baseName: string,
): AttachmentMetadata {
  return {
    ...attachment,
    fileName: `${baseName}.${getAttachmentExtension(attachment)}`,
  };
}

function getAttachmentExtension(attachment: AttachmentMetadata): string {
  const fromMimeType = IMAGE_EXTENSION_BY_MIME_TYPE[attachment.mimeType.toLowerCase()];
  if (fromMimeType) {
    return fromMimeType;
  }
  const fileName = attachment.fileName?.trim();
  const extension = fileName?.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase();
  return extension || "png";
}

function takeInitialAiCreationEditState(): InitialAiCreationEditState {
  const source = takeAiCreationEditSource();
  if (!source) {
    return {
      mode: "image",
      references: [],
      previewUri: null,
      sourceAgentId: null,
      sourceServerId: null,
    };
  }
  return {
    mode: "edit",
    references: [source.image],
    previewUri: source.previewUri,
    sourceAgentId: source.sourceAgentId,
    sourceServerId: source.sourceServerId,
  };
}

function getConversationEditTitle(image: AttachmentMetadata | undefined): string {
  const fileName = image?.fileName?.trim();
  if (!fileName) {
    return "编辑图片";
  }
  return fileName.replace(/\.[A-Za-z0-9]+$/, "") || "编辑图片";
}

async function createAiCreationWorkspace(
  input: CreateAiCreationWorkspaceInput,
): Promise<AiCreationWorkspace> {
  if (!input.accountSession) {
    throw new Error("请先登录 Paseo 账号后再使用 AI 创作。");
  }
  const project = await createAccountProject({
    userId: input.accountSession.user.userId,
    workspaceId: input.accountSession.workspace.workspaceId,
    accessToken: input.accountSession.accessToken,
    displayName: input.displayName,
  });
  const nextSession = {
    ...input.accountSession,
    projects: [
      ...input.accountSession.projects.filter((item) => item.projectId !== project.projectId),
      project,
    ],
  };
  await saveAccountBootstrapSession(nextSession);

  const payload = await input.client.openProject(project.cwd);
  if (payload.error || !payload.workspace) {
    throw new Error(payload.error ?? "创建 AI 创作工作区失败。");
  }

  const workspace = applyAccountProjectDisplay({
    workspace: normalizeWorkspaceDescriptor(payload.workspace),
    session: nextSession,
    project,
  });
  input.mergeWorkspaces(input.serverId, [workspace]);
  input.setHasHydratedWorkspaces(input.serverId, true);

  const cwd = workspace.workspaceDirectory.trim();
  if (!cwd) {
    throw new Error("AI 创作工作区缺少可用目录。");
  }
  return { cwd, workspaceId: workspace.id };
}

function buildAiCreationPrompt(input: {
  mode: CreationMode;
  prompt: string;
  ratio: AspectRatio;
  style: VisualStyle;
  referenceCount: number;
  extraImageCount: number;
  hasSelectionMask: boolean;
}): string {
  if (input.mode === "edit") {
    return buildImageEditPrompt({
      prompt: input.prompt,
      ratio: input.ratio,
      style: input.style,
      extraImageCount: input.extraImageCount,
      hasSelectionMask: input.hasSelectionMask,
    });
  }
  return buildImagegenPrompt({
    prompt: input.prompt,
    ratio: input.ratio,
    style: input.style,
    referenceCount: input.referenceCount,
  });
}

function buildImagegenPrompt(input: {
  prompt: string;
  ratio: AspectRatio;
  style: VisualStyle;
  referenceCount: number;
}): string {
  const lines = [
    "Use the Codex imagegen skill for this request. Follow the default built-in image_gen workflow unless the user explicitly asks for a CLI fallback.",
    "This is an AI creation surface. Do not explain your reasoning, workflow, skill usage, shell commands, or implementation steps in the final conversation.",
    "Reply only with the generated image result when available. If you must send text while generating, keep it to one short user-facing sentence in Chinese.",
    "",
    "Create a raster image from this prompt:",
    input.prompt,
    "",
    `Aspect ratio: ${input.ratio}`,
    `Style: ${STYLE_LABELS[input.style]}`,
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

function buildImageEditPrompt(input: {
  prompt: string;
  ratio: AspectRatio;
  style: VisualStyle;
  extraImageCount: number;
  hasSelectionMask: boolean;
}): string {
  const lines = [
    "Use the Codex imagegen skill for this request. Follow the default built-in image_gen workflow unless the user explicitly asks for a CLI fallback.",
    "This is an AI creation surface. Do not explain your reasoning, workflow, skill usage, shell commands, or implementation steps in the final conversation.",
    "Reply only with the edited image result when available. If you must send text while editing, keep it to one short user-facing sentence in Chinese.",
    "",
    "Edit the attached image with this instruction:",
    input.prompt,
    "",
    `Aspect ratio: ${input.ratio}`,
    `Style guidance: ${STYLE_LABELS[input.style]}`,
    "Use only the image attached in this turn as `ai-edit-source.*` as the source image. It is the exact latest image to edit.",
    "Do not inspect the temp attachment directory to choose a different image. Do not use any earlier image from the conversation as the edit source.",
    "Preserve all unrelated parts of the original image.",
    "Save the final image into the current workspace if a workspace-bound asset is produced.",
    "When the final image is saved, reply with Markdown image syntax only, using the workspace-relative path, for example: ![](assets/edited-image.png)",
  ];
  if (input.hasSelectionMask) {
    lines.splice(
      11,
      0,
      "A second attached image named `ai-edit-selection-mask.svg` is a mask only, never the source image. White strokes mark the editable region; black means preserve unchanged. Only modify the selected region unless the user's instruction explicitly requires a matching boundary adjustment.",
    );
  } else {
    lines.splice(
      11,
      0,
      "No explicit selection mask is attached, so make the smallest visual change needed to satisfy the instruction.",
    );
  }
  if (input.extraImageCount > 0) {
    lines.splice(
      12,
      0,
      `Additional images attached as \`ai-edit-reference-*.png\` are message attachments/reference images only. Do not replace the edit source with them; use them only if the user asks to reference, match, compare, or borrow details from the uploaded image. Reference image count: ${input.extraImageCount}.`,
    );
  }
  return lines.join("\n");
}

function buildAiCreationUserMessageText(input: { mode: CreationMode; prompt: string }): string {
  return input.mode === "edit" ? `编辑图片：${input.prompt}` : input.prompt;
}

function buildEditOptimisticImages(
  image: AttachmentMetadata | null,
  extraImages: AttachmentMetadata[],
): AttachmentMetadata[] {
  return image ? [image, ...extraImages] : extraImages;
}

function SelectionBrushToolbar({
  brushSize,
  canUndo,
  canRedo,
  canClear,
  onChangeBrushSize,
  onUndo,
  onRedo,
  onClear,
}: {
  brushSize: number;
  canUndo: boolean;
  canRedo: boolean;
  canClear: boolean;
  onChangeBrushSize: (size: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}) {
  return (
    <View style={styles.selectionToolbar}>
      <View style={styles.selectionBrushPreviewSmall} />
      <BrushSizeControl value={brushSize} onChange={onChangeBrushSize} />
      <View
        style={[
          styles.selectionBrushPreviewLarge,
          {
            width: Math.round(brushSize / 3),
            height: Math.round(brushSize / 3),
            borderRadius: Math.round(brushSize / 6),
          },
        ]}
      />
      <View style={styles.selectionToolbarDivider} />
      <SelectionToolButton
        icon={Undo2}
        disabled={!canUndo}
        onPress={onUndo}
        accessibilityLabel="Undo selection stroke"
      />
      <SelectionToolButton
        icon={Redo2}
        disabled={!canRedo}
        onPress={onRedo}
        accessibilityLabel="Redo selection stroke"
      />
      <View style={styles.selectionToolbarDivider} />
      <Pressable
        style={styles.selectionClearButton}
        disabled={!canClear}
        onPress={onClear}
        accessibilityRole="button"
        accessibilityLabel="Clear selection"
      >
        <Text style={[styles.selectionClearText, !canClear ? styles.selectionToolDisabled : null]}>
          清空
        </Text>
      </Pressable>
    </View>
  );
}

function BrushSizeControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (size: number) => void;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const progress =
    (value - SELECTION_BRUSH_SIZE_MIN) / (SELECTION_BRUSH_SIZE_MAX - SELECTION_BRUSH_SIZE_MIN);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  }, []);
  const updateFromLocation = useCallback(
    (locationX: number) => {
      if (trackWidth <= 0) return;
      const nextProgress = clamp(locationX / trackWidth, 0, 1);
      onChange(
        Math.round(
          SELECTION_BRUSH_SIZE_MIN +
            nextProgress * (SELECTION_BRUSH_SIZE_MAX - SELECTION_BRUSH_SIZE_MIN),
        ),
      );
    },
    [onChange, trackWidth],
  );
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          updateFromLocation(event.nativeEvent.locationX);
        },
        onPanResponderMove: (event) => {
          updateFromLocation(event.nativeEvent.locationX);
        },
      }),
    [updateFromLocation],
  );
  return (
    <View
      style={styles.selectionBrushSlider}
      onLayout={handleLayout}
      accessibilityRole="adjustable"
      accessibilityLabel="Brush size"
      {...panResponder.panHandlers}
    >
      <View style={styles.selectionBrushTrack} />
      <View
        style={[
          styles.selectionBrushTrackFill,
          { width: `${Math.round(clamp(progress, 0, 1) * 100)}%` },
        ]}
      />
      <View
        style={[
          styles.selectionBrushThumb,
          { left: `${Math.round(clamp(progress, 0, 1) * 100)}%` },
        ]}
      />
    </View>
  );
}

function SelectionToolButton({
  icon: Icon,
  disabled,
  onPress,
  accessibilityLabel,
}: {
  icon: typeof Undo2;
  disabled: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const { theme } = useUnistyles();
  return (
    <Pressable
      style={styles.selectionToolButton}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Icon
        size={theme.iconSize.md}
        color={disabled ? theme.colors.foregroundMuted : theme.colors.foreground}
      />
    </Pressable>
  );
}

function ChoiceStrip<T extends string>({
  label,
  value,
  options,
  getLabel,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly T[];
  getLabel?: (value: T) => string;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const handleToggle = useCallback(() => setOpen((current) => !current), []);
  return (
    <View style={styles.choiceGroup}>
      <Pressable style={chipStyle} onPress={handleToggle} accessibilityRole="button">
        <Text style={styles.chipText}>{`${label} ${value}`}</Text>
      </Pressable>
      {open ? (
        <View style={styles.choicePopover}>
          {options.map((option) => {
            const optionLabel = getLabel ? getLabel(option) : option;
            return (
              <Pressable
                key={option}
                style={chipStyle}
                onPress={() => {
                  onChange(option);
                  setOpen(false);
                }}
              >
                <Text style={styles.chipText}>{optionLabel}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function ReferenceThumb({
  image,
  onRemove,
}: {
  image: AttachmentMetadata;
  onRemove: (id: string) => void;
}) {
  const uri = useAttachmentPreviewUrl(image);
  const handleRemove = useCallback(() => onRemove(image.id), [image.id, onRemove]);
  if (!uri) {
    return <View style={styles.referenceThumbPlaceholder} />;
  }
  return (
    <Pressable onPress={handleRemove} style={styles.referenceThumb} accessibilityRole="button">
      <Image source={{ uri }} style={styles.referenceThumbImage} />
    </Pressable>
  );
}

function chipStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.chip, Boolean(hovered) && styles.chipHovered, pressed && styles.chipPressed];
}

function featureCardStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    styles.featureCard,
    Boolean(hovered) && styles.featureCardHovered,
    pressed && styles.chipPressed,
  ];
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  conversationEditRoot: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  conversationEditTopBar: {
    minHeight: 64,
    borderBottomWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[4],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  selectionToolbar: {
    minHeight: 48,
    borderBottomWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  selectionBrushPreviewSmall: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: theme.borderWidth[2],
    borderColor: theme.colors.foreground,
  },
  selectionBrushPreviewLarge: {
    borderWidth: theme.borderWidth[2],
    borderColor: theme.colors.foreground,
    backgroundColor: "transparent",
  },
  selectionBrushSlider: {
    width: 150,
    height: 32,
    justifyContent: "center",
  },
  selectionBrushTrack: {
    height: 4,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
  },
  selectionBrushTrackFill: {
    position: "absolute",
    left: 0,
    height: 4,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foreground,
  },
  selectionBrushThumb: {
    position: "absolute",
    width: 28,
    height: 28,
    marginLeft: -14,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface0,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    shadowColor: theme.colors.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  selectionToolbarDivider: {
    width: theme.borderWidth[1],
    height: 28,
    backgroundColor: theme.colors.border,
  },
  selectionToolButton: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  selectionClearButton: {
    minHeight: 32,
    justifyContent: "center",
    paddingHorizontal: theme.spacing[2],
  },
  selectionClearText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  selectionToolDisabled: {
    color: theme.colors.foregroundMuted,
    opacity: theme.opacity[50],
  },
  conversationEditTopActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  conversationEditTopLeft: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  conversationEditTitle: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  conversationEditDivider: {
    width: theme.borderWidth[1],
    height: 32,
    backgroundColor: theme.colors.border,
    marginHorizontal: theme.spacing[1],
  },
  conversationEditIconButton: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  conversationEditContent: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: theme.spacing[6],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[4],
    gap: theme.spacing[3],
    overflow: "hidden",
  },
  conversationEditStage: {
    width: "100%",
    maxWidth: 1360,
    flex: 1,
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  conversationEditCanvas: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  conversationEditImageFrame: {
    position: "relative",
    overflow: "hidden",
  },
  conversationEditComposer: {
    width: "100%",
    maxWidth: 1120,
    flexShrink: 0,
    borderRadius: theme.borderRadius["2xl"],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface1,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[4],
    gap: theme.spacing[3],
  },
  conversationEditPromptInput: {
    minHeight: 44,
    maxHeight: 160,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
    ...(isWeb
      ? ({
          outlineStyle: "none",
          outlineWidth: 0,
          outlineColor: "transparent",
        } as object)
      : {}),
  },
  conversationEditComposerToolbar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing[2],
    justifyContent: "space-between",
    marginHorizontal: -6,
  },
  conversationEditSubmitButton: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  conversationEditAddButton: {
    width: 36,
    height: 36,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  conversationEditAddText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xl,
    lineHeight: theme.lineHeight.xl,
  },
  scrollContent: {
    alignItems: "center",
    paddingHorizontal: theme.spacing[6],
    paddingTop: theme.spacing[8],
    paddingBottom: theme.spacing[12],
  },
  hero: {
    width: "100%",
    maxWidth: 960,
    alignItems: "center",
    gap: theme.spacing[4],
  },
  title: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  subtitle: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
  composer: {
    width: "100%",
    minHeight: 142,
    borderRadius: theme.borderRadius.xl,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  promptInput: {
    minHeight: 58,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  editStage: {
    width: "100%",
    maxWidth: 1180,
    minHeight: 420,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
    overflow: "hidden",
  },
  editImageFrame: {
    width: "100%",
    maxWidth: 760,
    minHeight: 320,
    position: "relative",
    overflow: "hidden",
  },
  editImage: {
    width: "100%",
    height: "100%",
  },
  selectionOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  selectionCanvas: {
    width: "100%",
    height: "100%",
  },
  selectionStroke: {
    color: theme.colors.accent,
  },
  editUploadTarget: {
    minHeight: 320,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
  },
  editUploadIcon: {
    color: theme.colors.foregroundMuted,
  },
  editUploadText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  referenceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  referenceThumb: {
    width: 48,
    height: 48,
    borderRadius: theme.borderRadius.md,
    overflow: "hidden",
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  referenceThumbImage: {
    width: "100%",
    height: "100%",
  },
  referenceThumbPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  toolbarSpacer: {
    flexGrow: 1,
  },
  micButton: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
  },
  choiceGroup: {
    position: "relative",
  },
  choicePopover: {
    position: "absolute",
    top: 42,
    left: 0,
    zIndex: 20,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[2],
    gap: theme.spacing[1],
    minWidth: 110,
  },
  chip: {
    minHeight: 34,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface1,
  },
  chipHovered: {
    backgroundColor: theme.colors.surface2,
  },
  chipPressed: {
    opacity: 0.85,
  },
  chipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  modelTrigger: {
    minHeight: 34,
    maxWidth: 180,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: theme.spacing[1.5],
    backgroundColor: theme.colors.surface0,
  },
  modelTriggerText: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  featureGrid: {
    width: "100%",
    maxWidth: 960,
    marginTop: theme.spacing[8],
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  featureCard: {
    flexGrow: 1,
    flexBasis: 160,
    minHeight: 70,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: theme.spacing[4],
  },
  featureCardHovered: {
    backgroundColor: theme.colors.surface2,
  },
  featureTitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  featureImage: {
    width: 70,
    height: 70,
  },
  gallery: {
    width: "100%",
    maxWidth: 1320,
    marginTop: theme.spacing[6],
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1],
  },
  galleryImage: {
    flexGrow: 1,
    flexBasis: 260,
    height: 260,
    borderRadius: theme.borderRadius.md,
  },
  galleryImageTall: {
    height: 360,
  },
}));

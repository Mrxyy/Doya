import {
  View,
  Pressable,
  Text,
  ActivityIndicator,
  Image,
  type PressableStateCallbackType,
} from "react-native";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  memo,
  type ReactElement,
  type ReactNode,
} from "react";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useShallow } from "zustand/shallow";
import {
  ArrowUp,
  Square,
  Pencil,
  AudioLines,
  CircleDot,
  GitPullRequest,
  Github,
  Paperclip,
  FileText,
  FileImage,
  PanelsTopLeft,
  Presentation,
  Table2,
  X,
  Palette,
  ChevronDown,
  Sparkles,
} from "lucide-react-native";
import Animated from "react-native-reanimated";
import { FOOTER_HEIGHT, MAX_CONTENT_WIDTH } from "@/constants/layout";
import {
  AgentControls,
  DraftAgentControls,
  type DraftAgentControlsProps,
} from "@/composer/agent-controls";
import { ContextWindowMeter } from "@/components/context-window-meter";
import { useImageAttachmentPicker } from "@/hooks/use-image-attachment-picker";
import { useFileAttachmentPicker } from "@/hooks/use-file-attachment-picker";
import { useSessionStore } from "@/stores/session-store";
import { MessageInput, type MessageInputRef, type AttachmentMenuItem } from "./input/input";
import type { ImageAttachment, MessagePayload } from "./types";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import type { DraftCommandConfig } from "@/hooks/use-agent-commands-query";
import { encodeImages } from "@/utils/encode-images";
import { focusWithRetries } from "@/utils/web-focus";
import {
  cancelComposerAgent,
  dispatchComposerAgentMessage,
  editQueuedComposerMessage,
  findGithubItemByOption,
  isAttachmentSelectedForGithubItem,
  openComposerAttachment,
  pickAndPersistImages,
  queueComposerMessage,
  removeComposerAttachmentAtIndex,
  sendQueuedComposerMessageNow,
  toggleGithubAttachmentFromPicker,
  type AgentStreamWriter,
  type QueueWriter,
  type QueuedComposerMessage,
} from "@/composer/actions";
import { useVoiceOptional } from "@/contexts/voice-context";
import { useToast } from "@/contexts/toast-context";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Shortcut } from "@/components/ui/shortcut";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { AutocompletePopover } from "@/components/ui/autocomplete-popover";
import { useAgentAutocomplete } from "@/hooks/use-agent-autocomplete";
import {
  useHostRuntimeAgentDirectoryStatus,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
} from "@/runtime/host-runtime";
import {
  deleteAttachments,
  persistAttachmentFromBlob,
  persistAttachmentFromFileUri,
  resolveAttachmentPreviewUrl,
} from "@/attachments/service";
import { resolveAgentControlsMode } from "@/composer/agent-controls/mode";
import { useKeyboardShiftStyle } from "@/hooks/use-keyboard-shift-style";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import type { MessageInputKeyboardActionKind } from "@/keyboard/actions";
import { submitAgentInput } from "@/composer/submit";
import { useAppSettings } from "@/hooks/use-settings";
import { isWeb, isNative } from "@/constants/platform";
import type { GitHubSearchItem } from "@getdoya/protocol/messages";
import type {
  AttachmentMetadata,
  ComposerAttachment,
  UserComposerAttachment,
  WorkspaceComposerAttachment,
} from "@/attachments/types";
import { composerWorkspaceAttachment } from "@/composer/attachments/workspace";
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { AttachmentPill } from "@/components/attachment-pill";
import { AttachmentLightbox } from "@/components/attachment-lightbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { openExternalUrl } from "@/utils/open-external-url";
import { useIsDictationReady } from "@/hooks/use-is-dictation-ready";
import { useGithubSearchQuery } from "@/git/use-github-search-query";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import { useComposerGithubAutoAttach } from "./github/auto-attach";
import { resolveClientSlashCommand, type ClientSlashCommand } from "@/client-slash-commands";
import { translateNow } from "@/i18n/i18n";
import type { TranslationKey } from "@/i18n/translations";
import {
  AI_CREATION_STYLE_OPTIONS,
  aiCreationUsesAspectRatio,
  getAiCreationRatioOptions,
  type AiCreationAspectRatio,
  type AiCreationSurfaceMode,
  type AiCreationVisualStyle,
  type AiCreationVisualStyleOption,
} from "@/ai-creation/options";
import type { ComposerAiCreationPromptContext } from "@/ai-creation/composer-prompt";

type QueuedMessage = QueuedComposerMessage;

type AttachmentListUpdater =
  | UserComposerAttachment[]
  | ((prev: UserComposerAttachment[]) => UserComposerAttachment[]);

function noop() {}

function resolveComposerButtonIconSize(): number {
  return isWeb ? ICON_SIZE.md : ICON_SIZE.lg;
}

function resolveIsComposerLocked(
  submitBehavior: "clear" | "preserve-and-lock",
  isSubmitLoading: boolean,
): boolean {
  return submitBehavior === "preserve-and-lock" && isSubmitLoading;
}

function resolveIsVoiceModeForAgent(
  voice: ReturnType<typeof useVoiceOptional>,
  serverId: string,
  agentId: string,
): boolean {
  return voice?.isVoiceModeForAgent(serverId, agentId) ?? false;
}

function resolveKeyboardPriority(isMessageInputFocused: boolean): number {
  return isMessageInputFocused ? 200 : 100;
}

function resolveIsDesktopWebBreakpoint(isMobile: boolean): boolean {
  return isWeb && !isMobile;
}

function resolveMessagePlaceholder(isDesktopWebBreakpoint: boolean): string {
  return isDesktopWebBreakpoint
    ? translateNow("composer.placeholder.desktop")
    : translateNow("composer.placeholder.mobile");
}

function resolveGithubSearchEnabled(
  isGithubPickerOpen: boolean,
  isConnected: boolean,
  cwd: string,
): boolean {
  return isGithubPickerOpen && isConnected && cwd.trim().length > 0;
}

function resolveCheckoutRemoteUrl(
  checkoutStatus: ReturnType<typeof useCheckoutStatusQuery>["status"],
): string | null {
  return checkoutStatus?.remoteUrl ?? null;
}

function buildCancelButtonStyle(isConnected: boolean, isCancellingAgent: boolean): object[] {
  const disabled = !isConnected || isCancellingAgent ? styles.buttonDisabled : undefined;
  return [styles.cancelButton, disabled].filter((value): value is object => Boolean(value));
}

function buildRealtimeVoiceButtonStyle(
  hovered: boolean | undefined,
  voiceButtonDisabled: boolean,
): object[] {
  const hoveredStyle = hovered ? styles.iconButtonHovered : undefined;
  const disabledStyle = voiceButtonDisabled ? styles.buttonDisabled : undefined;
  return [styles.realtimeVoiceButton, hoveredStyle, disabledStyle].filter(
    (value): value is object => Boolean(value),
  );
}

function buildAgentStateSelector(serverId: string, agentId: string) {
  return (state: ReturnType<typeof useSessionStore.getState>) => {
    const agent = state.sessions[serverId]?.agents?.get(agentId) ?? null;
    return {
      status: agent?.status ?? null,
      contextWindowMaxTokens: agent?.lastUsage?.contextWindowMaxTokens ?? null,
      contextWindowUsedTokens: agent?.lastUsage?.contextWindowUsedTokens ?? null,
      totalCostUsd: agent?.lastUsage?.totalCostUsd ?? null,
    };
  };
}

function renderContextWindowMeter(
  contextWindowMaxTokens: number | null,
  contextWindowUsedTokens: number | null,
  totalCostUsd: number | null,
  showPercentage: boolean,
): ReactElement | null {
  if (contextWindowMaxTokens === null || contextWindowUsedTokens === null) {
    return null;
  }
  return (
    <ContextWindowMeter
      maxTokens={contextWindowMaxTokens}
      usedTokens={contextWindowUsedTokens}
      totalCostUsd={totalCostUsd}
      showPercentage={showPercentage}
    />
  );
}

function resolveContextWindowPlacement(
  meter: ReactElement | null,
  isMobile: boolean,
): { beforeVoiceContent: ReactNode; footerInlineContent: ReactNode } {
  if (isMobile) {
    return { beforeVoiceContent: null, footerInlineContent: meter };
  }
  return {
    beforeVoiceContent: <View style={styles.contextWindowMeterSlot}>{meter}</View>,
    footerInlineContent: null,
  };
}

interface RenderLeftContentArgs {
  agentControls: DraftAgentControlsProps | undefined;
  agentId: string;
  serverId: string;
  focusInput: () => void;
  showQuickActions: boolean;
  selectedQuickActionMode: ComposerAiCreationMode | null;
  onSelectQuickActionMode: (mode: ComposerAiCreationMode | null) => void;
  quickActionRatio: ComposerAiCreationRatio;
  onSelectQuickActionRatio: (ratio: ComposerAiCreationRatio) => void;
  quickActionStyle: ComposerAiCreationStyle;
  onSelectQuickActionStyle: (style: ComposerAiCreationStyle) => void;
  onSelectQuickActionReference: () => void;
  onSelectQuickActionMaterial: () => void;
}

function renderLeftContent(args: RenderLeftContentArgs): ReactElement {
  const {
    agentControls,
    agentId,
    serverId,
    focusInput,
    showQuickActions,
    selectedQuickActionMode,
    onSelectQuickActionMode,
    quickActionRatio,
    onSelectQuickActionRatio,
    quickActionStyle,
    onSelectQuickActionStyle,
    onSelectQuickActionReference,
    onSelectQuickActionMaterial,
  } = args;
  const quickActions = showQuickActions ? (
    <ComposerQuickActions
      selectedMode={selectedQuickActionMode}
      onSelectMode={onSelectQuickActionMode}
      ratio={quickActionRatio}
      onSelectRatio={onSelectQuickActionRatio}
      style={quickActionStyle}
      onSelectStyle={onSelectQuickActionStyle}
      onSelectReference={onSelectQuickActionReference}
      onSelectMaterial={onSelectQuickActionMaterial}
    />
  ) : null;

  if (selectedQuickActionMode) {
    return quickActions ?? <View />;
  }

  const controls =
    resolveAgentControlsMode(agentControls) === "draft" && agentControls ? (
      <DraftAgentControls {...agentControls} />
    ) : (
      <AgentControls agentId={agentId} serverId={serverId} onDropdownClose={focusInput} />
    );

  return (
    <>
      {controls}
      {quickActions}
    </>
  );
}

type ComposerAiCreationMode = AiCreationSurfaceMode;
type ComposerAiCreationRatio = AiCreationAspectRatio;
type ComposerAiCreationStyle = AiCreationVisualStyle;

export interface ComposerAiCreationSubmitContext extends Partial<
  Pick<ComposerAiCreationPromptContext, "ratio" | "style">
> {
  mode: ComposerAiCreationMode;
  displayText: string;
}

interface ComposerQuickAction {
  mode: ComposerAiCreationMode;
  labelKey:
    | "composer.quickAction.image"
    | "composer.quickAction.slides"
    | "composer.quickAction.pdf"
    | "composer.quickAction.document"
    | "composer.quickAction.spreadsheet";
  selectedLabelKey:
    | "composer.quickAction.selected.image"
    | "composer.quickAction.selected.slides"
    | "composer.quickAction.selected.pdf"
    | "composer.quickAction.selected.document"
    | "composer.quickAction.selected.spreadsheet";
}

const VISIBLE_QUICK_ACTIONS: readonly ComposerQuickAction[] = [
  {
    mode: "image",
    labelKey: "composer.quickAction.image",
    selectedLabelKey: "composer.quickAction.selected.image",
  },
  {
    mode: "slides",
    labelKey: "composer.quickAction.slides",
    selectedLabelKey: "composer.quickAction.selected.slides",
  },
  {
    mode: "pdf",
    labelKey: "composer.quickAction.pdf",
    selectedLabelKey: "composer.quickAction.selected.pdf",
  },
  {
    mode: "word",
    labelKey: "composer.quickAction.document",
    selectedLabelKey: "composer.quickAction.selected.document",
  },
  {
    mode: "spreadsheet",
    labelKey: "composer.quickAction.spreadsheet",
    selectedLabelKey: "composer.quickAction.selected.spreadsheet",
  },
];

function ComposerQuickActions({
  selectedMode,
  onSelectMode,
  ratio,
  onSelectRatio,
  style,
  onSelectStyle,
  onSelectReference,
  onSelectMaterial,
}: {
  selectedMode: ComposerAiCreationMode | null;
  onSelectMode: (mode: ComposerAiCreationMode | null) => void;
  ratio: ComposerAiCreationRatio;
  onSelectRatio: (ratio: ComposerAiCreationRatio) => void;
  style: ComposerAiCreationStyle;
  onSelectStyle: (style: ComposerAiCreationStyle) => void;
  onSelectReference: () => void;
  onSelectMaterial: () => void;
}) {
  const selectedAction = selectedMode
    ? (VISIBLE_QUICK_ACTIONS.find((action) => action.mode === selectedMode) ?? null)
    : null;
  if (selectedAction) {
    return (
      <ComposerSelectedQuickAction
        action={selectedAction}
        ratio={ratio}
        onSelectRatio={onSelectRatio}
        style={style}
        onSelectStyle={onSelectStyle}
        onSelectReference={onSelectReference}
        onSelectMaterial={onSelectMaterial}
        onClear={onSelectMode}
      />
    );
  }

  return (
    <View style={styles.quickActions}>
      {VISIBLE_QUICK_ACTIONS.map((action) => (
        <ComposerQuickActionButton
          key={action.mode}
          action={action}
          selected={selectedMode === action.mode}
          onSelect={onSelectMode}
        />
      ))}
    </View>
  );
}

function ComposerQuickActionButton({
  action,
  selected,
  onSelect,
}: {
  action: ComposerQuickAction;
  selected: boolean;
  onSelect: (mode: ComposerAiCreationMode | null) => void;
}) {
  const handlePress = useCallback(() => onSelect(action.mode), [action.mode, onSelect]);
  const pressableStyle = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) =>
      quickActionButtonStyle({ ...state, selected }),
    [selected],
  );
  const accessibilityState = useMemo(() => ({ selected }), [selected]);

  return (
    <Pressable
      onPress={handlePress}
      style={pressableStyle}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      accessibilityLabel={translateNow(action.labelKey)}
      testID={`composer-quick-action-${action.mode}`}
    >
      {renderQuickActionIcon(action.mode, ICON_SIZE.md)}
      <Text style={styles.quickActionText}>{translateNow(action.labelKey)}</Text>
    </Pressable>
  );
}

function ComposerSelectedQuickAction({
  action,
  ratio,
  onSelectRatio,
  style,
  onSelectStyle,
  onSelectReference,
  onSelectMaterial,
  onClear,
}: {
  action: ComposerQuickAction;
  ratio: ComposerAiCreationRatio;
  onSelectRatio: (ratio: ComposerAiCreationRatio) => void;
  style: ComposerAiCreationStyle;
  onSelectStyle: (style: ComposerAiCreationStyle) => void;
  onSelectReference: () => void;
  onSelectMaterial: () => void;
  onClear: (mode: ComposerAiCreationMode | null) => void;
}) {
  const handleClear = useCallback(() => onClear(null), [onClear]);
  const clearAccessibilityLabel = translateNow("composer.quickAction.clearSelected");
  const sourceLabel =
    action.mode === "image"
      ? translateNow("aiCreation.source.reference")
      : translateNow("aiCreation.source.material");
  const handleSourcePress = action.mode === "image" ? onSelectReference : onSelectMaterial;

  return (
    <View style={styles.selectedQuickActionRow}>
      <View style={styles.selectedQuickAction}>
        {renderSelectedQuickActionIcon(action.mode, ICON_SIZE.md)}
        <Text style={styles.selectedQuickActionText}>{translateNow(action.selectedLabelKey)}</Text>
        <Pressable
          onPress={handleClear}
          style={selectedQuickActionClearStyle}
          accessibilityRole="button"
          accessibilityLabel={clearAccessibilityLabel}
          testID={`composer-quick-action-clear-${action.mode}`}
        >
          <ThemedX size={ICON_SIZE.md} uniProps={selectedQuickActionIconMapping} />
        </Pressable>
      </View>
      <ComposerQuickActionConfigButton
        label={sourceLabel}
        onPress={handleSourcePress}
        testID={`composer-quick-action-source-${action.mode}`}
      />
      {usesComposerAiCreationAspectRatio(action.mode) ? (
        <ComposerRatioControl mode={action.mode} value={ratio} onSelect={onSelectRatio} />
      ) : null}
      {action.mode === "image" ? (
        <ComposerStyleControl value={style} onSelect={onSelectStyle} />
      ) : null}
    </View>
  );
}

function ComposerQuickActionConfigButton({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={quickActionConfigButtonStyle}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <ThemedPaperclip size={ICON_SIZE.md} uniProps={quickActionConfigIconMapping} />
      <Text style={styles.quickActionConfigText}>{label}</Text>
    </Pressable>
  );
}

function quickActionConfigButtonStyle({
  hovered,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    styles.quickActionConfigButton,
    Boolean(hovered) && styles.quickActionConfigButtonHovered,
  ];
}

function ComposerRatioControl({
  mode,
  value,
  onSelect,
}: {
  mode: ComposerAiCreationMode;
  value: ComposerAiCreationRatio;
  onSelect: (ratio: ComposerAiCreationRatio) => void;
}) {
  const options = getAiCreationRatioOptions(mode);
  const trigger = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) =>
      quickActionConfigButtonStyle(state),
    [],
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        style={trigger}
        accessibilityRole="button"
        accessibilityLabel={translateNow("aiCreation.aspectRatio")}
        testID="composer-quick-action-ratio"
      >
        <ThemedSquare size={ICON_SIZE.md} uniProps={quickActionConfigIconMapping} />
        <Text style={styles.quickActionConfigText}>
          {translateNow("aiCreation.aspectRatio")} {value}
        </Text>
        <ThemedChevronDown size={ICON_SIZE.sm} uniProps={quickActionConfigIconMapping} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" width={180}>
        {options.map((ratio) => (
          <ComposerRatioMenuItem
            key={ratio}
            ratio={ratio}
            selected={ratio === value}
            onSelect={onSelect}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function usesComposerAiCreationAspectRatio(mode: ComposerAiCreationMode): boolean {
  return aiCreationUsesAspectRatio(mode);
}

function ComposerRatioMenuItem({
  ratio,
  selected,
  onSelect,
}: {
  ratio: ComposerAiCreationRatio;
  selected: boolean;
  onSelect: (ratio: ComposerAiCreationRatio) => void;
}) {
  const handleSelect = useCallback(() => onSelect(ratio), [onSelect, ratio]);
  return (
    <DropdownMenuItem selected={selected} showSelectedCheck onSelect={handleSelect}>
      {ratio}
    </DropdownMenuItem>
  );
}

function ComposerStyleControl({
  value,
  onSelect,
}: {
  value: ComposerAiCreationStyle;
  onSelect: (style: ComposerAiCreationStyle) => void;
}) {
  const selectedOption =
    AI_CREATION_STYLE_OPTIONS.find((option) => option.value === value) ??
    AI_CREATION_STYLE_OPTIONS[0]!;
  const trigger = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) =>
      quickActionConfigButtonStyle(state),
    [],
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        style={trigger}
        accessibilityRole="button"
        accessibilityLabel={translateNow("aiCreation.style")}
        testID="composer-quick-action-style"
      >
        <ThemedPalette size={ICON_SIZE.md} uniProps={quickActionConfigIconMapping} />
        <Text style={styles.quickActionConfigText}>
          {translateNow("aiCreation.style")} {translateNow(selectedOption.key)}
        </Text>
        <ThemedChevronDown size={ICON_SIZE.sm} uniProps={quickActionConfigIconMapping} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" width={260} maxHeight={360} scrollable>
        {AI_CREATION_STYLE_OPTIONS.map((styleOption) => (
          <ComposerStyleMenuItem
            key={styleOption.value}
            styleOption={styleOption}
            selected={styleOption.value === value}
            onSelect={onSelect}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ComposerStyleMenuItem({
  styleOption,
  selected,
  onSelect,
}: {
  styleOption: AiCreationVisualStyleOption;
  selected: boolean;
  onSelect: (style: ComposerAiCreationStyle) => void;
}) {
  const handleSelect = useCallback(() => onSelect(styleOption.value), [onSelect, styleOption]);
  const leading = useMemo(
    () =>
      styleOption.source ? (
        <Image source={styleOption.source} style={styles.quickActionStyleOptionImage} />
      ) : (
        <View style={styles.quickActionStyleOptionAuto}>
          <ThemedSparkles size={ICON_SIZE.sm} uniProps={quickActionConfigIconMapping} />
        </View>
      ),
    [styleOption.source],
  );
  return (
    <DropdownMenuItem
      selected={selected}
      showSelectedCheck
      leading={leading}
      onSelect={handleSelect}
    >
      {translateNow(styleOption.key)}
    </DropdownMenuItem>
  );
}

function selectedQuickActionClearStyle({
  hovered,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    styles.selectedQuickActionClear,
    Boolean(hovered) && styles.selectedQuickActionClearHovered,
  ];
}

function quickActionButtonStyle({
  hovered,
  selected,
}: PressableStateCallbackType & { hovered?: boolean; selected: boolean }) {
  return [
    styles.quickActionButton,
    selected && styles.quickActionButtonSelected,
    Boolean(hovered) && styles.iconButtonHovered,
  ];
}

function renderQuickActionIcon(mode: ComposerAiCreationMode, size: number): ReactElement {
  switch (mode) {
    case "slides":
      return <ThemedPresentation size={size} uniProps={iconForegroundMapping} />;
    case "image":
      return <ThemedFileImage size={size} uniProps={iconForegroundMapping} />;
    case "pdf":
      return <ThemedFileText size={size} uniProps={iconForegroundMapping} />;
    case "word":
      return <ThemedPanelsTopLeft size={size} uniProps={iconForegroundMapping} />;
    case "spreadsheet":
      return <ThemedTable2 size={size} uniProps={iconForegroundMapping} />;
  }
}

function renderSelectedQuickActionIcon(mode: ComposerAiCreationMode, size: number): ReactElement {
  switch (mode) {
    case "slides":
      return <ThemedPresentation size={size} uniProps={selectedQuickActionIconMapping} />;
    case "image":
      return <ThemedFileImage size={size} uniProps={selectedQuickActionIconMapping} />;
    case "pdf":
      return <ThemedFileText size={size} uniProps={selectedQuickActionIconMapping} />;
    case "word":
      return <ThemedPanelsTopLeft size={size} uniProps={selectedQuickActionIconMapping} />;
    case "spreadsheet":
      return <ThemedTable2 size={size} uniProps={selectedQuickActionIconMapping} />;
  }
}

const QUICK_ACTION_PLACEHOLDER_KEYS: Record<ComposerAiCreationMode, TranslationKey> = {
  image: "aiCreation.prompt.imagePlaceholder",
  slides: "aiCreation.prompt.slidesPlaceholder",
  pdf: "aiCreation.prompt.pdfPlaceholder",
  word: "aiCreation.prompt.wordPlaceholder",
  spreadsheet: "aiCreation.prompt.spreadsheetPlaceholder",
};

function shouldShowComposerQuickActions(isMobile: boolean): boolean {
  return !isMobile;
}

function resolveComposerPlaceholder(
  mode: ComposerAiCreationMode | null,
  isDesktopWebBreakpoint: boolean,
): string {
  if (mode) {
    return translateNow(QUICK_ACTION_PLACEHOLDER_KEYS[mode]);
  }
  return resolveMessagePlaceholder(isDesktopWebBreakpoint);
}

function buildComposerAiCreationSubmitContext(
  mode: ComposerAiCreationMode | null,
  text: string,
  ratio: ComposerAiCreationRatio,
  style: ComposerAiCreationStyle,
): ComposerAiCreationSubmitContext | undefined {
  const displayText = text.trim();
  if (!mode || !displayText) {
    return undefined;
  }
  return { mode, displayText, ratio, style };
}

interface RenderAttachmentTrayArgs {
  selectedAttachments: ComposerAttachment[];
  isComposerLocked: boolean;
  handleOpenAttachment: (attachment: ComposerAttachment) => void;
  handleRemoveAttachment: (index: number) => void;
}

function renderComposerFooter(
  footer: ReactNode,
  footerInlineContent: ReactNode,
): ReactElement | null {
  if (!footer && !footerInlineContent) return null;
  return (
    <View style={styles.footer}>
      <View style={styles.footerContent}>
        <View style={styles.footerLeft}>
          {footer}
          {footerInlineContent}
        </View>
      </View>
    </View>
  );
}

function renderAttachmentTray(args: RenderAttachmentTrayArgs): ReactElement | null {
  const { selectedAttachments, isComposerLocked, handleOpenAttachment, handleRemoveAttachment } =
    args;
  if (selectedAttachments.length === 0) return null;
  return (
    <View style={styles.attachmentTray} testID="composer-attachment-tray">
      {selectedAttachments.map((attachment, index) =>
        renderComposerAttachmentPill({
          attachment,
          index,
          disabled: isComposerLocked,
          onOpen: handleOpenAttachment,
          onRemove: handleRemoveAttachment,
        }),
      )}
    </View>
  );
}

interface RenderQueueTrackArgs {
  queuedMessages: readonly QueuedMessage[];
  handleEditQueuedMessage: (id: string) => void;
  handleSendQueuedNow: (id: string) => Promise<void>;
}

function renderQueueTrack(args: RenderQueueTrackArgs): ReactElement | null {
  const { queuedMessages, handleEditQueuedMessage, handleSendQueuedNow } = args;
  if (queuedMessages.length === 0) return null;
  return (
    <View style={styles.queueTrack}>
      {queuedMessages.map((item) => (
        <QueuedMessageRow
          key={item.id}
          item={item}
          onEdit={handleEditQueuedMessage}
          onSendNow={handleSendQueuedNow}
        />
      ))}
    </View>
  );
}

interface RenderComposerAttachmentPillArgs {
  attachment: ComposerAttachment;
  index: number;
  disabled: boolean;
  onOpen: (attachment: ComposerAttachment) => void;
  onRemove: (index: number) => void;
}

function renderComposerAttachmentPill(args: RenderComposerAttachmentPillArgs): ReactElement {
  const { attachment, index, disabled, onOpen, onRemove } = args;
  if (attachment.kind === "image") {
    return (
      <ImageAttachmentPill
        key={attachment.metadata.id}
        attachment={attachment}
        index={index}
        disabled={disabled}
        onOpen={onOpen}
        onRemove={onRemove}
      />
    );
  }
  if (attachment.kind === "file") {
    return (
      <FileAttachmentPill
        key={attachment.metadata.id}
        attachment={attachment}
        index={index}
        disabled={disabled}
        onOpen={onOpen}
        onRemove={onRemove}
      />
    );
  }
  if (composerWorkspaceAttachment.is(attachment)) {
    return composerWorkspaceAttachment.renderPill({
      attachment,
      index,
      disabled,
      onOpen,
      onRemove,
    });
  }
  return (
    <GithubAttachmentPill
      key={`${attachment.item.kind}:${attachment.item.number}`}
      attachment={attachment}
      index={index}
      disabled={disabled}
      onOpen={onOpen}
      onRemove={onRemove}
    />
  );
}

function resolveVoiceStartErrorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return null;
}

interface AttemptStartRealtimeVoiceArgs {
  voice: ReturnType<typeof useVoiceOptional>;
  isConnected: boolean;
  hasAgent: boolean;
  serverId: string;
  agentId: string;
  toastErrorRef: { current: (message: string) => void };
}

function attemptStartRealtimeVoice(args: AttemptStartRealtimeVoiceArgs): void {
  const { voice, isConnected, hasAgent, serverId, agentId, toastErrorRef } = args;
  if (!voice || !isConnected || !hasAgent) return;
  if (voice.isVoiceSwitching) return;
  if (voice.isVoiceModeForAgent(serverId, agentId)) return;
  void voice.startVoice(serverId, agentId).catch((error) => {
    console.error("[Composer] Failed to start voice mode", error);
    const message = resolveVoiceStartErrorMessage(error);
    if (message && message.trim().length > 0) {
      toastErrorRef.current(message);
    }
  });
}

function focusMessageInputWithPlatformStrategy(messageInputRef: {
  current: MessageInputRef | null;
}): void {
  if (isNative) {
    messageInputRef.current?.focus();
    return;
  }
  focusWithRetries({
    focus: () => messageInputRef.current?.focus(),
    isFocused: () => {
      const el = messageInputRef.current?.getNativeElement?.() ?? null;
      const active = typeof document !== "undefined" ? document.activeElement : null;
      return Boolean(el) && active === el;
    },
  });
}

interface DispatchComposerKeyboardActionArgs {
  action: KeyboardActionDefinition;
  isPaneFocused: boolean;
  messageInputRef: { current: MessageInputRef | null };
  isAgentRunning: boolean;
  isCancellingAgent: boolean;
  isConnected: boolean;
  handleCancelAgent: () => void;
  focusMessageInputForKeyboardAction: () => void;
}

function dispatchComposerKeyboardAction(args: DispatchComposerKeyboardActionArgs): boolean {
  const {
    action,
    isPaneFocused,
    messageInputRef,
    isAgentRunning,
    isCancellingAgent,
    isConnected,
    handleCancelAgent,
    focusMessageInputForKeyboardAction,
  } = args;
  if (!isPaneFocused) return false;

  if (action.id === "agent.interrupt") {
    if (messageInputRef.current?.runKeyboardAction("dictation-cancel")) return true;
    if (!isAgentRunning || isCancellingAgent || !isConnected) return false;
    handleCancelAgent();
    return true;
  }

  if (action.id === "message-input.focus") {
    focusMessageInputForKeyboardAction();
    return true;
  }

  const passthroughAction = resolveMessageInputPassthroughAction(action.id);
  if (!passthroughAction) return false;
  const result = messageInputRef.current?.runKeyboardAction(passthroughAction);
  if (passthroughAction === "send" || passthroughAction === "dictation-confirm") {
    return result ?? false;
  }
  return true;
}

function resolveMessageInputPassthroughAction(
  actionId: string,
): MessageInputKeyboardActionKind | null {
  switch (actionId) {
    case "message-input.send":
      return "send";
    case "message-input.dictation-confirm":
      return "dictation-confirm";
    case "message-input.dictation-toggle":
      return "dictation-toggle";
    case "message-input.dictation-cancel":
      return "dictation-cancel";
    case "message-input.voice-toggle":
      return "voice-toggle";
    case "message-input.voice-mute-toggle":
      return "voice-mute-toggle";
    default:
      return null;
  }
}

interface QueuedMessageRowProps {
  item: QueuedMessage;
  onEdit: (id: string) => void;
  onSendNow: (id: string) => void;
}

function QueuedMessageRow({ item, onEdit, onSendNow }: QueuedMessageRowProps) {
  const handleEdit = useCallback(() => {
    onEdit(item.id);
  }, [onEdit, item.id]);
  const handleSendNow = useCallback(() => {
    onSendNow(item.id);
  }, [onSendNow, item.id]);
  return (
    <View style={styles.queueItem}>
      <Text style={styles.queueText} numberOfLines={2} ellipsizeMode="tail">
        {item.text}
      </Text>
      <View style={styles.queueActions}>
        <Pressable
          onPress={handleEdit}
          style={styles.queueActionButton}
          accessibilityLabel={translateNow("ui.edit.queued.message.2ujjf4")}
          accessibilityRole="button"
        >
          <ThemedPencil size={ICON_SIZE.sm} uniProps={iconForegroundMapping} />
        </Pressable>
        <Pressable
          onPress={handleSendNow}
          style={QUEUE_SEND_BUTTON_STYLE}
          accessibilityLabel={translateNow("ui.send.queued.message.now.wxlrig")}
          accessibilityRole="button"
        >
          <ThemedArrowUp size={ICON_SIZE.sm} uniProps={iconAccentForegroundMapping} />
        </Pressable>
      </View>
    </View>
  );
}

function ImageAttachmentThumbnail({ image }: { image: ImageAttachment }) {
  const uri = useAttachmentPreviewUrl(image);
  const source = useMemo(() => ({ uri: uri ?? "" }), [uri]);
  if (!uri) {
    return <View style={styles.imageThumbnailPlaceholder} />;
  }
  return <Image source={source} style={styles.imageThumbnail} />;
}

interface ImageAttachmentPillProps {
  attachment: Extract<ComposerAttachment, { kind: "image" }>;
  index: number;
  disabled: boolean;
  onOpen: (attachment: ComposerAttachment) => void;
  onRemove: (index: number) => void;
}

function ImageAttachmentPill({
  attachment,
  index,
  disabled,
  onOpen,
  onRemove,
}: ImageAttachmentPillProps) {
  const handleOpen = useCallback(() => {
    onOpen(attachment);
  }, [onOpen, attachment]);
  const handleRemove = useCallback(() => {
    onRemove(index);
  }, [onRemove, index]);
  return (
    <AttachmentPill
      testID="composer-image-attachment-pill"
      onOpen={handleOpen}
      onRemove={handleRemove}
      openAccessibilityLabel="Open image attachment"
      removeAccessibilityLabel="Remove image attachment"
      disabled={disabled}
    >
      <ImageAttachmentThumbnail image={attachment.metadata} />
    </AttachmentPill>
  );
}

interface GithubAttachmentPillProps {
  attachment: Extract<ComposerAttachment, { kind: "github_pr" | "github_issue" }>;
  index: number;
  disabled: boolean;
  onOpen: (attachment: ComposerAttachment) => void;
  onRemove: (index: number) => void;
}

interface FileAttachmentPillProps {
  attachment: Extract<ComposerAttachment, { kind: "file" }>;
  index: number;
  disabled: boolean;
  onOpen: (attachment: ComposerAttachment) => void;
  onRemove: (index: number) => void;
}

function FileAttachmentPill({
  attachment,
  index,
  disabled,
  onOpen,
  onRemove,
}: FileAttachmentPillProps) {
  const fileName = attachment.metadata.fileName ?? "File";
  const handleOpen = useCallback(() => {
    onOpen(attachment);
  }, [onOpen, attachment]);
  const handleRemove = useCallback(() => {
    onRemove(index);
  }, [onRemove, index]);
  return (
    <AttachmentPill
      testID="composer-file-attachment-pill"
      onOpen={handleOpen}
      onRemove={handleRemove}
      openAccessibilityLabel={`Open file attachment ${fileName}`}
      removeAccessibilityLabel={`Remove file attachment ${fileName}`}
      disabled={disabled}
    >
      <View style={styles.filePillBody}>
        <ThemedFileText size={ICON_SIZE.sm} uniProps={iconForegroundMutedMapping} />
        <Text style={styles.filePillText} numberOfLines={1} ellipsizeMode="middle">
          {fileName}
        </Text>
      </View>
    </AttachmentPill>
  );
}

function GithubAttachmentPill({
  attachment,
  index,
  disabled,
  onOpen,
  onRemove,
}: GithubAttachmentPillProps) {
  const item = attachment.item;
  const kindLabel = item.kind === "pr" ? "PR" : "issue";
  const handleOpen = useCallback(() => {
    onOpen(attachment);
  }, [onOpen, attachment]);
  const handleRemove = useCallback(() => {
    onRemove(index);
  }, [onRemove, index]);
  return (
    <AttachmentPill
      testID="composer-github-attachment-pill"
      onOpen={handleOpen}
      onRemove={handleRemove}
      openAccessibilityLabel={`Open ${kindLabel} #${item.number}`}
      removeAccessibilityLabel={`Remove ${kindLabel} #${item.number}`}
      disabled={disabled}
    >
      <View style={styles.githubPillBody}>
        <View style={styles.githubPillIcon}>
          {item.kind === "pr" ? (
            <ThemedGitPullRequest size={ICON_SIZE.sm} uniProps={iconForegroundMutedMapping} />
          ) : (
            <ThemedCircleDot size={ICON_SIZE.sm} uniProps={iconForegroundMutedMapping} />
          )}
        </View>
        <Text style={styles.githubPillText} numberOfLines={1}>
          #{item.number} {item.title}
        </Text>
      </View>
    </AttachmentPill>
  );
}

interface GithubPickerOptionProps {
  label: string;
  testID: string;
  active: boolean;
  selected: boolean;
  item: GitHubSearchItem;
  onToggle: (item: GitHubSearchItem) => void;
}

function GithubPickerOption({
  label,
  testID,
  active,
  selected,
  item,
  onToggle,
}: GithubPickerOptionProps) {
  const handlePress = useCallback(() => {
    onToggle(item);
  }, [onToggle, item]);
  const leadingSlot = useMemo(
    () =>
      item.kind === "pr" ? (
        <ThemedGitPullRequest size={ICON_SIZE.sm} uniProps={iconForegroundMutedMapping} />
      ) : (
        <ThemedCircleDot size={ICON_SIZE.sm} uniProps={iconForegroundMutedMapping} />
      ),
    [item.kind],
  );
  return (
    <ComboboxItem
      testID={testID}
      label={label}
      selected={selected}
      active={active}
      onPress={handlePress}
      leadingSlot={leadingSlot}
    />
  );
}

interface ComposerProps {
  agentId: string;
  serverId: string;
  isPaneFocused: boolean;
  onSubmitMessage?: (
    payload: MessagePayload,
    aiCreationContext?: ComposerAiCreationSubmitContext,
  ) => Promise<void>;
  onClientSlashCommand?: (command: ClientSlashCommand) => Promise<void>;
  /** When true, the submit button is enabled even without text or images (e.g. external attachment selected). */
  hasExternalContent?: boolean;
  /** When true, the composer can submit even with no text or attachments. */
  allowEmptySubmit?: boolean;
  /** Optional accessibility label for the primary submit button. */
  submitButtonAccessibilityLabel?: string;
  submitIcon?: "arrow" | "return";
  /** Externally controlled loading state. When true, disables the submit button. */
  isSubmitLoading?: boolean;
  submitBehavior?: "clear" | "preserve-and-lock";
  /** When true, blurs the input immediately when submitting. */
  blurOnSubmit?: boolean;
  value: string;
  onChangeText: (text: string) => void;
  attachments: UserComposerAttachment[];
  workspaceAttachments?: readonly WorkspaceComposerAttachment[];
  onOpenWorkspaceAttachment?: (attachment: WorkspaceComposerAttachment) => void;
  onChangeAttachments: (updater: AttachmentListUpdater) => void;
  cwd: string;
  clearDraft: (lifecycle: "sent" | "abandoned") => void;
  /** When true, auto-focuses the text input on web. */
  autoFocus?: boolean;
  /** Callback to expose the addImages function to parent components */
  onAddImages?: (addImages: (images: ImageAttachment[]) => void) => void;
  /** Callback to expose a focus function to parent components (desktop only). */
  onFocusInput?: (focus: () => void) => void;
  /** Optional draft context for listing commands before an agent exists. */
  commandDraftConfig?: DraftCommandConfig;
  /** Called when a message is about to be sent (any path: keyboard, dictation, queued). */
  onMessageSent?: () => void;
  /** Called before a message is accepted for sending. Throw to block the submit. */
  onBeforeSendMessage?: () => Promise<void>;
  onComposerHeightChange?: (height: number) => void;
  onAttentionInputFocus?: () => void;
  onAttentionPromptSend?: () => void;
  /** Controlled agent controls rendered in input area (draft flows). */
  agentControls?: DraftAgentControlsProps;
  /** Extra styles merged onto the message input wrapper (e.g. elevated background). */
  inputWrapperStyle?: import("react-native").ViewStyle;
  /** Rendered below the input, inside the keyboard-shifted container. */
  footer?: ReactNode;
  /** Additional controls rendered inside the input button row before built-in send controls. */
  extraRightContent?: ReactNode;
  /** When true, a parent wrapper owns the keyboard shift, so the composer skips its own. */
  externalKeyboardShift?: boolean;
}

const EMPTY_ARRAY: readonly QueuedMessage[] = [];
const StableMessageInput = memo(MessageInput);

function resolveContextWindowValues(
  rawMax: number | null,
  rawUsed: number | null,
): { contextWindowMaxTokens: number | null; contextWindowUsedTokens: number | null } {
  if (typeof rawMax === "number" && typeof rawUsed === "number") {
    return { contextWindowMaxTokens: rawMax, contextWindowUsedTokens: rawUsed };
  }
  return { contextWindowMaxTokens: null, contextWindowUsedTokens: null };
}

interface ComposerCancelButtonProps {
  buttonIconSize: number;
  cancelButtonStyle: (object | undefined)[];
  handleCancelAgent: () => void;
  isConnected: boolean;
  isCancellingAgent: boolean;
  agentInterruptKeys: ReturnType<typeof useShortcutKeys>;
}

function ComposerCancelButton({
  buttonIconSize,
  cancelButtonStyle,
  handleCancelAgent,
  isConnected,
  isCancellingAgent,
  agentInterruptKeys,
}: ComposerCancelButtonProps) {
  const accessibilityLabel = isCancellingAgent
    ? translateNow("composer.action.cancelingAgent")
    : translateNow("composer.action.stopAgent");
  const icon = isCancellingAgent ? (
    <ActivityIndicator size="small" color="white" />
  ) : (
    <Square size={buttonIconSize} color="white" fill="white" />
  );
  const shortcutNode = agentInterruptKeys ? <Shortcut chord={agentInterruptKeys} /> : null;
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={handleCancelAgent}
        disabled={!isConnected || isCancellingAgent}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        style={cancelButtonStyle}
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <View style={styles.tooltipRow}>
          <Text style={styles.tooltipText}>{translateNow("ui.interrupt.15gl1dv")}</Text>
          {shortcutNode}
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

interface ComposerCancelButtonSlotProps extends ComposerCancelButtonProps {
  isAgentRunning: boolean;
  hasSendableContent: boolean;
  isProcessing: boolean;
}

function ComposerCancelButtonSlot({
  isAgentRunning,
  hasSendableContent,
  isProcessing,
  ...rest
}: ComposerCancelButtonSlotProps) {
  if (!isAgentRunning || hasSendableContent || isProcessing) return null;
  return <ComposerCancelButton {...rest} />;
}

interface ComposerVoiceModeButtonProps {
  buttonIconSize: number;
  handleToggleRealtimeVoice: () => void;
  isConnected: boolean;
  isVoiceSwitching: boolean;
  realtimeVoiceButtonStyle: (
    state: PressableStateCallbackType & { hovered?: boolean },
  ) => (object | undefined)[];
  voiceToggleKeys: ReturnType<typeof useShortcutKeys>;
}

interface ComposerRightControlsSlotProps extends ComposerVoiceModeButtonProps {
  isVoiceModeForAgent: boolean;
  hasAgent: boolean;
  isAgentRunning: boolean;
  hasSendableContent: boolean;
  isProcessing: boolean;
  isCompact: boolean;
  cancelButton: ReactElement;
  extraContent?: ReactNode;
}

function ComposerRightControlsSlot({
  isVoiceModeForAgent,
  hasAgent,
  isAgentRunning,
  hasSendableContent,
  isProcessing,
  isCompact,
  cancelButton,
  extraContent,
  ...voiceProps
}: ComposerRightControlsSlotProps) {
  const hideVoiceForCompactInput = isCompact && hasSendableContent;
  const showVoiceModeButton =
    !isVoiceModeForAgent && hasAgent && !isAgentRunning && !hideVoiceForCompactInput;
  const shouldShowCancelButton = isAgentRunning && !hasSendableContent && !isProcessing;
  if (!extraContent && !showVoiceModeButton && !shouldShowCancelButton) return null;
  return (
    <View style={styles.rightControls}>
      {extraContent}
      {showVoiceModeButton ? <ComposerVoiceModeButton {...voiceProps} /> : null}
      {cancelButton}
    </View>
  );
}

function ComposerVoiceModeButton({
  buttonIconSize,
  handleToggleRealtimeVoice,
  isConnected,
  isVoiceSwitching,
  realtimeVoiceButtonStyle,
  voiceToggleKeys,
}: ComposerVoiceModeButtonProps) {
  const shortcutNode = voiceToggleKeys ? <Shortcut chord={voiceToggleKeys} /> : null;
  const renderTriggerContent = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => {
      if (isVoiceSwitching) {
        return <ActivityIndicator size="small" color="white" />;
      }
      const colorMapping = hovered ? iconForegroundMapping : iconForegroundMutedMapping;
      return <ThemedAudioLines size={buttonIconSize} uniProps={colorMapping} />;
    },
    [buttonIconSize, isVoiceSwitching],
  );
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={handleToggleRealtimeVoice}
        disabled={!isConnected || isVoiceSwitching}
        accessibilityLabel={translateNow("ui.enable.voice.mode.12pfe6m")}
        accessibilityRole="button"
        style={realtimeVoiceButtonStyle}
      >
        {renderTriggerContent}
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <View style={styles.tooltipRow}>
          <Text style={styles.tooltipText}>{translateNow("ui.voice.mode.6y6tbl")}</Text>
          {shortcutNode}
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

export function Composer({
  agentId,
  serverId,
  isPaneFocused,
  onSubmitMessage,
  onClientSlashCommand,
  hasExternalContent = false,
  allowEmptySubmit = false,
  submitButtonAccessibilityLabel,
  submitIcon = "arrow",
  isSubmitLoading = false,
  submitBehavior = "clear",
  blurOnSubmit = false,
  value,
  onChangeText,
  attachments,
  workspaceAttachments = [],
  onOpenWorkspaceAttachment,
  onChangeAttachments,
  cwd,
  clearDraft,
  autoFocus = false,
  onAddImages,
  onFocusInput,
  commandDraftConfig,
  onMessageSent,
  onBeforeSendMessage,
  onComposerHeightChange,
  onAttentionInputFocus,
  onAttentionPromptSend,
  agentControls,
  inputWrapperStyle,
  footer,
  extraRightContent,
  externalKeyboardShift,
}: ComposerProps) {
  const buttonIconSize = resolveComposerButtonIconSize();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const agentDirectoryStatus = useHostRuntimeAgentDirectoryStatus(serverId);
  const toast = useToast();
  const toastErrorRef = useRef(toast.error);
  toastErrorRef.current = toast.error;
  const voice = useVoiceOptional();
  const voiceToggleKeys = useShortcutKeys("voice-toggle");
  const agentInterruptKeys = useShortcutKeys("agent-interrupt");
  const isDictationReady = useIsDictationReady({
    serverId,
    isConnected,
    agentDirectoryStatus,
  });

  const { settings: appSettings } = useAppSettings();

  const agentState = useSessionStore(useShallow(buildAgentStateSelector(serverId, agentId)));

  const queuedMessagesRaw = useSessionStore((state) =>
    state.sessions[serverId]?.queuedMessages?.get(agentId),
  );
  const queuedMessages = queuedMessagesRaw ?? EMPTY_ARRAY;

  const setQueuedMessages = useSessionStore((state) => state.setQueuedMessages);
  const setAgentStreamTail = useSessionStore((state) => state.setAgentStreamTail);
  const setAgentStreamHead = useSessionStore((state) => state.setAgentStreamHead);

  const isMobile = useIsCompactFormFactor();
  const isDesktopWebBreakpoint = resolveIsDesktopWebBreakpoint(isMobile);
  const showComposerQuickActions = shouldShowComposerQuickActions(isMobile);
  const [selectedQuickActionMode, setSelectedQuickActionMode] =
    useState<ComposerAiCreationMode | null>(null);
  const [quickActionRatio, setQuickActionRatio] = useState<ComposerAiCreationRatio>("16:9");
  const [quickActionStyle, setQuickActionStyle] = useState<ComposerAiCreationStyle>("auto");
  const handleSelectQuickActionMode = useCallback((mode: ComposerAiCreationMode | null) => {
    if (mode === "slides") {
      setQuickActionRatio("16:9");
    }
    setSelectedQuickActionMode(mode);
  }, []);
  const messagePlaceholder = resolveComposerPlaceholder(
    selectedQuickActionMode,
    isDesktopWebBreakpoint,
  );
  const userInput = value;
  const setUserInput = onChangeText;
  const {
    selectedAttachments,
    buildOutgoingAttachments,
    removeAttachment,
    openAttachment,
    clearSentAttachments,
    completeSubmit,
    resetSuppression,
  } = composerWorkspaceAttachment.useBinding({
    normalAttachments: attachments,
    workspaceAttachments,
    onOpenWorkspaceAttachment,
  });
  const setSelectedAttachments = onChangeAttachments;
  const checkoutStatusQuery = useCheckoutStatusQuery({ serverId, cwd });
  const githubAutoAttach = useComposerGithubAutoAttach({
    text: userInput,
    remoteUrl: resolveCheckoutRemoteUrl(checkoutStatusQuery.status),
    attachments,
    client,
    isConnected,
    serverId,
    cwd,
    setAttachments: setSelectedAttachments,
  });
  const [cursorIndex, setCursorIndex] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCancellingAgent, setIsCancellingAgent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isMessageInputFocused, setIsMessageInputFocused] = useState(false);
  const [isGithubPickerOpen, setIsGithubPickerOpen] = useState(false);
  const [githubSearchQuery, setGithubSearchQuery] = useState("");
  const [lightboxMetadata, setLightboxMetadata] = useState<AttachmentMetadata | null>(null);
  const attachButtonRef = useRef<View | null>(null);
  const messageInputRef = useRef<MessageInputRef>(null);
  const isComposerLocked = resolveIsComposerLocked(submitBehavior, isSubmitLoading);
  const keyboardHandlerIdRef = useRef(
    `message-input:${serverId}:${agentId}:${Math.random().toString(36).slice(2)}`,
  );

  const runClientSlashCommand = useCallback(
    (command: ClientSlashCommand): boolean => {
      if (command.execution !== "immediate" || !onClientSlashCommand) {
        return false;
      }

      if (blurOnSubmit) {
        messageInputRef.current?.blur();
      }
      clearDraft("sent");
      setUserInput("");
      setSelectedAttachments([]);
      resetSuppression();
      setSendError(null);
      setIsProcessing(true);
      void onClientSlashCommand(command)
        .catch((error) => {
          console.error("[Composer] Failed to run client slash command:", error);
          setSendError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          setIsProcessing(false);
        });
      return true;
    },
    [
      blurOnSubmit,
      clearDraft,
      onClientSlashCommand,
      resetSuppression,
      setSelectedAttachments,
      setUserInput,
    ],
  );

  const autocomplete = useAgentAutocomplete({
    userInput,
    cursorIndex,
    setUserInput,
    serverId,
    agentId,
    draftConfig: commandDraftConfig,
    canExecuteClientSlashCommand: buildOutgoingAttachments(attachments).length === 0,
    onClientSlashCommand: runClientSlashCommand,
    onAutocompleteApplied: () => {
      messageInputRef.current?.focus();
    },
  });
  const autocompleteOnKeyPressRef = useRef(autocomplete.onKeyPress);
  autocompleteOnKeyPressRef.current = autocomplete.onKeyPress;

  // Clear send error when user edits the input
  useEffect(() => {
    if (sendError && userInput) {
      setSendError(null);
    }
  }, [userInput, sendError]);

  useEffect(() => {
    setCursorIndex((current) => Math.min(current, userInput.length));
  }, [userInput.length]);

  const { pickImages } = useImageAttachmentPicker();
  const { pickFiles } = useFileAttachmentPicker();
  const agentIdRef = useRef(agentId);
  const sendAgentMessageRef = useRef<
    | ((
        agentId: string,
        text: string,
        attachments: ComposerAttachment[],
        aiCreationContext?: ComposerAiCreationSubmitContext,
      ) => Promise<void>)
    | null
  >(null);
  const onSubmitMessageRef = useRef(onSubmitMessage);

  // Expose addImages function to parent for drag-and-drop support
  const addImages = useCallback(
    (images: ImageAttachment[]) => {
      setSelectedAttachments((prev) => [
        ...prev,
        ...images.map((metadata) => ({ kind: "image" as const, metadata })),
      ]);
    },
    [setSelectedAttachments],
  );

  const addFiles = useCallback(
    (files: AttachmentMetadata[]) => {
      setSelectedAttachments((prev) => [
        ...prev,
        ...files.map((metadata) => ({ kind: "file" as const, metadata })),
      ]);
    },
    [setSelectedAttachments],
  );

  useEffect(() => {
    onAddImages?.(addImages);
  }, [addImages, onAddImages]);

  const focusInput = useCallback(() => {
    if (isNative) return;
    focusWithRetries({
      focus: () => messageInputRef.current?.focus(),
      isFocused: () => {
        const el = messageInputRef.current?.getNativeElement?.() ?? null;
        return el != null && document.activeElement === el;
      },
    });
  }, []);

  useEffect(() => {
    onFocusInput?.(focusInput);
  }, [focusInput, onFocusInput]);

  const submitMessage = useCallback(
    async (
      text: string,
      submitAttachments: ComposerAttachment[],
      aiCreationContext?: ComposerAiCreationSubmitContext,
    ) => {
      await onBeforeSendMessage?.();
      onMessageSent?.();
      if (onSubmitMessageRef.current) {
        await onSubmitMessageRef.current(
          { text, attachments: submitAttachments, cwd },
          aiCreationContext,
        );
        return;
      }
      if (!sendAgentMessageRef.current) {
        throw new Error(translateNow("ui.host.is.not.connected.n90cm6"));
      }
      await sendAgentMessageRef.current(
        agentIdRef.current,
        text,
        submitAttachments,
        aiCreationContext,
      );
    },
    [cwd, onBeforeSendMessage, onMessageSent],
  );

  useEffect(() => {
    agentIdRef.current = agentId;
  }, [agentId]);

  useEffect(() => {
    sendAgentMessageRef.current = async (
      targetAgentId: string,
      text: string,
      sendAttachments: ComposerAttachment[],
      aiCreationContext?: ComposerAiCreationSubmitContext,
    ) => {
      if (!client) {
        throw new Error(translateNow("ui.host.is.not.connected.n90cm6"));
      }
      const stream: AgentStreamWriter = {
        getTail: (id) => useSessionStore.getState().sessions[serverId]?.agentStreamTail?.get(id),
        getHead: (id) => useSessionStore.getState().sessions[serverId]?.agentStreamHead?.get(id),
        setHead: (updater) => setAgentStreamHead(serverId, updater),
        setTail: (updater) => setAgentStreamTail(serverId, updater),
      };
      await dispatchComposerAgentMessage({
        client,
        agentId: targetAgentId,
        text,
        attachments: sendAttachments,
        aiCreationContext,
        encodeImages,
        stream,
      });
      onAttentionPromptSend?.();
    };
  }, [client, onAttentionPromptSend, serverId, setAgentStreamTail, setAgentStreamHead]);

  useEffect(() => {
    onSubmitMessageRef.current = onSubmitMessage;
  }, [onSubmitMessage]);

  const isAgentRunning = agentState.status === "running";
  const hasAgent = agentState.status !== null;

  const queueWriter = useMemo<QueueWriter>(
    () => ({
      read: (id) => useSessionStore.getState().sessions[serverId]?.queuedMessages?.get(id) ?? [],
      write: (updater) => setQueuedMessages(serverId, updater),
    }),
    [serverId, setQueuedMessages],
  );

  const queueMessage = useCallback(
    (queuedMessage: string, queuedAttachments: ComposerAttachment[]) => {
      const result = queueComposerMessage({
        agentId,
        text: queuedMessage,
        attachments: queuedAttachments,
        queue: queueWriter,
      });
      if (!result.queued) return;

      setUserInput("");
      setSelectedAttachments([]);
      resetSuppression();
      clearSentAttachments(queuedAttachments);
    },
    [
      agentId,
      clearSentAttachments,
      queueWriter,
      resetSuppression,
      setSelectedAttachments,
      setUserInput,
    ],
  );

  const sendMessageWithContent = useCallback(
    async (
      outgoingMessage: string,
      outgoingAttachments: ComposerAttachment[],
      forceSend?: boolean,
      aiCreationContext?: ComposerAiCreationSubmitContext,
    ) => {
      const result = await submitAgentInput({
        message: outgoingMessage,
        attachments: outgoingAttachments,
        hasExternalContent,
        allowEmptySubmit,
        forceSend,
        submitBehavior,
        isAgentRunning,
        // Parent-managed submits are still valid submit paths even when the
        // transport is disconnected, because the parent decides the failure mode.
        canSubmit: Boolean(sendAgentMessageRef.current || onSubmitMessageRef.current),
        queueMessage: ({ message: queuedText, attachments: queuedAttachments }) => {
          queueMessage(queuedText, queuedAttachments);
        },
        submitMessage: async ({ message: submitText, attachments: submitAttachments }) => {
          await submitMessage(submitText, submitAttachments, aiCreationContext);
        },
        clearDraft,
        setUserInput,
        setAttachments: (nextAttachments) => {
          setSelectedAttachments(composerWorkspaceAttachment.userAttachmentsOnly(nextAttachments));
        },
        setSendError,
        setIsProcessing,
        onSubmitError: (error) => {
          console.error("[AgentInput] Failed to send message:", error);
        },
      });
      completeSubmit({
        result,
        outgoingAttachments,
      });
    },
    [
      allowEmptySubmit,
      clearDraft,
      completeSubmit,
      hasExternalContent,
      isAgentRunning,
      queueMessage,
      setSelectedAttachments,
      setUserInput,
      submitBehavior,
      submitMessage,
    ],
  );

  const handleSubmit = useCallback(
    (payload: MessagePayload) => {
      const outgoingAttachments = buildOutgoingAttachments(attachments);
      const clientSlashCommand = resolveClientSlashCommand({
        text: payload.text,
        hasAttachments: outgoingAttachments.length > 0,
      });
      if (clientSlashCommand && runClientSlashCommand(clientSlashCommand)) {
        return;
      }

      if (blurOnSubmit) {
        messageInputRef.current?.blur();
      }
      const aiCreationContext = buildComposerAiCreationSubmitContext(
        selectedQuickActionMode,
        payload.text,
        quickActionRatio,
        quickActionStyle,
      );
      void sendMessageWithContent(
        payload.text,
        outgoingAttachments,
        payload.forceSend,
        aiCreationContext,
      );
    },
    [
      attachments,
      blurOnSubmit,
      buildOutgoingAttachments,
      quickActionRatio,
      quickActionStyle,
      runClientSlashCommand,
      selectedQuickActionMode,
      sendMessageWithContent,
    ],
  );

  const handlePickImage = useCallback(async () => {
    const newImages = await pickAndPersistImages({
      pickImages,
      persister: {
        persistFromBlob: ({ blob, mimeType, fileName }) =>
          persistAttachmentFromBlob({ blob, mimeType, fileName }),
        persistFromFileUri: ({ uri, mimeType, fileName }) =>
          persistAttachmentFromFileUri({ uri, mimeType, fileName }),
      },
    });
    if (newImages.length === 0) return;
    addImages(newImages);
  }, [addImages, pickImages]);

  const handlePickFile = useCallback(async () => {
    const newFiles = await pickFiles();
    if (newFiles.length === 0) return;
    addFiles(newFiles);
  }, [addFiles, pickFiles]);

  const handleRemoveAttachment = useCallback(
    (index: number) => {
      githubAutoAttach.markGithubAttachmentRemoved(selectedAttachments[index]);
      const didRemoveWorkspaceAttachment = removeAttachment({
        selectedAttachments,
        index,
      });
      if (didRemoveWorkspaceAttachment) {
        return;
      }
      setSelectedAttachments((prev) =>
        removeComposerAttachmentAtIndex({ attachments: prev, index, deleteAttachments }),
      );
    },
    [githubAutoAttach, removeAttachment, selectedAttachments, setSelectedAttachments],
  );

  const handleOpenAttachment = useCallback(
    (attachment: ComposerAttachment) => {
      openComposerAttachment({
        attachment,
        setLightboxMetadata,
        openWorkspaceAttachment: openAttachment,
        resolveAttachmentPreviewUrl,
        openExternalUrl: (url) => {
          void openExternalUrl(url);
        },
      }).catch((error) => {
        console.error("[Composer] Failed to open attachment:", error);
      });
    },
    [openAttachment],
  );

  useEffect(() => {
    if (!isAgentRunning || !isConnected) {
      setIsCancellingAgent(false);
    }
  }, [isAgentRunning, isConnected]);

  const handleCancelAgent = useCallback(() => {
    const didCancel = cancelComposerAgent({
      client,
      agentId: agentIdRef.current,
      isAgentRunning,
      isCancellingAgent,
      isConnected,
    });
    if (!didCancel) return;
    setIsCancellingAgent(true);
    messageInputRef.current?.focus();
  }, [client, isAgentRunning, isCancellingAgent, isConnected]);

  const focusMessageInputForKeyboardAction = useCallback(() => {
    focusMessageInputWithPlatformStrategy(messageInputRef);
  }, []);

  const handleKeyboardAction = useCallback(
    (action: KeyboardActionDefinition): boolean =>
      dispatchComposerKeyboardAction({
        action,
        isPaneFocused,
        messageInputRef,
        isAgentRunning,
        isCancellingAgent,
        isConnected,
        handleCancelAgent,
        focusMessageInputForKeyboardAction,
      }),
    [
      focusMessageInputForKeyboardAction,
      handleCancelAgent,
      isAgentRunning,
      isCancellingAgent,
      isConnected,
      isPaneFocused,
    ],
  );

  useKeyboardActionHandler({
    handlerId: keyboardHandlerIdRef.current,
    actions: [
      "agent.interrupt",
      "message-input.focus",
      "message-input.send",
      "message-input.dictation-toggle",
      "message-input.dictation-cancel",
      "message-input.dictation-confirm",
      "message-input.voice-toggle",
      "message-input.voice-mute-toggle",
    ],
    enabled: isPaneFocused,
    priority: resolveKeyboardPriority(isMessageInputFocused),
    isActive: () => isPaneFocused,
    handle: handleKeyboardAction,
  });

  const { style: keyboardAnimatedStyle } = useKeyboardShiftStyle({
    mode: "translate",
    enabled: !externalKeyboardShift,
  });

  const isVoiceModeForAgent = resolveIsVoiceModeForAgent(voice, serverId, agentId);

  const handleToggleRealtimeVoice = useCallback(() => {
    attemptStartRealtimeVoice({
      voice,
      isConnected,
      hasAgent,
      serverId,
      agentId,
      toastErrorRef,
    });
  }, [agentId, hasAgent, isConnected, serverId, voice]);

  const handleEditQueuedMessage = useCallback(
    (id: string) => {
      const result = editQueuedComposerMessage({
        agentId,
        messageId: id,
        queue: queueWriter,
      });
      if (!result) return;
      setUserInput(result.text);
      setSelectedAttachments(result.attachments);
    },
    [agentId, queueWriter, setSelectedAttachments, setUserInput],
  );

  const handleSendQueuedNow = useCallback(
    async (id: string) => {
      if (!sendAgentMessageRef.current && !onSubmitMessageRef.current) return;
      // Reuse the regular send path; server-side send atomically interrupts any active run.
      const result = await sendQueuedComposerMessageNow({
        agentId,
        messageId: id,
        queue: queueWriter,
        submitMessage: ({ text, attachments: queuedAttachments }) =>
          submitMessage(text, queuedAttachments),
      });
      if (result.status === "failed") {
        setSendError(result.errorMessage);
      }
    },
    [agentId, queueWriter, submitMessage],
  );

  const handleQueue = useCallback(
    (payload: MessagePayload) => {
      const outgoingAttachments = buildOutgoingAttachments(attachments);
      const clientSlashCommand = resolveClientSlashCommand({
        text: payload.text,
        hasAttachments: outgoingAttachments.length > 0,
      });
      if (clientSlashCommand && runClientSlashCommand(clientSlashCommand)) {
        return;
      }
      queueMessage(payload.text, outgoingAttachments);
    },
    [attachments, buildOutgoingAttachments, queueMessage, runClientSlashCommand],
  );

  const hasSendableContent = userInput.trim().length > 0 || selectedAttachments.length > 0;

  // Handle keyboard navigation for command autocomplete.
  const handleCommandKeyPress = useCallback(
    (event: { key: string; preventDefault: () => void }) =>
      autocompleteOnKeyPressRef.current(event),
    [],
  );

  const cancelButtonStyle = useMemo(
    () => buildCancelButtonStyle(isConnected, isCancellingAgent),
    [isConnected, isCancellingAgent],
  );

  const isVoiceSwitching = voice?.isVoiceSwitching ?? false;
  const voiceButtonDisabled = !isConnected || isVoiceSwitching;
  const realtimeVoiceButtonStyle = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) =>
      buildRealtimeVoiceButtonStyle(state.hovered, voiceButtonDisabled),
    [voiceButtonDisabled],
  );

  const cancelButton = useMemo(
    () => (
      <ComposerCancelButtonSlot
        isAgentRunning={isAgentRunning}
        hasSendableContent={hasSendableContent}
        isProcessing={isProcessing}
        buttonIconSize={buttonIconSize}
        cancelButtonStyle={cancelButtonStyle}
        handleCancelAgent={handleCancelAgent}
        isConnected={isConnected}
        isCancellingAgent={isCancellingAgent}
        agentInterruptKeys={agentInterruptKeys}
      />
    ),
    [
      agentInterruptKeys,
      buttonIconSize,
      cancelButtonStyle,
      handleCancelAgent,
      hasSendableContent,
      isAgentRunning,
      isCancellingAgent,
      isConnected,
      isProcessing,
    ],
  );

  const rightContent = useMemo(
    () => (
      <ComposerRightControlsSlot
        isVoiceModeForAgent={isVoiceModeForAgent}
        hasAgent={hasAgent}
        isAgentRunning={isAgentRunning}
        hasSendableContent={hasSendableContent}
        isProcessing={isProcessing}
        isCompact={isMobile}
        buttonIconSize={buttonIconSize}
        handleToggleRealtimeVoice={handleToggleRealtimeVoice}
        isConnected={isConnected}
        isVoiceSwitching={isVoiceSwitching}
        realtimeVoiceButtonStyle={realtimeVoiceButtonStyle}
        voiceToggleKeys={voiceToggleKeys}
        cancelButton={cancelButton}
        extraContent={extraRightContent}
      />
    ),
    [
      buttonIconSize,
      cancelButton,
      handleToggleRealtimeVoice,
      hasAgent,
      hasSendableContent,
      isAgentRunning,
      isConnected,
      isMobile,
      isProcessing,
      isVoiceModeForAgent,
      isVoiceSwitching,
      realtimeVoiceButtonStyle,
      voiceToggleKeys,
      extraRightContent,
    ],
  );

  const { contextWindowMaxTokens, contextWindowUsedTokens } = resolveContextWindowValues(
    agentState.contextWindowMaxTokens,
    agentState.contextWindowUsedTokens,
  );

  const contextWindowMeter = useMemo(
    () =>
      renderContextWindowMeter(
        contextWindowMaxTokens,
        contextWindowUsedTokens,
        agentState.totalCostUsd,
        isMobile,
      ),
    [contextWindowMaxTokens, contextWindowUsedTokens, agentState.totalCostUsd, isMobile],
  );
  const { beforeVoiceContent, footerInlineContent } = useMemo(
    () => resolveContextWindowPlacement(contextWindowMeter, isMobile),
    [contextWindowMeter, isMobile],
  );

  const githubSearchQueryTrimmed = githubSearchQuery.trim();
  const githubSearchResultsQuery = useGithubSearchQuery({
    client,
    serverId,
    cwd,
    query: githubSearchQueryTrimmed,
    enabled: resolveGithubSearchEnabled(isGithubPickerOpen, isConnected, cwd),
  });

  const githubSearchItemsRaw = githubSearchResultsQuery.data?.items;
  const githubSearchItems = useMemo(() => githubSearchItemsRaw ?? [], [githubSearchItemsRaw]);
  const githubSearchOptions: ComboboxOption[] = useMemo(
    () =>
      githubSearchItems.map((item) => ({
        id: `${item.kind}:${item.number}`,
        label: `#${item.number} ${item.title}`,
        description: githubSearchQueryTrimmed,
      })),
    [githubSearchItems, githubSearchQueryTrimmed],
  );

  const attachmentMenuItems = useMemo<AttachmentMenuItem[]>(
    () => [
      {
        id: "image",
        label: translateNow("ui.add.image.8u6gvw"),
        icon: <ThemedPaperclip size={ICON_SIZE.md} uniProps={iconForegroundMutedMapping} />,
        onSelect: () => {
          void handlePickImage();
        },
      },
      {
        id: "file",
        label: translateNow("ui.add.file"),
        icon: <ThemedFileText size={ICON_SIZE.md} uniProps={iconForegroundMutedMapping} />,
        onSelect: () => {
          void handlePickFile();
        },
      },
      {
        id: "github",
        label: translateNow("ui.add.issue.or.pr.c6uuyh"),
        icon: <ThemedGithub size={ICON_SIZE.md} uniProps={iconForegroundMutedMapping} />,
        onSelect: () => {
          setIsGithubPickerOpen(true);
        },
      },
    ],
    [handlePickFile, handlePickImage],
  );

  const handleToggleGithubItem = useCallback(
    (item: GitHubSearchItem) => {
      const nextAttachments = toggleGithubAttachmentFromPicker({
        current: attachments,
        item,
        markGithubAttachmentRemoved: githubAutoAttach.markGithubAttachmentRemoved,
      });
      setSelectedAttachments(nextAttachments);
      setIsGithubPickerOpen(false);
      setGithubSearchQuery("");
    },
    [
      attachments,
      githubAutoAttach,
      setSelectedAttachments,
      setGithubSearchQuery,
      setIsGithubPickerOpen,
    ],
  );

  const leftContent = useMemo(
    () =>
      renderLeftContent({
        agentControls,
        agentId,
        serverId,
        focusInput,
        showQuickActions: showComposerQuickActions,
        selectedQuickActionMode,
        onSelectQuickActionMode: handleSelectQuickActionMode,
        quickActionRatio,
        onSelectQuickActionRatio: setQuickActionRatio,
        quickActionStyle,
        onSelectQuickActionStyle: setQuickActionStyle,
        onSelectQuickActionReference: handlePickImage,
        onSelectQuickActionMaterial: handlePickFile,
      }),
    [
      agentControls,
      agentId,
      handlePickFile,
      focusInput,
      handlePickImage,
      handleSelectQuickActionMode,
      quickActionRatio,
      quickActionStyle,
      selectedQuickActionMode,
      serverId,
      showComposerQuickActions,
    ],
  );

  const handleAttachButtonRef = useCallback((node: View | null) => {
    attachButtonRef.current = node;
  }, []);

  const handleSelectionChange = useCallback((selection: { start: number; end: number }) => {
    setCursorIndex(selection.start);
  }, []);

  const handleFocusChange = useCallback(
    (focused: boolean) => {
      setIsMessageInputFocused(focused);
      if (focused) {
        onAttentionInputFocus?.();
      }
    },
    [onAttentionInputFocus],
  );

  const handleLightboxClose = useCallback(() => {
    setLightboxMetadata(null);
  }, []);

  const handleGithubPickerOpenChange = useCallback(
    (open: boolean) => {
      setIsGithubPickerOpen(open);
      if (!open) {
        setGithubSearchQuery("");
      }
    },
    [setGithubSearchQuery],
  );

  const renderGithubPickerOption = useCallback(
    ({ option, active }: { option: ComboboxOption; selected: boolean; active: boolean }) => {
      const item = findGithubItemByOption(githubSearchItems, option.id);
      if (!item) {
        return <View key={option.id} />;
      }
      const selected = isAttachmentSelectedForGithubItem(selectedAttachments, item);
      return (
        <GithubPickerOption
          key={option.id}
          testID={`composer-github-option-${option.id}`}
          label={option.label}
          selected={selected}
          active={active}
          item={item}
          onToggle={handleToggleGithubItem}
        />
      );
    },
    [githubSearchItems, selectedAttachments, handleToggleGithubItem],
  );

  const composerContainerStyle = useMemo(
    () => [styles.container, keyboardAnimatedStyle],
    [keyboardAnimatedStyle],
  );
  const inputAreaContainerStyle = useMemo(
    () => [styles.inputAreaContainer, isComposerLocked && styles.inputAreaLocked],
    [isComposerLocked],
  );

  const attachmentTray = useMemo(
    () =>
      renderAttachmentTray({
        selectedAttachments,
        isComposerLocked,
        handleOpenAttachment,
        handleRemoveAttachment,
      }),
    [handleOpenAttachment, handleRemoveAttachment, isComposerLocked, selectedAttachments],
  );

  const queueList = useMemo(
    () => renderQueueTrack({ queuedMessages, handleEditQueuedMessage, handleSendQueuedNow }),
    [handleEditQueuedMessage, handleSendQueuedNow, queuedMessages],
  );

  const messageInputContainerRef = useRef<View>(null);

  const isSubmitBusy = isProcessing || isSubmitLoading;
  const messageInputAutoFocus = autoFocus && isDesktopWebBreakpoint;
  const submitLoadingPressHandler = isAgentRunning ? handleCancelAgent : undefined;
  const sendErrorNode = useMemo(
    () => (sendError ? <Text style={styles.sendErrorText}>{sendError}</Text> : null),
    [sendError],
  );
  const githubEmptyText = githubSearchResultsQuery.isFetching
    ? translateNow("composer.github.searching")
    : translateNow("composer.github.noResults");
  const autocompleteVisible = autocomplete.isVisible && isPaneFocused;

  return (
    <Animated.View style={composerContainerStyle}>
      <AttachmentLightbox metadata={lightboxMetadata} onClose={handleLightboxClose} />
      {/* Input area */}
      <View style={inputAreaContainerStyle}>
        <View style={styles.inputAreaContent}>
          {queueList}
          {sendErrorNode}

          <View ref={messageInputContainerRef} style={styles.messageInputContainer}>
            <AutocompletePopover
              visible={autocompleteVisible}
              anchorRef={messageInputContainerRef}
              options={autocomplete.options}
              selectedIndex={autocomplete.selectedIndex}
              onSelect={autocomplete.onSelectOption}
              isLoading={autocomplete.isLoading}
              errorMessage={autocomplete.errorMessage}
              loadingText={autocomplete.loadingText}
              emptyText={autocomplete.emptyText}
            />

            {/* MessageInput handles everything: text, dictation, attachments, all buttons */}
            <StableMessageInput
              ref={messageInputRef}
              value={userInput}
              onChangeText={setUserInput}
              onSubmit={handleSubmit}
              hasExternalContent={hasExternalContent}
              allowEmptySubmit={allowEmptySubmit}
              submitButtonAccessibilityLabel={submitButtonAccessibilityLabel}
              submitIcon={submitIcon}
              isSubmitDisabled={isSubmitBusy}
              isSubmitLoading={isSubmitBusy}
              attachments={selectedAttachments}
              cwd={cwd}
              attachmentMenuItems={attachmentMenuItems}
              onAttachButtonRef={handleAttachButtonRef}
              onAddImages={addImages}
              client={client}
              isReadyForDictation={isDictationReady}
              placeholder={messagePlaceholder}
              autoFocus={messageInputAutoFocus}
              autoFocusKey={`${serverId}:${agentId}`}
              disabled={isSubmitLoading}
              isPaneFocused={isPaneFocused}
              leftContent={leftContent}
              hideAttachmentButton={selectedQuickActionMode !== null}
              beforeVoiceContent={beforeVoiceContent}
              rightContent={rightContent}
              voiceServerId={serverId}
              voiceAgentId={agentId}
              isAgentRunning={isAgentRunning}
              defaultSendBehavior={appSettings.sendBehavior}
              onQueue={handleQueue}
              onSubmitLoadingPress={submitLoadingPressHandler}
              onKeyPress={handleCommandKeyPress}
              onSelectionChange={handleSelectionChange}
              onFocusChange={handleFocusChange}
              onHeightChange={onComposerHeightChange}
              inputWrapperStyle={inputWrapperStyle}
              attachmentSlot={attachmentTray}
            />
            <Combobox
              options={githubSearchOptions}
              value=""
              onSelect={noop}
              keepOpenOnSelect
              searchable
              searchPlaceholder="Search issues and PRs..."
              title={translateNow("ui.attach.issue.or.pr.1tduk2l")}
              open={isGithubPickerOpen}
              onOpenChange={handleGithubPickerOpenChange}
              onSearchQueryChange={setGithubSearchQuery}
              desktopPlacement="top-start"
              anchorRef={attachButtonRef}
              emptyText={githubEmptyText}
              renderOption={renderGithubPickerOption}
            />
          </View>
        </View>
      </View>
      {renderComposerFooter(footer, footerInlineContent)}
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  container: {
    flexDirection: "column",
    position: "relative",
  },
  borderSeparator: {
    height: theme.borderWidth[1],
    backgroundColor: theme.colors.border,
  },
  inputAreaContainer: {
    position: "relative",
    minHeight: FOOTER_HEIGHT,
    marginHorizontal: "auto",
    alignItems: "center",
    width: "100%",
    overflow: "visible",
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[4],
  },
  inputAreaLocked: {
    opacity: 0.6,
  },
  inputAreaContent: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    gap: theme.spacing[3],
  },
  footer: {
    width: "100%",
    paddingHorizontal: theme.spacing[4],
    // Negative margin pulls the footer up against the input area's paddingBottom.
    // On mobile, leave a 3px gap (no token sits below spacing[1]); desktop keeps more.
    marginTop: {
      xs: -(theme.spacing[4] - 3),
      md: -theme.spacing[3],
    },
    alignItems: "center",
  },
  footerContent: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    // On mobile, the negative margins below cancel each glyph's internal padding
    // to reach the composer border; this inset adds a small visual gap from it.
    paddingLeft: {
      xs: 5,
      md: 10,
    },
    paddingRight: {
      xs: 5,
      md: 10,
    },
  },
  footerLeft: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    // On mobile, cancel the leading glyph's internal padding (chip paddingHorizontal)
    // so its icon aligns to the composer border before the footer inset is applied.
    marginLeft: {
      xs: -theme.spacing[2],
      md: 0,
    },
  },
  messageInputContainer: {
    position: "relative",
    width: "100%",
    gap: theme.spacing[3],
  },
  cancelButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.palette.red[600],
    alignItems: "center",
    justifyContent: "center",
    marginLeft: theme.spacing[1],
  },
  rightControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  quickActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    marginLeft: theme.spacing[1],
    minWidth: 0,
    flexShrink: 1,
  },
  quickActionButton: {
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    backgroundColor: "transparent",
  },
  quickActionButtonSelected: {
    backgroundColor: theme.colors.surface2,
  },
  quickActionText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    lineHeight: theme.fontSize.sm * 1.3,
  },
  selectedQuickAction: {
    height: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    marginLeft: theme.spacing[1],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: `${theme.colors.accent}14`,
  },
  selectedQuickActionText: {
    color: theme.colors.accent,
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.medium,
    lineHeight: theme.fontSize.md * 1.25,
  },
  selectedQuickActionClear: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  selectedQuickActionClearHovered: {
    backgroundColor: `${theme.colors.accent}20`,
  },
  selectedQuickActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    marginLeft: theme.spacing[1],
    minWidth: 0,
    flexShrink: 1,
  },
  quickActionConfigButton: {
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    backgroundColor: "transparent",
  },
  quickActionConfigButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  quickActionConfigText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.normal,
    lineHeight: theme.fontSize.md * 1.25,
  },
  quickActionStyleOptionImage: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.md,
  },
  quickActionStyleOptionAuto: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f2efff",
  },
  contextWindowMeterSlot: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  realtimeVoiceButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  realtimeVoiceButtonActive: {
    backgroundColor: theme.colors.palette.green[600],
    borderColor: theme.colors.palette.green[800],
  },
  iconButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  attachmentTray: {
    flexDirection: "row",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  imageThumbnail: {
    width: 32,
    height: 32,
  },
  imageThumbnailPlaceholder: {
    width: 32,
    height: 32,
    backgroundColor: theme.colors.surface2,
  },
  filePillBody: {
    minHeight: 32,
    maxWidth: 260,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
  },
  filePillText: {
    minWidth: 0,
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  githubPillBody: {
    minHeight: 32,
    maxWidth: 260,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
  },
  githubPillIcon: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  githubPillText: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  queueTrack: {
    flexDirection: "column",
    gap: theme.spacing[2],
  },
  queueItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    gap: theme.spacing[2],
  },
  queueText: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  queueActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  queueActionButton: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
  },
  queueSendButton: {
    backgroundColor: theme.colors.accent,
  },
  sendErrorText: {
    color: theme.colors.palette.red[500],
    fontSize: theme.fontSize.sm,
  },
})) as unknown as Record<string, object>;

const QUEUE_SEND_BUTTON_STYLE = [styles.queueActionButton, styles.queueSendButton];

const ThemedPencil = withUnistyles(Pencil);
const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedGitPullRequest = withUnistyles(GitPullRequest);
const ThemedCircleDot = withUnistyles(CircleDot);
const ThemedAudioLines = withUnistyles(AudioLines);
const ThemedPaperclip = withUnistyles(Paperclip);
const ThemedGithub = withUnistyles(Github);
const ThemedFileText = withUnistyles(FileText);
const ThemedFileImage = withUnistyles(FileImage);
const ThemedPanelsTopLeft = withUnistyles(PanelsTopLeft);
const ThemedPresentation = withUnistyles(Presentation);
const ThemedTable2 = withUnistyles(Table2);
const ThemedX = withUnistyles(X);
const ThemedPalette = withUnistyles(Palette);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedSquare = withUnistyles(Square);
const ThemedSparkles = withUnistyles(Sparkles);

const iconForegroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const iconForegroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const selectedQuickActionIconMapping = (theme: Theme) => ({ color: theme.colors.accent });
const quickActionConfigIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const iconAccentForegroundMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });

import {
  View,
  Text,
  Image,
  Pressable,
  ActivityIndicator,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  StyleProp,
  ViewStyle,
  type TextStyle,
} from "react-native";
import { MarkdownParagraphView, MarkdownTextSpan } from "@/components/markdown-text";
import { AppearanceStyleBoundary } from "@/components/appearance-style-boundary";
import * as React from "react";
import {
  useState,
  useEffect,
  useRef,
  memo,
  useMemo,
  useCallback,
  createContext,
  useContext,
  isValidElement,
  Children,
  cloneElement,
} from "react";
import type { ReactNode, ComponentType } from "react";
import Markdown, {
  MarkdownIt,
  type ASTNode,
  type RenderRules,
} from "react-native-markdown-display";
import MaskedView from "@react-native-masked-view/masked-view";
import {
  Circle,
  Info,
  CheckCircle,
  XCircle,
  FileText,
  ChevronRight,
  ChevronDown,
  Check,
  CheckSquare,
  Copy,
  TriangleAlertIcon,
  Scissors,
  MicVocal,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileSymlink,
  Pencil,
  Presentation,
  Sparkles,
  type LucideIcon,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { type Theme } from "@/styles/theme";
import { useIsCompactFormFactor } from "@/constants/layout";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from "react-native-svg";
import { createMarkdownStyles } from "@/styles/markdown-styles";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import type { TodoEntry, UserMessageImageAttachment } from "@/types/stream";
import type { AgentAttachment } from "@getdoya/protocol/messages";
import type { ToolCallDetail } from "@getdoya/protocol/agent-types";
import { buildToolCallPresentation } from "@/tool-calls/presentation";
import { resolveToolCallIcon } from "@/utils/tool-call-icon";
import { getMarkdownListMarker, getMarkdownListSpacing } from "@/utils/markdown-list";
import { useStableEvent } from "@/hooks/use-stable-event";
import { HighlightedCodeBlock } from "@/components/highlighted-code-block";
import { splitMarkdownBlocks } from "@/utils/split-markdown-blocks";
import { formatDuration, formatMessageTimestamp } from "@/utils/time";
import { writeMarkdownToRichClipboard } from "@/utils/rich-clipboard";
import { getDefaultMarkdownClipboardEnvironment } from "@/utils/rich-clipboard-default-environment";
import {
  getAssistantImageLoadStateFromMetadata,
  getAssistantImageMetadata,
  setAssistantImageMetadata,
  type AssistantImageLoadState,
} from "@/utils/assistant-image-metadata";
import { setAssistantMarkdownBlockHeight } from "@/utils/assistant-message-height-estimate";
import { resolveAssistantImageSource } from "@/utils/assistant-image-source";
import { PlanCard } from "./plan-card";
import { useToolCallSheet } from "./tool-call-sheet";
import { ToolCallDetailsContent } from "./tool-call-details";
import {
  AssistantInlineCodePathLink,
  type AssistantFileLinkSource,
  AssistantMarkdownCodeLink,
  AssistantMarkdownLink,
  type InlinePathTarget,
  useAssistantFileLinkActions,
} from "@/assistant-file-links";
import { getCompactionMarkerLabel } from "./message-compaction-label";
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";
import type { AttachmentMetadata } from "@/attachments/types";
import { Button } from "@/components/ui/button";
import { filterUserMessageDisplayAttachments } from "@/components/user-message-attachments";
import {
  getDoyaMessageVisibleText,
  parseDoyaMessageCard,
  parseDoyaMessageRenderParts,
  type DoyaMessageCard,
} from "@/utils/doya-message-markup";
import type { DaemonClient } from "@getdoya/client/internal/daemon-client";
import { isWeb, isNative } from "@/constants/platform";
import type { AgentCapabilityFlags } from "@getdoya/protocol/agent-types";
import { RewindMenu, type RewindMode } from "@/components/rewind/rewind-menu";
import { useRewindAgentMutation } from "@/components/rewind/use-rewind-agent-mutation";
import { translateNow } from "@/i18n/i18n";
export type { InlinePathTarget } from "@/assistant-file-links";

type MarkdownStyles = Record<string, TextStyle & ViewStyle & { [key: string]: unknown }>;

interface UserMessageProps {
  serverId?: string;
  agentId?: string;
  messageId?: string;
  workspaceRoot?: string;
  message: string;
  images?: UserMessageImageAttachment[];
  attachments?: AgentAttachment[];
  selectionPreviewUri?: string;
  selectionImageSource?: string;
  selectionImage?: AttachmentMetadata;
  timestamp: number;
  capabilities?: AgentCapabilityFlags;
  client?: DaemonClient | null;
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
  disableOuterSpacing?: boolean;
}

const MessageOuterSpacingContext = createContext(false);

export function MessageOuterSpacingProvider({
  disableOuterSpacing,
  children,
}: {
  disableOuterSpacing: boolean;
  children: ReactNode;
}) {
  return (
    <MessageOuterSpacingContext.Provider value={disableOuterSpacing}>
      {children}
    </MessageOuterSpacingContext.Provider>
  );
}

function useDisableOuterSpacing(disableOuterSpacing: boolean | undefined) {
  const contextValue = useContext(MessageOuterSpacingContext);
  return disableOuterSpacing ?? contextValue;
}

const WEB_TOOLCALL_SHIMMER_KEYFRAME_ID = "doya-toolcall-shimmer-keyframes";
const WEB_TOOLCALL_SHIMMER_ANIMATION_NAME = "doya-toolcall-shimmer";
const MARKDOWN_ALLOWED_IMAGE_HANDLERS = [
  "data:image/png;base64",
  "data:image/gif;base64",
  "data:image/jpeg;base64",
  "https://",
  "http://",
] as const;
const MARKDOWN_TOP_LEVEL_MAX_EXCEEDED_ITEM = <Text key="dotdotdot">...</Text>;

interface MarkdownWithStableRendererProps {
  children: ReactNode;
  style: ReturnType<typeof createMarkdownStyles>;
  rules: RenderRules;
  markdownit: MarkdownIt;
  onLinkPress: (url: string) => boolean;
  allowedImageHandlers: readonly string[];
  topLevelMaxExceededItem: ReactNode;
}

const MarkdownWithStableRenderer = Markdown as ComponentType<MarkdownWithStableRendererProps>;
const ThemedMarkdown = withUnistyles(MarkdownWithStableRenderer);
const markdownStyleMapping = (theme: Theme): Partial<MarkdownWithStableRendererProps> => ({
  style: createMarkdownStyles(theme),
});

const ThemedMicVocal = withUnistyles(MicVocal);
const ThemedTodoCheckIcon = withUnistyles(Check);
const ThemedFileSymlinkIcon = withUnistyles(FileSymlink);
const ThemedTriangleAlertIcon = withUnistyles(TriangleAlertIcon);
const ThemedChevronRightIcon = withUnistyles(ChevronRight);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const mutedForegroundColorMapping = (theme: Theme) => ({
  color: theme.colors.mutedForeground,
});
const primaryForegroundColorMapping = (theme: Theme) => ({
  color: theme.colors.primaryForeground,
});
const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });
const WEB_TOOLCALL_SHIMMER_KEYFRAME_CSS = `
  @keyframes ${WEB_TOOLCALL_SHIMMER_ANIMATION_NAME} {
    0% {
      background-position: var(--doya-shimmer-start, -200px) 0;
    }
    100% {
      background-position: var(--doya-shimmer-end, 200px) 0;
    }
  }
`;
let webToolCallShimmerRegistered = false;
const SCROLL_EDGE_EPSILON = 0.5;

// Font size for stream metadata (timestamps, durations, live elapsed timer).
// Lives between theme.fontSize.xs (12) and theme.fontSize.sm (14); no token.
export const STREAM_METADATA_FONT_SIZE = 13;
type ScrollAxis = "x" | "y";

function ensureWebToolCallShimmerKeyframes() {
  if (isNative) {
    return;
  }
  if (typeof document === "undefined") {
    return;
  }
  const existing = document.getElementById(WEB_TOOLCALL_SHIMMER_KEYFRAME_ID);
  if (existing) {
    if (existing.textContent !== WEB_TOOLCALL_SHIMMER_KEYFRAME_CSS) {
      existing.textContent = WEB_TOOLCALL_SHIMMER_KEYFRAME_CSS;
    }
    webToolCallShimmerRegistered = true;
    return;
  }
  if (webToolCallShimmerRegistered) {
    return;
  }
  const styleElement = document.createElement("style");
  styleElement.id = WEB_TOOLCALL_SHIMMER_KEYFRAME_ID;
  styleElement.textContent = WEB_TOOLCALL_SHIMMER_KEYFRAME_CSS;
  document.head.appendChild(styleElement);
  webToolCallShimmerRegistered = true;
}

function getWheelEventElementTarget(event: WheelEvent, fallback: HTMLElement): HTMLElement {
  const { target } = event;
  if (target instanceof HTMLElement) {
    return target;
  }
  if (target instanceof Node && target.parentElement) {
    return target.parentElement;
  }
  return fallback;
}

function canElementScrollInDirection(
  element: HTMLElement,
  axis: ScrollAxis,
  delta: number,
): boolean {
  if (delta === 0) {
    return false;
  }

  const computedStyle = window.getComputedStyle(element);
  const overflow = axis === "x" ? computedStyle.overflowX : computedStyle.overflowY;
  const isScrollableOverflow =
    overflow === "auto" || overflow === "scroll" || overflow === "overlay";
  if (!isScrollableOverflow) {
    return false;
  }

  const scrollPosition = axis === "x" ? element.scrollLeft : element.scrollTop;
  const scrollSize =
    axis === "x"
      ? element.scrollWidth - element.clientWidth
      : element.scrollHeight - element.clientHeight;
  if (scrollSize <= SCROLL_EDGE_EPSILON) {
    return false;
  }

  if (delta > 0) {
    return scrollPosition < scrollSize - SCROLL_EDGE_EPSILON;
  }
  return scrollPosition > SCROLL_EDGE_EPSILON;
}

function canScrollInsideDetailFromTarget(
  detailRoot: HTMLElement,
  startElement: HTMLElement,
  axis: ScrollAxis,
  delta: number,
): boolean {
  if (delta === 0) {
    return false;
  }

  let current: HTMLElement | null = startElement;
  while (current) {
    if (canElementScrollInDirection(current, axis, delta)) {
      return true;
    }
    if (current === detailRoot) {
      break;
    }
    current = current.parentElement;
  }
  return false;
}

function shouldStopDetailWheelPropagation(detailRoot: HTMLElement, event: WheelEvent): boolean {
  const startElement = getWheelEventElementTarget(event, detailRoot);
  const verticalDelta = event.deltaY;
  let horizontalDelta: number;
  if (event.deltaX !== 0) horizontalDelta = event.deltaX;
  else if (event.shiftKey) horizontalDelta = event.deltaY;
  else horizontalDelta = 0;

  const hasVerticalIntent = Math.abs(verticalDelta) > SCROLL_EDGE_EPSILON;
  const hasHorizontalIntent = Math.abs(horizontalDelta) > SCROLL_EDGE_EPSILON;
  if (!hasVerticalIntent && !hasHorizontalIntent) {
    return false;
  }

  const canScrollVertically = hasVerticalIntent
    ? canScrollInsideDetailFromTarget(detailRoot, startElement, "y", verticalDelta)
    : false;
  const canScrollHorizontally = hasHorizontalIntent
    ? canScrollInsideDetailFromTarget(detailRoot, startElement, "x", horizontalDelta)
    : false;

  if (hasVerticalIntent && hasHorizontalIntent) {
    const isVerticalDominant = Math.abs(verticalDelta) >= Math.abs(horizontalDelta);
    return isVerticalDominant
      ? canScrollVertically || canScrollHorizontally
      : canScrollHorizontally || canScrollVertically;
  }

  if (hasVerticalIntent) {
    return canScrollVertically;
  }
  return canScrollHorizontally;
}

const userMessageStylesheet = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    justifyContent: "flex-end",
    ...(isWeb ? { userSelect: "text" as const } : {}),
  },
  content: {
    alignItems: "flex-end",
    maxWidth: "100%",
    cursor: "auto",
  },
  containerSpacing: {
    marginBottom: theme.spacing[1],
  },
  containerFirstInGroup: {
    marginTop: theme.spacing[4],
  },
  containerLastInGroup: {
    marginBottom: theme.spacing[4],
  },
  bubble: {
    backgroundColor: theme.colors.surface3,
    borderRadius: theme.borderRadius["2xl"],
    borderTopRightRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[4],
    minWidth: 0,
    flexShrink: 1,
  },
  doyaBubble: {
    backgroundColor: "transparent",
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  text: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: 22,
    overflowWrap: "anywhere",
  },
  imagePreviewContainer: {
    flexDirection: "row",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  attachmentPreviewContainer: {
    flexDirection: "row",
    gap: theme.spacing[2],
    flexWrap: "wrap",
    maxWidth: "100%",
  },
  imagePreviewSpacing: {
    marginBottom: theme.spacing[2],
  },
  imagePill: {
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    overflow: "hidden",
  },
  selectionReferenceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginBottom: theme.spacing[2],
  },
  selectionReferenceArrow: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xl,
    lineHeight: theme.fontSize.xl * 1.2,
  },
  selectionReferenceThumb: {
    width: 48,
    height: 36,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface2,
  },
  selectionReferenceText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.medium,
  },
  imageThumbnail: {
    width: 48,
    height: 48,
  },
  imageThumbnailPlaceholder: {
    width: 48,
    height: 48,
    backgroundColor: theme.colors.surface1,
  },
  structuredAttachmentCard: {
    maxWidth: 360,
    minHeight: 42,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: "rgba(24, 24, 27, 0.08)",
    backgroundColor: "rgba(255, 255, 255, 0.78)",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    shadowColor: "#000000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  structuredAttachmentIconBox: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  structuredAttachmentText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: 220,
  },
  structuredAttachmentBadge: {
    borderRadius: theme.borderRadius.sm,
    borderWidth: theme.borderWidth[1],
    borderColor: "rgba(24, 24, 27, 0.08)",
    backgroundColor: "rgba(244, 244, 245, 0.86)",
    paddingHorizontal: theme.spacing[1],
    paddingVertical: 2,
  },
  structuredAttachmentBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    lineHeight: 14,
  },
  doyaCard: {
    width: 620,
    maxWidth: "100%",
    minHeight: 176,
    position: "relative",
    overflow: "hidden",
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    paddingLeft: 22,
    paddingRight: 24,
    paddingVertical: 20,
    gap: theme.spacing[3],
    shadowColor: "#000000",
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  doyaCardResult: {
    width: 620,
    minHeight: 116,
    paddingLeft: 34,
    paddingVertical: 16,
    gap: theme.spacing[2],
  },
  doyaCardStripe: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  doyaCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingRight: 148,
  },
  doyaCardHeaderResult: {
    gap: theme.spacing[2],
    paddingRight: 110,
    paddingLeft: 2,
  },
  doyaCardIconBox: {
    width: 48,
    height: 48,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: theme.borderWidth[1],
  },
  doyaCardIconBoxResult: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.md,
    marginLeft: 2,
  },
  doyaCardTitleGroup: {
    flex: 1,
    minWidth: 0,
  },
  doyaCardResultTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  doyaCardTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 24,
    marginBottom: 1,
  },
  doyaCardTitleResult: {
    flexShrink: 1,
    fontSize: theme.fontSize.base,
    lineHeight: 22,
    marginBottom: 0,
  },
  doyaCardKind: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
    flexShrink: 1,
  },
  doyaCardMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  doyaCardBadge: {
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 1,
  },
  doyaCardBadgeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    lineHeight: 14,
  },
  doyaCardSummary: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: 22,
    paddingRight: 148,
  },
  doyaCardSummaryResult: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    paddingRight: 112,
  },
  doyaCardFieldList: {
    gap: 3,
    paddingRight: 132,
    marginTop: 2,
  },
  doyaCardFieldListResult: {
    paddingRight: 112,
    marginTop: 0,
  },
  doyaCardFieldRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
    minWidth: 0,
  },
  doyaCardFieldLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    minWidth: 38,
  },
  doyaCardFieldValue: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  doyaCardIllustration: {
    position: "absolute",
    right: 0,
    top: 0,
    width: 154,
    height: 154,
    opacity: 1,
  },
  doyaCardIllustrationResult: {
    width: 126,
    height: 112,
    opacity: 0.82,
  },
  doyaCardHalo: {
    position: "absolute",
    right: -50,
    top: -58,
    width: 196,
    height: 196,
    borderRadius: 98,
  },
  doyaCardIllustrationPlate: {
    position: "absolute",
    right: 18,
    top: 24,
    width: 98,
    height: 88,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
  },
  doyaCardAccentWash: {
    position: "absolute",
    right: -40,
    bottom: -30,
    width: 178,
    height: 112,
    borderTopLeftRadius: 90,
  },
  doyaCardDecorRail: {
    position: "absolute",
    right: 17,
    bottom: 16,
    width: 104,
    height: 32,
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    paddingHorizontal: 7,
    paddingVertical: 5,
    gap: 4,
    opacity: 0.72,
  },
  doyaCardDecorRailLine: {
    height: 4,
    borderRadius: 3,
  },
  doyaCardDecorRailLineShort: {
    width: "58%",
  },
  doyaCardDecorRailLineLong: {
    width: "86%",
  },
  doyaCardDecorDots: {
    position: "absolute",
    right: 30,
    bottom: 58,
    flexDirection: "row",
    gap: 4,
  },
  doyaCardDecorDot: {
    width: 4,
    height: 4,
    borderRadius: 3,
  },
  doyaCardMiniDoc: {
    position: "absolute",
    right: 32,
    top: 31,
    width: 58,
    height: 72,
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    backgroundColor: "rgba(255, 255, 255, 0.86)",
    paddingHorizontal: 7,
    paddingTop: 24,
    gap: 5,
  },
  doyaCardMiniDocFold: {
    position: "absolute",
    right: -1,
    top: -1,
    width: 16,
    height: 16,
    borderBottomLeftRadius: theme.borderRadius.sm,
    borderWidth: theme.borderWidth[1],
  },
  doyaCardMiniBadge: {
    position: "absolute",
    left: 7,
    top: 7,
    borderRadius: 5,
    borderWidth: theme.borderWidth[1],
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  doyaCardMiniBadgeText: {
    color: "#ffffff",
    fontSize: 7,
    fontWeight: theme.fontWeight.semibold,
    lineHeight: 9,
  },
  doyaCardMiniLine: {
    height: 4,
    borderRadius: 2,
  },
  doyaCardMiniLineShort: {
    width: "58%",
  },
  doyaCardMiniLineLong: {
    width: "86%",
  },
  doyaCardMiniSlide: {
    position: "absolute",
    right: 27,
    top: 34,
    width: 82,
    height: 58,
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    backgroundColor: "rgba(255, 255, 255, 0.84)",
    padding: 7,
    gap: 5,
  },
  doyaCardMiniSlideBar: {
    width: "54%",
    height: 5,
    borderRadius: 3,
  },
  doyaCardMiniTypeText: {
    position: "absolute",
    right: 7,
    top: 6,
    fontSize: 7,
    fontWeight: theme.fontWeight.semibold,
    lineHeight: 9,
  },
  doyaCardMiniSlideRow: {
    flexDirection: "row",
    gap: 4,
    alignItems: "flex-end",
    marginTop: 2,
  },
  doyaCardMiniSlideColumn: {
    width: 7,
    borderRadius: 3,
  },
  doyaCardMiniSheet: {
    position: "absolute",
    right: 27,
    top: 32,
    width: 82,
    height: 62,
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    backgroundColor: "rgba(255, 255, 255, 0.84)",
    paddingHorizontal: 7,
    paddingBottom: 6,
    paddingTop: 18,
    gap: 4,
  },
  doyaCardMiniSheetHeader: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 14,
    borderTopLeftRadius: theme.borderRadius.md,
    borderTopRightRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  doyaCardMiniSheetHeaderText: {
    color: "#ffffff",
    fontSize: 7,
    fontWeight: theme.fontWeight.semibold,
    lineHeight: 9,
  },
  doyaCardMiniSheetRow: {
    flexDirection: "row",
    gap: 4,
  },
  doyaCardMiniSheetCell: {
    width: 13,
    height: 7,
    borderRadius: 2,
  },
  doyaCardMiniImage: {
    position: "absolute",
    right: 27,
    top: 32,
    width: 82,
    height: 62,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    backgroundColor: "rgba(255, 255, 255, 0.84)",
    overflow: "hidden",
  },
  doyaCardMiniImageSun: {
    position: "absolute",
    right: 9,
    top: 8,
    width: 11,
    height: 11,
    borderRadius: 6,
  },
  doyaCardMiniImageFrame: {
    position: "absolute",
    left: 8,
    top: 8,
    width: 22,
    height: 16,
    borderRadius: 4,
    borderWidth: theme.borderWidth[1],
  },
  doyaCardMiniImageHill: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 18,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  doyaProgressCard: {
    width: 620,
    maxWidth: "100%",
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: "rgba(179, 90, 24, 0.14)",
    backgroundColor: "rgba(255, 253, 249, 0.82)",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
  },
  doyaProgressIconBox: {
    width: 30,
    height: 30,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(179, 90, 24, 0.1)",
    borderWidth: theme.borderWidth[1],
    borderColor: "rgba(179, 90, 24, 0.18)",
    marginTop: 1,
  },
  doyaProgressBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  doyaProgressTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 21,
  },
  doyaProgressSummary: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  doyaProgressFieldList: {
    marginTop: theme.spacing[1],
    gap: 2,
  },
  doyaProgressFieldRow: {
    flexDirection: "row",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  doyaProgressFieldLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 17,
    minWidth: 34,
  },
  doyaProgressFieldValue: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 17,
  },
  copyButton: {
    alignSelf: "center",
    padding: theme.spacing[1],
    paddingTop: theme.spacing[1],
    marginTop: 0,
    marginRight: -theme.spacing[1],
  },
  trailingRow: {
    alignSelf: "flex-end",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  trailingRowHidden: {
    opacity: 0,
  },
  trailingRowVisible: {
    opacity: 1,
  },
  timestampText: {
    color: theme.colors.foregroundMuted,
    fontSize: STREAM_METADATA_FONT_SIZE,
  },
}));

function useAssistantResolvedImage(input: {
  source?: string | null;
  client?: DaemonClient | null;
  workspaceRoot?: string;
  serverId?: string;
}): {
  uri: string | null;
  editableImage: AttachmentMetadata | null;
  isLoading: boolean;
  errorText: string;
} {
  const source = input.source?.trim() || "";
  const resolution = useMemo(
    () =>
      source ? resolveAssistantImageSource({ source, workspaceRoot: input.workspaceRoot }) : null,
    [source, input.workspaceRoot],
  );
  const workspaceFileUri = useMemo(() => {
    if (!input.client || resolution?.kind !== "file_rpc") {
      return null;
    }
    return input.client.buildWorkspaceFileRawUrl({
      cwd: resolution.cwd,
      path: resolution.path,
    });
  }, [input.client, resolution]);

  const directUri = resolution?.kind === "direct" ? resolution.uri : null;
  const editableImage = useMemo(() => {
    if (!workspaceFileUri || resolution?.kind !== "file_rpc") {
      return null;
    }
    return buildAssistantWorkspaceEditableImage({
      cwd: resolution.cwd,
      path: resolution.path,
      previewUri: workspaceFileUri,
    });
  }, [resolution, workspaceFileUri]);

  return {
    uri: directUri ?? workspaceFileUri ?? null,
    editableImage,
    isLoading: false,
    errorText: "Unable to load image preview.",
  };
}

function buildAssistantWorkspaceEditableImage(input: {
  cwd: string;
  path: string;
  previewUri: string;
}): AttachmentMetadata & { fallbackPreviewUrl: string } {
  const fileName = getPathFileName(input.path) ?? "assistant-image.png";
  return {
    id: `assistant_workspace_image_${hashStableString(`${input.cwd}\0${input.path}`)}`,
    mimeType: inferImageMimeType(fileName),
    storageType: "desktop-file",
    storageKey: resolveWorkspaceFileStorageKey(input),
    fileName,
    byteSize: null,
    createdAt: Date.now(),
    fallbackPreviewUrl: input.previewUri,
  };
}

function resolveWorkspaceFileStorageKey(input: { cwd: string; path: string }): string {
  const path = input.path.trim();
  if (!path || isAbsoluteFilePath(path) || path.startsWith("~")) {
    return path;
  }
  const cwd = input.cwd.trim();
  if (!cwd) {
    return path;
  }
  const separator = cwd.endsWith("/") || cwd.endsWith("\\") ? "" : "/";
  return `${cwd}${separator}${path.replace(/^[\\/]+/u, "")}`;
}

function isAbsoluteFilePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path);
}

function getPathFileName(path: string): string | null {
  const normalized = path.trim().replace(/\\/gu, "/");
  const parts = normalized.split("/");
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const fileName = parts[index]?.trim();
    if (fileName) {
      return fileName;
    }
  }
  return null;
}

function inferImageMimeType(fileName: string): string {
  const extension = fileName.match(/\.([A-Za-z0-9]+)$/u)?.[1]?.toLowerCase();
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "avif":
      return "image/avif";
    case "svg":
      return "image/svg+xml";
    default:
      return "image/png";
  }
}

function hashStableString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function UserMessageAttachmentThumbnail({
  image,
  client,
  workspaceRoot,
}: {
  image: UserMessageImageAttachment;
  client?: DaemonClient | null;
  workspaceRoot?: string;
}) {
  const isWorkspaceImage = isWorkspaceUserMessageImage(image);
  const attachmentUri = useAttachmentPreviewUrl(isWorkspaceImage ? null : image);
  const workspaceUri = useMemo(() => {
    if (!isWorkspaceImage) {
      return null;
    }
    const rawTarget = resolveWorkspaceImageRawTarget({
      image,
      workspaceRoot,
    });
    if (client && rawTarget) {
      return client.buildWorkspaceFileRawUrl({
        cwd: rawTarget.cwd,
        path: rawTarget.path,
      });
    }
    return image.url ?? null;
  }, [client, image, isWorkspaceImage, workspaceRoot]);
  const uri = isWorkspaceImage ? workspaceUri : attachmentUri;
  const imageSource = useMemo(() => ({ uri: uri ?? "" }), [uri]);
  if (!uri) {
    return <View style={userMessageStylesheet.imageThumbnailPlaceholder} />;
  }
  return <Image source={imageSource} style={userMessageStylesheet.imageThumbnail} />;
}

function isWorkspaceUserMessageImage(
  image: UserMessageImageAttachment,
): image is Extract<UserMessageImageAttachment, { kind: "workspace_image" }> {
  return "kind" in image && image.kind === "workspace_image";
}

function resolveWorkspaceImageRawTarget(input: {
  image: Extract<UserMessageImageAttachment, { kind: "workspace_image" }>;
  workspaceRoot?: string;
}): { cwd: string; path: string } | null {
  const cwd = input.image.cwd?.trim() || input.workspaceRoot?.trim() || "";
  const path = input.image.path.trim();
  if (!path) {
    return null;
  }
  if (cwd) {
    return { cwd, path };
  }
  const normalized = path.replace(/\\/g, "/");
  const attachmentIndex = normalized.lastIndexOf("/attachments/");
  if (attachmentIndex < 0) {
    return null;
  }
  const inferredCwd = normalized.slice(0, attachmentIndex);
  const relativePath = normalized.slice(attachmentIndex + 1);
  return inferredCwd && relativePath ? { cwd: inferredCwd, path: relativePath } : null;
}

function UserMessageSelectionReference({
  previewUri,
  source,
  image,
  client,
  workspaceRoot,
  serverId,
}: {
  previewUri?: string;
  source?: string;
  image?: Extract<UserMessageImageAttachment, AttachmentMetadata>;
  client?: DaemonClient | null;
  workspaceRoot?: string;
  serverId?: string;
}) {
  const sourceImage = useAssistantResolvedImage({ source, client, workspaceRoot, serverId });
  const imagePreviewUri = useAttachmentPreviewUrl(image);
  const resolvedPreviewUri = previewUri ?? sourceImage.uri ?? imagePreviewUri;
  const imageSource = useMemo(() => ({ uri: resolvedPreviewUri ?? "" }), [resolvedPreviewUri]);
  if (!source && !resolvedPreviewUri && !image && !previewUri) {
    return null;
  }
  return (
    <View style={userMessageStylesheet.selectionReferenceRow}>
      <Text style={userMessageStylesheet.selectionReferenceArrow}>↳</Text>
      {resolvedPreviewUri ? (
        <Image
          source={imageSource}
          style={userMessageStylesheet.selectionReferenceThumb}
          resizeMode="cover"
        />
      ) : (
        <View style={userMessageStylesheet.selectionReferenceThumb} />
      )}
      <Text style={userMessageStylesheet.selectionReferenceText}>
        {translateNow("aiCreation.display.selectionReference")}
      </Text>
    </View>
  );
}

function getUserMessageAttachmentLabel(attachment: AgentAttachment): string {
  switch (attachment.type) {
    case "review": {
      const count = attachment.comments.length;
      return count === 1 ? "Review · 1 comment" : `Review · ${count} comments`;
    }
    case "github_pr":
      return `PR #${attachment.number}`;
    case "github_issue":
      return `Issue #${attachment.number}`;
    case "text":
      return attachment.title ?? "Text attachment";
    case "file":
      return attachment.title ?? "File attachment";
    default:
      return "";
  }
}

function getAttachmentOriginalMimeType(attachment: AgentAttachment): string {
  if (attachment.type === "text") {
    const match = attachment.text.match(/^MIME type:\s*(.+)$/m);
    return match?.[1]?.trim() || attachment.mimeType;
  }
  if (attachment.type === "file") {
    return attachment.mimeType;
  }
  return attachment.mimeType;
}

function getAttachmentExtension(title: string): string {
  const cleanTitle = title.trim().replace(/[?#].*$/, "");
  const extension = cleanTitle.includes(".") ? cleanTitle.split(".").pop()?.trim() : "";
  return extension ? extension.slice(0, 8).toUpperCase() : "FILE";
}

function getUserMessageAttachmentVisual(attachment: AgentAttachment): {
  Icon: LucideIcon;
  color: string;
  backgroundColor: string;
  badge: string;
} {
  const title = getUserMessageAttachmentLabel(attachment);
  const mimeType = getAttachmentOriginalMimeType(attachment).toLowerCase();
  const extension = getAttachmentExtension(title);

  if (attachment.type === "github_pr" || attachment.type === "github_issue") {
    return { Icon: FileSymlink, color: "#6366f1", backgroundColor: "#eef2ff", badge: "GH" };
  }
  if (attachment.type === "review") {
    return { Icon: CheckSquare, color: "#7c3aed", backgroundColor: "#f3e8ff", badge: "REVIEW" };
  }
  if (mimeType.includes("pdf") || extension === "PDF") {
    return { Icon: FileText, color: "#ef4444", backgroundColor: "#fee2e2", badge: "PDF" };
  }
  if (mimeType.includes("wordprocessingml") || ["DOC", "DOCX"].includes(extension)) {
    return { Icon: FileText, color: "#2563eb", backgroundColor: "#dbeafe", badge: extension };
  }
  if (
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel") ||
    ["CSV", "XLS", "XLSX"].includes(extension)
  ) {
    return {
      Icon: FileSpreadsheet,
      color: "#16a34a",
      backgroundColor: "#dcfce7",
      badge: extension,
    };
  }
  if (mimeType.includes("presentation") || ["PPT", "PPTX"].includes(extension)) {
    return { Icon: Presentation, color: "#f97316", backgroundColor: "#ffedd5", badge: extension };
  }
  if (
    mimeType.startsWith("image/") ||
    ["PNG", "JPG", "JPEG", "WEBP", "GIF", "SVG", "AVIF", "BMP", "TIFF"].includes(extension)
  ) {
    return { Icon: FileImage, color: "#8b5cf6", backgroundColor: "#ede9fe", badge: extension };
  }
  if (["ZIP", "RAR", "7Z", "TAR", "GZ"].includes(extension)) {
    return { Icon: FileArchive, color: "#a16207", backgroundColor: "#fef3c7", badge: extension };
  }
  if (
    mimeType.startsWith("text/") ||
    ["TXT", "MD", "JSON", "TS", "TSX", "JS", "CSS", "HTML"].includes(extension)
  ) {
    return { Icon: FileText, color: "#64748b", backgroundColor: "#e2e8f0", badge: extension };
  }
  return { Icon: File, color: "#71717a", backgroundColor: "#f4f4f5", badge: extension };
}

function UserMessageStructuredAttachment({ attachment }: { attachment: AgentAttachment }) {
  const label = getUserMessageAttachmentLabel(attachment);
  const visual = getUserMessageAttachmentVisual(attachment);
  const Icon = visual.Icon;
  const iconBoxStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      userMessageStylesheet.structuredAttachmentIconBox,
      { backgroundColor: visual.backgroundColor },
    ],
    [visual.backgroundColor],
  );
  return (
    <View style={userMessageStylesheet.structuredAttachmentCard}>
      <View style={iconBoxStyle}>
        <Icon size={18} color={visual.color} strokeWidth={2.2} />
      </View>
      <Text style={userMessageStylesheet.structuredAttachmentText} numberOfLines={1}>
        {label}
      </Text>
      <View style={userMessageStylesheet.structuredAttachmentBadge}>
        <Text style={userMessageStylesheet.structuredAttachmentBadgeText} numberOfLines={1}>
          {visual.badge}
        </Text>
      </View>
    </View>
  );
}

function getDoyaMessageKindLabel(kind: string): string {
  switch (kind) {
    case "ppt.apply_annotations":
      return "PPT 标注任务";
    case "ppt.apply_annotations.result":
      return "PPT 标注结果";
    case "document.apply_annotations":
      return "文件标注任务";
    case "document.apply_annotations.result":
      return "文件标注结果";
    default:
      if (kind.startsWith("ai_creation.") && kind.endsWith(".result")) {
        return "AI 创作结果";
      }
      if (kind.startsWith("ai_creation.")) {
        return "AI 创作任务";
      }
      return kind;
  }
}

function isDoyaSlidesProgressCard(card: DoyaMessageCard): boolean {
  return card.kind === "ai_creation.slides.progress";
}

type DoyaMessageCardIllustrationKind = "image" | "slides" | "pdf" | "word" | "sheet" | "generic";

const DOYA_SLIDE_COLUMN_HEIGHTS = [16, 24, 11] as const;
const DOYA_SHEET_ROWS = [0, 1, 2, 3] as const;
const DOYA_SHEET_COLUMNS = [0, 1, 2] as const;

interface DoyaMessageCardVisual {
  Icon: LucideIcon;
  badge: string;
  accent: string;
  accentMuted: string;
  iconBackground: string;
  iconBorder: string;
  cardBackground: string;
  borderColor: string;
  stripeColor: string;
  haloColor: string;
  illustration: DoyaMessageCardIllustrationKind;
}

function getDoyaMessageCardVisual(card: DoyaMessageCard): DoyaMessageCardVisual {
  const fileType = getDoyaMessageCardFileType(card);
  if (card.kind.includes(".spreadsheet.") || fileType === "xlsx" || fileType === "csv") {
    return {
      Icon: FileSpreadsheet,
      badge: fileType === "csv" ? "CSV" : "XLSX",
      accent: "#137a4b",
      accentMuted: "rgba(19, 122, 75, 0.66)",
      iconBackground: "rgba(19, 122, 75, 0.12)",
      iconBorder: "rgba(19, 122, 75, 0.22)",
      cardBackground: "#fbfdfc",
      borderColor: "rgba(19, 122, 75, 0.18)",
      stripeColor: "#1f9d63",
      haloColor: "rgba(31, 157, 99, 0.08)",
      illustration: "sheet",
    };
  }

  if (card.kind.includes(".slides.") || card.kind.startsWith("ppt.") || fileType === "pptx") {
    return {
      Icon: Presentation,
      badge: "PPTX",
      accent: "#b35a18",
      accentMuted: "rgba(179, 90, 24, 0.64)",
      iconBackground: "rgba(179, 90, 24, 0.12)",
      iconBorder: "rgba(179, 90, 24, 0.22)",
      cardBackground: "#fffdf9",
      borderColor: "rgba(179, 90, 24, 0.18)",
      stripeColor: "#e67e22",
      haloColor: "rgba(230, 126, 34, 0.08)",
      illustration: "slides",
    };
  }

  if (card.kind.includes(".document.pdf.") || fileType === "pdf") {
    return {
      Icon: FileText,
      badge: "PDF",
      accent: "#c2413a",
      accentMuted: "rgba(194, 65, 58, 0.62)",
      iconBackground: "rgba(194, 65, 58, 0.11)",
      iconBorder: "rgba(194, 65, 58, 0.2)",
      cardBackground: "#fffdfd",
      borderColor: "rgba(194, 65, 58, 0.17)",
      stripeColor: "#e0524b",
      haloColor: "rgba(224, 82, 75, 0.08)",
      illustration: "pdf",
    };
  }

  if (card.kind.includes(".document.word.") || fileType === "docx") {
    return {
      Icon: FileText,
      badge: "DOCX",
      accent: "#2f63c7",
      accentMuted: "rgba(47, 99, 199, 0.62)",
      iconBackground: "rgba(47, 99, 199, 0.11)",
      iconBorder: "rgba(47, 99, 199, 0.2)",
      cardBackground: "#fbfdff",
      borderColor: "rgba(47, 99, 199, 0.16)",
      stripeColor: "#4d7ee8",
      haloColor: "rgba(77, 126, 232, 0.08)",
      illustration: "word",
    };
  }

  if (card.kind.startsWith("document.apply_annotations")) {
    return {
      Icon: FileText,
      badge: "FILE",
      accent: "#475569",
      accentMuted: "rgba(71, 85, 105, 0.58)",
      iconBackground: "rgba(71, 85, 105, 0.12)",
      iconBorder: "rgba(71, 85, 105, 0.16)",
      cardBackground: "#f8fafc",
      borderColor: "rgba(71, 85, 105, 0.14)",
      stripeColor: "#475569",
      haloColor: "rgba(71, 85, 105, 0.08)",
      illustration: "word",
    };
  }

  if (card.kind.includes(".image.") || fileType === "image") {
    return {
      Icon: FileImage,
      badge: "IMG",
      accent: "#9b4fb8",
      accentMuted: "rgba(155, 79, 184, 0.6)",
      iconBackground: "rgba(155, 79, 184, 0.11)",
      iconBorder: "rgba(155, 79, 184, 0.2)",
      cardBackground: "#fffaff",
      borderColor: "rgba(155, 79, 184, 0.16)",
      stripeColor: "#b862d6",
      haloColor: "rgba(184, 98, 214, 0.08)",
      illustration: "image",
    };
  }

  return {
    Icon: Sparkles,
    badge: "AI",
    accent: "#5f6472",
    accentMuted: "rgba(95, 100, 114, 0.58)",
    iconBackground: "rgba(95, 100, 114, 0.12)",
    iconBorder: "rgba(95, 100, 114, 0.16)",
    cardBackground: "#f8f8fa",
    borderColor: "rgba(95, 100, 114, 0.14)",
    stripeColor: "#5f6472",
    haloColor: "rgba(95, 100, 114, 0.08)",
    illustration: "generic",
  };
}

function getDoyaMessageCardFileType(
  card: DoyaMessageCard,
): "image" | "pptx" | "pdf" | "docx" | "xlsx" | "csv" | null {
  const haystack = [card.kind, card.title, card.summary, ...card.fields.map((field) => field.value)]
    .join(" ")
    .toLowerCase();
  if (/\.(png|jpe?g|webp|gif|avif|svg)\b/.test(haystack) || haystack.includes("图片")) {
    return "image";
  }
  if (/\.pptx?\b/.test(haystack) || haystack.includes("ppt")) {
    return "pptx";
  }
  if (/\.pdf\b/.test(haystack)) {
    return "pdf";
  }
  if (/\.docx?\b/.test(haystack) || haystack.includes("word")) {
    return "docx";
  }
  if (/\.xlsx?\b/.test(haystack) || haystack.includes("excel") || haystack.includes("表格")) {
    return "xlsx";
  }
  if (/\.csv\b/.test(haystack)) {
    return "csv";
  }
  return null;
}

function DoyaCardIllustration({
  visual,
  isResult,
}: {
  visual: DoyaMessageCardVisual;
  isResult: boolean;
}) {
  const haloStyle = useMemo<StyleProp<ViewStyle>>(
    () => [userMessageStylesheet.doyaCardHalo, { backgroundColor: visual.haloColor }],
    [visual.haloColor],
  );
  const washStyle = useMemo<StyleProp<ViewStyle>>(
    () => [userMessageStylesheet.doyaCardAccentWash, { backgroundColor: visual.haloColor }],
    [visual.haloColor],
  );
  const plateStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      userMessageStylesheet.doyaCardIllustrationPlate,
      { backgroundColor: visual.iconBackground, borderColor: visual.borderColor },
    ],
    [visual.borderColor, visual.iconBackground],
  );
  const illustrationStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      userMessageStylesheet.doyaCardIllustration,
      isResult ? userMessageStylesheet.doyaCardIllustrationResult : null,
    ],
    [isResult],
  );

  return (
    <View style={illustrationStyle} pointerEvents="none">
      <View style={washStyle} />
      <View style={haloStyle} />
      <View style={plateStyle} />
      {visual.illustration === "sheet" ? <DoyaSheetIllustration visual={visual} /> : null}
      {visual.illustration === "slides" ? <DoyaSlidesIllustration visual={visual} /> : null}
      {visual.illustration === "image" ? <DoyaImageIllustration visual={visual} /> : null}
      {visual.illustration === "pdf" || visual.illustration === "word" ? (
        <DoyaDocumentIllustration visual={visual} />
      ) : null}
      {visual.illustration === "generic" ? <DoyaDocumentIllustration visual={visual} /> : null}
      <DoyaCardDecor visual={visual} />
    </View>
  );
}

function DoyaCardDecor({ visual }: { visual: DoyaMessageCardVisual }) {
  const railStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      userMessageStylesheet.doyaCardDecorRail,
      { backgroundColor: visual.iconBackground, borderColor: visual.borderColor },
    ],
    [visual.borderColor, visual.iconBackground],
  );
  const longLineStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      userMessageStylesheet.doyaCardDecorRailLine,
      userMessageStylesheet.doyaCardDecorRailLineLong,
      { backgroundColor: visual.accentMuted },
    ],
    [visual.accentMuted],
  );
  const shortLineStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      userMessageStylesheet.doyaCardDecorRailLine,
      userMessageStylesheet.doyaCardDecorRailLineShort,
      { backgroundColor: visual.iconBackground },
    ],
    [visual.iconBackground],
  );
  const dotStyle = useMemo<StyleProp<ViewStyle>>(
    () => [userMessageStylesheet.doyaCardDecorDot, { backgroundColor: visual.accentMuted }],
    [visual.accentMuted],
  );

  return (
    <>
      <View style={userMessageStylesheet.doyaCardDecorDots}>
        <View style={dotStyle} />
        <View style={dotStyle} />
        <View style={dotStyle} />
      </View>
      <View style={railStyle}>
        <View style={longLineStyle} />
        <View style={shortLineStyle} />
      </View>
    </>
  );
}

function DoyaDocumentIllustration({ visual }: { visual: DoyaMessageCardVisual }) {
  const docStyle = useMemo<StyleProp<ViewStyle>>(
    () => [userMessageStylesheet.doyaCardMiniDoc, { borderColor: visual.borderColor }],
    [visual.borderColor],
  );
  const foldStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      userMessageStylesheet.doyaCardMiniDocFold,
      { backgroundColor: visual.iconBackground, borderColor: visual.borderColor },
    ],
    [visual.borderColor, visual.iconBackground],
  );
  const accentLineStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      userMessageStylesheet.doyaCardMiniLine,
      userMessageStylesheet.doyaCardMiniLineLong,
      { backgroundColor: visual.accent },
    ],
    [visual.accent],
  );
  const mutedLongLineStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      userMessageStylesheet.doyaCardMiniLine,
      userMessageStylesheet.doyaCardMiniLineLong,
      { backgroundColor: visual.iconBackground },
    ],
    [visual.iconBackground],
  );
  const mutedShortLineStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      userMessageStylesheet.doyaCardMiniLine,
      userMessageStylesheet.doyaCardMiniLineShort,
      { backgroundColor: visual.iconBackground },
    ],
    [visual.iconBackground],
  );
  const badgeStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      userMessageStylesheet.doyaCardMiniBadge,
      { backgroundColor: visual.accent, borderColor: visual.borderColor },
    ],
    [visual.accent, visual.borderColor],
  );

  return (
    <View style={docStyle}>
      <View style={foldStyle} />
      <View style={badgeStyle}>
        <Text style={userMessageStylesheet.doyaCardMiniBadgeText}>{visual.badge}</Text>
      </View>
      <View style={accentLineStyle} />
      <View style={mutedLongLineStyle} />
      <View style={mutedShortLineStyle} />
    </View>
  );
}

function DoyaSlidesIllustration({ visual }: { visual: DoyaMessageCardVisual }) {
  const slideStyle = useMemo<StyleProp<ViewStyle>>(
    () => [userMessageStylesheet.doyaCardMiniSlide, { borderColor: visual.borderColor }],
    [visual.borderColor],
  );
  const barStyle = useMemo<StyleProp<ViewStyle>>(
    () => [userMessageStylesheet.doyaCardMiniSlideBar, { backgroundColor: visual.accent }],
    [visual.accent],
  );
  const columnStyles = useMemo(
    () =>
      DOYA_SLIDE_COLUMN_HEIGHTS.map((height) => [
        userMessageStylesheet.doyaCardMiniSlideColumn,
        { height, backgroundColor: visual.iconBackground },
      ]),
    [visual.iconBackground],
  );
  const typeTextStyle = useMemo<StyleProp<TextStyle>>(
    () => [userMessageStylesheet.doyaCardMiniTypeText, { color: visual.accent }],
    [visual.accent],
  );

  return (
    <View style={slideStyle}>
      <View style={barStyle} />
      <Text style={typeTextStyle}>{visual.badge}</Text>
      <View style={userMessageStylesheet.doyaCardMiniSlideRow}>
        {columnStyles.map((columnStyle, index) => (
          <View key={DOYA_SLIDE_COLUMN_HEIGHTS[index]} style={columnStyle} />
        ))}
      </View>
    </View>
  );
}

function DoyaSheetIllustration({ visual }: { visual: DoyaMessageCardVisual }) {
  const sheetStyle = useMemo<StyleProp<ViewStyle>>(
    () => [userMessageStylesheet.doyaCardMiniSheet, { borderColor: visual.borderColor }],
    [visual.borderColor],
  );
  const cellStyles = useMemo(
    () =>
      DOYA_SHEET_ROWS.map((row) =>
        DOYA_SHEET_COLUMNS.map((column) => [
          userMessageStylesheet.doyaCardMiniSheetCell,
          {
            backgroundColor: row === 0 || column === 0 ? visual.accent : visual.iconBackground,
            opacity: row === 0 || column === 0 ? 0.72 : 1,
          },
        ]),
      ),
    [visual.accent, visual.iconBackground],
  );
  const headerStyle = useMemo<StyleProp<ViewStyle>>(
    () => [userMessageStylesheet.doyaCardMiniSheetHeader, { backgroundColor: visual.accent }],
    [visual.accent],
  );

  return (
    <View style={sheetStyle}>
      <View style={headerStyle}>
        <Text style={userMessageStylesheet.doyaCardMiniSheetHeaderText}>{visual.badge}</Text>
      </View>
      {DOYA_SHEET_ROWS.map((row) => (
        <View key={row} style={userMessageStylesheet.doyaCardMiniSheetRow}>
          {DOYA_SHEET_COLUMNS.map((column) => (
            <View key={column} style={cellStyles[row][column]} />
          ))}
        </View>
      ))}
    </View>
  );
}

function DoyaImageIllustration({ visual }: { visual: DoyaMessageCardVisual }) {
  const imageStyle = useMemo<StyleProp<ViewStyle>>(
    () => [userMessageStylesheet.doyaCardMiniImage, { borderColor: visual.borderColor }],
    [visual.borderColor],
  );
  const sunStyle = useMemo<StyleProp<ViewStyle>>(
    () => [userMessageStylesheet.doyaCardMiniImageSun, { backgroundColor: visual.accent }],
    [visual.accent],
  );
  const hillStyle = useMemo<StyleProp<ViewStyle>>(
    () => [userMessageStylesheet.doyaCardMiniImageHill, { backgroundColor: visual.iconBackground }],
    [visual.iconBackground],
  );
  const frameStyle = useMemo<StyleProp<ViewStyle>>(
    () => [userMessageStylesheet.doyaCardMiniImageFrame, { borderColor: visual.accentMuted }],
    [visual.accentMuted],
  );

  return (
    <View style={imageStyle}>
      <View style={sunStyle} />
      <View style={frameStyle} />
      <View style={hillStyle} />
    </View>
  );
}

function UserMessageDoyaProgressCard({ card }: { card: DoyaMessageCard }) {
  return (
    <View style={userMessageStylesheet.doyaProgressCard}>
      <View style={userMessageStylesheet.doyaProgressIconBox}>
        <CheckCircle size={16} color="#b35a18" strokeWidth={2.4} />
      </View>
      <View style={userMessageStylesheet.doyaProgressBody}>
        <Text style={userMessageStylesheet.doyaProgressTitle} numberOfLines={1}>
          {card.title}
        </Text>
        <Text style={userMessageStylesheet.doyaProgressSummary}>{card.summary}</Text>
        {card.fields.length > 0 ? (
          <View style={userMessageStylesheet.doyaProgressFieldList}>
            {card.fields.map((field) => (
              <View key={field.name} style={userMessageStylesheet.doyaProgressFieldRow}>
                <Text style={userMessageStylesheet.doyaProgressFieldLabel}>{field.label}</Text>
                <Text style={userMessageStylesheet.doyaProgressFieldValue} numberOfLines={1}>
                  {field.value}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function UserMessageDoyaTaskCard({ card }: { card: DoyaMessageCard }) {
  const isResult = card.kind.endsWith(".result");
  const visual = getDoyaMessageCardVisual(card);
  const Icon = visual.Icon;
  const cardStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      userMessageStylesheet.doyaCard,
      isResult ? userMessageStylesheet.doyaCardResult : null,
      { backgroundColor: visual.cardBackground, borderColor: visual.borderColor },
    ],
    [isResult, visual.borderColor, visual.cardBackground],
  );
  const iconBoxStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      userMessageStylesheet.doyaCardIconBox,
      isResult ? userMessageStylesheet.doyaCardIconBoxResult : null,
      { backgroundColor: visual.iconBackground, borderColor: visual.iconBorder },
    ],
    [isResult, visual.iconBackground, visual.iconBorder],
  );
  const stripeStyle = useMemo<StyleProp<ViewStyle>>(
    () => [userMessageStylesheet.doyaCardStripe, { backgroundColor: visual.stripeColor }],
    [visual.stripeColor],
  );
  const badgeStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      userMessageStylesheet.doyaCardBadge,
      { backgroundColor: visual.iconBackground, borderColor: visual.iconBorder },
    ],
    [visual.iconBackground, visual.iconBorder],
  );
  const badgeTextStyle = useMemo<StyleProp<TextStyle>>(
    () => [userMessageStylesheet.doyaCardBadgeText, { color: visual.accent }],
    [visual.accent],
  );
  const headerStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      userMessageStylesheet.doyaCardHeader,
      isResult ? userMessageStylesheet.doyaCardHeaderResult : null,
    ],
    [isResult],
  );
  const resultTitleStyle = useMemo<StyleProp<TextStyle>>(
    () => [userMessageStylesheet.doyaCardTitle, userMessageStylesheet.doyaCardTitleResult],
    [],
  );
  const summaryStyle = useMemo<StyleProp<TextStyle>>(
    () => [
      userMessageStylesheet.doyaCardSummary,
      isResult ? userMessageStylesheet.doyaCardSummaryResult : null,
    ],
    [isResult],
  );
  const fieldListStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      userMessageStylesheet.doyaCardFieldList,
      isResult ? userMessageStylesheet.doyaCardFieldListResult : null,
    ],
    [isResult],
  );

  return (
    <View style={cardStyle}>
      <View style={stripeStyle} />
      <DoyaCardIllustration visual={visual} isResult={isResult} />
      <View style={headerStyle}>
        <View style={iconBoxStyle}>
          <Icon size={isResult ? 20 : 22} color={visual.accent} strokeWidth={2.2} />
        </View>
        <View style={userMessageStylesheet.doyaCardTitleGroup}>
          {isResult ? (
            <View style={userMessageStylesheet.doyaCardResultTitleRow}>
              <Text style={resultTitleStyle} numberOfLines={1}>
                {card.title}
              </Text>
              <View style={badgeStyle}>
                <Text style={badgeTextStyle} numberOfLines={1}>
                  {visual.badge}
                </Text>
              </View>
            </View>
          ) : (
            <>
              <Text style={userMessageStylesheet.doyaCardTitle} numberOfLines={1}>
                {card.title}
              </Text>
              <View style={userMessageStylesheet.doyaCardMetaRow}>
                <Text style={userMessageStylesheet.doyaCardKind} numberOfLines={1}>
                  {getDoyaMessageKindLabel(card.kind)}
                </Text>
                <View style={badgeStyle}>
                  <Text style={badgeTextStyle} numberOfLines={1}>
                    {visual.badge}
                  </Text>
                </View>
              </View>
            </>
          )}
        </View>
      </View>
      <Text style={summaryStyle}>{card.summary}</Text>
      {card.fields.length > 0 ? (
        <View style={fieldListStyle}>
          {card.fields.map((field) => (
            <View key={field.name} style={userMessageStylesheet.doyaCardFieldRow}>
              <Text style={userMessageStylesheet.doyaCardFieldLabel}>{field.label}</Text>
              <Text style={userMessageStylesheet.doyaCardFieldValue} numberOfLines={2}>
                {field.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function UserMessageDoyaCard({ card }: { card: DoyaMessageCard }) {
  if (isDoyaSlidesProgressCard(card)) {
    return <UserMessageDoyaProgressCard card={card} />;
  }

  return <UserMessageDoyaTaskCard card={card} />;
}

function shouldUseDoyaCardBubble(input: {
  hasDoyaCard: boolean;
  shouldRenderRawText: boolean;
  hasImages: boolean;
  hasAttachments: boolean;
  hasSelectionPreview: boolean;
}): boolean {
  return (
    input.hasDoyaCard &&
    !input.shouldRenderRawText &&
    !input.hasImages &&
    !input.hasAttachments &&
    !input.hasSelectionPreview
  );
}

export const UserMessage = memo(function UserMessage({
  serverId,
  agentId,
  messageId,
  workspaceRoot,
  message,
  images = [],
  attachments = [],
  selectionPreviewUri,
  selectionImageSource,
  selectionImage,
  timestamp,
  capabilities,
  client,
  isFirstInGroup = true,
  isLastInGroup = true,
  disableOuterSpacing,
}: UserMessageProps) {
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const resolvedDisableOuterSpacing = useDisableOuterSpacing(disableOuterSpacing);
  const displayImages = useMemo(
    () => images.filter((image) => !isLocalUserMessageImage(image)),
    [images],
  );
  const displayAttachments = useMemo(
    () => filterUserMessageDisplayAttachments({ images: displayImages, attachments }),
    [attachments, displayImages],
  );
  const visibleMessage = useMemo(() => getDoyaMessageVisibleText(message), [message]);
  const hasText = visibleMessage.trim().length > 0 || message.trim().length > 0;
  const doyaCard = useMemo(() => parseDoyaMessageCard(message), [message]);
  const shouldRenderRawText = visibleMessage.trim().length > 0 && !doyaCard;
  const hasImages = displayImages.length > 0;
  const hasAttachments = displayAttachments.length > 0;
  const shouldUseDoyaBubble = shouldUseDoyaCardBubble({
    hasDoyaCard: Boolean(doyaCard),
    shouldRenderRawText,
    hasImages,
    hasAttachments,
    hasSelectionPreview: Boolean(selectionPreviewUri),
  });
  const showTrailingRow = hasText && (isCompact || isNative || isHovered);
  const formattedTimestamp = useMemo(
    () => formatMessageTimestamp(new Date(timestamp)),
    [timestamp],
  );
  const rewindMutation = useRewindAgentMutation({ serverId, agentId, client, messageId });

  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const getMessageContent = useCallback(() => message, [message]);
  const handleRewind = useCallback(
    (input: { mode: RewindMode; rewoundText: string }) => {
      return rewindMutation.rewindAgent(input);
    },
    [rewindMutation],
  );

  const containerStyle = useMemo(
    () => [
      userMessageStylesheet.container,
      !resolvedDisableOuterSpacing && [
        isFirstInGroup ? userMessageStylesheet.containerFirstInGroup : null,
        isLastInGroup ? userMessageStylesheet.containerLastInGroup : null,
        !isFirstInGroup || !isLastInGroup ? userMessageStylesheet.containerSpacing : null,
      ],
    ],
    [resolvedDisableOuterSpacing, isFirstInGroup, isLastInGroup],
  );
  const imagePreviewContainerStyle = useMemo(
    () => [
      userMessageStylesheet.imagePreviewContainer,
      hasText || hasAttachments ? userMessageStylesheet.imagePreviewSpacing : undefined,
    ],
    [hasAttachments, hasText],
  );
  const attachmentPreviewContainerStyle = useMemo(
    () => [
      userMessageStylesheet.attachmentPreviewContainer,
      hasText ? userMessageStylesheet.imagePreviewSpacing : undefined,
    ],
    [hasText],
  );
  const trailingRowStyle = useMemo(
    () => [
      userMessageStylesheet.trailingRow,
      showTrailingRow
        ? userMessageStylesheet.trailingRowVisible
        : userMessageStylesheet.trailingRowHidden,
    ],
    [showTrailingRow],
  );
  const bubbleStyle = useMemo(
    () => [
      userMessageStylesheet.bubble,
      shouldUseDoyaBubble ? userMessageStylesheet.doyaBubble : null,
    ],
    [shouldUseDoyaBubble],
  );

  return (
    <View style={containerStyle} testID="user-message">
      <View
        style={userMessageStylesheet.content}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        <View style={bubbleStyle}>
          {selectionPreviewUri ? (
            <UserMessageSelectionReference
              previewUri={selectionPreviewUri}
              source={selectionImageSource}
              image={selectionImage}
              client={client}
              workspaceRoot={workspaceRoot}
              serverId={serverId}
            />
          ) : null}
          {hasImages ? (
            <View style={imagePreviewContainerStyle}>
              {displayImages.map((image) => (
                <View key={image.id} style={userMessageStylesheet.imagePill}>
                  <UserMessageAttachmentThumbnail
                    image={image}
                    client={client}
                    workspaceRoot={workspaceRoot}
                  />
                </View>
              ))}
            </View>
          ) : null}
          {hasAttachments ? (
            <View style={attachmentPreviewContainerStyle}>
              {displayAttachments.map((attachment, index) => (
                <View
                  key={`${attachment.type}:${"number" in attachment ? attachment.number : index}`}
                >
                  <UserMessageStructuredAttachment attachment={attachment} />
                </View>
              ))}
            </View>
          ) : null}
          {doyaCard ? <UserMessageDoyaCard card={doyaCard} /> : null}
          {shouldRenderRawText ? (
            <Text selectable style={userMessageStylesheet.text}>
              {visibleMessage}
            </Text>
          ) : null}
        </View>
        {hasText ? (
          <View style={trailingRowStyle} pointerEvents={showTrailingRow ? "auto" : "none"}>
            <Text style={userMessageStylesheet.timestampText}>{formattedTimestamp}</Text>
            {capabilities ? (
              <RewindMenu
                capabilities={capabilities}
                isPending={rewindMutation.isPending}
                rewoundText={message}
                onRewind={handleRewind}
              />
            ) : null}
            <TurnCopyButton
              getContent={getMessageContent}
              containerStyle={userMessageStylesheet.copyButton}
              accessibilityLabel={translateNow("ui.copy.message.1g7ue7w")}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
});

function isLocalUserMessageImage(image: UserMessageImageAttachment): boolean {
  return !isWorkspaceUserMessageImage(image);
}

interface AssistantTurnFooterProps {
  getContent: () => string;
  completedAt?: Date;
  durationMs?: number;
}

const assistantTurnFooterStylesheet = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  copyButton: {
    alignSelf: "center",
    padding: theme.spacing[1],
    paddingTop: theme.spacing[1],
    marginTop: 0,
    marginLeft: -theme.spacing[1],
  },
  labelWrapper: {
    position: "relative",
  },
  labelSizer: {
    color: theme.colors.foregroundMuted,
    fontSize: STREAM_METADATA_FONT_SIZE,
    opacity: 0,
  },
  labelOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    color: theme.colors.foregroundMuted,
    fontSize: STREAM_METADATA_FONT_SIZE,
  },
}));

const TIMESTAMP_REVEAL_MS = 3000;

/**
 * Footer rendered next to the copy button at the end of an assistant turn.
 * Always shows the turn duration; swaps to the end timestamp on hover (web)
 * or tap (native). The hidden sizer keeps the label width stable while the
 * visible text swaps.
 */
export const AssistantTurnFooter = memo(function AssistantTurnFooter({
  getContent,
  completedAt,
  durationMs,
}: AssistantTurnFooterProps) {
  const [hovered, setHovered] = useState(false);
  const [pressedReveal, setPressedReveal] = useState(false);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (revealTimerRef.current) {
        clearTimeout(revealTimerRef.current);
        revealTimerRef.current = null;
      }
    };
  }, []);

  const durationLabel = useMemo(
    () =>
      durationMs !== undefined
        ? translateNow("message.footer.workedForDuration", {
            duration: formatDuration(durationMs),
          })
        : "",
    [durationMs],
  );
  const timestampLabel = useMemo(
    () => (completedAt ? formatMessageTimestamp(completedAt) : ""),
    [completedAt],
  );

  const canSwap = Boolean(timestampLabel);
  const showTimestamp = canSwap && (isWeb ? hovered : pressedReveal);

  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);
  const handlePress = useCallback(() => {
    if (isWeb || !canSwap) return;
    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current);
    }
    setPressedReveal((prev) => !prev);
    revealTimerRef.current = setTimeout(() => {
      setPressedReveal(false);
      revealTimerRef.current = null;
    }, TIMESTAMP_REVEAL_MS);
  }, [canSwap]);

  return (
    <View style={assistantTurnFooterStylesheet.container}>
      <TurnCopyButton
        getContent={getContent}
        containerStyle={assistantTurnFooterStylesheet.copyButton}
      />
      {durationLabel ? (
        <Pressable
          onPress={handlePress}
          onHoverIn={handleHoverIn}
          onHoverOut={handleHoverOut}
          accessibilityRole={canSwap ? "button" : undefined}
          accessibilityLabel={canSwap ? `${durationLabel}, ended ${timestampLabel}` : durationLabel}
        >
          <View style={assistantTurnFooterStylesheet.labelWrapper}>
            {/* Sizer reserves space for whichever label is longer so the
                container width is stable across hover transitions. */}
            <Text style={assistantTurnFooterStylesheet.labelSizer} aria-hidden>
              {durationLabel.length >= timestampLabel.length ? durationLabel : timestampLabel}
            </Text>
            <Text style={assistantTurnFooterStylesheet.labelOverlay}>
              {showTimestamp ? timestampLabel : durationLabel}
            </Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
});

interface LiveElapsedProps {
  startedAt: Date;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * Ticks every 100ms to render an elapsed duration. Isolated from parents so
 * only this component re-renders on each tick.
 */
export const LiveElapsed = memo(function LiveElapsed({
  startedAt,
  style,
  testID,
}: LiveElapsedProps) {
  const startedAtMs = startedAt.getTime();
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - startedAtMs));

  useEffect(() => {
    setElapsedMs(Math.max(0, Date.now() - startedAtMs));
    const handle = setInterval(() => {
      setElapsedMs(Math.max(0, Date.now() - startedAtMs));
    }, 100);
    return () => clearInterval(handle);
  }, [startedAtMs]);

  return (
    <Text style={style} testID={testID}>
      {formatDuration(elapsedMs)}
    </Text>
  );
});

interface AssistantMessageProps {
  message: string;
  timestamp: number;
  workspaceRoot?: string;
  serverId?: string;
  client?: DaemonClient | null;
  spacing?: "default" | "compactTop" | "compactBottom" | "compactBoth";
  onEditImage?: (image: AttachmentMetadata, previewUri: string, source: string) => void;
}

interface AssistantMessageRenderBlock {
  key: string;
  block: string;
  card: DoyaMessageCard | null;
  text: string | null;
}

function buildAssistantMessageRenderBlocks(message: string): AssistantMessageRenderBlock[] {
  const renderParts = parseDoyaMessageRenderParts(message);
  const blocks: AssistantMessageRenderBlock[] = [];

  renderParts.forEach((part, partIndex) => {
    if (part.kind === "card") {
      const block = `doya-card:${part.card.kind}:${part.card.title}`;
      blocks.push({ key: `${partIndex}:${block}`, block, card: part.card, text: null });
      return;
    }

    splitMarkdownBlocks(part.text).forEach((block, blockIndex) => {
      blocks.push({
        key: `${partIndex}:${blockIndex}:${block.slice(0, 32)}`,
        block,
        card: null,
        text: block,
      });
    });
  });

  return blocks;
}

export const assistantMessageStylesheet = StyleSheet.create((theme) => ({
  container: {
    paddingVertical: theme.spacing[3],
    ...(isWeb ? { userSelect: "text" as const } : {}),
  },
  containerCompactTop: {
    paddingTop: 0,
  },
  containerCompactBottom: {
    paddingBottom: 0,
  },
  imageFrame: {
    width: "100%",
    minHeight: 160,
    marginHorizontal: -theme.spacing[1],
  },
  imageSurface: {
    width: "100%",
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  imageEditButton: {
    position: "absolute",
    top: theme.spacing[2],
    right: theme.spacing[2],
    backgroundColor: theme.colors.surface0,
    borderColor: theme.colors.border,
  },
  imageState: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[6],
    gap: theme.spacing[2],
  },
  imageErrorText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));

const ASSISTANT_IMAGE_MIN_HEIGHT = 160;

const AssistantMarkdownResolvedImage = memo(function AssistantMarkdownResolvedImage({
  uri,
  alt,
  containerStyle,
  source,
  workspaceRoot,
  serverId,
  editableImage,
  onEditImage,
}: {
  uri: string;
  alt?: string;
  containerStyle?: StyleProp<ViewStyle>;
  source: string;
  workspaceRoot?: string;
  serverId?: string;
  editableImage?: AttachmentMetadata | null;
  onEditImage?: (image: AttachmentMetadata, previewUri: string, source: string) => void;
}) {
  const cachedMetadata = useMemo(
    () => getAssistantImageMetadata({ source, workspaceRoot, serverId }),
    [serverId, source, workspaceRoot],
  );
  const [loadState, setLoadState] = useState<AssistantImageLoadState>(() =>
    getAssistantImageLoadStateFromMetadata(cachedMetadata),
  );

  useEffect(() => {
    if (cachedMetadata) {
      setLoadState(getAssistantImageLoadStateFromMetadata(cachedMetadata));
      return () => {};
    }

    setLoadState({ status: "loading" });
    let cancelled = false;

    Image.getSize(
      uri,
      (width, height) => {
        if (cancelled) {
          return;
        }
        if (width > 0 && height > 0) {
          const metadata = setAssistantImageMetadata(
            { source, workspaceRoot, serverId },
            { width, height },
          );
          setLoadState({
            status: "ready",
            aspectRatio: metadata?.aspectRatio ?? width / height,
          });
        }
      },
      () => {
        if (cancelled) {
          return;
        }
        setLoadState({ status: "error" });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [cachedMetadata, serverId, source, uri, workspaceRoot]);

  const handleImageError = useCallback(() => {
    setLoadState({ status: "error" });
  }, []);
  const surfaceStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      assistantMessageStylesheet.imageSurface,
      loadState.status === "ready"
        ? { aspectRatio: loadState.aspectRatio }
        : { height: ASSISTANT_IMAGE_MIN_HEIGHT },
    ],
    [loadState],
  );
  const frameStyle = useMemo<StyleProp<ViewStyle>>(
    () => [assistantMessageStylesheet.imageFrame, containerStyle],
    [containerStyle],
  );
  const stateSurfaceStyle = useMemo<StyleProp<ViewStyle>>(
    () => [surfaceStyle, assistantMessageStylesheet.imageState],
    [surfaceStyle],
  );
  const imageSource = useMemo(() => ({ uri }), [uri]);
  const handleEditImage = useCallback(() => {
    if (editableImage) {
      onEditImage?.(editableImage, uri, source);
    }
  }, [editableImage, onEditImage, source, uri]);

  if (loadState.status !== "ready") {
    return (
      <View style={frameStyle}>
        <View style={stateSurfaceStyle}>
          {loadState.status === "loading" ? <ActivityIndicator size="small" /> : null}
          {loadState.status === "error" ? (
            <Text style={assistantMessageStylesheet.imageErrorText}>
              {translateNow("ui.image.unavailable.1q705wr")}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={frameStyle}>
      <View style={surfaceStyle}>
        <Image
          source={imageSource}
          style={assistantMessageStylesheet.image}
          resizeMode="contain"
          accessibilityLabel={alt}
          onError={handleImageError}
        />
        {editableImage && onEditImage ? (
          <Button
            variant="secondary"
            size="xs"
            leftIcon={Pencil}
            onPress={handleEditImage}
            style={assistantMessageStylesheet.imageEditButton}
            accessibilityLabel={translateNow("ui.edit.image.accessibility")}
            testID="assistant-image-edit"
          >
            {translateNow("ui.edit.1a6ui")}
          </Button>
        ) : null}
      </View>
    </View>
  );
});

function AssistantMarkdownImage({
  source,
  alt,
  hasLeadingContent,
  client,
  workspaceRoot,
  serverId,
  onEditImage,
}: {
  source: string;
  alt?: string;
  hasLeadingContent: boolean;
  client?: DaemonClient | null;
  workspaceRoot?: string;
  serverId?: string;
  onEditImage?: (image: AttachmentMetadata, previewUri: string, source: string) => void;
}) {
  const containerStyle = useMemo<StyleProp<ViewStyle>>(
    () => ({
      marginTop: hasLeadingContent ? 16 : 0,
      marginBottom: 0,
    }),
    [hasLeadingContent],
  );
  const resolvedImage = useAssistantResolvedImage({ source, client, workspaceRoot, serverId });

  const stateFrameStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      assistantMessageStylesheet.imageFrame,
      containerStyle,
      { height: ASSISTANT_IMAGE_MIN_HEIGHT },
      assistantMessageStylesheet.imageState,
    ],
    [containerStyle],
  );

  if (resolvedImage.uri) {
    return (
      <AssistantMarkdownResolvedImage
        uri={resolvedImage.uri}
        alt={alt}
        containerStyle={containerStyle}
        source={source}
        workspaceRoot={workspaceRoot}
        serverId={serverId}
        editableImage={resolvedImage.editableImage}
        onEditImage={onEditImage}
      />
    );
  }

  if (resolvedImage.isLoading) {
    return (
      <View style={stateFrameStyle}>
        <ActivityIndicator size="small" />
      </View>
    );
  }

  return (
    <View style={stateFrameStyle}>
      <Text style={assistantMessageStylesheet.imageErrorText}>{resolvedImage.errorText}</Text>
    </View>
  );
}

function getInlineCodeAutoLinkUrl(
  markdownParser: ReturnType<typeof MarkdownIt>,
  content: string,
): string | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  const matches:
    | {
        index: number;
        lastIndex: number;
        url: string;
      }[]
    | null = markdownParser.linkify.match(trimmed);
  if (!matches || matches.length !== 1) {
    return null;
  }

  const [match] = matches;
  if (!match || match.index !== 0 || match.lastIndex !== trimmed.length) {
    return null;
  }

  return match.url;
}

function getInlineCodeAutoLinkSource(input: {
  href: string;
  content: string;
}): AssistantFileLinkSource {
  return {
    href: input.href,
    text: input.content,
    markup: "linkify",
    sourceInfo: "auto",
  };
}

interface AssistantMarkdownAstNode extends ASTNode {
  sourceInfo?: string;
}

function getMarkdownLinkSource(node: AssistantMarkdownAstNode): AssistantFileLinkSource {
  return {
    href: typeof node.attributes?.href === "string" ? node.attributes.href : "",
    text: getMarkdownNodeText(node),
    markup: node.markup,
    sourceInfo: node.sourceInfo,
    sourceType: node.sourceType === "inline-code" ? "inline-code" : undefined,
  };
}

function getMarkdownNodeText(node: ASTNode): string {
  if (!node.children.length) {
    return node.content ?? "";
  }

  return node.children.map(getMarkdownNodeText).join("");
}

function nodeHasParentType(parent: unknown, type: string): boolean {
  if (Array.isArray(parent)) {
    return parent.some((entry) => entry?.type === type);
  }

  return (
    typeof parent === "object" &&
    parent !== null &&
    "type" in parent &&
    (parent as Record<"type", unknown>)["type"] === type
  );
}

const turnCopyButtonStylesheet = StyleSheet.create((theme) => ({
  container: {
    alignSelf: "flex-start",
    padding: theme.spacing[2],
    paddingTop: 0,
    marginTop: theme.spacing[2],
  },
  iconColor: {
    color: theme.colors.foregroundMuted,
  },
  iconHoveredColor: {
    color: theme.colors.foreground,
  },
}));

interface TurnCopyButtonProps {
  getContent: () => string;
  containerStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  copiedAccessibilityLabel?: string;
}

export const TurnCopyButton = memo(function TurnCopyButton({
  getContent,
  containerStyle,
  accessibilityLabel,
  copiedAccessibilityLabel,
}: TurnCopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(async () => {
    const content = getContent();
    if (!content) {
      return;
    }

    await writeMarkdownToRichClipboard(content, getDefaultMarkdownClipboardEnvironment());
    setCopied(true);

    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }

    copyTimeoutRef.current = setTimeout(() => {
      setCopied(false);
      copyTimeoutRef.current = null;
    }, 1500);
  }, [getContent]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const pressableStyle = useMemo(
    () => [turnCopyButtonStylesheet.container, containerStyle],
    [containerStyle],
  );

  return (
    <Pressable
      onPress={handleCopy}
      style={pressableStyle}
      accessibilityRole="button"
      accessibilityLabel={
        copied ? (copiedAccessibilityLabel ?? "Copied") : (accessibilityLabel ?? "Copy turn")
      }
    >
      {({ hovered }) => {
        const iconColor = hovered
          ? turnCopyButtonStylesheet.iconHoveredColor.color
          : turnCopyButtonStylesheet.iconColor.color;
        return copied ? (
          <Check size={16} color={iconColor} />
        ) : (
          <Copy size={16} color={iconColor} />
        );
      }}
    </Pressable>
  );
});

const expandableBadgeStylesheet = StyleSheet.create((theme) => ({
  container: {
    marginHorizontal: -13,
  },
  containerSpacing: {
    marginBottom: theme.spacing[1],
  },
  containerLastInSequence: {
    marginBottom: theme.spacing[4],
  },
  pressable: {
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: "transparent",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    overflow: "hidden",
  },
  pressablePressed: {
    opacity: 0.9,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  labelRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
  },
  iconBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    marginRight: theme.spacing[1],
    backgroundColor: "transparent",
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    flexShrink: 0,
  },
  labelActive: {
    color: theme.colors.foreground,
  },
  labelLoading: {
    color: theme.colors.foreground,
    opacity: 0.72,
  },
  secondaryLabel: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    marginLeft: theme.spacing[2],
  },
  secondaryLabelActive: {
    color: theme.colors.foreground,
  },
  shimmerText: {
    color: "transparent",
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  spacer: {
    flex: 1,
  },
  chevron: {
    flexShrink: 0,
    transform: [{ scale: 1.3 }],
  },
  openFileButton: {
    marginLeft: theme.spacing[1],
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    flexShrink: 0,
  },
  openFileButtonPlaceholderIcon: {
    width: 14,
    height: 14,
  },
  chevronExpanded: {
    transform: [{ scale: 1.3 }, { rotate: "90deg" }],
  },
  detailWrapper: {
    borderBottomLeftRadius: theme.borderRadius.lg,
    borderBottomRightRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderTopWidth: 0,
    borderColor: theme.colors.border,
    padding: 0,
    gap: 0,
    flexShrink: 1,
    minWidth: 0,
    overflow: "hidden",
    ...(isWeb ? { cursor: "auto" as const, userSelect: "text" as const } : {}),
  },
  pressableExpanded: {
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  shimmerOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
  },
  shimmerMaskRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    height: "100%",
  },
  nativeShimmerTrack: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: "hidden",
  },
  nativeShimmerPeak: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
  },
}));

interface NativeExpandableBadgeShimmerProps {
  label: string;
  secondaryLabel?: string;
  rowWidth: number;
  rowHeight: number;
  peakWidth: number;
  durationSeconds: number;
  gradientId: string;
}

const NativeExpandableBadgeShimmer = memo(function NativeExpandableBadgeShimmer({
  label,
  secondaryLabel,
  rowWidth,
  rowHeight,
  peakWidth,
  durationSeconds,
  gradientId,
}: NativeExpandableBadgeShimmerProps) {
  const shimmerTranslateX = useSharedValue(0);

  useEffect(() => {
    const startPosition = -peakWidth;
    const endPosition = rowWidth + peakWidth;
    shimmerTranslateX.value = startPosition;
    shimmerTranslateX.value = withRepeat(
      withTiming(endPosition, {
        duration: durationSeconds * 1000,
        easing: Easing.linear,
      }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(shimmerTranslateX);
    };
  }, [durationSeconds, peakWidth, rowWidth, shimmerTranslateX]);

  const nativeShimmerPeakStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shimmerTranslateX.value }],
  }));

  const nativeShimmerTrackStyle = useMemo(
    () => [expandableBadgeStylesheet.nativeShimmerTrack, { width: rowWidth, height: rowHeight }],
    [rowHeight, rowWidth],
  );

  const nativeShimmerMaskStyle = useMemo(
    () => [expandableBadgeStylesheet.shimmerMaskRow, { width: rowWidth, height: rowHeight }],
    [rowHeight, rowWidth],
  );

  const nativeLabelMaskStyle = useMemo(
    () => [expandableBadgeStylesheet.label, { color: "#000000", opacity: 1 }],
    [],
  );

  const nativeSecondaryMaskStyle = useMemo(
    () => [expandableBadgeStylesheet.secondaryLabel, { color: "#000000", opacity: 1 }],
    [],
  );

  const nativeShimmerPeakCombinedStyle = useMemo(
    () => [
      expandableBadgeStylesheet.nativeShimmerPeak,
      nativeShimmerPeakStyle,
      { width: peakWidth, height: rowHeight },
    ],
    [nativeShimmerPeakStyle, peakWidth, rowHeight],
  );

  const maskElement = useMemo(
    () => (
      <View pointerEvents="none" style={nativeShimmerMaskStyle}>
        <Text style={nativeLabelMaskStyle} numberOfLines={1}>
          {label}
        </Text>
        {secondaryLabel ? (
          <Text style={nativeSecondaryMaskStyle} numberOfLines={1}>
            {secondaryLabel}
          </Text>
        ) : (
          <View style={expandableBadgeStylesheet.spacer} />
        )}
      </View>
    ),
    [nativeShimmerMaskStyle, nativeLabelMaskStyle, nativeSecondaryMaskStyle, label, secondaryLabel],
  );

  return (
    <View style={expandableBadgeStylesheet.shimmerOverlay} pointerEvents="none">
      <MaskedView pointerEvents="none" style={nativeShimmerTrackStyle} maskElement={maskElement}>
        <View pointerEvents="none" style={nativeShimmerTrackStyle}>
          <Animated.View pointerEvents="none" style={nativeShimmerPeakCombinedStyle}>
            <NativeShimmerPeakSvg gradientId={gradientId} />
          </Animated.View>
        </View>
      </MaskedView>
    </View>
  );
});

function NativeShimmerPeakSvg({ gradientId }: { gradientId: string }) {
  return (
    <Svg width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <SvgLinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%" stopColor="#ffffff" stopOpacity={0} />
          <Stop offset="50%" stopColor="#ffffff" stopOpacity={1} />
          <Stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
        </SvgLinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

interface AssistantMessageBlockContainerProps {
  block: string;
  marginBottom: number;
  children: ReactNode;
}

function AssistantMessageBlockContainer({
  block,
  marginBottom,
  children,
}: AssistantMessageBlockContainerProps) {
  const style = useMemo(() => (marginBottom > 0 ? { marginBottom } : undefined), [marginBottom]);
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      setAssistantMarkdownBlockHeight({ block, width, height });
    },
    [block],
  );
  return (
    <View style={style} onLayout={isWeb ? handleLayout : undefined}>
      {children}
    </View>
  );
}

interface MemoizedMarkdownBlockProps {
  text: string;
  rules: RenderRules;
  parser: MarkdownIt;
  onLinkPress: (url: string) => boolean;
}

const MemoizedMarkdownBlock = React.memo(function MemoizedMarkdownBlock({
  text,
  rules,
  parser,
  onLinkPress,
}: MemoizedMarkdownBlockProps) {
  return (
    <AppearanceStyleBoundary>
      <ThemedMarkdown
        uniProps={markdownStyleMapping}
        rules={rules}
        markdownit={parser}
        onLinkPress={onLinkPress}
        allowedImageHandlers={MARKDOWN_ALLOWED_IMAGE_HANDLERS}
        topLevelMaxExceededItem={MARKDOWN_TOP_LEVEL_MAX_EXCEEDED_ITEM}
      >
        {text}
      </ThemedMarkdown>
    </AppearanceStyleBoundary>
  );
});

interface MarkdownInheritedTextProps {
  inheritedStyles: TextStyle;
  textStyle: TextStyle;
  style?: StyleProp<TextStyle>;
  monoSurface?: boolean;
  children: ReactNode;
}

function MarkdownInheritedText({
  inheritedStyles,
  textStyle,
  style: overrideStyle,
  monoSurface,
  children,
}: MarkdownInheritedTextProps) {
  const style = useMemo(
    () => [inheritedStyles, textStyle, overrideStyle],
    [inheritedStyles, textStyle, overrideStyle],
  );
  return (
    <MarkdownTextSpan monoSurface={monoSurface} style={style}>
      {children}
    </MarkdownTextSpan>
  );
}

interface MarkdownListItemContentProps {
  contentStyle: ViewStyle;
  children: ReactNode;
}

const MARKDOWN_LIST_ITEM_CONTENT_FLEX: ViewStyle = { flex: 1, flexShrink: 1, minWidth: 0 };

function MarkdownListItemContent({ contentStyle, children }: MarkdownListItemContentProps) {
  const style = useMemo(() => [contentStyle, MARKDOWN_LIST_ITEM_CONTENT_FLEX], [contentStyle]);
  return <View style={style}>{children}</View>;
}

interface MarkdownListViewProps {
  baseStyle: ViewStyle;
  spacing: { marginTop: number; marginBottom: number };
  children: ReactNode;
}

function MarkdownListView({ baseStyle, spacing, children }: MarkdownListViewProps) {
  const style = useMemo(() => [baseStyle, spacing], [baseStyle, spacing]);
  return <View style={style}>{children}</View>;
}

export const AssistantMessage = memo(function AssistantMessage({
  message,
  timestamp: _timestamp,
  workspaceRoot,
  serverId,
  client,
  spacing = "default",
  onEditImage,
}: AssistantMessageProps) {
  const markdownParser = useMemo(() => {
    const parser = MarkdownIt({ typographer: true, linkify: true });
    const defaultValidateLink = parser.validateLink.bind(parser);
    parser.validateLink = (url: string) => {
      if (url.trim().toLowerCase().startsWith("file://")) {
        return true;
      }

      return defaultValidateLink(url);
    };
    return parser;
  }, []);

  const fileLinkActions = useAssistantFileLinkActions();
  const handleMarkdownLinkPress = useStableEvent((url: string) => {
    fileLinkActions.open({ href: url }, "main");
    // react-native-markdown-display opens the link itself when this returns true.
    // We already handled it above, so return false to avoid duplicate opens.
    return false;
  });

  const markdownRules = useMemo<RenderRules>(() => {
    return {
      text: (
        node: ASTNode,
        _children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
        inheritedStyles: TextStyle = {},
      ) => (
        <MarkdownInheritedText
          key={node.key}
          inheritedStyles={inheritedStyles}
          textStyle={styles.text}
        >
          {node.content}
        </MarkdownInheritedText>
      ),
      textgroup: (
        node: ASTNode,
        children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
        inheritedStyles: TextStyle = {},
      ) => (
        <MarkdownInheritedText
          key={node.key}
          inheritedStyles={inheritedStyles}
          textStyle={styles.textgroup}
        >
          {children}
        </MarkdownInheritedText>
      ),
      // strong/em/s have no custom rule in react-native-markdown-display's
      // defaults beyond wrapping children in a plain RN <Text>. On iOS the
      // paragraph/textgroup are native UITextViews (see markdown-text.ios.tsx),
      // and a plain <Text> nested inside one is not hoisted into a
      // UITextViewChild, so its content renders invisibly. Route these inline
      // marks through MarkdownTextSpan (same path as text/textgroup) so the
      // styled content composes and stays visible + selectable on iOS.
      strong: (
        node: ASTNode,
        children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
        inheritedStyles: TextStyle = {},
      ) => (
        <MarkdownInheritedText
          key={node.key}
          inheritedStyles={inheritedStyles}
          textStyle={styles.strong}
        >
          {children}
        </MarkdownInheritedText>
      ),
      em: (
        node: ASTNode,
        children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
        inheritedStyles: TextStyle = {},
      ) => (
        <MarkdownInheritedText
          key={node.key}
          inheritedStyles={inheritedStyles}
          textStyle={styles.em}
        >
          {children}
        </MarkdownInheritedText>
      ),
      s: (
        node: ASTNode,
        children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
        inheritedStyles: TextStyle = {},
      ) => (
        <MarkdownInheritedText
          key={node.key}
          inheritedStyles={inheritedStyles}
          textStyle={styles.s}
        >
          {children}
        </MarkdownInheritedText>
      ),
      // hardbreak/softbreak fall back to react-native-markdown-display's
      // default, a plain RN <Text>{"\n"}. Inside the paragraph UITextView that
      // plain <Text> is not hoisted into a UITextViewChild and is dropped (same
      // root cause as strong/em/s) — so on iOS a hard line break vanished, and
      // a softbreak between words jammed them together ("one\ntwo" -> "onetwo").
      // Emit the break through MarkdownTextSpan so it composes on iOS; web and
      // Android keep the same "\n" they rendered before.
      hardbreak: (node: ASTNode) => <MarkdownTextSpan key={node.key}>{"\n"}</MarkdownTextSpan>,
      softbreak: (node: ASTNode) => <MarkdownTextSpan key={node.key}>{"\n"}</MarkdownTextSpan>,
      code_block: (
        node: ASTNode,
        _children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
        inheritedStyles: TextStyle = {},
      ) => (
        <HighlightedCodeBlock
          key={node.key}
          code={node.content}
          language={null}
          inheritedStyles={inheritedStyles}
          textStyle={styles.code_block}
        />
      ),
      fence: (
        node: ASTNode,
        _children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
        inheritedStyles: TextStyle = {},
      ) => (
        <HighlightedCodeBlock
          key={node.key}
          code={node.content}
          language={node.sourceInfo}
          inheritedStyles={inheritedStyles}
          textStyle={styles.fence}
        />
      ),
      code_inline: (
        node: ASTNode,
        _children: ReactNode[],
        parent: ASTNode[],
        styles: MarkdownStyles,
        inheritedStyles: TextStyle = {},
      ) => {
        const content = node.content ?? "";
        const isLinkedInlineCode = nodeHasParentType(parent, "link");
        const inlineCodeSource: AssistantFileLinkSource = {
          href: content,
          text: content,
          sourceType: "inline-code",
        };
        const shouldResolveInlinePath =
          !isLinkedInlineCode && fileLinkActions.canResolveFile(inlineCodeSource);

        if (shouldResolveInlinePath) {
          return (
            <AssistantInlineCodePathLink
              key={node.key}
              content={content}
              inheritedStyles={inheritedStyles}
              codeInlineStyle={styles.code_inline}
              linkStyle={styles.link}
            />
          );
        }

        const inlineCodeLinkUrl = getInlineCodeAutoLinkUrl(markdownParser, content);
        if (inlineCodeLinkUrl) {
          const source = getInlineCodeAutoLinkSource({
            href: inlineCodeLinkUrl,
            content,
          });
          return (
            <AssistantMarkdownCodeLink
              key={node.key}
              source={source}
              inheritedStyles={inheritedStyles}
              codeInlineStyle={styles.code_inline}
              linkStyle={styles.link}
            >
              {content}
            </AssistantMarkdownCodeLink>
          );
        }

        return (
          <MarkdownInheritedText
            key={node.key}
            inheritedStyles={inheritedStyles}
            textStyle={styles.code_inline}
            monoSurface
          >
            {content}
          </MarkdownInheritedText>
        );
      },
      bullet_list: (
        node: ASTNode,
        children: ReactNode[],
        parent: ASTNode[],
        styles: MarkdownStyles,
      ) => (
        <MarkdownListView
          key={node.key}
          baseStyle={styles.bullet_list}
          spacing={getMarkdownListSpacing(node, parent)}
        >
          {children}
        </MarkdownListView>
      ),
      ordered_list: (
        node: ASTNode,
        children: ReactNode[],
        parent: ASTNode[],
        styles: MarkdownStyles,
      ) => (
        <MarkdownListView
          key={node.key}
          baseStyle={styles.ordered_list}
          spacing={getMarkdownListSpacing(node, parent)}
        >
          {children}
        </MarkdownListView>
      ),
      list_item: (
        node: ASTNode,
        children: ReactNode[],
        parent: ASTNode[],
        styles: MarkdownStyles,
      ) => {
        const { isOrdered, marker } = getMarkdownListMarker(node, parent);
        const iconStyle = isOrdered ? styles.ordered_list_icon : styles.bullet_list_icon;
        const contentStyle = isOrdered ? styles.ordered_list_content : styles.bullet_list_content;

        return (
          <View key={node.key} style={styles.list_item}>
            <Text style={iconStyle}>{marker}</Text>
            <MarkdownListItemContent contentStyle={contentStyle}>
              {children}
            </MarkdownListItemContent>
          </View>
        );
      },
      paragraph: (
        node: ASTNode,
        children: ReactNode[],
        _parent: ASTNode[],
        styles: MarkdownStyles,
      ) => (
        <MarkdownParagraphView key={node.key} paragraphStyle={styles.paragraph}>
          {children}
        </MarkdownParagraphView>
      ),
      link: (node: ASTNode, children: ReactNode[], _parent: ASTNode[], styles: MarkdownStyles) => (
        <AssistantMarkdownLink
          key={node.key}
          source={getMarkdownLinkSource(node)}
          style={styles.link}
        >
          {Children.map(children, (child) => {
            if (!isValidElement(child)) return child;
            const childProps = child.props as { style?: StyleProp<TextStyle> };
            return cloneElement(child, {
              style: [childProps.style, { color: styles.link.color }],
            } as Partial<{ style: StyleProp<TextStyle> }>);
          })}
        </AssistantMarkdownLink>
      ),
      image: (
        node: ASTNode,
        _children: ReactNode[],
        parent: ASTNode[],
        _styles: MarkdownStyles,
      ) => {
        const paragraphNode = Array.isArray(parent)
          ? parent.find((ancestor) => ancestor?.type === "paragraph")
          : null;
        const paragraphChildren = Array.isArray(paragraphNode?.children)
          ? paragraphNode.children
          : [];
        const imageIndex = paragraphChildren.findIndex((child: ASTNode) => child?.key === node.key);
        const hasLeadingContent = imageIndex > 0;

        return (
          <AssistantMarkdownImage
            key={node.key}
            source={String(node.attributes?.src ?? "")}
            alt={typeof node.attributes?.alt === "string" ? node.attributes.alt : undefined}
            hasLeadingContent={hasLeadingContent}
            client={client}
            workspaceRoot={workspaceRoot}
            serverId={serverId}
            onEditImage={onEditImage}
          />
        );
      },
    };
  }, [client, fileLinkActions, markdownParser, onEditImage, serverId, workspaceRoot]);

  const keyedBlocks = useMemo(() => buildAssistantMessageRenderBlocks(message), [message]);

  const assistantContainerStyle = useMemo(
    () => [
      assistantMessageStylesheet.container,
      (spacing === "compactTop" || spacing === "compactBoth") &&
        assistantMessageStylesheet.containerCompactTop,
      (spacing === "compactBottom" || spacing === "compactBoth") &&
        assistantMessageStylesheet.containerCompactBottom,
    ],
    [spacing],
  );

  return (
    <View testID="assistant-message" style={assistantContainerStyle}>
      {keyedBlocks.map(({ key, block, card, text }, index) => (
        <AssistantMessageBlockContainer
          key={key}
          block={block}
          marginBottom={index < keyedBlocks.length - 1 ? 12 : 0}
        >
          {card ? (
            <UserMessageDoyaCard card={card} />
          ) : (
            <MemoizedMarkdownBlock
              text={text ?? ""}
              rules={markdownRules}
              parser={markdownParser}
              onLinkPress={handleMarkdownLinkPress}
            />
          )}
        </AssistantMessageBlockContainer>
      ))}
    </View>
  );
});

interface SpeakMessageProps {
  message: string;
  timestamp: number;
  disableOuterSpacing?: boolean;
}

const speakMessageStylesheet = StyleSheet.create((theme) => ({
  container: {
    paddingVertical: theme.spacing[3],
  },
  containerSpacing: {
    marginBottom: theme.spacing[4],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginBottom: theme.spacing[2],
  },
  headerLabel: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  text: {
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.base,
    lineHeight: 22,
    color: theme.colors.foreground,
  },
}));

export const SpeakMessage = memo(function SpeakMessage({
  message,
  timestamp: _timestamp,
  disableOuterSpacing,
}: SpeakMessageProps) {
  const resolvedDisableOuterSpacing = useDisableOuterSpacing(disableOuterSpacing);
  const containerStyle = useMemo(
    () => [
      speakMessageStylesheet.container,
      !resolvedDisableOuterSpacing && speakMessageStylesheet.containerSpacing,
    ],
    [resolvedDisableOuterSpacing],
  );

  return (
    <View testID="speak-message" style={containerStyle}>
      <View style={speakMessageStylesheet.header}>
        <ThemedMicVocal size={12} uniProps={foregroundMutedColorMapping} />
        <Text style={speakMessageStylesheet.headerLabel}>{translateNow("ui.spoke.1bosq4")}</Text>
      </View>
      <Text style={speakMessageStylesheet.text}>{message}</Text>
    </View>
  );
});

interface ActivityLogProps {
  type: "system" | "info" | "success" | "error" | "artifact";
  message: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
  artifactId?: string;
  artifactType?: string;
  title?: string;
  onArtifactClick?: (artifactId: string) => void;
  disableOuterSpacing?: boolean;
}

const activityLogStylesheet = StyleSheet.create((theme) => ({
  pressable: {
    borderRadius: theme.borderRadius.md,
    overflow: "hidden",
  },
  pressableSpacing: {
    marginBottom: theme.spacing[1],
  },
  pressableActive: {
    opacity: 0.7,
  },
  systemBg: {
    backgroundColor: "rgba(39, 39, 42, 0.5)",
  },
  infoBg: {
    backgroundColor: "rgba(30, 58, 138, 0.3)",
  },
  successBg: {
    backgroundColor: "rgba(20, 83, 45, 0.3)",
  },
  errorBg: {},
  artifactBg: {
    backgroundColor: "rgba(30, 58, 138, 0.4)",
  },
  content: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  iconContainer: {
    flexShrink: 0,
    height: 20,
    justifyContent: "center",
  },
  textContainer: {
    flex: 1,
  },
  messageText: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  detailsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: theme.spacing[1],
  },
  detailsText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    marginRight: theme.spacing[1],
  },
  metadataContainer: {
    marginTop: theme.spacing[2],
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    borderRadius: theme.borderRadius.base,
    padding: theme.spacing[2],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  metadataText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.code,
    fontFamily: theme.fontFamily.mono,
    lineHeight: 16,
  },
}));

export const ActivityLog = memo(function ActivityLog({
  type,
  message,
  timestamp: _timestamp,
  metadata,
  artifactId,
  artifactType,
  title,
  onArtifactClick,
  disableOuterSpacing,
}: ActivityLogProps) {
  const resolvedDisableOuterSpacing = useDisableOuterSpacing(disableOuterSpacing);
  const [isExpanded, setIsExpanded] = useState(false);

  const typeConfig = {
    system: {
      bg: activityLogStylesheet.systemBg,
      color: "#a1a1aa",
      Icon: Circle,
    },
    info: { bg: activityLogStylesheet.infoBg, color: "#60a5fa", Icon: Info },
    success: {
      bg: activityLogStylesheet.successBg,
      color: "#4ade80",
      Icon: CheckCircle,
    },
    error: {
      bg: activityLogStylesheet.errorBg,
      color: "#f87171",
      Icon: XCircle,
    },
    artifact: {
      bg: activityLogStylesheet.artifactBg,
      color: "#93c5fd",
      Icon: FileText,
    },
  };

  const config = typeConfig[type];
  const IconComponent = config.Icon;

  const handlePress = useCallback(() => {
    if (type === "artifact" && artifactId && onArtifactClick) {
      onArtifactClick(artifactId);
    } else if (metadata) {
      setIsExpanded((prev) => !prev);
    }
  }, [type, artifactId, onArtifactClick, metadata]);

  const displayMessage =
    type === "artifact" && artifactType && title ? `${artifactType}: ${title}` : message;

  const isInteractive = type === "artifact" || metadata;
  const pressableStyle = useMemo(
    () => [
      activityLogStylesheet.pressable,
      !resolvedDisableOuterSpacing && activityLogStylesheet.pressableSpacing,
      config.bg,
      isInteractive && activityLogStylesheet.pressableActive,
    ],
    [resolvedDisableOuterSpacing, config.bg, isInteractive],
  );
  const messageTextStyle = useMemo(
    () => [activityLogStylesheet.messageText, { color: config.color }],
    [config.color],
  );

  return (
    <Pressable onPress={handlePress} disabled={!isInteractive} style={pressableStyle}>
      <View style={activityLogStylesheet.content}>
        <View style={activityLogStylesheet.row}>
          <View style={activityLogStylesheet.iconContainer}>
            <IconComponent size={16} color={config.color} />
          </View>
          <View style={activityLogStylesheet.textContainer}>
            <Text style={messageTextStyle} selectable>
              {displayMessage}
            </Text>
            {metadata && (
              <View style={activityLogStylesheet.detailsRow}>
                <Text style={activityLogStylesheet.detailsText}>
                  {translateNow("ui.details.1haiof6")}
                </Text>
                {isExpanded ? (
                  <ChevronDown size={12} color="#71717a" />
                ) : (
                  <ChevronRight size={12} color="#71717a" />
                )}
              </View>
            )}
          </View>
        </View>
        {isExpanded && metadata && (
          <View style={activityLogStylesheet.metadataContainer} dataSet={CODE_SURFACE_DATASET}>
            <Text style={activityLogStylesheet.metadataText}>
              {JSON.stringify(metadata, null, 2)}
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
});

interface CompactionMarkerProps {
  status: "loading" | "completed";
  trigger?: "auto" | "manual";
  preTokens?: number;
}

const compactionStylesheet = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[2],
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: theme.colors.border,
  },
  label: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  text: {
    fontFamily: theme.fontFamily.ui,
    fontSize: 13,
    color: theme.colors.foregroundMuted,
  },
}));

export const CompactionMarker = memo(function CompactionMarker({
  status,
  trigger,
  preTokens,
}: CompactionMarkerProps) {
  const label = getCompactionMarkerLabel({ status, trigger, preTokens });

  return (
    <View style={compactionStylesheet.container}>
      <View style={compactionStylesheet.line} />
      <View style={compactionStylesheet.label}>
        {status === "loading" ? (
          <ActivityIndicator size="small" color="#a1a1aa" />
        ) : (
          <Scissors size={12} color="#a1a1aa" />
        )}
        <Text style={compactionStylesheet.text}>{label}</Text>
      </View>
      <View style={compactionStylesheet.line} />
    </View>
  );
});

interface TodoListCardProps {
  items: TodoEntry[];
  disableOuterSpacing?: boolean;
}

interface TodoListItemRowProps {
  text: string;
  completed: boolean;
}

function TodoListItemRow({ text, completed }: TodoListItemRowProps) {
  const badgeStyle = useMemo(
    () => [
      todoListCardStylesheet.radioBadge,
      completed
        ? todoListCardStylesheet.radioBadgeComplete
        : todoListCardStylesheet.radioBadgeIncomplete,
    ],
    [completed],
  );
  const textStyle = useMemo(
    () => [todoListCardStylesheet.itemText, completed && todoListCardStylesheet.itemTextCompleted],
    [completed],
  );
  return (
    <View style={todoListCardStylesheet.itemRow}>
      <View style={badgeStyle}>
        {completed ? (
          <ThemedTodoCheckIcon size={12} uniProps={primaryForegroundColorMapping} />
        ) : null}
      </View>
      <Text style={textStyle}>{text}</Text>
    </View>
  );
}

const todoListCardStylesheet = StyleSheet.create((theme) => ({
  detailsWrapper: {
    padding: theme.spacing[2],
  },
  list: {
    gap: theme.spacing[1],
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  radioBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: theme.colors.foregroundMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  radioBadgeIncomplete: {
    opacity: 0.55,
  },
  radioBadgeComplete: {
    opacity: 0.95,
  },
  itemText: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  itemTextCompleted: {
    color: theme.colors.foregroundMuted,
    textDecorationLine: "line-through",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
}));

export const TodoListCard = memo(function TodoListCard({
  items,
  disableOuterSpacing,
}: TodoListCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const nextTask = useMemo(() => items.find((item) => !item.completed)?.text, [items]);

  const handleToggle = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const renderDetails = useCallback(() => {
    return (
      <View style={todoListCardStylesheet.detailsWrapper}>
        <View style={todoListCardStylesheet.list}>
          {items.length === 0 ? (
            <Text style={todoListCardStylesheet.emptyText}>
              {translateNow("ui.no.tasks.yet.2vd1dj")}
            </Text>
          ) : (
            items.map((item) => (
              <TodoListItemRow key={item.text} text={item.text} completed={item.completed} />
            ))
          )}
        </View>
      </View>
    );
  }, [items]);

  return (
    <ExpandableBadge
      label={translateNow("ui.tasks.1bz3hq")}
      secondaryLabel={nextTask}
      icon={CheckSquare}
      isExpanded={isExpanded}
      onToggle={handleToggle}
      renderDetails={renderDetails}
      disableOuterSpacing={disableOuterSpacing}
    />
  );
});

interface ExpandableBadgeProps {
  label: string;
  secondaryLabel?: string;
  icon?: ComponentType<{ size?: number; color?: string }>;
  isExpanded: boolean;
  style?: StyleProp<ViewStyle>;
  onToggle?: () => void;
  onOpenFile?: () => void;
  onDetailHoverChange?: (hovered: boolean) => void;
  renderDetails?: () => ReactNode;
  isLoading?: boolean;
  isError?: boolean;
  isLastInSequence?: boolean;
  disableOuterSpacing?: boolean;
  testID?: string;
}

interface ExpandableBadgeSecondaryLabelProps {
  secondaryLabel?: string;
  secondaryLabelStyle: StyleProp<TextStyle>;
  shouldMeasureWebShimmer: boolean;
  onSecondaryLayout: (event: LayoutChangeEvent) => void;
}

function ExpandableBadgeSecondaryLabel({
  secondaryLabel,
  secondaryLabelStyle,
  shouldMeasureWebShimmer,
  onSecondaryLayout,
}: ExpandableBadgeSecondaryLabelProps) {
  if (!secondaryLabel) {
    return null;
  }
  return (
    <Text
      style={secondaryLabelStyle}
      numberOfLines={1}
      onLayout={shouldMeasureWebShimmer ? onSecondaryLayout : undefined}
    >
      {secondaryLabel}
    </Text>
  );
}

interface ExpandableBadgeWebShimmerOverlayProps {
  label: string;
  secondaryLabel?: string;
  shimmerLabelTextStyle: StyleProp<TextStyle>;
  shimmerSecondaryTextStyle: StyleProp<TextStyle>;
  showOpenFileButton: boolean;
}

function ExpandableBadgeWebShimmerOverlay({
  label,
  secondaryLabel,
  shimmerLabelTextStyle,
  shimmerSecondaryTextStyle,
  showOpenFileButton,
}: ExpandableBadgeWebShimmerOverlayProps) {
  return (
    <View style={expandableBadgeStylesheet.shimmerOverlay} pointerEvents="none">
      <Text style={shimmerLabelTextStyle} numberOfLines={1}>
        {label}
      </Text>
      {secondaryLabel ? (
        <Text style={shimmerSecondaryTextStyle} numberOfLines={1}>
          {secondaryLabel}
        </Text>
      ) : null}
      {showOpenFileButton ? (
        <View style={expandableBadgeStylesheet.openFileButton}>
          <View style={expandableBadgeStylesheet.openFileButtonPlaceholderIcon} />
        </View>
      ) : null}
      {!secondaryLabel && !showOpenFileButton ? (
        <View style={expandableBadgeStylesheet.spacer} />
      ) : null}
    </View>
  );
}

interface ExpandableBadgeLabelRowProps {
  label: string;
  labelStyle: StyleProp<TextStyle>;
  secondaryLabel?: string;
  secondaryLabelStyle: StyleProp<TextStyle>;
  shouldMeasureWebShimmer: boolean;
  shouldMeasureNativeShimmer: boolean;
  isWebShimmer: boolean;
  isNativeShimmer: boolean;
  shimmerLabelTextStyle: StyleProp<TextStyle>;
  shimmerSecondaryTextStyle: StyleProp<TextStyle>;
  labelRowWidth: number;
  labelRowHeight: number;
  nativeShimmerPeakWidth: number;
  shimmerDuration: number;
  nativeGradientId: string;
  onLabelRowLayout: (event: LayoutChangeEvent) => void;
  onLabelLayout: (event: LayoutChangeEvent) => void;
  onSecondaryLayout: (event: LayoutChangeEvent) => void;
  showOpenFileButton: boolean;
  isOpenFileHovered: boolean;
  onOpenFilePress: (event: GestureResponderEvent) => void;
  onOpenFileHoverIn: () => void;
  onOpenFileHoverOut: () => void;
}

function ExpandableBadgeLabelRow({
  label,
  labelStyle,
  secondaryLabel,
  secondaryLabelStyle,
  shouldMeasureWebShimmer,
  shouldMeasureNativeShimmer,
  isWebShimmer,
  isNativeShimmer,
  shimmerLabelTextStyle,
  shimmerSecondaryTextStyle,
  labelRowWidth,
  labelRowHeight,
  nativeShimmerPeakWidth,
  shimmerDuration,
  nativeGradientId,
  onLabelRowLayout,
  onLabelLayout,
  onSecondaryLayout,
  showOpenFileButton,
  isOpenFileHovered,
  onOpenFilePress,
  onOpenFileHoverIn,
  onOpenFileHoverOut,
}: ExpandableBadgeLabelRowProps) {
  return (
    <View
      style={expandableBadgeStylesheet.labelRow}
      onLayout={shouldMeasureNativeShimmer ? onLabelRowLayout : undefined}
    >
      <Text
        style={labelStyle}
        numberOfLines={1}
        onLayout={shouldMeasureWebShimmer ? onLabelLayout : undefined}
      >
        {label}
      </Text>
      <ExpandableBadgeSecondaryLabel
        secondaryLabel={secondaryLabel}
        secondaryLabelStyle={secondaryLabelStyle}
        shouldMeasureWebShimmer={shouldMeasureWebShimmer}
        onSecondaryLayout={onSecondaryLayout}
      />
      {showOpenFileButton ? (
        <Pressable
          onPress={onOpenFilePress}
          onHoverIn={onOpenFileHoverIn}
          onHoverOut={onOpenFileHoverOut}
          accessibilityRole="button"
          accessibilityLabel={translateNow("ui.open.file.1lqvfci")}
          testID="tool-call-open-file"
          style={expandableBadgeStylesheet.openFileButton}
          hitSlop={6}
        >
          <ThemedFileSymlinkIcon
            size={14}
            uniProps={isOpenFileHovered ? foregroundColorMapping : foregroundMutedColorMapping}
          />
        </Pressable>
      ) : null}
      {isWebShimmer ? (
        <ExpandableBadgeWebShimmerOverlay
          label={label}
          secondaryLabel={secondaryLabel}
          shimmerLabelTextStyle={shimmerLabelTextStyle}
          shimmerSecondaryTextStyle={shimmerSecondaryTextStyle}
          showOpenFileButton={showOpenFileButton}
        />
      ) : null}
      {isNativeShimmer ? (
        <NativeExpandableBadgeShimmer
          label={label}
          secondaryLabel={secondaryLabel}
          rowWidth={labelRowWidth}
          rowHeight={labelRowHeight}
          peakWidth={nativeShimmerPeakWidth}
          durationSeconds={shimmerDuration}
          gradientId={nativeGradientId}
        />
      ) : null}
    </View>
  );
}

// HACK: lucide ships every icon inside a 24×24 viewBox where the path
// doesn't touch the edges — there's per-icon internal padding. The layout
// already places the SVG element's box on the rail, but the visible glyph
// inside the SVG sits inset by a few pixels (and the inset amount differs
// per icon — chevron-right paints only in the right half of its viewBox,
// regular tool icons paint roughly the full viewBox minus ~1 unit margin).
//
// Lucide has no viewBox knob, so the only way to nudge the visible glyph
// flush with the rail is a per-icon negative margin. Cosmetic; not exact —
// every lucide icon has slightly different padding and we're not measuring
// each one. Two buckets is the compromise:
//   - LUCIDE_TOOL_ICON_NUDGE_LEFT: regular tool icons (path mostly fills
//     the viewBox); needs ~1px left shift.
//   - LUCIDE_CHEVRON_NUDGE_LEFT: chevron-right (path in right half of
//     viewBox, and we scale it 1.3×); needs ~4px left shift.
// If we ever want this exact, the principled fix is a custom <Svg> wrapper
// with a tight viewBox per icon — see option (2) in the design discussion.
const LUCIDE_TOOL_ICON_NUDGE_LEFT: ViewStyle = { marginLeft: -1 };
const LUCIDE_CHEVRON_NUDGE_LEFT: ViewStyle = { marginLeft: -4 };

function renderExpandableBadgeIcon({
  isError,
  isActive,
  ThemedIcon,
}: {
  isError: boolean;
  isActive: boolean;
  ThemedIcon: ComponentType<{ size?: number; uniProps?: typeof foregroundColorMapping }> | null;
}): ReactNode {
  if (isError) {
    return (
      <View style={LUCIDE_TOOL_ICON_NUDGE_LEFT}>
        <ThemedTriangleAlertIcon size={12} opacity={0.8} uniProps={destructiveColorMapping} />
      </View>
    );
  }
  if (ThemedIcon) {
    return (
      <View style={LUCIDE_TOOL_ICON_NUDGE_LEFT}>
        <ThemedIcon
          size={12}
          uniProps={isActive ? foregroundColorMapping : mutedForegroundColorMapping}
        />
      </View>
    );
  }
  return null;
}

function renderExpandableBadgeIconSlot({
  showChevron,
  chevronStyle,
  iconNode,
}: {
  showChevron: boolean;
  chevronStyle: StyleProp<ViewStyle>;
  iconNode: ReactNode;
}): ReactNode {
  if (showChevron) {
    return (
      <ThemedChevronRightIcon size={12} style={chevronStyle} uniProps={foregroundColorMapping} />
    );
  }
  return iconNode;
}

function computeShimmerMetrics(input: {
  label: string;
  secondaryLabel: string | undefined;
  isLoading: boolean;
  labelRowWidth: number;
  labelRowHeight: number;
  labelOffsetX: number;
  labelWidth: number;
  secondaryOffsetX: number;
  secondaryWidth: number;
}) {
  const totalShimmerChars = input.label.trim().length + (input.secondaryLabel?.trim().length ?? 0);
  const shortTextDurationAdjustment = totalShimmerChars <= 12 ? 0.25 : 0;
  const shimmerDuration = Math.max(
    1,
    Math.min(2.3, 1.25 + totalShimmerChars * 0.008 - shortTextDurationAdjustment),
  );
  const nativeShimmerPeakWidth = Math.max(
    32,
    Math.min(120, input.labelRowWidth > 0 ? input.labelRowWidth * 0.28 : 0),
  );
  const isWebShimmer = input.isLoading && isWeb;
  const shouldMeasureWebShimmer = isWebShimmer;
  const shouldMeasureNativeShimmer = input.isLoading && isNative;
  const isNativeShimmer =
    shouldMeasureNativeShimmer && input.labelRowWidth > 0 && input.labelRowHeight > 0;
  const webShimmerSpanStartX = input.labelOffsetX;
  const webShimmerSpanEndX = input.secondaryLabel
    ? input.secondaryOffsetX + input.secondaryWidth
    : input.labelOffsetX + input.labelWidth;
  const webShimmerSpanWidth = Math.max(1, webShimmerSpanEndX - webShimmerSpanStartX);
  const webShimmerPeakWidth = Math.max(42, Math.min(120, webShimmerSpanWidth * 0.22));
  const webShimmerTrackStart = webShimmerSpanStartX - webShimmerPeakWidth;
  const webShimmerTrackEnd = webShimmerSpanEndX;
  return {
    shimmerDuration,
    nativeShimmerPeakWidth,
    isWebShimmer,
    shouldMeasureWebShimmer,
    shouldMeasureNativeShimmer,
    isNativeShimmer,
    webShimmerPeakWidth,
    webShimmerTrackStart,
    webShimmerTrackEnd,
  };
}

function useDetailWheelPropagationBlocker(input: {
  detailWrapperRef: React.RefObject<View | null>;
  enabled: boolean;
}): void {
  const { detailWrapperRef, enabled } = input;
  useEffect(() => {
    if (!enabled) {
      return () => {};
    }
    const rawRef: unknown = detailWrapperRef.current;
    if (!(rawRef instanceof HTMLElement)) {
      return () => {};
    }
    const node = rawRef;
    const stopWheelPropagation = (event: WheelEvent) => {
      if (shouldStopDetailWheelPropagation(node, event)) {
        event.stopPropagation();
      }
    };
    node.addEventListener("wheel", stopWheelPropagation, { passive: true });
    return () => {
      node.removeEventListener("wheel", stopWheelPropagation);
    };
  }, [detailWrapperRef, enabled]);
}

const SHIMMER_GRADIENT =
  "linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.45) 24%, #ffffff 40%, #ffffff 60%, rgba(255, 255, 255, 0.45) 76%, rgba(255, 255, 255, 0) 100%)";

function buildShimmerTextStyle(input: {
  isWebShimmer: boolean;
  webShimmerPeakWidth: number;
  shimmerDuration: number;
  webShimmerTrackStart: number;
  webShimmerTrackEnd: number;
  offsetX: number;
}): object | null {
  if (!input.isWebShimmer) return null;
  return {
    opacity: 1,
    color: "transparent",
    backgroundImage: SHIMMER_GRADIENT,
    backgroundSize: `${input.webShimmerPeakWidth}px 100%`,
    backgroundRepeat: "no-repeat",
    backgroundClip: "text",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    animation: `${WEB_TOOLCALL_SHIMMER_ANIMATION_NAME} ${input.shimmerDuration}s linear infinite`,
    "--doya-shimmer-start": `${input.webShimmerTrackStart - input.offsetX}px`,
    "--doya-shimmer-end": `${input.webShimmerTrackEnd - input.offsetX}px`,
  };
}

const ExpandableBadge = memo(function ExpandableBadge({
  label,
  style,
  secondaryLabel,
  icon,
  isExpanded,
  onToggle,
  onOpenFile,
  onDetailHoverChange,
  renderDetails,
  isLoading = false,
  isError = false,
  isLastInSequence = false,
  disableOuterSpacing,
  testID,
}: ExpandableBadgeProps) {
  const resolvedDisableOuterSpacing = useDisableOuterSpacing(disableOuterSpacing);
  const [isHovered, setIsHovered] = useState(false);
  const [isOpenFileHovered, setIsOpenFileHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const isInteractive = Boolean(onToggle);
  const hasDetailContent = Boolean(renderDetails);
  const detailContent = hasDetailContent && isExpanded ? renderDetails?.() : null;
  const detailWrapperRef = useRef<View | null>(null);

  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => {
    setIsHovered(false);
    setIsPressed(false);
  }, []);
  const handlePressIn = useCallback(() => setIsPressed(true), []);
  const handlePressOut = useCallback(() => setIsPressed(false), []);
  const handleDetailHoverIn = useCallback(() => onDetailHoverChange?.(true), [onDetailHoverChange]);
  const handleDetailHoverOut = useCallback(
    () => onDetailHoverChange?.(false),
    [onDetailHoverChange],
  );
  const handleOpenFilePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation?.();
      onOpenFile?.();
    },
    [onOpenFile],
  );
  const handleOpenFileHoverIn = useCallback(() => setIsOpenFileHovered(true), []);
  const handleOpenFileHoverOut = useCallback(() => setIsOpenFileHovered(false), []);

  const nativeGradientIdRef = useRef(
    `shimmer-gradient-${Math.random().toString(36).substring(2, 9)}`,
  );
  const [labelRowWidth, setLabelRowWidth] = useState(0);
  const [labelRowHeight, setLabelRowHeight] = useState(0);
  const [labelOffsetX, setLabelOffsetX] = useState(0);
  const [labelWidth, setLabelWidth] = useState(0);
  const [secondaryOffsetX, setSecondaryOffsetX] = useState(0);
  const [secondaryWidth, setSecondaryWidth] = useState(0);

  const {
    shimmerDuration,
    nativeShimmerPeakWidth,
    isWebShimmer,
    shouldMeasureWebShimmer,
    shouldMeasureNativeShimmer,
    isNativeShimmer,
    webShimmerPeakWidth,
    webShimmerTrackStart,
    webShimmerTrackEnd,
  } = computeShimmerMetrics({
    label,
    secondaryLabel,
    isLoading,
    labelRowWidth,
    labelRowHeight,
    labelOffsetX,
    labelWidth,
    secondaryOffsetX,
    secondaryWidth,
  });

  const handleLabelRowLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (!shouldMeasureNativeShimmer) {
        return;
      }
      const { width, height } = event.nativeEvent.layout;
      setLabelRowWidth((previous) => (Math.abs(previous - width) > 0.5 ? width : previous));
      setLabelRowHeight((previous) => (Math.abs(previous - height) > 0.5 ? height : previous));
    },
    [shouldMeasureNativeShimmer],
  );

  const handleLabelLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (!shouldMeasureWebShimmer) {
        return;
      }
      const { x, width } = event.nativeEvent.layout;
      setLabelOffsetX((previous) => (Math.abs(previous - x) > 0.5 ? x : previous));
      setLabelWidth((previous) => (Math.abs(previous - width) > 0.5 ? width : previous));
    },
    [shouldMeasureWebShimmer],
  );

  const handleSecondaryLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (!shouldMeasureWebShimmer || !secondaryLabel) {
        return;
      }
      const { x, width } = event.nativeEvent.layout;
      setSecondaryOffsetX((previous) => (Math.abs(previous - x) > 0.5 ? x : previous));
      setSecondaryWidth((previous) => (Math.abs(previous - width) > 0.5 ? width : previous));
    },
    [shouldMeasureWebShimmer, secondaryLabel],
  );

  useEffect(() => {
    if (!isWebShimmer) {
      return;
    }
    ensureWebToolCallShimmerKeyframes();
  }, [isWebShimmer]);

  useDetailWheelPropagationBlocker({
    detailWrapperRef,
    enabled: !isNative && isExpanded && hasDetailContent,
  });

  const shimmerLabelStyle = useMemo<StyleProp<TextStyle>>(
    () =>
      buildShimmerTextStyle({
        isWebShimmer,
        webShimmerPeakWidth,
        shimmerDuration,
        webShimmerTrackStart,
        webShimmerTrackEnd,
        offsetX: labelOffsetX,
      }),
    [
      isWebShimmer,
      webShimmerPeakWidth,
      shimmerDuration,
      webShimmerTrackStart,
      webShimmerTrackEnd,
      labelOffsetX,
    ],
  );

  const shimmerSecondaryStyle = useMemo<StyleProp<TextStyle>>(
    () =>
      buildShimmerTextStyle({
        isWebShimmer,
        webShimmerPeakWidth,
        shimmerDuration,
        webShimmerTrackStart,
        webShimmerTrackEnd,
        offsetX: secondaryOffsetX,
      }),
    [
      isWebShimmer,
      webShimmerPeakWidth,
      shimmerDuration,
      webShimmerTrackStart,
      webShimmerTrackEnd,
      secondaryOffsetX,
    ],
  );

  const containerStyle = useMemo(
    () => [
      expandableBadgeStylesheet.container,
      !resolvedDisableOuterSpacing &&
        (isLastInSequence
          ? expandableBadgeStylesheet.containerLastInSequence
          : expandableBadgeStylesheet.containerSpacing),
      style,
    ],
    [isLastInSequence, resolvedDisableOuterSpacing, style],
  );

  const pressableStyle = useMemo(
    () => [
      expandableBadgeStylesheet.pressable,
      isPressed && isInteractive ? expandableBadgeStylesheet.pressablePressed : null,
      isExpanded && expandableBadgeStylesheet.pressableExpanded,
    ],
    [isExpanded, isInteractive, isPressed],
  );

  const accessibilityState = useMemo(
    () => (isInteractive ? { expanded: isExpanded } : undefined),
    [isExpanded, isInteractive],
  );

  const isActive = isHovered || isExpanded;

  const labelStyle = useMemo(
    () => [
      expandableBadgeStylesheet.label,
      isActive && expandableBadgeStylesheet.labelActive,
      isLoading && expandableBadgeStylesheet.labelLoading,
    ],
    [isActive, isLoading],
  );

  const secondaryLabelStyle = useMemo(
    () => [
      expandableBadgeStylesheet.secondaryLabel,
      isActive && expandableBadgeStylesheet.secondaryLabelActive,
    ],
    [isActive],
  );

  const shimmerLabelTextStyle = useMemo(
    () => [
      expandableBadgeStylesheet.label,
      isLoading && expandableBadgeStylesheet.labelLoading,
      expandableBadgeStylesheet.shimmerText,
      shimmerLabelStyle,
    ],
    [isLoading, shimmerLabelStyle],
  );

  const shimmerSecondaryTextStyle = useMemo(
    () => [
      expandableBadgeStylesheet.secondaryLabel,
      expandableBadgeStylesheet.shimmerText,
      shimmerSecondaryStyle,
    ],
    [shimmerSecondaryStyle],
  );

  const chevronStyle = useMemo(
    () => [
      expandableBadgeStylesheet.chevron,
      isExpanded && expandableBadgeStylesheet.chevronExpanded,
      LUCIDE_CHEVRON_NUDGE_LEFT,
    ],
    [isExpanded],
  );

  const ThemedIcon = useMemo(() => (icon ? withUnistyles(icon) : null), [icon]);
  const iconNode = renderExpandableBadgeIcon({ isError, isActive, ThemedIcon });
  const iconSlotNode = renderExpandableBadgeIconSlot({
    showChevron: isInteractive && isHovered,
    chevronStyle,
    iconNode,
  });

  const pressHandlers = isInteractive
    ? {
        onPress: onToggle,
        onPressIn: handlePressIn,
        onPressOut: handlePressOut,
        accessibilityRole: "button" as const,
      }
    : {};

  return (
    <View
      style={containerStyle}
      testID={testID}
      onPointerEnter={isWeb ? handleHoverIn : undefined}
      onPointerLeave={isWeb ? handleHoverOut : undefined}
    >
      <Pressable
        {...pressHandlers}
        disabled={!isInteractive}
        accessibilityState={accessibilityState}
        style={pressableStyle}
      >
        <View style={expandableBadgeStylesheet.headerRow}>
          <View style={expandableBadgeStylesheet.iconBadge}>{iconSlotNode}</View>
          <ExpandableBadgeLabelRow
            label={label}
            labelStyle={labelStyle}
            secondaryLabel={secondaryLabel}
            secondaryLabelStyle={secondaryLabelStyle}
            shouldMeasureWebShimmer={shouldMeasureWebShimmer}
            shouldMeasureNativeShimmer={shouldMeasureNativeShimmer}
            isWebShimmer={isWebShimmer}
            isNativeShimmer={isNativeShimmer}
            shimmerLabelTextStyle={shimmerLabelTextStyle}
            shimmerSecondaryTextStyle={shimmerSecondaryTextStyle}
            labelRowWidth={labelRowWidth}
            labelRowHeight={labelRowHeight}
            nativeShimmerPeakWidth={nativeShimmerPeakWidth}
            shimmerDuration={shimmerDuration}
            nativeGradientId={nativeGradientIdRef.current}
            onLabelRowLayout={handleLabelRowLayout}
            onLabelLayout={handleLabelLayout}
            onSecondaryLayout={handleSecondaryLayout}
            showOpenFileButton={Boolean(onOpenFile && isHovered)}
            isOpenFileHovered={isOpenFileHovered}
            onOpenFilePress={handleOpenFilePress}
            onOpenFileHoverIn={handleOpenFileHoverIn}
            onOpenFileHoverOut={handleOpenFileHoverOut}
          />
        </View>
      </Pressable>
      {detailContent ? (
        <Pressable
          ref={detailWrapperRef}
          style={expandableBadgeStylesheet.detailWrapper}
          onHoverIn={handleDetailHoverIn}
          onHoverOut={handleDetailHoverOut}
        >
          {detailContent}
        </Pressable>
      ) : null}
    </View>
  );
}, areExpandableBadgePropsEqual);

function areExpandableBadgePropsEqual(previous: ExpandableBadgeProps, next: ExpandableBadgeProps) {
  if (previous.label !== next.label) return false;
  if (previous.secondaryLabel !== next.secondaryLabel) return false;
  if (previous.icon !== next.icon) return false;
  if (previous.isExpanded !== next.isExpanded) return false;
  if (previous.style !== next.style) return false;
  if (previous.isLoading !== next.isLoading) return false;
  if (previous.isError !== next.isError) return false;
  if (previous.isLastInSequence !== next.isLastInSequence) return false;
  if (previous.disableOuterSpacing !== next.disableOuterSpacing) return false;
  if (previous.testID !== next.testID) return false;
  if (previous.onToggle !== next.onToggle) return false;
  if (previous.onOpenFile !== next.onOpenFile) return false;
  if (previous.onDetailHoverChange !== next.onDetailHoverChange) return false;
  if (previous.renderDetails !== next.renderDetails) return false;
  return true;
}

interface ToolCallProps {
  toolName: string;
  args?: unknown;
  result?: unknown;
  error?: unknown;
  status: "executing" | "running" | "completed" | "failed" | "canceled";
  detail?: ToolCallDetail;
  cwd?: string;
  metadata?: Record<string, unknown>;
  isLastInSequence?: boolean;
  disableOuterSpacing?: boolean;
  onInlineDetailsHoverChange?: (hovered: boolean) => void;
  onInlineDetailsExpandedChange?: (expanded: boolean) => void;
  onOpenFilePath?: (filePath: string) => void;
}

export const ToolCall = memo(function ToolCall({
  toolName,
  args,
  result,
  error,
  status,
  detail,
  cwd,
  metadata,
  isLastInSequence = false,
  disableOuterSpacing,
  onInlineDetailsHoverChange,
  onInlineDetailsExpandedChange,
  onOpenFilePath,
}: ToolCallProps) {
  const { openToolCall } = useToolCallSheet();
  const [isExpanded, setIsExpanded] = useState(false);

  const isMobile = useIsCompactFormFactor();

  const effectiveDetail = useMemo<ToolCallDetail | undefined>(() => {
    if (detail) {
      return detail;
    }
    if (args !== undefined || result !== undefined) {
      return {
        type: "unknown",
        input: args ?? null,
        output: result ?? null,
      };
    }
    return undefined;
  }, [detail, args, result]);

  const presentation = useMemo(
    () =>
      buildToolCallPresentation({
        toolName,
        status,
        error: error ?? null,
        detail: effectiveDetail,
        metadata,
        cwd,
        resolveIcon: resolveToolCallIcon,
      }),
    [toolName, status, error, effectiveDetail, metadata, cwd],
  );
  const handleOpenFile = useMemo(() => {
    const openFilePath = presentation.openFilePath;
    if (!openFilePath || !onOpenFilePath) {
      return undefined;
    }
    return () => onOpenFilePath(openFilePath);
  }, [presentation.openFilePath, onOpenFilePath]);

  const handleToggle = useCallback(() => {
    if (isMobile) {
      openToolCall({
        displayName: presentation.displayName,
        summary: presentation.summary,
        detail: effectiveDetail,
        errorText: presentation.errorText,
        icon: presentation.icon,
        showLoadingSkeleton: presentation.isLoadingDetails,
      });
    } else {
      setIsExpanded((prev) => !prev);
    }
  }, [
    isMobile,
    openToolCall,
    presentation.displayName,
    presentation.summary,
    presentation.errorText,
    presentation.icon,
    presentation.isLoadingDetails,
    effectiveDetail,
  ]);

  useEffect(() => {
    if (!onInlineDetailsHoverChange || isMobile || isExpanded) {
      return;
    }
    onInlineDetailsHoverChange(false);
  }, [isExpanded, isMobile, onInlineDetailsHoverChange]);

  useEffect(() => {
    if (!onInlineDetailsExpandedChange) {
      return;
    }
    if (isMobile) {
      onInlineDetailsExpandedChange(false);
      return;
    }
    onInlineDetailsExpandedChange(isExpanded);
  }, [isExpanded, isMobile, onInlineDetailsExpandedChange]);

  useEffect(() => {
    if (!onInlineDetailsExpandedChange) {
      return () => {};
    }
    return () => {
      onInlineDetailsExpandedChange(false);
    };
  }, [onInlineDetailsExpandedChange]);

  // Render inline details for desktop
  const renderDetails = useCallback(() => {
    if (isMobile) return null;
    return (
      <ToolCallDetailsContent
        detail={effectiveDetail}
        errorText={presentation.errorText}
        maxHeight={400}
        showLoadingSkeleton={presentation.isLoadingDetails}
      />
    );
  }, [isMobile, effectiveDetail, presentation.errorText, presentation.isLoadingDetails]);

  if (presentation.isPlan && effectiveDetail?.type === "plan") {
    return (
      <PlanCard
        title={translateNow("ui.plan.1hdft")}
        text={effectiveDetail.text}
        testID="timeline-plan-card"
        disableOuterSpacing={disableOuterSpacing}
      />
    );
  }

  return (
    <ExpandableBadge
      testID="tool-call-badge"
      label={presentation.displayName}
      secondaryLabel={presentation.summary}
      icon={presentation.icon}
      isExpanded={!isMobile && isExpanded}
      onToggle={presentation.canOpenDetails ? handleToggle : undefined}
      onOpenFile={handleOpenFile}
      renderDetails={presentation.canOpenDetails && !isMobile ? renderDetails : undefined}
      isLoading={status === "running" || status === "executing"}
      isError={status === "failed"}
      isLastInSequence={isLastInSequence}
      disableOuterSpacing={disableOuterSpacing}
      onDetailHoverChange={onInlineDetailsHoverChange}
    />
  );
}, areToolCallPropsEqual);

function areToolCallPropsEqual(previous: ToolCallProps, next: ToolCallProps) {
  if (previous.toolName !== next.toolName) return false;
  if (previous.args !== next.args) return false;
  if (previous.result !== next.result) return false;
  if (previous.error !== next.error) return false;
  if (previous.status !== next.status) return false;
  if (previous.detail !== next.detail) return false;
  if (previous.cwd !== next.cwd) return false;
  if (previous.metadata !== next.metadata) return false;
  if (previous.isLastInSequence !== next.isLastInSequence) return false;
  if (previous.disableOuterSpacing !== next.disableOuterSpacing) return false;
  if (previous.onOpenFilePath !== next.onOpenFilePath) return false;
  return true;
}

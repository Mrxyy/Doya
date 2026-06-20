import React, { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DaemonClient, FileReadResult } from "@getdoya/client/internal/daemon-client";
import Markdown, { MarkdownIt } from "react-native-markdown-display";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image as RNImage,
  ScrollView as RNScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useSessionStore, type ExplorerFile } from "@/stores/session-store";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { useWebScrollbarStyle } from "@/hooks/use-web-scrollbar-style";
import { highlightCode, type HighlightToken } from "@getdoya/highlight";
import { Button } from "@/components/ui/button";
import { syntaxTokenStyleFor } from "@/styles/syntax-token-styles";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { lineNumberGutterWidth } from "@/components/code-insets";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { isRenderedMarkdownFile } from "@/components/file-pane-render-mode";
import { isWeb } from "@/constants/platform";
import { createMarkdownStyles } from "@/styles/markdown-styles";
import type { AttachmentMetadata } from "@/attachments/types";
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";
import { persistAttachmentFromBytes } from "@/attachments/service";
import { createPreviewAttachmentId, getFileNameFromPath } from "@/attachments/utils";
import {
  DocumentViewer,
  type DocumentAnnotationTarget,
  type DocumentViewerKind,
} from "@/components/document-viewer";
import { explorerFileFromReadResult } from "@/file-explorer/read-result";
import { resolveFilePreviewReadTarget } from "@/file-explorer/preview-target";
import type { WorkspaceFileLocation } from "@/workspace/file-open";
import { translateNow, useI18n, type Locale } from "@/i18n/i18n";
import {
  shouldPollDocumentAnnotationPreview,
  transitionDocumentAnnotationApplyPhase,
  type DocumentAnnotationApplyPhase,
} from "@/utils/document-annotation-apply-phase";
import { beginDocumentAnnotationApplyRequest } from "@/utils/document-annotation-apply-request";
import { resolveDocumentAnnotationAvailability } from "@/utils/document-annotation-availability";
import {
  getDocumentAnnotationControllerView,
  initialDocumentAnnotationControllerState,
  reduceDocumentAnnotationControllerState,
  type PendingDocumentAnnotation,
} from "@/utils/document-annotation-controller";
import { createDocumentPreviewRevision } from "@/utils/document-preview-revision";
import { resolveDocumentViewerKind } from "@/utils/document-viewer-kind";

interface CodeLineProps {
  tokens: HighlightToken[];
  lineNumber: number;
  gutterWidth: number;
  highlighted: boolean;
}

interface FilePreviewBodyProps {
  preview: ExplorerFile | null;
  documentBytes: Uint8Array | null;
  documentKind: DocumentViewerKind | null;
  documentSourceUrl: string | null;
  documentPreviewRevision: string | null;
  documentAnnotationMode: boolean;
  pendingDocumentAnnotationTargets: DocumentAnnotationTarget[];
  selectedDocumentAnnotationTarget: DocumentAnnotationTarget | null;
  isLoading: boolean;
  showDesktopWebScrollbar: boolean;
  isMobile: boolean;
  location: WorkspaceFileLocation;
  imagePreviewUri: string | null;
  onDocumentAnnotationTargetSelect: (target: DocumentAnnotationTarget) => void;
}

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface FileLineSelection {
  lineStart: number;
  lineEnd: number;
}

interface DocumentAnnotationController {
  annotationMode: boolean;
  selectedAnnotationTarget: DocumentAnnotationTarget | null;
  annotationInstruction: string;
  pendingAnnotations: PendingDocumentAnnotation[];
  applyPhase: DocumentAnnotationApplyPhase;
  hasPendingAnnotations: boolean;
  canAddAnnotation: boolean;
  canApplyAnnotations: boolean;
  modeButtonLabel: string;
  modeButtonVariant: "default" | "outline";
  setAnnotationInstruction: (value: string) => void;
  toggleAnnotationMode: () => void;
  selectTarget: (target: DocumentAnnotationTarget) => void;
  addAnnotation: () => void;
  removeAnnotation: (id: string) => void;
  applyAnnotations: () => void;
}

function formatFileSize({ size }: { size: number }): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

async function createFilePanePreview(file: FileReadResult | null): Promise<{
  file: ExplorerFile | null;
  imageAttachment: AttachmentMetadata | null;
  documentBytes: Uint8Array | null;
  documentKind: DocumentViewerKind | null;
  documentSourceUrl: string | null;
}> {
  if (!file) {
    return {
      file: null,
      imageAttachment: null,
      documentBytes: null,
      documentKind: null,
      documentSourceUrl: null,
    };
  }

  const explorerFile = explorerFileFromReadResult(file);
  const documentKind = resolveDocumentViewerKind({
    path: file.path,
    mimeType: file.mime,
  });
  if (documentKind) {
    return {
      file: explorerFile,
      imageAttachment: null,
      documentBytes: file.bytes,
      documentKind,
      documentSourceUrl: null,
    };
  }

  if (file.kind !== "image") {
    return {
      file: explorerFile,
      imageAttachment: null,
      documentBytes: null,
      documentKind: null,
      documentSourceUrl: null,
    };
  }

  const imageAttachment = await persistAttachmentFromBytes({
    id: createPreviewAttachmentId({
      mimeType: file.mime,
      path: file.path,
      size: file.size,
      modifiedAt: file.modifiedAt,
      contentLength: file.bytes.byteLength,
    }),
    bytes: file.bytes,
    mimeType: file.mime,
    fileName: getFileNameFromPath(file.path),
  });

  return {
    file: explorerFile,
    imageAttachment,
    documentBytes: null,
    documentKind: null,
    documentSourceUrl: null,
  };
}

type FilePanePreviewData = Awaited<ReturnType<typeof createFilePanePreview>> & {
  error: string | null;
};

type FilePaneReadTarget = NonNullable<ReturnType<typeof resolveFilePreviewReadTarget>>;

function createFilePaneUnavailablePreview(error: string): FilePanePreviewData {
  return {
    file: null,
    imageAttachment: null,
    documentBytes: null,
    documentKind: null,
    documentSourceUrl: null,
    error,
  };
}

function getDocumentSourceUrl(input: {
  client: DaemonClient;
  documentKind: DocumentViewerKind | null;
  readTarget: FilePaneReadTarget;
}): string | null {
  const { client, documentKind, readTarget } = input;
  if (documentKind === "docx") {
    return client.buildWorkspaceFileRawUrl({
      cwd: readTarget.cwd,
      path: readTarget.path,
    });
  }
  if (documentKind === "xlsx") {
    return withOnlyOfficeXlsxPreviewVersion(
      client.buildWorkspaceFileOnlyOfficePreviewUrl({
        cwd: readTarget.cwd,
        path: readTarget.path,
      }),
    );
  }
  return null;
}

const ONLYOFFICE_XLSX_PREVIEW_VERSION = "4";

function withOnlyOfficeXlsxPreviewVersion(sourceUrl: string): string {
  const url = new URL(sourceUrl);
  url.searchParams.set("preview_version", ONLYOFFICE_XLSX_PREVIEW_VERSION);
  return url.toString();
}

async function readFilePanePreview(input: {
  client: DaemonClient | null;
  readTarget: FilePaneReadTarget | null;
}): Promise<FilePanePreviewData> {
  const { client, readTarget } = input;
  if (!client || !readTarget) {
    return createFilePaneUnavailablePreview(translateNow("ui.host.is.not.connected.n90cm6"));
  }
  try {
    const file = await client.readFile(readTarget.cwd, readTarget.path);
    const preview = await createFilePanePreview(file);
    return {
      ...preview,
      documentSourceUrl: getDocumentSourceUrl({
        client,
        documentKind: preview.documentKind,
        readTarget,
      }),
      error: null,
    };
  } catch (error) {
    return createFilePaneUnavailablePreview(
      error instanceof Error ? error.message : "Failed to load file",
    );
  }
}

function clampLineSelection(input: {
  lineStart?: number;
  lineEnd?: number;
  lineCount: number;
}): FileLineSelection | null {
  if (!input.lineStart || input.lineStart <= 0 || input.lineCount <= 0) {
    return null;
  }
  const lineStart = Math.min(Math.floor(input.lineStart), input.lineCount);
  const rawLineEnd =
    input.lineEnd && input.lineEnd >= input.lineStart ? input.lineEnd : input.lineStart;
  const lineEnd = Math.min(Math.floor(rawLineEnd), input.lineCount);
  return { lineStart, lineEnd: Math.max(lineStart, lineEnd) };
}

const CodeLine = React.memo(function CodeLine({
  tokens,
  lineNumber,
  gutterWidth,
  highlighted,
}: CodeLineProps) {
  const gutterStyle = useMemo(
    () => [codeLineStyles.gutter, inlineUnistylesStyle({ width: gutterWidth })],
    [gutterWidth],
  );
  const lineStyle = useMemo(
    () => [codeLineStyles.line, highlighted && codeLineStyles.highlightedLine],
    [highlighted],
  );
  const keyedTokens = useMemo(
    () => tokens.map((token, index) => ({ key: `${index}-${token.text}`, token })),
    [tokens],
  );
  return (
    <View style={lineStyle}>
      <View style={gutterStyle}>
        <Text numberOfLines={1} style={codeLineStyles.gutterText}>
          {String(lineNumber)}
        </Text>
      </View>
      <Text selectable style={codeLineStyles.lineText}>
        {keyedTokens.map(({ key, token }) => (
          <CodeLineToken key={key} token={token} />
        ))}
      </Text>
    </View>
  );
});

interface CodeLineTokenProps {
  token: HighlightToken;
}

function CodeLineToken({ token }: CodeLineTokenProps) {
  return <Text style={syntaxTokenStyleFor(token.style)}>{token.text}</Text>;
}

const codeLineStyles = StyleSheet.create((theme) => ({
  line: {
    flexDirection: "row",
  },
  highlightedLine: {
    backgroundColor: theme.colors.accentBorder,
  },
  gutter: {
    alignItems: "flex-end",
    paddingRight: theme.spacing[3],
    flexShrink: 0,
  },
  gutterText: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    lineHeight: theme.fontSize.code * 1.45,
    opacity: 0.4,
    userSelect: "none",
  },
  lineText: {
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    lineHeight: theme.fontSize.code * 1.45,
    flex: 1,
  },
}));

function FilePreviewBody({
  preview,
  documentBytes,
  documentKind,
  documentSourceUrl,
  documentPreviewRevision,
  documentAnnotationMode,
  pendingDocumentAnnotationTargets,
  selectedDocumentAnnotationTarget,
  isLoading,
  showDesktopWebScrollbar,
  isMobile,
  location,
  imagePreviewUri,
  onDocumentAnnotationTargetSelect,
}: FilePreviewBodyProps) {
  const { theme } = useUnistyles();
  const filePath = location.path;
  const markdownStyles = useMemo(() => createMarkdownStyles(theme), [theme]);
  const markdownParser = useMemo(() => MarkdownIt({ typographer: true, linkify: true }), []);
  const isMarkdownFile = isRenderedMarkdownPreview({ filePath, location, preview });

  const previewScrollRef = useRef<RNScrollView>(null);
  const webScrollbarStyle = useWebScrollbarStyle();
  const scrollbar = useWebScrollViewScrollbar(previewScrollRef, {
    enabled: showDesktopWebScrollbar,
  });

  const highlightedLines = useMemo(() => {
    const textPreview = !isMarkdownFile && preview?.kind === "text" ? preview : null;
    if (!textPreview) {
      return null;
    }

    return highlightCode(textPreview.content ?? "", filePath);
  }, [isMarkdownFile, preview, filePath]);

  const gutterWidth = useMemo(() => {
    if (!highlightedLines) return 0;
    return lineNumberGutterWidth(highlightedLines.length, theme.fontSize.code);
  }, [highlightedLines, theme.fontSize.code]);
  const lineHeight = theme.fontSize.code * 1.45;
  const lineSelection = useMemo(() => {
    if (!highlightedLines) {
      return null;
    }
    return clampLineSelection({
      lineStart: location.lineStart,
      lineEnd: location.lineEnd,
      lineCount: highlightedLines.length,
    });
  }, [highlightedLines, location.lineEnd, location.lineStart]);

  const imageSource = useMemo(
    () => (imagePreviewUri ? { uri: imagePreviewUri } : null),
    [imagePreviewUri],
  );

  useEffect(() => {
    if (!lineSelection) {
      return;
    }
    const timeout = setTimeout(() => {
      previewScrollRef.current?.scrollTo({
        y: Math.max(0, (lineSelection.lineStart - 1) * lineHeight),
        animated: false,
      });
    }, 0);
    return () => clearTimeout(timeout);
  }, [lineHeight, lineSelection]);

  if (isLoading && !preview) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator size="small" />
        <Text style={styles.loadingText}>{translateNow("ui.loading.file.1vqma06")}</Text>
      </View>
    );
  }

  if (!preview) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.emptyText}>{translateNow("ui.no.preview.available.4gglbm")}</Text>
      </View>
    );
  }

  if (documentBytes && documentKind) {
    return (
      <DocumentViewer
        key={`${documentPreviewRevision ?? `${documentKind}:${filePath}`}:${documentSourceUrl ?? ""}`}
        kind={documentKind}
        bytes={documentBytes}
        mimeType={preview.mimeType ?? "application/octet-stream"}
        fileName={filePath.split("/").findLast(Boolean) ?? filePath}
        sourceUrl={documentSourceUrl}
        annotationMode={documentAnnotationMode}
        pendingAnnotationTargets={pendingDocumentAnnotationTargets}
        selectedAnnotationTarget={selectedDocumentAnnotationTarget}
        onAnnotationTargetSelect={onDocumentAnnotationTargetSelect}
      />
    );
  }

  if (preview.kind === "text") {
    if (isMarkdownFile) {
      return (
        <View style={styles.previewScrollContainer}>
          <RNScrollView
            ref={previewScrollRef}
            style={styles.previewContent}
            contentContainerStyle={styles.previewMarkdownScrollContent}
            onLayout={scrollbar.onLayout}
            onScroll={scrollbar.onScroll}
            onContentSizeChange={scrollbar.onContentSizeChange}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={!showDesktopWebScrollbar}
          >
            <Markdown style={markdownStyles} markdownit={markdownParser}>
              {preview.content ?? ""}
            </Markdown>
          </RNScrollView>
          {scrollbar.overlay}
        </View>
      );
    }

    const lines = highlightedLines ?? [[{ text: preview.content ?? "", style: null }]];
    const keyedLines = lines.map((tokens, index) => ({
      key: `line-${index}`,
      tokens,
      lineNumber: index + 1,
    }));
    const codeLines = (
      <View dataSet={CODE_SURFACE_DATASET}>
        {keyedLines.map(({ key, tokens, lineNumber }) => (
          <CodeLine
            key={key}
            tokens={tokens}
            lineNumber={lineNumber}
            gutterWidth={gutterWidth}
            highlighted={isLineNumberSelected(lineSelection, lineNumber)}
          />
        ))}
      </View>
    );

    return (
      <View style={styles.previewScrollContainer}>
        <RNScrollView
          ref={previewScrollRef}
          style={styles.previewContent}
          onLayout={scrollbar.onLayout}
          onScroll={scrollbar.onScroll}
          onContentSizeChange={scrollbar.onContentSizeChange}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={!showDesktopWebScrollbar}
        >
          {isMobile ? (
            <View style={styles.previewCodeScrollContent}>{codeLines}</View>
          ) : (
            <RNScrollView
              horizontal
              nestedScrollEnabled
              showsHorizontalScrollIndicator
              style={webScrollbarStyle}
              contentContainerStyle={styles.previewCodeScrollContent}
            >
              {codeLines}
            </RNScrollView>
          )}
        </RNScrollView>
        {scrollbar.overlay}
      </View>
    );
  }

  if (preview.kind === "image") {
    if (!imagePreviewUri) {
      return (
        <View style={styles.centerState}>
          <ActivityIndicator size="small" />
          <Text style={styles.loadingText}>{translateNow("ui.loading.file.1vqma06")}</Text>
        </View>
      );
    }

    return (
      <View style={styles.previewScrollContainer}>
        <RNScrollView
          ref={previewScrollRef}
          style={styles.previewContent}
          contentContainerStyle={styles.previewImageScrollContent}
          onLayout={scrollbar.onLayout}
          onScroll={scrollbar.onScroll}
          onContentSizeChange={scrollbar.onContentSizeChange}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={!showDesktopWebScrollbar}
        >
          <RNImage
            source={imageSource ?? undefined}
            style={styles.previewImage}
            resizeMode="contain"
          />
        </RNScrollView>
        {scrollbar.overlay}
      </View>
    );
  }

  return (
    <View style={styles.centerState}>
      <Text style={styles.emptyText}>{translateNow("ui.binary.preview.unavailable.1p2cq61")}</Text>
      <Text style={styles.binaryMetaText}>{formatFileSize({ size: preview.size })}</Text>
    </View>
  );
}

function isRenderedMarkdownPreview(input: {
  filePath: string;
  location: WorkspaceFileLocation;
  preview: ExplorerFile | null;
}): boolean {
  return Boolean(
    input.preview?.kind === "text" &&
    isRenderedMarkdownFile(input.filePath) &&
    !input.location.lineStart,
  );
}

function isLineNumberSelected(
  lineSelection: { lineStart: number; lineEnd: number } | null,
  lineNumber: number,
): boolean {
  return Boolean(
    lineSelection && lineNumber >= lineSelection.lineStart && lineNumber <= lineSelection.lineEnd,
  );
}

function useDocumentAnnotationController(input: {
  appendOptimisticUserMessageToAgentStream: ReturnType<
    typeof useSessionStore.getState
  >["appendOptimisticUserMessageToAgentStream"];
  client: DaemonClient | null;
  documentKind: DocumentViewerKind | null | undefined;
  filePath: string;
  onApplied: () => Promise<string | null>;
  previewRevision: string | null;
  serverId: string;
  sourceAgentId?: string;
  sourceAgentStatus: string | null;
  defaultLocale: Locale;
}): DocumentAnnotationController {
  const {
    appendOptimisticUserMessageToAgentStream,
    client,
    documentKind,
    filePath,
    defaultLocale,
    onApplied,
    previewRevision,
    serverId,
    sourceAgentId,
    sourceAgentStatus,
  } = input;
  const [state, dispatch] = useReducer(
    reduceDocumentAnnotationControllerState,
    initialDocumentAnnotationControllerState,
  );
  const applyBaseRevisionRef = useRef<string | null>(null);
  const view = useMemo(() => getDocumentAnnotationControllerView(state), [state]);

  useEffect(() => {
    applyBaseRevisionRef.current = null;
    dispatch({ type: "reset" });
  }, [filePath]);

  useEffect(() => {
    const transition = transitionDocumentAnnotationApplyPhase({
      phase: state.applyPhase,
      sourceAgentStatus,
    });
    if (transition.phase !== state.applyPhase) {
      dispatch({ type: "set_apply_phase", phase: transition.phase });
    }
    if (transition.shouldRefreshPreview) {
      void onApplied().then((nextRevision) => {
        if (
          nextRevision &&
          applyBaseRevisionRef.current &&
          nextRevision !== applyBaseRevisionRef.current
        ) {
          applyBaseRevisionRef.current = null;
          dispatch({ type: "clear_after_apply_success" });
        }
        return undefined;
      });
    }
  }, [onApplied, sourceAgentStatus, state.applyPhase]);

  useEffect(() => {
    if (!shouldPollDocumentAnnotationPreview(state.applyPhase)) {
      return;
    }
    let inFlight = false;
    const interval = setInterval(() => {
      if (inFlight) {
        return;
      }
      inFlight = true;
      void onApplied()
        .then((nextRevision) => {
          if (
            nextRevision &&
            applyBaseRevisionRef.current &&
            nextRevision !== applyBaseRevisionRef.current
          ) {
            applyBaseRevisionRef.current = null;
            dispatch({ type: "clear_after_apply_success" });
          }
          return undefined;
        })
        .finally(() => {
          inFlight = false;
        });
    }, 2500);
    return () => clearInterval(interval);
  }, [onApplied, state.applyPhase]);

  const toggleAnnotationMode = useCallback(() => {
    dispatch({ type: "toggle_mode" });
  }, []);

  const selectTarget = useCallback((target: DocumentAnnotationTarget) => {
    dispatch({ type: "select_target", target });
  }, []);

  const addAnnotation = useCallback(() => {
    dispatch({ type: "add_annotation", id: `${Date.now()}-${state.pendingAnnotations.length}` });
  }, [state.pendingAnnotations.length]);

  const removeAnnotation = useCallback((id: string) => {
    dispatch({ type: "remove_annotation", id });
  }, []);

  const applyAnnotations = useCallback(() => {
    if (!client || !sourceAgentId || !documentKind || state.pendingAnnotations.length === 0) {
      return;
    }
    const request = beginDocumentAnnotationApplyRequest({
      appendOptimisticUserMessageToAgentStream,
      client,
      documentKind,
      filePath,
      annotations: state.pendingAnnotations,
      defaultLocale,
      serverId,
      sourceAgentId,
      sourceAgentStatus,
    });
    applyBaseRevisionRef.current = previewRevision;
    dispatch({ type: "set_apply_phase", phase: request.phase });
    void request.sendPromise
      .then(() => {
        return undefined;
      })
      .catch(() => {
        dispatch({ type: "set_apply_phase", phase: "idle" });
        return undefined;
      });
  }, [
    appendOptimisticUserMessageToAgentStream,
    client,
    documentKind,
    filePath,
    defaultLocale,
    serverId,
    sourceAgentId,
    sourceAgentStatus,
    previewRevision,
    state.pendingAnnotations,
  ]);

  return {
    annotationMode: state.annotationMode,
    selectedAnnotationTarget: state.selectedAnnotationTarget,
    annotationInstruction: state.annotationInstruction,
    pendingAnnotations: state.pendingAnnotations,
    applyPhase: state.applyPhase,
    hasPendingAnnotations: view.hasPendingAnnotations,
    canAddAnnotation: view.canAddAnnotation,
    canApplyAnnotations: view.canApplyAnnotations,
    modeButtonLabel: view.modeButtonLabel,
    modeButtonVariant: view.modeButtonVariant,
    setAnnotationInstruction: (instruction) => dispatch({ type: "set_instruction", instruction }),
    toggleAnnotationMode,
    selectTarget,
    addAnnotation,
    removeAnnotation,
    applyAnnotations,
  };
}

function DocumentAnnotationPanel({
  controller,
  documentKind,
  isMobile,
}: {
  controller: DocumentAnnotationController;
  documentKind: DocumentViewerKind | null | undefined;
  isMobile: boolean;
}) {
  const panelStyle = useMemo(
    () => [styles.annotationPanel, isMobile ? styles.annotationPanelCompact : null],
    [isMobile],
  );
  const annotationHint = getDocumentAnnotationHint({
    annotationMode: controller.annotationMode,
    documentKind,
  });
  const shouldGuideTargetSelection =
    controller.annotationMode && controller.selectedAnnotationTarget === null;
  const targetGuidePulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!shouldGuideTargetSelection) {
      targetGuidePulse.stopAnimation();
      targetGuidePulse.setValue(0);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(targetGuidePulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(targetGuidePulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [shouldGuideTargetSelection, targetGuidePulse]);

  const targetGuideStyle = useMemo(
    () => ({
      opacity: targetGuidePulse.interpolate({
        inputRange: [0, 1],
        outputRange: [0.18, 0.72],
      }),
      transform: [
        {
          scale: targetGuidePulse.interpolate({
            inputRange: [0, 1],
            outputRange: [1, 1.018],
          }),
        },
      ],
    }),
    [targetGuidePulse],
  );
  const targetBoxStyle = useMemo(
    () => [
      styles.annotationTargetBox,
      shouldGuideTargetSelection ? styles.annotationTargetBoxGuided : null,
    ],
    [shouldGuideTargetSelection],
  );
  const targetPulseStyle = useMemo(
    () => [styles.annotationTargetGuidePulse, targetGuideStyle],
    [targetGuideStyle],
  );

  return (
    <View style={panelStyle} testID="document-annotation-panel">
      <View style={styles.annotationHeader}>
        <Text style={styles.annotationTitle}>标注修改</Text>
        <Button
          onPress={controller.toggleAnnotationMode}
          size="xs"
          testID="document-annotation-mode-button"
          variant={controller.modeButtonVariant}
        >
          {controller.modeButtonLabel}
        </Button>
      </View>
      <Text style={styles.annotationHint}>{annotationHint}</Text>
      <View style={targetBoxStyle}>
        {shouldGuideTargetSelection ? (
          <Animated.View pointerEvents="none" style={targetPulseStyle} />
        ) : null}
        <Text style={styles.annotationTargetLabel}>当前位置</Text>
        <Text
          style={styles.annotationTargetText}
          numberOfLines={3}
          testID="document-annotation-selected-target"
        >
          {formatAnnotationTarget(controller.selectedAnnotationTarget)}
        </Text>
        {shouldGuideTargetSelection ? (
          <Text style={styles.annotationTargetGuideText}>
            {getAnnotationTargetGuideText(documentKind)}
          </Text>
        ) : null}
      </View>
      <TextInput
        multiline
        value={controller.annotationInstruction}
        onChangeText={controller.setAnnotationInstruction}
        placeholder="描述希望 AI 如何修改这里..."
        style={styles.annotationInput}
        testID="document-annotation-instruction-input"
      />
      <Button
        disabled={!controller.canAddAnnotation}
        onPress={controller.addAnnotation}
        size="md"
        testID="document-annotation-add-button"
        variant="default"
      >
        添加标注
      </Button>
      <View style={styles.annotationList} testID="document-annotation-list">
        {controller.pendingAnnotations.length === 0 ? (
          <Text style={styles.annotationEmpty}>暂无标注</Text>
        ) : (
          controller.pendingAnnotations.map((annotation) => (
            <DocumentAnnotationListItem
              key={annotation.id}
              annotation={annotation}
              onRemove={controller.removeAnnotation}
            />
          ))
        )}
      </View>
      <Button
        disabled={!controller.canApplyAnnotations}
        loading={controller.applyPhase !== "idle"}
        onPress={controller.applyAnnotations}
        size="lg"
        testID="document-annotation-apply-button"
        variant="secondary"
      >
        {controller.applyPhase === "idle" ? "应用标注" : "等待 AI 完成..."}
      </Button>
    </View>
  );
}

function getDocumentAnnotationHint(input: {
  annotationMode: boolean;
  documentKind: DocumentViewerKind | null | undefined;
}): string {
  if (input.documentKind === "pdf") {
    return input.annotationMode
      ? "使用顶部 Annotate 工具创建或选择标注。"
      : "开启后用 PDF 顶部 Annotate 工具标出要修改的位置。";
  }
  if (input.documentKind === "xlsx" || input.documentKind === "csv") {
    return input.annotationMode
      ? translateNow("document.annotation.xlsx.selection.modeHint")
      : translateNow("document.annotation.xlsx.selection.offHint");
  }
  return input.annotationMode ? "在预览中点击单元格、文字或页面位置。" : "开启后选择要修改的位置。";
}

function getAnnotationTargetGuideText(documentKind: DocumentViewerKind | null | undefined): string {
  if (documentKind === "xlsx" || documentKind === "csv") {
    return translateNow("document.annotation.targetGuide.spreadsheet");
  }
  if (documentKind === "pdf") {
    return translateNow("document.annotation.targetGuide.pdf");
  }
  return translateNow("document.annotation.targetGuide.default");
}

function DocumentAnnotationApplyOverlay({ phase }: { phase: DocumentAnnotationApplyPhase }) {
  return (
    <View style={styles.annotationApplyOverlay} testID="document-annotation-apply-overlay">
      <View style={styles.annotationApplyOverlayCard}>
        <ActivityIndicator size="small" />
        <Text style={styles.annotationApplyOverlayTitle}>正在应用标注</Text>
        <Text style={styles.annotationApplyOverlayText}>
          {phase === "waiting"
            ? "标注已发送给 AI，等待开始处理。"
            : "AI 正在修改文件，完成后会自动刷新预览。"}
        </Text>
      </View>
    </View>
  );
}

function DocumentAnnotationUnavailablePanel({ isMobile }: { isMobile: boolean }) {
  const panelStyle = useMemo(
    () => [styles.annotationPanel, isMobile ? styles.annotationPanelCompact : null],
    [isMobile],
  );

  return (
    <View style={panelStyle} testID="document-annotation-unavailable-panel">
      <View style={styles.annotationHeader}>
        <Text style={styles.annotationTitle}>标注修改</Text>
      </View>
      <View style={styles.annotationTargetBox}>
        <Text style={styles.annotationTargetLabel}>暂不可用</Text>
        <Text style={styles.annotationTargetText}>
          从 agent 输出或当前 agent 旁的文件树打开文件后，可以把标注发送给对应 agent 应用修改。
        </Text>
      </View>
    </View>
  );
}

function DocumentAnnotationListItem({
  annotation,
  onRemove,
}: {
  annotation: PendingDocumentAnnotation;
  onRemove: (id: string) => void;
}) {
  const handleRemove = useCallback(() => onRemove(annotation.id), [annotation.id, onRemove]);
  return (
    <View style={styles.annotationItem} testID="document-annotation-item">
      <Text style={styles.annotationItemTitle} numberOfLines={1}>
        {annotation.target.label}
      </Text>
      <Text style={styles.annotationItemText} numberOfLines={2}>
        {annotation.instruction}
      </Text>
      <Button
        onPress={handleRemove}
        size="xs"
        style={styles.annotationRemoveButton}
        testID="document-annotation-remove-button"
        textStyle={styles.annotationRemoveButtonText}
        variant="ghost"
      >
        删除
      </Button>
    </View>
  );
}

function formatAnnotationTarget(target: DocumentAnnotationTarget | null): string {
  if (!target) {
    return "未选择";
  }
  return `${target.label}${target.context ? ` · ${target.context}` : ""}`;
}

function useFilePanePreviewQuery(input: {
  client: DaemonClient | null;
  readTarget: FilePaneReadTarget | null;
  serverId: string;
}) {
  const { client, readTarget, serverId } = input;
  return useQuery({
    queryKey: ["workspaceFile", serverId, readTarget?.cwd ?? null, readTarget?.path ?? null],
    enabled: Boolean(client && readTarget),
    queryFn: () => readFilePanePreview({ client, readTarget }),
    staleTime: 5_000,
    refetchOnMount: true,
  });
}

function getFilePanePreviewRevision(data: FilePanePreviewData | undefined): string | null {
  if (!data?.file || !data.documentKind || !data.documentBytes) {
    return null;
  }
  return createDocumentPreviewRevision({
    path: data.file.path,
    size: data.file.size,
    modifiedAt: data.file.modifiedAt,
    documentKind: data.documentKind,
    bytes: data.documentBytes,
  });
}

function getFilePaneDocumentSourceUrl(data: FilePanePreviewData | undefined): string | null {
  return data?.documentSourceUrl ?? null;
}

export function FilePane({
  serverId,
  sourceAgentId,
  workspaceRoot,
  location,
}: {
  serverId: string;
  sourceAgentId?: string;
  workspaceRoot: string;
  location: WorkspaceFileLocation;
}) {
  const isMobile = useIsCompactFormFactor();
  const { locale } = useI18n();
  const showDesktopWebScrollbar = isWeb && !isMobile;

  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const appendOptimisticUserMessageToAgentStream = useSessionStore(
    (state) => state.appendOptimisticUserMessageToAgentStream,
  );
  const sourceAgentStatus = useSessionStore((state) => {
    if (!sourceAgentId) {
      return null;
    }
    const session = state.sessions[serverId];
    return (
      session?.agents.get(sourceAgentId)?.status ??
      session?.agentDetails.get(sourceAgentId)?.status ??
      null
    );
  });
  const normalizedWorkspaceRoot = useMemo(() => workspaceRoot.trim(), [workspaceRoot]);
  const sourceAgentCwd = useSessionStore((state) => {
    if (!sourceAgentId) {
      return null;
    }
    const session = state.sessions[serverId];
    return (
      session?.agents.get(sourceAgentId)?.cwd ??
      session?.agentDetails.get(sourceAgentId)?.cwd ??
      null
    );
  });
  const previewWorkspaceRoot = useMemo(
    () => sourceAgentCwd?.trim() || normalizedWorkspaceRoot,
    [normalizedWorkspaceRoot, sourceAgentCwd],
  );
  const normalizedFilePath = useMemo(() => trimNonEmpty(location.path), [location.path]);
  const readTarget = useMemo(
    () =>
      normalizedFilePath
        ? resolveFilePreviewReadTarget({
            path: normalizedFilePath,
            workspaceRoot: previewWorkspaceRoot,
          })
        : null,
    [normalizedFilePath, previewWorkspaceRoot],
  );

  const query = useFilePanePreviewQuery({ client, readTarget, serverId });
  const imagePreviewUri = useAttachmentPreviewUrl(query.data?.imageAttachment ?? null);
  const annotationAvailability = resolveDocumentAnnotationAvailability({
    documentKind: query.data?.documentKind,
    sourceAgentId,
  });
  const shouldEnableDocumentAnnotation = annotationAvailability.state === "enabled";
  const shouldShowDocumentAnnotationUnavailable = annotationAvailability.state === "missing-agent";

  const handleAppliedAnnotations = useCallback(async () => {
    const result = await query.refetch();
    return getFilePanePreviewRevision(result.data);
  }, [query]);
  const previewRevision = useMemo(() => getFilePanePreviewRevision(query.data), [query.data]);
  const documentSourceUrl = useMemo(() => getFilePaneDocumentSourceUrl(query.data), [query.data]);
  const previewAndAnnotationStyle = useMemo(
    () => [
      styles.previewAndAnnotationContainer,
      isMobile ? styles.previewAndAnnotationContainerCompact : null,
    ],
    [isMobile],
  );
  const annotationController = useDocumentAnnotationController({
    appendOptimisticUserMessageToAgentStream,
    client,
    documentKind: query.data?.documentKind,
    filePath: location.path,
    onApplied: handleAppliedAnnotations,
    previewRevision,
    serverId,
    sourceAgentId,
    sourceAgentStatus,
    defaultLocale: locale,
  });
  const documentAnnotationMode = shouldEnableDocumentAnnotation
    ? annotationController.annotationMode
    : false;
  const pendingDocumentAnnotationTargets = useMemo(
    () => annotationController.pendingAnnotations.map((annotation) => annotation.target),
    [annotationController.pendingAnnotations],
  );
  const shouldShowApplyOverlay =
    shouldEnableDocumentAnnotation && annotationController.applyPhase !== "idle";

  return (
    <View style={styles.container} testID="workspace-file-pane">
      {query.data?.error ? (
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{query.data.error}</Text>
        </View>
      ) : null}

      <View style={previewAndAnnotationStyle}>
        <View style={styles.previewSurface}>
          <FilePreviewBody
            preview={query.data?.file ?? null}
            documentBytes={query.data?.documentBytes ?? null}
            documentKind={query.data?.documentKind ?? null}
            documentSourceUrl={documentSourceUrl}
            documentPreviewRevision={previewRevision}
            documentAnnotationMode={documentAnnotationMode}
            pendingDocumentAnnotationTargets={pendingDocumentAnnotationTargets}
            selectedDocumentAnnotationTarget={annotationController.selectedAnnotationTarget}
            isLoading={query.isFetching}
            showDesktopWebScrollbar={showDesktopWebScrollbar}
            isMobile={isMobile}
            location={location}
            imagePreviewUri={imagePreviewUri}
            onDocumentAnnotationTargetSelect={annotationController.selectTarget}
          />
          {shouldShowApplyOverlay ? (
            <DocumentAnnotationApplyOverlay phase={annotationController.applyPhase} />
          ) : null}
        </View>
        {shouldEnableDocumentAnnotation ? (
          <DocumentAnnotationPanel
            controller={annotationController}
            documentKind={query.data?.documentKind}
            isMobile={isMobile}
          />
        ) : null}
        {shouldShowDocumentAnnotationUnavailable ? (
          <DocumentAnnotationUnavailablePanel isMobile={isMobile} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  previewAndAnnotationContainer: {
    flex: 1,
    minHeight: 0,
    flexDirection: "row",
  },
  previewAndAnnotationContainerCompact: {
    flexDirection: "column",
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  loadingText: {
    marginTop: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  binaryMetaText: {
    marginTop: theme.spacing[2],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  previewSurface: {
    flex: 1,
    minHeight: 0,
    position: "relative",
    zIndex: 0,
    ...(isWeb
      ? {
          isolation: "isolate",
        }
      : null),
  },
  previewScrollContainer: {
    flex: 1,
    minHeight: 0,
  },
  previewContent: {
    flex: 1,
    minHeight: 0,
  },
  previewCodeScrollContent: {
    padding: theme.spacing[4],
  },
  previewMarkdownScrollContent: {
    padding: theme.spacing[4],
  },
  previewImageScrollContent: {
    flexGrow: 1,
    padding: theme.spacing[4],
    alignItems: "center",
    justifyContent: "center",
  },
  previewImage: {
    width: "100%",
    height: 420,
  },
  annotationPanel: {
    width: 300,
    borderLeftWidth: theme.borderWidth[1],
    borderLeftColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  annotationPanelCompact: {
    width: "100%",
    maxHeight: 360,
    borderLeftWidth: 0,
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  annotationHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  annotationTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
  },
  annotationHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  annotationTargetBox: {
    position: "relative",
    overflow: "hidden",
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[3],
    gap: theme.spacing[1],
  },
  annotationTargetBoxGuided: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surface2,
  },
  annotationTargetGuidePulse: {
    position: "absolute",
    top: -1,
    right: -1,
    bottom: -1,
    left: -1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 2,
    borderColor: theme.colors.accent,
    backgroundColor: "transparent",
  },
  annotationTargetLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
  },
  annotationTargetText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  annotationTargetGuideText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 18,
  },
  annotationInput: {
    minHeight: 104,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    padding: theme.spacing[3],
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    textAlignVertical: "top",
  },
  annotationList: {
    flex: 1,
    minHeight: 0,
    gap: theme.spacing[2],
  },
  annotationEmpty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  annotationItem: {
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[3],
    gap: theme.spacing[1],
  },
  annotationItemTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  annotationItemText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
  },
  annotationRemoveButton: {
    alignSelf: "flex-start",
    marginLeft: -theme.spacing[3],
  },
  annotationRemoveButtonText: {
    color: theme.colors.destructive,
  },
  annotationApplyOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
    backgroundColor: "rgba(248, 250, 252, 0.76)",
    zIndex: 2147483647,
    elevation: 24,
  },
  annotationApplyOverlayCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[4],
    alignItems: "center",
    gap: theme.spacing[2],
  },
  annotationApplyOverlayTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    textAlign: "center",
  },
  annotationApplyOverlayText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    textAlign: "center",
  },
}));

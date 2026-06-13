import {
  default as React,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import * as XSpreadsheetBundle from "x-data-spreadsheet/dist/xspreadsheet.js";
import "x-data-spreadsheet/dist/xspreadsheet.css";
import * as XLSX from "xlsx";
import { translateNow, useI18n, type Locale } from "@/i18n/i18n";
import type { DocumentAnnotationTarget } from "@/components/document-viewer";
import {
  buildDocxAnnotationTargetFromClick,
  buildSpreadsheetAnnotationTargetFromClick,
} from "@/utils/document-annotation-event-targets";
import {
  buildPdfBuiltinAnnotationTarget,
  columnNameFromIndex,
} from "@/utils/document-annotation-target";
import {
  parseSpreadsheetPreview,
  SPREADSHEET_MAX_COLUMNS,
  SPREADSHEET_MAX_ROWS,
} from "@/utils/spreadsheet-preview";
import type { PluginRegistry } from "@embedpdf/react-pdf-viewer";
import type { I18nCapability, UICapability } from "@embedpdf/snippet";
import type {
  AnnotationCapability,
  AnnotationDocumentState,
  AnnotationEvent,
  SidebarAnnotationEntry,
  TrackedAnnotation,
} from "@embedpdf/plugin-annotation";
import { getSidebarAnnotationsWithReplies } from "@embedpdf/plugin-annotation";

export type DocumentViewerKind = "pdf" | "docx" | "pptx" | "csv" | "xlsx";

export interface DocumentViewerProps {
  kind: DocumentViewerKind;
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
  sourceUrl?: string | null;
  annotationMode?: boolean;
  selectedAnnotationTarget?: DocumentAnnotationTarget | null;
  pendingAnnotationTargets?: DocumentAnnotationTarget[];
  onAnnotationTargetSelect?: (target: DocumentAnnotationTarget) => void;
}

type RenderState = { status: "idle" | "loading" | "ready" } | { status: "error"; message: string };
type PdfViewerComponent = ComponentType<{
  config: {
    src: string;
    theme: { preference: "system" };
    tabBar: "never";
    disabledCategories: string[];
    i18n: {
      defaultLocale: string;
      fallbackLocale: string;
    };
  };
  onReady?: (registry: PluginRegistry) => void;
  style?: CSSProperties;
}>;
type PptxViewerInstance = InstanceType<typeof import("@aiden0z/pptx-renderer").PptxViewer>;
type XSpreadsheetFactory = (
  container: HTMLElement,
  options?: XSpreadsheetOptions,
) => XSpreadsheetInstance;
interface XSpreadsheetInstance {
  loadData(data: XSpreadsheetSheetData[]): XSpreadsheetInstance;
  on(
    eventName: "cell-selected",
    callback: (
      cell: XSpreadsheetCellData | undefined,
      rowIndex: number,
      columnIndex: number,
    ) => void,
  ): XSpreadsheetInstance;
}
type XSpreadsheetRenderState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };
interface XSpreadsheetOptions {
  mode: "edit" | "read";
  showBottomBar: boolean;
  showToolbar: boolean;
  showContextmenu: boolean;
  showGrid: boolean;
  view: {
    height: () => number;
    width: () => number;
  };
}
interface XSpreadsheetCellData {
  text: string;
  merge?: [number, number];
}
interface XSpreadsheetSheetData {
  name: string;
  rows: {
    len: number;
    [rowIndex: number]:
      | {
          cells: Record<number, XSpreadsheetCellData>;
          height?: number;
        }
      | number;
  };
  cols?: {
    len: number;
    [columnIndex: number]: { width?: number } | number;
  };
  merges?: string[];
}
interface OnlyOfficeDocEditor {
  createConnector?: () => OnlyOfficeConnector;
  destroyEditor?: () => void;
}

interface OnlyOfficeConnector {
  callCommand?: <T>(command: () => T, callback: (result: T | null) => void) => void;
}

interface OnlyOfficeSpreadsheetApi {
  GetActiveSheet?: () => OnlyOfficeWorksheet | null;
}

interface OnlyOfficeWorksheet {
  GetName?: () => string;
  GetSelection?: () => OnlyOfficeRange | null;
}

interface OnlyOfficeRange {
  GetAddress?: (
    rowAbs?: boolean,
    colAbs?: boolean,
    referenceStyle?: string,
    external?: boolean,
  ) => string;
  GetFormula?: () => unknown;
  GetText?: () => unknown;
  GetValue?: () => unknown;
}

interface OnlyOfficeDocsApi {
  DocEditor: new (elementId: string, config: OnlyOfficeEditorConfig) => OnlyOfficeDocEditor;
}

interface OnlyOfficeEditorConfig {
  documentType: "cell";
  document: {
    fileType: "xlsx";
    key: string;
    title: string;
    url: string;
    permissions: {
      download: boolean;
      edit: boolean;
      print: boolean;
    };
  };
  editorConfig: {
    callbackUrl: string;
    lang: string;
    mode: "view";
    plugins?: {
      autostart: string[];
      pluginsData: string[];
    };
    customization: {
      compactHeader: boolean;
      compactToolbar: boolean;
      hideRightMenu: boolean;
      logo: {
        visible: boolean;
      };
    };
  };
  height: string;
  type: "desktop";
  width: string;
}

declare global {
  interface Window {
    DocsAPI?: OnlyOfficeDocsApi;
    x_spreadsheet?: XSpreadsheetFactory;
  }
  var Api: OnlyOfficeSpreadsheetApi;
}

const LOCAL_ONLYOFFICE_DOCUMENT_SERVER_URL = "http://localhost:8082";
const LOCAL_ONLYOFFICE_FILE_PROXY_HOST = "doya-onlyoffice-host-proxy";
const ONLYOFFICE_SELECTION_PLUGIN_GUID = "asc.{6D5C3F73-B91E-4A5A-90A0-9B3B23D20A1D}";
const ONLYOFFICE_SELECTION_PLUGIN_VERSION = "20260613-3";

const PDF_SHAPES_ONLY_DISABLED_CATEGORIES = [
  "mode-view",
  "mode-annotate",
  "mode-insert",
  "mode-form",
  "mode-redact",
  "mode-shapes",
  "annotation-markup",
  "annotation-comment",
  "annotation-link",
  "annotation-style",
  "annotation-widget-edit",
  "annotation-redaction",
  "annotation-delete",
  "panel-annotation-style",
  "stamp",
  "insert",
  "form",
  "redaction",
];

function createDocumentBlobUrl(input: { bytes: Uint8Array; mimeType: string }): string {
  return URL.createObjectURL(new Blob([getArrayBuffer(input.bytes)], { type: input.mimeType }));
}

function getArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

function useDocumentBlobUrl(input: { bytes: Uint8Array; mimeType: string }): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const { bytes, mimeType } = input;

  useEffect(() => {
    const nextUrl = createDocumentBlobUrl({ bytes, mimeType });
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [bytes, mimeType]);

  return url;
}

function PdfDocumentViewer({
  annotationMode,
  bytes,
  mimeType,
  onAnnotationTargetSelect,
}: Pick<
  DocumentViewerProps,
  "annotationMode" | "bytes" | "mimeType" | "onAnnotationTargetSelect"
>) {
  const { locale } = useI18n();
  const embedPdfLocale = getEmbedPdfLocale(locale);
  const url = useDocumentBlobUrl({ bytes, mimeType });
  const [embedPdfRegistry, setEmbedPdfRegistry] = useState<PluginRegistry | null>(null);
  const onAnnotationTargetSelectRef = useRef(onAnnotationTargetSelect);
  const [PdfViewerComponent, setPdfViewerComponent] = useState<PdfViewerComponent | null>(null);
  const pdfConfig = useMemo(
    () => ({
      src: url ?? "",
      theme: { preference: "system" as const },
      tabBar: "never" as const,
      disabledCategories: PDF_SHAPES_ONLY_DISABLED_CATEGORIES,
      i18n: {
        defaultLocale: embedPdfLocale,
        fallbackLocale: "en",
      },
    }),
    [embedPdfLocale, url],
  );

  useEffect(() => {
    onAnnotationTargetSelectRef.current = onAnnotationTargetSelect;
  }, [onAnnotationTargetSelect]);

  useEffect(() => {
    let canceled = false;
    void import("@embedpdf/react-pdf-viewer").then((module) => {
      if (!canceled) {
        setPdfViewerComponent(() => module.PDFViewer as PdfViewerComponent);
      }
      return undefined;
    });
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    const registry = embedPdfRegistry;
    if (!registry || !PdfViewerComponent) {
      return;
    }
    const annotation = getEmbedPdfCapability<AnnotationCapability>(registry, "annotation");
    if (!annotation) {
      return;
    }

    const selectAnnotationTarget = (tracked: TrackedAnnotation | null | undefined) => {
      if (!tracked) {
        return;
      }
      const target = buildPdfTargetFromTrackedAnnotation({
        registry,
        state: annotation.getState(),
        tracked,
      });
      if (target) {
        onAnnotationTargetSelectRef.current?.(target);
      }
    };
    const handleStateChange = (event: { state?: AnnotationDocumentState }) => {
      const state = event.state ?? annotation.getState();
      const selectedUid = state.selectedUids.at(-1);
      if (selectedUid) {
        const target = buildPdfTargetFromTrackedAnnotation({
          registry,
          state,
          tracked: state.byUid[selectedUid],
        });
        if (target) {
          onAnnotationTargetSelectRef.current?.(target);
        }
      }
    };

    const unsubscribeState = annotation.onStateChange(handleStateChange);
    const unsubscribeEvents = annotation.onAnnotationEvent((event: AnnotationEvent) => {
      if (event.type === "create" || event.type === "update") {
        const state = annotation.getState();
        const tracked = annotation.getAnnotationById(event.annotation.id) ?? {
          commitState: "dirty" as const,
          object: event.annotation,
        };
        const target = buildPdfTargetFromTrackedAnnotation({
          registry,
          state,
          tracked,
        });
        if (target) {
          onAnnotationTargetSelectRef.current?.(target);
        }
      }
    });

    selectAnnotationTarget(annotation.getSelectedAnnotations().at(-1));

    return () => {
      unsubscribeState();
      unsubscribeEvents();
    };
  }, [embedPdfRegistry, PdfViewerComponent]);

  const handlePdfReady = useCallback(
    (registry: PluginRegistry) => {
      setEmbedPdfRegistry(registry);
      setPdfShapesToolbarVisibility(registry, Boolean(annotationMode));
      setEmbedPdfLocale(registry, embedPdfLocale);
    },
    [annotationMode, embedPdfLocale],
  );

  useEffect(() => {
    if (!embedPdfRegistry) {
      return;
    }
    setPdfShapesToolbarVisibility(embedPdfRegistry, Boolean(annotationMode));
  }, [annotationMode, embedPdfRegistry]);

  if (!url || !PdfViewerComponent) {
    return <DocumentLoadingState label={translateNow("ui.loading.pdf")} />;
  }
  return (
    <div data-testid="document-pdf-preview" style={webStyles.fill}>
      <PdfViewerComponent config={pdfConfig} style={webStyles.fill} onReady={handlePdfReady} />
    </div>
  );
}

function getEmbedPdfCapability<T>(registry: PluginRegistry, pluginId: string): T | null {
  return (registry.getPlugin(pluginId)?.provides?.() as T | undefined) ?? null;
}

function getEmbedPdfLocale(locale: Locale): string {
  return locale === "zh" ? "zh-CN" : "en";
}

function setEmbedPdfLocale(registry: PluginRegistry, locale: string): void {
  getEmbedPdfCapability<I18nCapability>(registry, "i18n")?.setLocale(locale);
}

function setPdfShapesToolbarVisibility(registry: PluginRegistry, visible: boolean): void {
  const ui = getEmbedPdfCapability<UICapability>(registry, "ui");
  const documentId = registry.getStore().getState().core.activeDocumentId ?? undefined;
  if (!ui || !documentId) {
    return;
  }
  if (!visible) {
    ui.forDocument(documentId).closeToolbarSlot("top", "secondary");
    return;
  }
  ui.setActiveToolbar("top", "secondary", "shapes-toolbar", documentId);
}

function getEmbedPdfPageSize(
  registry: PluginRegistry,
  pageIndex: number,
): { width: number; height: number } | null {
  const state = registry.getStore().getState();
  const documentId = state.core.activeDocumentId ?? undefined;
  const page = documentId ? state.core.documents[documentId]?.document?.pages?.[pageIndex] : null;
  const width = page?.size?.width;
  const height = page?.size?.height;
  return typeof width === "number" && typeof height === "number" && width > 0 && height > 0
    ? { width, height }
    : null;
}

function buildPdfTargetFromTrackedAnnotation(input: {
  registry: PluginRegistry;
  state: AnnotationDocumentState;
  tracked: TrackedAnnotation | null | undefined;
}): DocumentAnnotationTarget | null {
  if (!input.tracked) {
    return null;
  }
  const sidebarEntry = findSidebarAnnotationEntry(input.state, input.tracked);
  const primaryAnnotation = sidebarEntry?.annotation.object ?? input.tracked.object;
  const target = buildPdfBuiltinAnnotationTarget({
    annotation: primaryAnnotation,
    pageSize: getEmbedPdfPageSize(input.registry, primaryAnnotation.pageIndex),
  });
  if (!target) {
    return null;
  }
  const replyText = normalizePdfReplyContents(sidebarEntry?.replies ?? []);
  if (!replyText) {
    return target;
  }
  return {
    ...target,
    context: target.context ? `${target.context}; replies=${replyText}` : `replies=${replyText}`,
  };
}

function findSidebarAnnotationEntry(
  state: AnnotationDocumentState,
  tracked: TrackedAnnotation,
): SidebarAnnotationEntry | null {
  const annotationId = tracked.object.id;
  return (
    getSidebarAnnotationsWithReplies(state).find((entry) => {
      if (entry.annotation.object.id === annotationId) {
        return true;
      }
      if (entry.replies.some((reply) => reply.object.id === annotationId)) {
        return true;
      }
      return entry.groupMembers?.some((member) => member.object.id === annotationId) ?? false;
    }) ?? null
  );
}

function normalizePdfReplyContents(replies: TrackedAnnotation[]): string {
  return replies
    .map((reply) => reply.object.contents?.replace(/\s+/g, " ").trim() ?? "")
    .filter(Boolean)
    .join(" | ")
    .slice(0, 1000);
}

function DocxDocumentViewer({
  bytes,
  annotationMode,
  pendingAnnotationTargets,
  selectedAnnotationTarget,
  onAnnotationTargetSelect,
}: Pick<
  DocumentViewerProps,
  | "annotationMode"
  | "bytes"
  | "onAnnotationTargetSelect"
  | "pendingAnnotationTargets"
  | "selectedAnnotationTarget"
>) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const renderVersionRef = useRef(0);
  const [state, setState] = useState<RenderState>({ status: "idle" });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const renderTarget = host;

    let canceled = false;
    const renderVersion = renderVersionRef.current + 1;
    renderVersionRef.current = renderVersion;
    const renderHost = document.createElement("div");
    setState({ status: "loading" });
    renderTarget.replaceChildren();

    async function renderDocx() {
      try {
        const { renderAsync } = await import("docx-preview");
        await renderAsync(getArrayBuffer(bytes), renderHost, undefined, {
          className: "doya-docx",
          inWrapper: true,
          renderAltChunks: false,
          useBase64URL: true,
        });
        if (canceled || renderVersionRef.current !== renderVersion) {
          return;
        }
        renderTarget.replaceChildren(...Array.from(renderHost.childNodes));
        setState({ status: "ready" });
      } catch (error) {
        if (canceled || renderVersionRef.current !== renderVersion) {
          return;
        }
        setState({
          status: "error",
          message:
            error instanceof Error ? error.message : translateNow("ui.failed.to.render.docx"),
        });
      }
    }

    void renderDocx();

    return () => {
      canceled = true;
      renderTarget.replaceChildren();
    };
  }, [bytes]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || state.status !== "ready") {
      return;
    }
    updateDocxAnnotationHighlights({
      root: host,
      selectedAnnotationTarget,
      pendingAnnotationTargets: pendingAnnotationTargets ?? [],
    });
  }, [pendingAnnotationTargets, selectedAnnotationTarget, state.status]);

  const handleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!annotationMode || !onAnnotationTargetSelect || !hostRef.current) {
        return;
      }
      const target = buildDocxAnnotationTargetFromClick({
        root: hostRef.current,
        eventTarget: event.target,
      });
      if (!target) {
        return;
      }
      onAnnotationTargetSelect(target);
    },
    [annotationMode, onAnnotationTargetSelect],
  );

  return (
    <div data-testid="document-docx-preview" style={webStyles.docxRoot}>
      {state.status === "idle" || state.status === "loading" ? (
        <DocumentLoadingOverlay label={translateNow("ui.loading.docx")} />
      ) : null}
      {state.status === "error" ? <DocumentErrorOverlay message={state.message} /> : null}
      <div
        aria-label={translateNow("ui.docx.preview.title")}
        data-testid="document-docx-host"
        ref={hostRef}
        style={annotationMode ? webStyles.docxHostAnnotatable : webStyles.docxHost}
        onClick={handleClick}
      />
    </div>
  );
}

function updateDocxAnnotationHighlights(input: {
  root: HTMLElement;
  selectedAnnotationTarget?: DocumentAnnotationTarget | null;
  pendingAnnotationTargets: DocumentAnnotationTarget[];
}): void {
  input.root
    .querySelectorAll<HTMLElement>("[data-doya-docx-annotation-state]")
    .forEach(clearDocxAnnotationHighlight);

  for (const target of input.pendingAnnotationTargets) {
    const element = findDocxAnnotationElement(input.root, target);
    if (element) {
      applyDocxAnnotationHighlight(element, "pending");
    }
  }

  const selectedElement = findDocxAnnotationElement(input.root, input.selectedAnnotationTarget);
  if (selectedElement) {
    applyDocxAnnotationHighlight(selectedElement, "selected");
  }
}

function findDocxAnnotationElement(
  root: HTMLElement,
  target: DocumentAnnotationTarget | null | undefined,
): HTMLElement | null {
  if (!target || target.kind !== "docx") {
    return null;
  }
  const path = typeof target.locator.path === "string" ? target.locator.path : "";
  if (!path) {
    return null;
  }
  try {
    const element = root.querySelector(path);
    return element instanceof HTMLElement ? element : null;
  } catch {
    return null;
  }
}

function applyDocxAnnotationHighlight(element: HTMLElement, state: "selected" | "pending"): void {
  element.dataset.doyaDocxAnnotationState = state;
  element.style.borderRadius = "4px";
  if (state === "selected") {
    element.style.outline = "2px solid rgba(32, 116, 74, 0.72)";
    element.style.outlineOffset = "2px";
    element.style.backgroundColor = "rgba(32, 116, 74, 0.12)";
    return;
  }
  element.style.boxShadow = "inset 0 0 0 2px rgba(32, 116, 74, 0.34)";
  element.style.backgroundColor = "rgba(32, 116, 74, 0.07)";
}

function clearDocxAnnotationHighlight(element: HTMLElement): void {
  delete element.dataset.doyaDocxAnnotationState;
  element.style.outline = "";
  element.style.outlineOffset = "";
  element.style.boxShadow = "";
  element.style.backgroundColor = "";
  element.style.borderRadius = "";
}

function PptxDocumentViewer({ bytes }: Pick<DocumentViewerProps, "bytes">) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const abortController = new AbortController();
    setIsLoading(true);
    setRenderError(null);
    let viewer: PptxViewerInstance | null = null;

    void import("@aiden0z/pptx-renderer")
      .then(({ PptxViewer }) => {
        if (abortController.signal.aborted) {
          return;
        }
        const nextViewer = new PptxViewer(host, {
          fitMode: "contain",
          zoomPercent: 100,
          scrollContainer: host,
        });
        viewer = nextViewer;
        return nextViewer.open(getArrayBuffer(bytes), {
          renderMode: "list",
          listOptions: { windowed: true, showSlideLabels: true },
          signal: abortController.signal,
        });
      })
      .catch((openError) => {
        if (abortController.signal.aborted) {
          return;
        }
        setRenderError(
          openError instanceof Error ? openError.message : translateNow("ui.failed.to.render.pptx"),
        );
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => {
      abortController.abort();
      viewer?.destroy();
      host.replaceChildren();
    };
  }, [bytes]);

  return (
    <div style={webStyles.pptxFrame}>
      {isLoading ? <DocumentLoadingOverlay label={translateNow("ui.loading.pptx")} /> : null}
      {renderError ? <DocumentErrorOverlay message={renderError} /> : null}
      <div ref={hostRef} style={webStyles.pptxHost} />
    </div>
  );
}

function OnlyOfficeSpreadsheetDocumentViewer({
  annotationMode,
  bytes,
  fileName,
  onAnnotationTargetSelect,
  sourceUrl,
}: Pick<
  DocumentViewerProps,
  "annotationMode" | "bytes" | "fileName" | "onAnnotationTargetSelect" | "sourceUrl"
>) {
  const hostId = useMemo(() => `onlyoffice-${crypto.randomUUID()}`, []);
  const editorRef = useRef<OnlyOfficeDocEditor | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [shouldFallback, setShouldFallback] = useState(false);
  const documentUrl = useMemo(
    () => (sourceUrl ? toOnlyOfficeContainerReachableUrl(sourceUrl) : null),
    [sourceUrl],
  );
  const documentKey = useMemo(
    () => (documentUrl ? createOnlyOfficeDocumentKey({ sourceUrl: documentUrl, bytes }) : null),
    [bytes, documentUrl],
  );
  const callbackUrl = useMemo(
    () => (sourceUrl ? toOnlyOfficeCallbackUrl(sourceUrl) : null),
    [sourceUrl],
  );
  const pluginConfigUrl = useMemo(
    () =>
      sourceUrl && documentKey
        ? toOnlyOfficeSelectionPluginConfigUrl(sourceUrl, documentKey)
        : null,
    [documentKey, sourceUrl],
  );
  const selectionCaptureUrl = useMemo(
    () =>
      sourceUrl && documentKey ? toOnlyOfficeSelectionCaptureUrl(sourceUrl, documentKey) : null,
    [documentKey, sourceUrl],
  );

  useEffect(() => {
    if (!documentUrl || !callbackUrl || !documentKey || !pluginConfigUrl) {
      setShouldFallback(true);
      return;
    }

    const resolvedDocumentUrl = documentUrl;
    const resolvedCallbackUrl = callbackUrl;
    const resolvedDocumentKey = documentKey;
    const resolvedPluginConfigUrl = pluginConfigUrl;
    let canceled = false;
    setIsLoading(true);
    setShouldFallback(false);

    async function openEditor() {
      try {
        await loadOnlyOfficeApiScript();
        if (canceled) {
          return;
        }
        const docsApi = window.DocsAPI;
        if (!docsApi) {
          throw new Error("ONLYOFFICE Docs API is unavailable");
        }
        editorRef.current?.destroyEditor?.();
        editorRef.current = new docsApi.DocEditor(hostId, {
          documentType: "cell",
          document: {
            fileType: "xlsx",
            key: resolvedDocumentKey,
            permissions: {
              download: true,
              edit: false,
              print: true,
            },
            title: fileName,
            url: resolvedDocumentUrl,
          },
          editorConfig: {
            callbackUrl: resolvedCallbackUrl,
            customization: {
              compactHeader: true,
              compactToolbar: true,
              hideRightMenu: true,
              logo: {
                visible: false,
              },
            },
            lang: "zh-CN",
            mode: "view",
            plugins: {
              autostart: [ONLYOFFICE_SELECTION_PLUGIN_GUID],
              pluginsData: [resolvedPluginConfigUrl],
            },
          },
          height: "100%",
          type: "desktop",
          width: "100%",
        });
        setIsLoading(false);
      } catch {
        if (!canceled) {
          setShouldFallback(true);
        }
      }
    }

    void openEditor();

    return () => {
      canceled = true;
      editorRef.current?.destroyEditor?.();
      editorRef.current = null;
    };
  }, [callbackUrl, documentKey, documentUrl, fileName, hostId, pluginConfigUrl]);

  if (shouldFallback) {
    return (
      <XSpreadsheetDocumentViewer
        annotationMode={annotationMode}
        bytes={bytes}
        onAnnotationTargetSelect={onAnnotationTargetSelect}
      />
    );
  }

  return (
    <div data-testid="document-xlsx-onlyoffice-preview" style={webStyles.onlyOfficeRoot}>
      <div id={hostId} style={webStyles.onlyOfficeHost} />
      {isLoading ? <DocumentLoadingOverlay label={translateNow("ui.loading.xlsx")} /> : null}
      {annotationMode && onAnnotationTargetSelect ? (
        <OnlyOfficeSelectionAnnotationBar
          editorRef={editorRef}
          fileName={fileName}
          onAnnotationTargetSelect={onAnnotationTargetSelect}
          selectionCaptureUrl={selectionCaptureUrl}
        />
      ) : null}
    </div>
  );
}

interface OnlyOfficeSpreadsheetSelection {
  sheetName: string;
  address: string;
  text?: string;
  value?: string;
  formula?: string;
}

type OnlyOfficeSelectionReadState = "idle" | "reading" | "error" | "unsupported";

function OnlyOfficeSelectionAnnotationBar({
  editorRef,
  fileName,
  onAnnotationTargetSelect,
  selectionCaptureUrl,
}: {
  editorRef: React.RefObject<OnlyOfficeDocEditor | null>;
  fileName: string;
  onAnnotationTargetSelect: NonNullable<DocumentViewerProps["onAnnotationTargetSelect"]>;
  selectionCaptureUrl: string | null;
}) {
  const [state, setState] = useState<OnlyOfficeSelectionReadState>("idle");

  const handleReadSelection = useCallback(() => {
    setState("reading");
    void readOnlyOfficeSpreadsheetSelection({
      editor: editorRef.current,
      selectionCaptureUrl,
    })
      .then((selection) => {
        if (!selection) {
          setState("unsupported");
          return;
        }
        onAnnotationTargetSelect(buildOnlyOfficeSelectionAnnotationTarget({ fileName, selection }));
        setState("idle");
      })
      .catch(() => {
        setState("error");
      });
  }, [editorRef, fileName, onAnnotationTargetSelect, selectionCaptureUrl]);

  return (
    <div style={webStyles.onlyOfficeSelectionBar}>
      <button
        data-testid="document-xlsx-onlyoffice-read-selection-button"
        disabled={state === "reading"}
        onClick={handleReadSelection}
        style={webStyles.onlyOfficeSelectionButton}
        type="button"
      >
        {state === "reading"
          ? translateNow("document.annotation.xlsx.selection.reading")
          : translateNow("document.annotation.xlsx.selection.readButton")}
      </button>
      <span style={webStyles.onlyOfficeSelectionHint}>{getOnlyOfficeSelectionHint(state)}</span>
    </div>
  );
}

function getOnlyOfficeSelectionHint(state: OnlyOfficeSelectionReadState): string {
  if (state === "error") {
    return translateNow("document.annotation.xlsx.selection.error");
  }
  if (state === "unsupported") {
    return translateNow("document.annotation.xlsx.selection.unsupported");
  }
  return translateNow("document.annotation.xlsx.selection.barHint");
}

function buildOnlyOfficeSelectionAnnotationTarget(input: {
  fileName: string;
  selection: OnlyOfficeSpreadsheetSelection;
}): DocumentAnnotationTarget {
  const locator: DocumentAnnotationTarget["locator"] = {
    type: "range",
    source: "onlyoffice_selection",
    fileName: input.fileName,
    sheet: input.selection.sheetName,
    range: input.selection.address,
  };
  setLocatorString(locator, "text", input.selection.text);
  setLocatorString(locator, "value", input.selection.value);
  setLocatorString(locator, "formula", input.selection.formula);

  return {
    kind: "xlsx",
    label: `${input.selection.sheetName}!${input.selection.address}`,
    locator,
    context: buildOnlyOfficeSelectionContext(input.selection),
  };
}

function buildOnlyOfficeSelectionContext(selection: OnlyOfficeSpreadsheetSelection): string {
  return [
    selection.text ? `text=${selection.text}` : null,
    selection.value ? `value=${selection.value}` : null,
    selection.formula ? `formula=${selection.formula}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join("; ");
}

function setLocatorString(
  locator: DocumentAnnotationTarget["locator"],
  key: string,
  value: string | undefined,
): void {
  if (value) {
    locator[key] = value;
  }
}

async function readOnlyOfficeSpreadsheetSelection(input: {
  editor: OnlyOfficeDocEditor | null;
  selectionCaptureUrl: string | null;
}): Promise<OnlyOfficeSpreadsheetSelection | null> {
  const connectorSelection = await readOnlyOfficeSpreadsheetSelectionFromConnector(input.editor);
  if (connectorSelection) {
    return connectorSelection;
  }
  return readOnlyOfficeSpreadsheetSelectionFromPlugin(input.selectionCaptureUrl);
}

async function readOnlyOfficeSpreadsheetSelectionFromConnector(
  editor: OnlyOfficeDocEditor | null,
): Promise<OnlyOfficeSpreadsheetSelection | null> {
  const connector = editor?.createConnector?.();
  if (!connector?.callCommand) {
    return null;
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      settled = true;
      reject(new Error("ONLYOFFICE selection timeout"));
    }, 3000);
    try {
      connector.callCommand(readActiveOnlyOfficeSpreadsheetSelection, (result) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        resolve(normalizeOnlyOfficeSpreadsheetSelection(result));
      });
    } catch (error) {
      settled = true;
      window.clearTimeout(timeout);
      reject(error);
    }
  });
}

async function readOnlyOfficeSpreadsheetSelectionFromPlugin(
  selectionCaptureUrl: string | null,
): Promise<OnlyOfficeSpreadsheetSelection | null> {
  if (!selectionCaptureUrl) {
    return null;
  }
  const response = await fetch(selectionCaptureUrl, { cache: "no-store" });
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json()) as unknown;
  if (!isRecord(payload)) {
    return null;
  }
  return normalizeOnlyOfficeSpreadsheetSelection(payload.selection);
}

function readActiveOnlyOfficeSpreadsheetSelection(): unknown {
  function readValue(read: () => unknown): unknown {
    try {
      return read();
    } catch {
      return undefined;
    }
  }
  function readSingleCellValue(address: unknown, read: () => unknown): unknown {
    if (typeof address !== "string" || address.includes(":")) {
      return undefined;
    }
    return readValue(read);
  }

  try {
    const sheet = Api.GetActiveSheet?.();
    const selection = sheet?.GetSelection?.();
    const sheetName = readValue(() => sheet?.GetName?.()) ?? "Sheet1";
    const address =
      readValue(() => selection?.GetAddress?.(false, false, "xlA1", false)) ??
      readValue(() => selection?.GetAddress?.()) ??
      "";
    return JSON.stringify({
      sheetName,
      address,
      formula: readSingleCellValue(address, () => selection?.GetFormula?.()),
      text: readSingleCellValue(address, () => selection?.GetText?.()),
      value: readSingleCellValue(address, () => selection?.GetValue?.()),
    });
  } catch {
    return null;
  }
}

function normalizeOnlyOfficeSpreadsheetSelection(
  value: unknown,
): OnlyOfficeSpreadsheetSelection | null {
  if (typeof value === "string") {
    try {
      return normalizeOnlyOfficeSpreadsheetSelection(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (!isRecord(value)) {
    return null;
  }
  const address = toAnnotationLocatorString(value.address);
  if (!address) {
    return null;
  }
  return {
    sheetName: toAnnotationLocatorString(value.sheetName) || "Sheet1",
    address,
    formula: toAnnotationLocatorString(value.formula),
    text: toAnnotationLocatorString(value.text),
    value: toAnnotationLocatorString(value.value),
  };
}

function toAnnotationLocatorString(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === "string") {
    return trimAnnotationLocatorString(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const serialized = JSON.stringify(value);
  return typeof serialized === "string" ? trimAnnotationLocatorString(serialized) : undefined;
}

function trimAnnotationLocatorString(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > 2000 ? `${trimmed.slice(0, 2000)}...` : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function loadOnlyOfficeApiScript(): Promise<void> {
  if (window.DocsAPI) {
    return Promise.resolve();
  }
  const scriptUrl = `${LOCAL_ONLYOFFICE_DOCUMENT_SERVER_URL}/web-apps/apps/api/documents/api.js`;
  const existing = document.querySelector<HTMLScriptElement>(
    `script[data-doya-onlyoffice-api="${scriptUrl}"]`,
  );
  if (existing) {
    if (existing.dataset.doyaOnlyofficeLoaded === "true") {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load ONLYOFFICE")), {
        once: true,
      });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.dataset.doyaOnlyofficeApi = scriptUrl;
    script.src = scriptUrl;
    script.addEventListener(
      "load",
      () => {
        script.dataset.doyaOnlyofficeLoaded = "true";
        resolve();
      },
      { once: true },
    );
    script.addEventListener("error", () => reject(new Error("Failed to load ONLYOFFICE")), {
      once: true,
    });
    document.head.appendChild(script);
  });
}

function createOnlyOfficeDocumentKey(input: { bytes: Uint8Array; sourceUrl: string }): string {
  return `doya-${hashString(input.sourceUrl)}-${hashBytes(input.bytes)}`.slice(0, 64);
}

function hashBytes(bytes: Uint8Array): string {
  return `${bytes.byteLength.toString(36)}-${hashString(bytes)}`;
}

function hashString(value: string | Uint8Array): string {
  let hash = 0x811c9dc5;
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function toOnlyOfficeContainerReachableUrl(sourceUrl: string): string {
  const url = new URL(sourceUrl);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    url.protocol = "http:";
    url.hostname = LOCAL_ONLYOFFICE_FILE_PROXY_HOST;
    url.port = "";
  }
  return url.toString();
}

function toOnlyOfficeCallbackUrl(sourceUrl: string): string {
  const url = new URL(sourceUrl);
  const callbackUrl = new URL("/api/onlyoffice/callback", url.origin);
  const accessToken = url.searchParams.get("access_token");
  if (accessToken) {
    callbackUrl.searchParams.set("access_token", accessToken);
  }
  if (callbackUrl.hostname === "localhost" || callbackUrl.hostname === "127.0.0.1") {
    callbackUrl.protocol = "http:";
    callbackUrl.hostname = LOCAL_ONLYOFFICE_FILE_PROXY_HOST;
    callbackUrl.port = "";
  }
  return callbackUrl.toString();
}

function toOnlyOfficeSelectionPluginConfigUrl(sourceUrl: string, documentKey: string): string {
  const url = new URL(sourceUrl);
  const pluginUrl = new URL("/api/onlyoffice/doya-selection-plugin/config.json", url.origin);
  pluginUrl.searchParams.set("document_key", documentKey);
  pluginUrl.searchParams.set("v", ONLYOFFICE_SELECTION_PLUGIN_VERSION);
  const accessToken = url.searchParams.get("access_token");
  if (accessToken) {
    pluginUrl.searchParams.set("access_token", accessToken);
  }
  return pluginUrl.toString();
}

function toOnlyOfficeSelectionCaptureUrl(sourceUrl: string, documentKey: string): string {
  const url = new URL(sourceUrl);
  const captureUrl = new URL("/api/onlyoffice/selection-capture", url.origin);
  captureUrl.searchParams.set("document_key", documentKey);
  const accessToken = url.searchParams.get("access_token");
  if (accessToken) {
    captureUrl.searchParams.set("access_token", accessToken);
  }
  return captureUrl.toString();
}

function XSpreadsheetDocumentViewer({
  bytes,
  annotationMode,
  onAnnotationTargetSelect,
}: Pick<DocumentViewerProps, "annotationMode" | "bytes" | "onAnnotationTargetSelect">) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onAnnotationTargetSelectRef = useRef(onAnnotationTargetSelect);
  const [state, setState] = useState<XSpreadsheetRenderState>({ status: "loading" });

  useEffect(() => {
    onAnnotationTargetSelectRef.current = onAnnotationTargetSelect;
  }, [onAnnotationTargetSelect]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const renderHost = host;
    let canceled = false;
    setState({ status: "loading" });
    renderHost.replaceChildren();

    async function renderXlsx() {
      try {
        const spreadsheetData = await createXSpreadsheetData(bytes);
        void XSpreadsheetBundle;
        const spreadsheetFactory = window.x_spreadsheet;
        if (!spreadsheetFactory) {
          throw new Error("x-spreadsheet is unavailable");
        }
        if (!canceled) {
          const spreadsheet = spreadsheetFactory(renderHost, {
            mode: "read",
            showBottomBar: true,
            showToolbar: false,
            showContextmenu: false,
            showGrid: true,
            view: {
              height: () => renderHost.clientHeight,
              width: () => renderHost.clientWidth,
            },
          }).loadData(spreadsheetData);
          spreadsheet.on("cell-selected", (_cell, rowIndex, columnIndex) => {
            if (!annotationMode) {
              return;
            }
            const sheetName = spreadsheetData[0]?.name ?? "Sheet1";
            onAnnotationTargetSelectRef.current?.({
              kind: "xlsx",
              label: `${sheetName}!${columnNameFromIndex(columnIndex)}${rowIndex + 1}`,
              locator: {
                type: "cell",
                sheet: sheetName,
                cell: `${columnNameFromIndex(columnIndex)}${rowIndex + 1}`,
                row: rowIndex + 1,
                column: columnIndex + 1,
              },
            });
          });
          setState({ status: "ready" });
        }
      } catch (error) {
        if (!canceled) {
          setState({
            status: "error",
            message:
              error instanceof Error ? error.message : translateNow("ui.failed.to.render.xlsx"),
          });
        }
      }
    }

    void renderXlsx();

    return () => {
      canceled = true;
      renderHost.replaceChildren();
    };
  }, [annotationMode, bytes]);

  return (
    <div data-testid="document-xlsx-xspreadsheet-preview" style={webStyles.xlsxSpreadsheetRoot}>
      <div ref={hostRef} style={webStyles.xlsxSpreadsheetHost} />
      {state.status === "loading" ? (
        <DocumentLoadingOverlay label={translateNow("ui.loading.xlsx")} />
      ) : null}
      {state.status === "error" ? <DocumentErrorOverlay message={state.message} /> : null}
    </div>
  );
}

export function createXSpreadsheetData(bytes: Uint8Array): XSpreadsheetSheetData[] {
  const workbook = XLSX.read(bytes, {
    cellDates: true,
    type: "array",
  });
  return workbook.SheetNames.map((sheetName) =>
    createXSpreadsheetSheetData(sheetName, workbook.Sheets[sheetName]),
  );
}

function createXSpreadsheetSheetData(
  sheetName: string,
  sheet: XLSX.WorkSheet | undefined,
): XSpreadsheetSheetData {
  const range = XLSX.utils.decode_range(sheet?.["!ref"] ?? "A1");
  const rows: XSpreadsheetSheetData["rows"] = {
    len: Math.max(range.e.r + 1, 100),
  };
  const cols: NonNullable<XSpreadsheetSheetData["cols"]> = {
    len: Math.max(range.e.c + 1, 26),
  };
  const mergeRanges = sheet?.["!merges"] ?? [];
  const merges = mergeRanges.map((mergeRange) => XLSX.utils.encode_range(mergeRange));

  applyXSpreadsheetColumns({ cols, sheet });

  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const row = createXSpreadsheetRow({ rowIndex, sheet });
    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
      const cell = createXSpreadsheetCell({
        columnIndex,
        mergeRanges,
        rowIndex,
        sheet,
      });
      if (!cell) {
        continue;
      }
      row.cells[columnIndex] = cell;
    }
    if (shouldIncludeXSpreadsheetRow(row)) {
      rows[rowIndex] = row;
    }
  }

  return {
    cols,
    merges,
    name: sheetName,
    rows,
  };
}

function applyXSpreadsheetColumns(input: {
  cols: NonNullable<XSpreadsheetSheetData["cols"]>;
  sheet: XLSX.WorkSheet | undefined;
}): void {
  const sourceColumns = input.sheet?.["!cols"] ?? [];
  sourceColumns.forEach((column, columnIndex) => {
    const width = typeof column.wpx === "number" ? column.wpx : undefined;
    if (width) {
      input.cols[columnIndex] = { width };
    }
  });
}

function createXSpreadsheetRow(input: { rowIndex: number; sheet: XLSX.WorkSheet | undefined }): {
  cells: Record<number, XSpreadsheetCellData>;
  height?: number;
} {
  const sourceRow = input.sheet?.["!rows"]?.[input.rowIndex];
  const rowHeight = typeof sourceRow?.hpx === "number" ? sourceRow.hpx : undefined;
  return {
    cells: {},
    ...(rowHeight ? { height: rowHeight } : {}),
  };
}

function createXSpreadsheetCell(input: {
  columnIndex: number;
  rowIndex: number;
  sheet: XLSX.WorkSheet | undefined;
  mergeRanges: XLSX.Range[];
}): XSpreadsheetCellData | null {
  const address = XLSX.utils.encode_cell({ c: input.columnIndex, r: input.rowIndex });
  const cell = input.sheet?.[address];
  const merge = findMergeForCell(input.mergeRanges, input.rowIndex, input.columnIndex);
  if (!cell && !merge) {
    return null;
  }
  const nextCell: XSpreadsheetCellData = {
    text: getSpreadsheetCellText(cell),
  };
  if (merge) {
    nextCell.merge = [merge.e.r - merge.s.r, merge.e.c - merge.s.c];
  }
  return nextCell;
}

function shouldIncludeXSpreadsheetRow(input: {
  cells: Record<number, XSpreadsheetCellData>;
  height?: number;
}): boolean {
  return Object.keys(input.cells).length > 0 || input.height !== undefined;
}

function findMergeForCell(
  merges: XLSX.Range[],
  rowIndex: number,
  columnIndex: number,
): XLSX.Range | null {
  return merges.find((merge) => merge.s.r === rowIndex && merge.s.c === columnIndex) ?? null;
}

function getSpreadsheetCellText(cell: XLSX.CellObject | undefined): string {
  if (!cell) {
    return "";
  }
  const formula = typeof cell.f === "string" && cell.f.trim() ? `=${cell.f.trim()}` : "";
  if (cell.w != null) {
    return String(cell.w);
  }
  if (cell.v != null) {
    return String(cell.v);
  }
  return formula;
}

function SpreadsheetDocumentViewer({
  kind,
  bytes,
  annotationMode,
  pendingAnnotationTargets,
  selectedAnnotationTarget,
  onAnnotationTargetSelect,
}: Pick<DocumentViewerProps, "bytes"> & {
  kind: Extract<DocumentViewerKind, "csv" | "xlsx">;
  annotationMode?: boolean;
  selectedAnnotationTarget?: DocumentAnnotationTarget | null;
  pendingAnnotationTargets?: DocumentAnnotationTarget[];
  onAnnotationTargetSelect?: DocumentViewerProps["onAnnotationTargetSelect"];
}) {
  const [activeSheetName, setActiveSheetName] = useState<string | undefined>(undefined);
  const preview = useMemo(
    () => parseSpreadsheetPreview({ kind, bytes, activeSheetName }),
    [activeSheetName, bytes, kind],
  );
  const columnIndexes = useMemo(
    () =>
      Array.from(
        { length: Math.min(preview.columnCount, SPREADSHEET_MAX_COLUMNS) },
        (_, index) => preview.startColumnIndex + index,
      ),
    [preview.columnCount, preview.startColumnIndex],
  );
  const keyedRows = useMemo(
    () =>
      preview.rows.map((row) => ({
        key: `${row.sheetRowIndex + 1}:${row.cells
          .slice(0, 8)
          .map((cell) => cell.text)
          .join("\u0000")}`,
        cells: row.cells,
        sheetRowIndex: row.sheetRowIndex,
      })),
    [preview.rows],
  );
  const handleTableClick = useCallback(
    (event: MouseEvent<HTMLTableElement>) => {
      if (!annotationMode || !onAnnotationTargetSelect) {
        return;
      }
      const target = buildSpreadsheetAnnotationTargetFromClick({
        kind,
        sheetName: preview.activeSheetName,
        eventTarget: event.target,
      });
      if (target) {
        onAnnotationTargetSelect(target);
      }
    },
    [annotationMode, kind, onAnnotationTargetSelect, preview.activeSheetName],
  );

  if (preview.rowCount === 0 || preview.columnCount === 0) {
    return <DocumentErrorState message={translateNow("ui.spreadsheet.empty")} />;
  }

  return (
    <div data-testid="document-spreadsheet-preview" style={webStyles.spreadsheetRoot}>
      {preview.sheetNames.length > 1 ? (
        <div style={webStyles.sheetTabs}>
          {preview.sheetNames.map((sheetName) => (
            <SpreadsheetSheetTab
              key={sheetName}
              active={sheetName === preview.activeSheetName}
              sheetName={sheetName}
              onSelect={setActiveSheetName}
            />
          ))}
        </div>
      ) : null}
      <div style={webStyles.spreadsheetMeta}>
        {translateNow("ui.spreadsheet.meta", {
          rows: preview.rowCount.toLocaleString(),
          columns: preview.columnCount.toLocaleString(),
        })}
        {preview.truncatedRows || preview.truncatedColumns
          ? translateNow("ui.spreadsheet.truncated.meta", {
              rows: Math.min(preview.rowCount, SPREADSHEET_MAX_ROWS).toLocaleString(),
              columns: Math.min(preview.columnCount, SPREADSHEET_MAX_COLUMNS).toLocaleString(),
            })
          : ""}
      </div>
      <div style={webStyles.spreadsheetScroller}>
        <table
          data-testid="document-spreadsheet-table"
          style={webStyles.spreadsheetTable}
          onClick={handleTableClick}
        >
          <thead>
            <tr>
              <th style={webStyles.cornerHeaderCell} />
              {columnIndexes.map((columnIndex) => (
                <th key={columnIndex} style={webStyles.columnHeaderCell}>
                  {columnNameFromIndex(columnIndex)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keyedRows.map(({ key, cells, sheetRowIndex }) => (
              <tr key={key}>
                <th style={webStyles.rowHeaderCell}>{sheetRowIndex + 1}</th>
                {columnIndexes.map((columnIndex, displayColumnIndex) => {
                  const cell = cells[displayColumnIndex];
                  const annotationState = getSpreadsheetAnnotationCellState({
                    kind,
                    sheetName: preview.activeSheetName,
                    rowIndex: sheetRowIndex,
                    columnIndex,
                    selectedAnnotationTarget,
                    pendingAnnotationTargets: pendingAnnotationTargets ?? [],
                  });
                  return (
                    <td
                      key={columnIndex}
                      data-annotation-state={annotationState}
                      data-column-index={columnIndex}
                      data-formatted-value={cell?.formattedValue ?? ""}
                      data-formula={cell?.formula ?? ""}
                      data-raw-value={cell?.rawValue ?? ""}
                      data-row-index={sheetRowIndex}
                      data-testid={formatSpreadsheetCellTestId({
                        sheetName: preview.activeSheetName,
                        columnIndex,
                        rowIndex: sheetRowIndex,
                      })}
                      data-value={cell?.text ?? ""}
                      style={getSpreadsheetCellStyle({
                        annotationMode,
                        annotationState,
                      })}
                    >
                      {cell?.text ?? ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function getSpreadsheetAnnotationCellState(input: {
  kind: Extract<DocumentViewerKind, "csv" | "xlsx">;
  sheetName: string;
  rowIndex: number;
  columnIndex: number;
  selectedAnnotationTarget?: DocumentAnnotationTarget | null;
  pendingAnnotationTargets: DocumentAnnotationTarget[];
}): "selected" | "pending" | "none" {
  const isSelected = spreadsheetTargetMatchesCell(input.selectedAnnotationTarget, input);
  if (isSelected) {
    return "selected";
  }
  return input.pendingAnnotationTargets.some((target) =>
    spreadsheetTargetMatchesCell(target, input),
  )
    ? "pending"
    : "none";
}

function spreadsheetTargetMatchesCell(
  target: DocumentAnnotationTarget | null | undefined,
  cell: {
    kind: Extract<DocumentViewerKind, "csv" | "xlsx">;
    sheetName: string;
    rowIndex: number;
    columnIndex: number;
  },
): boolean {
  if (!target || target.kind !== cell.kind) {
    return false;
  }
  return (
    target.locator.type === "cell" &&
    target.locator.sheet === cell.sheetName &&
    target.locator.row === cell.rowIndex + 1 &&
    target.locator.column === cell.columnIndex + 1
  );
}

function getSpreadsheetCellStyle(input: {
  annotationMode?: boolean;
  annotationState: "selected" | "pending" | "none";
}): CSSProperties {
  const baseStyle = input.annotationMode
    ? webStyles.spreadsheetCellAnnotatable
    : webStyles.spreadsheetCell;
  if (input.annotationState === "selected") {
    return { ...baseStyle, ...webStyles.spreadsheetCellSelected };
  }
  if (input.annotationState === "pending") {
    return { ...baseStyle, ...webStyles.spreadsheetCellPending };
  }
  return baseStyle;
}

function formatSpreadsheetCellTestId(input: {
  sheetName: string;
  columnIndex: number;
  rowIndex: number;
}): string {
  const safeSheetName = input.sheetName.replace(/[^A-Za-z0-9_-]+/g, "_");
  return `document-spreadsheet-cell-${safeSheetName}-${columnNameFromIndex(input.columnIndex)}${input.rowIndex + 1}`;
}

function SpreadsheetSheetTab({
  active,
  sheetName,
  onSelect,
}: {
  active: boolean;
  sheetName: string;
  onSelect: (sheetName: string) => void;
}) {
  const handleClick = useCallback(() => onSelect(sheetName), [onSelect, sheetName]);
  return (
    <button
      type="button"
      style={active ? webStyles.sheetTabActive : webStyles.sheetTab}
      onClick={handleClick}
    >
      {sheetName}
    </button>
  );
}

function DocumentLoadingState({ label }: { label: string }) {
  return (
    <View style={styles.centerState}>
      <ActivityIndicator size="small" />
      <Text style={styles.stateText}>{label}</Text>
    </View>
  );
}

function DocumentErrorState({ message }: { message: string }) {
  return (
    <View style={styles.centerState}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

function DocumentLoadingOverlay({ label }: { label: string }) {
  return (
    <View style={styles.overlayState}>
      <ActivityIndicator size="small" />
      <Text style={styles.stateText}>{label}</Text>
    </View>
  );
}

function DocumentErrorOverlay({ message }: { message: string }) {
  return (
    <View style={styles.overlayState}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

export function DocumentViewer({
  kind,
  bytes,
  mimeType,
  fileName,
  sourceUrl,
  annotationMode,
  pendingAnnotationTargets,
  selectedAnnotationTarget,
  onAnnotationTargetSelect,
}: DocumentViewerProps) {
  const stableBytes = useMemo(() => bytes, [bytes]);
  if (kind === "pdf") {
    return (
      <PdfDocumentViewer
        annotationMode={annotationMode}
        bytes={stableBytes}
        mimeType={mimeType}
        onAnnotationTargetSelect={onAnnotationTargetSelect}
      />
    );
  }
  if (kind === "docx") {
    return (
      <DocxDocumentViewer
        annotationMode={annotationMode}
        bytes={stableBytes}
        pendingAnnotationTargets={pendingAnnotationTargets}
        selectedAnnotationTarget={selectedAnnotationTarget}
        onAnnotationTargetSelect={onAnnotationTargetSelect}
      />
    );
  }
  if (kind === "pptx") {
    return <PptxDocumentViewer bytes={stableBytes} />;
  }
  if (kind === "xlsx") {
    if (sourceUrl) {
      return (
        <OnlyOfficeSpreadsheetDocumentViewer
          annotationMode={annotationMode}
          bytes={stableBytes}
          fileName={fileName}
          onAnnotationTargetSelect={onAnnotationTargetSelect}
          sourceUrl={sourceUrl}
        />
      );
    }
    return (
      <XSpreadsheetDocumentViewer
        annotationMode={annotationMode}
        bytes={stableBytes}
        onAnnotationTargetSelect={onAnnotationTargetSelect}
      />
    );
  }
  return (
    <SpreadsheetDocumentViewer
      annotationMode={annotationMode}
      kind={kind}
      bytes={stableBytes}
      pendingAnnotationTargets={pendingAnnotationTargets}
      selectedAnnotationTarget={selectedAnnotationTarget}
      onAnnotationTargetSelect={onAnnotationTargetSelect}
    />
  );
}

const webStyles = {
  fill: {
    width: "100%",
    height: "100%",
    minHeight: 0,
  },
  fillAnnotatable: {
    width: "100%",
    height: "100%",
    minHeight: 0,
    cursor: "crosshair",
  },
  docxRoot: {
    position: "relative",
    width: "100%",
    height: "100%",
    minHeight: 0,
    overflow: "hidden",
    background: "var(--doya-surface1, #f4f4f5)",
  },
  docxHost: {
    width: "100%",
    height: "100%",
    minHeight: 0,
    overflow: "auto",
    padding: "24px 0",
  },
  docxHostAnnotatable: {
    width: "100%",
    height: "100%",
    minHeight: 0,
    overflow: "auto",
    padding: "24px 0",
    cursor: "crosshair",
  },
  pptxFrame: {
    position: "relative",
    width: "100%",
    height: "100%",
    minHeight: 0,
  },
  pptxHost: {
    width: "100%",
    height: "100%",
    minHeight: 0,
    overflow: "auto",
  },
  xlsxSpreadsheetRoot: {
    position: "relative",
    width: "100%",
    height: "100%",
    minHeight: 0,
    background: "var(--doya-surface0, #fff)",
  },
  xlsxSpreadsheetHost: {
    width: "100%",
    height: "100%",
    minHeight: 0,
  },
  onlyOfficeRoot: {
    position: "relative",
    width: "100%",
    height: "100%",
    minHeight: 0,
    background: "var(--doya-surface0, #fff)",
  },
  onlyOfficeHost: {
    width: "100%",
    height: "100%",
    minHeight: 0,
  },
  onlyOfficeSelectionBar: {
    position: "absolute",
    top: 12,
    right: 12,
    zIndex: 12,
    display: "flex",
    alignItems: "center",
    gap: 8,
    maxWidth: "min(620px, calc(100% - 24px))",
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid rgba(32, 116, 74, 0.22)",
    background: "rgba(255, 255, 255, 0.94)",
    color: "#1f2937",
    boxShadow: "0 8px 20px rgba(15, 23, 42, 0.12)",
  },
  onlyOfficeSelectionButton: {
    flex: "0 0 auto",
    border: "1px solid rgba(32, 116, 74, 0.42)",
    borderRadius: 6,
    background: "#20744A",
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    lineHeight: 1.4,
    padding: "5px 9px",
  },
  onlyOfficeSelectionHint: {
    minWidth: 0,
    color: "#4b5563",
    fontSize: 12,
    lineHeight: 1.35,
  },
  spreadsheetRoot: {
    width: "100%",
    height: "100%",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    background: "var(--doya-surface0, #fff)",
  },
  sheetTabs: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    padding: "10px 12px",
    borderBottom: "1px solid rgba(127, 127, 127, 0.24)",
  },
  sheetTab: {
    border: "1px solid rgba(127, 127, 127, 0.32)",
    borderRadius: 6,
    background: "transparent",
    color: "inherit",
    padding: "5px 10px",
    font: "inherit",
    cursor: "pointer",
  },
  sheetTabActive: {
    border: "1px solid rgba(37, 99, 235, 0.48)",
    borderRadius: 6,
    background: "rgba(37, 99, 235, 0.12)",
    color: "inherit",
    padding: "5px 10px",
    font: "inherit",
    cursor: "pointer",
  },
  spreadsheetMeta: {
    padding: "8px 12px",
    color: "rgba(113, 113, 122, 1)",
    fontSize: 12,
    borderBottom: "1px solid rgba(127, 127, 127, 0.18)",
  },
  spreadsheetScroller: {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
  },
  spreadsheetTable: {
    borderCollapse: "separate",
    borderSpacing: 0,
    fontSize: 12,
    lineHeight: 1.4,
    minWidth: "100%",
  },
  cornerHeaderCell: {
    position: "sticky",
    top: 0,
    left: 0,
    zIndex: 3,
    minWidth: 48,
    width: 48,
    background: "#f4f4f5",
    borderRight: "1px solid #d4d4d8",
    borderBottom: "1px solid #d4d4d8",
  },
  columnHeaderCell: {
    position: "sticky",
    top: 0,
    zIndex: 2,
    minWidth: 120,
    maxWidth: 280,
    padding: "6px 8px",
    background: "#f4f4f5",
    color: "#71717a",
    fontWeight: 500,
    textAlign: "left",
    borderRight: "1px solid #d4d4d8",
    borderBottom: "1px solid #d4d4d8",
  },
  rowHeaderCell: {
    position: "sticky",
    left: 0,
    zIndex: 1,
    width: 48,
    minWidth: 48,
    padding: "6px 8px",
    background: "#f4f4f5",
    color: "#71717a",
    fontWeight: 500,
    textAlign: "right",
    borderRight: "1px solid #d4d4d8",
    borderBottom: "1px solid #e4e4e7",
  },
  spreadsheetCell: {
    minWidth: 120,
    maxWidth: 280,
    padding: "6px 8px",
    color: "#18181b",
    background: "#fff",
    borderRight: "1px solid #e4e4e7",
    borderBottom: "1px solid #e4e4e7",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  spreadsheetCellAnnotatable: {
    minWidth: 120,
    maxWidth: 280,
    padding: "6px 8px",
    color: "#18181b",
    background: "#fff",
    borderRight: "1px solid #e4e4e7",
    borderBottom: "1px solid #e4e4e7",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    cursor: "crosshair",
  },
  spreadsheetCellSelected: {
    background: "rgba(32, 116, 74, 0.12)",
    outline: "2px solid rgba(32, 116, 74, 0.72)",
    outlineOffset: -2,
  },
  spreadsheetCellPending: {
    background: "rgba(32, 116, 74, 0.07)",
    boxShadow: "inset 0 0 0 2px rgba(32, 116, 74, 0.34)",
  },
} satisfies Record<string, CSSProperties>;

const styles = StyleSheet.create((theme) => ({
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface0,
  },
  overlayState: {
    position: "absolute",
    top: theme.spacing[3],
    right: theme.spacing[3],
    zIndex: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.base,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  stateText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));

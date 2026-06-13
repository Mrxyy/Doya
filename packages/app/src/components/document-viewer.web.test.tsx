// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      addEventListener: () => {},
      addListener: () => {},
      dispatchEvent: () => false,
      matches: false,
      media: "",
      onchange: null,
      removeEventListener: () => {},
      removeListener: () => {},
    }),
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:document-viewer-test",
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: () => {},
  });
});

const pdfViewerMockState = vi.hoisted(() => ({
  registry: null as null | EmbedPdfRegistryMock,
  renderPageElement: true,
}));

interface XSpreadsheetMockInstance {
  data: unknown;
  loadData(data: unknown): XSpreadsheetMockInstance;
  loadDataMock(data: unknown): XSpreadsheetMockInstance;
  on(
    eventName: "cell-selected",
    callback: (
      cell: { merge?: [number, number]; style?: number; text: string } | undefined,
      rowIndex: number,
      columnIndex: number,
    ) => void,
  ): XSpreadsheetMockInstance;
  onMock(
    eventName: "cell-selected",
    callback: (
      cell: { merge?: [number, number]; style?: number; text: string } | undefined,
      rowIndex: number,
      columnIndex: number,
    ) => void,
  ): XSpreadsheetMockInstance;
}

const xSpreadsheetMockState = vi.hoisted(() => ({
  instances: [] as XSpreadsheetMockInstance[],
}));

const onlyOfficeMockState = vi.hoisted(() => ({
  connectorAvailable: true,
  configs: [] as unknown[],
  connectorResult: null as unknown,
}));

vi.mock("x-data-spreadsheet/dist/xspreadsheet.css", () => ({}));

vi.mock("x-data-spreadsheet/dist/xspreadsheet.js", () => {
  window.x_spreadsheet = (host: HTMLElement) => {
    const instance: XSpreadsheetMockInstance = {
      data: null,
      loadData(data: unknown) {
        return instance.loadDataMock(data);
      },
      loadDataMock: vi.fn((data: unknown) => {
        instance.data = data;
        return instance;
      }),
      on(
        eventName: "cell-selected",
        callback: (
          cell: { merge?: [number, number]; style?: number; text: string } | undefined,
          rowIndex: number,
          columnIndex: number,
        ) => void,
      ) {
        return instance.onMock(eventName, callback);
      },
      onMock: vi.fn(() => instance),
    };
    host.textContent = "x-spreadsheet mounted";
    xSpreadsheetMockState.instances.push(instance);
    return instance;
  };
  return {};
});

vi.mock("@aiden0z/pptx-renderer", () => ({
  PptxViewer: class PptxViewer {
    open() {
      return Promise.resolve();
    }
    destroy() {}
  },
}));

vi.mock("@embedpdf/react-pdf-viewer", async () => {
  const ReactModule = await import("react");
  return {
    PDFViewer: (props: { onReady?: (registry: EmbedPdfRegistryMock) => void }) => {
      const { onReady } = props;
      ReactModule.useEffect(() => {
        if (pdfViewerMockState.registry) {
          onReady?.(pdfViewerMockState.registry);
        }
      }, [onReady]);
      if (!pdfViewerMockState.renderPageElement) {
        return ReactModule.createElement("div", { "data-testid": "pdf-empty-viewer" }, "PDF copy");
      }
      return ReactModule.createElement(
        "div",
        {
          "data-page-number": "2",
          "data-testid": "pdf-page",
        },
        ReactModule.createElement(
          "div",
          { "data-testid": "pdf-page-content", "data-pdf-page-content": "true" },
          ReactModule.createElement("span", { "data-testid": "pdf-click-target" }, "PDF copy"),
        ),
      );
    },
  };
});

vi.mock("docx-preview", () => ({
  renderAsync: vi.fn((_buffer: ArrayBuffer, renderHost: HTMLElement) => {
    renderHost.innerHTML = `
      <section>
        <p><strong data-testid="docx-click-target">Revenue target</strong></p>
      </section>
    `;
    return Promise.resolve();
  }),
}));

vi.mock("@/i18n/i18n", () => ({
  translateNow: (key: string, values?: Record<string, string>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  useI18n: () => ({
    language: "zh",
    locale: "zh",
    t: (key: string, values?: Record<string, string>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function"
        ? factory({
            colors: {
              border: "#ddd",
              destructive: "#d00",
              foregroundMuted: "#666",
              surface0: "#fff",
            },
            borderRadius: {
              base: 4,
            },
            borderWidth: {
              1: 1,
            },
            fontSize: {
              base: 16,
              sm: 14,
            },
            spacing: {
              2: 8,
              3: 12,
              4: 16,
            },
          })
        : factory,
  },
}));

const SELECTED_DOCX_TARGET = {
  kind: "docx" as const,
  label: "p: Revenue target",
  locator: {
    type: "element",
    pageNumber: 1,
    path: "section:nth-of-type(1) > p:nth-of-type(1)",
  },
};

const PENDING_DOCX_TARGETS = [
  {
    kind: "docx" as const,
    label: "p: Revenue target",
    locator: {
      type: "element",
      pageNumber: 1,
      path: "section:nth-of-type(1) > p:nth-of-type(1)",
    },
  },
];

const SELECTED_CSV_TARGET = {
  kind: "csv" as const,
  label: "Sheet1!B2",
  locator: { type: "cell", sheet: "Sheet1", cell: "B2", row: 2, column: 2 },
};

const PENDING_CSV_TARGETS = [
  {
    kind: "csv" as const,
    label: "Sheet1!A1",
    locator: { type: "cell", sheet: "Sheet1", cell: "A1", row: 1, column: 1 },
  },
];

describe("DocumentViewer web annotation interactions", () => {
  beforeEach(() => {
    onlyOfficeMockState.connectorAvailable = true;
    onlyOfficeMockState.configs = [];
    onlyOfficeMockState.connectorResult = null;
    xSpreadsheetMockState.instances = [];
    window.DocsAPI = {
      DocEditor: class DocEditor {
        constructor(_elementId: string, config: unknown) {
          onlyOfficeMockState.configs.push(config);
        }

        destroyEditor() {}

        createConnector() {
          if (!onlyOfficeMockState.connectorAvailable) {
            return undefined;
          }
          return {
            callCommand: (_command: () => unknown, callback: (result: unknown) => void) => {
              callback(onlyOfficeMockState.connectorResult);
            },
          };
        }
      },
    };
  });

  afterEach(() => {
    cleanup();
    delete window.DocsAPI;
    pdfViewerMockState.registry = null;
    pdfViewerMockState.renderPageElement = true;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("selects a CSV cell target from a rendered spreadsheet preview", async () => {
    const { DocumentViewer } = await import("./document-viewer.web");
    const onAnnotationTargetSelect = vi.fn();
    const bytes = createCsvBytes();

    render(
      <DocumentViewer
        kind="csv"
        bytes={bytes}
        mimeType="text/csv"
        fileName="budget.csv"
        annotationMode
        onAnnotationTargetSelect={onAnnotationTargetSelect}
      />,
    );

    fireEvent.click(screen.getByTestId("document-spreadsheet-cell-Sheet1-B2"));

    expect(onAnnotationTargetSelect).toHaveBeenCalledWith({
      kind: "csv",
      label: "Sheet1!B2",
      locator: {
        type: "cell",
        sheet: "Sheet1",
        cell: "B2",
        row: 2,
        column: 2,
        rawValue: "150000",
      },
      context: "display=150000",
    });
  });

  it("does not select spreadsheet targets when annotation mode is off", async () => {
    const { DocumentViewer } = await import("./document-viewer.web");
    const onAnnotationTargetSelect = vi.fn();

    render(
      <DocumentViewer
        kind="csv"
        bytes={createCsvBytes()}
        mimeType="text/csv"
        fileName="budget.csv"
        annotationMode={false}
        onAnnotationTargetSelect={onAnnotationTargetSelect}
      />,
    );

    fireEvent.click(screen.getByTestId("document-spreadsheet-cell-Sheet1-B2"));

    expect(onAnnotationTargetSelect).not.toHaveBeenCalled();
  });

  it("marks selected and pending CSV cells in the preview", async () => {
    const { DocumentViewer } = await import("./document-viewer.web");

    render(
      <DocumentViewer
        kind="csv"
        bytes={createCsvBytes()}
        mimeType="text/csv"
        fileName="budget.csv"
        annotationMode
        selectedAnnotationTarget={SELECTED_CSV_TARGET}
        pendingAnnotationTargets={PENDING_CSV_TARGETS}
      />,
    );

    expect(
      screen
        .getByTestId("document-spreadsheet-cell-Sheet1-B2")
        .getAttribute("data-annotation-state"),
    ).toBe("selected");
    expect(
      screen
        .getByTestId("document-spreadsheet-cell-Sheet1-A1")
        .getAttribute("data-annotation-state"),
    ).toBe("pending");
  });

  it("converts XLSX workbooks to x-spreadsheet data", async () => {
    const { createXSpreadsheetData } = await import("./document-viewer.web");
    const data = createXSpreadsheetData(createWorkbookBytes());

    expect(data).toEqual([
      expect.objectContaining({
        merges: expect.arrayContaining(["A1:C1"]),
        name: "Budget",
        rows: expect.objectContaining({
          0: expect.objectContaining({
            cells: expect.objectContaining({
              0: expect.objectContaining({
                merge: [0, 2],
                text: "Budget",
              }),
            }),
          }),
          1: expect.objectContaining({
            cells: expect.objectContaining({
              2: expect.objectContaining({ text: "150000" }),
            }),
          }),
        }),
      }),
    ]);
  });

  it("renders XLSX workbooks with x-spreadsheet instead of the local grid", async () => {
    delete window.DocsAPI;
    const { DocumentViewer } = await import("./document-viewer.web");

    render(
      <DocumentViewer
        kind="xlsx"
        bytes={createWorkbookBytes()}
        mimeType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        fileName="budget.xlsx"
      />,
    );

    expect(await screen.findByText("x-spreadsheet mounted")).toBeTruthy();
    expect(screen.getByTestId("document-xlsx-xspreadsheet-preview")).toBeTruthy();
    expect(screen.queryByTestId("document-spreadsheet-preview")).toBeNull();
    expect(xSpreadsheetMockState.instances).toHaveLength(1);

    const [spreadsheet] = xSpreadsheetMockState.instances;
    expect(spreadsheet.loadDataMock).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: "Budget" })]),
    );
  });

  it("renders XLSX workbooks with ONLYOFFICE when a source URL is available", async () => {
    const { DocumentViewer } = await import("./document-viewer.web");

    render(
      <DocumentViewer
        kind="xlsx"
        bytes={createWorkbookBytes()}
        mimeType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        fileName="budget.xlsx"
        sourceUrl="http://localhost:6767/api/workspace-files/raw?cwd=/repo&path=budget.xlsx&access_token=secret"
      />,
    );

    expect(await screen.findByTestId("document-xlsx-onlyoffice-preview")).toBeTruthy();
    expect(onlyOfficeMockState.configs).toEqual([
      expect.objectContaining({
        documentType: "cell",
        document: expect.objectContaining({
          fileType: "xlsx",
          title: "budget.xlsx",
          url: expect.stringContaining("doya-onlyoffice-host-proxy"),
        }),
        editorConfig: expect.objectContaining({
          callbackUrl: expect.stringContaining("doya-onlyoffice-host-proxy"),
          customization: expect.objectContaining({
            compactHeader: true,
            logo: { visible: false },
          }),
          mode: "view",
          plugins: expect.objectContaining({
            autostart: ["asc.{6D5C3F73-B91E-4A5A-90A0-9B3B23D20A1D}"],
            pluginsData: [
              expect.stringContaining("/api/onlyoffice/doya-selection-plugin/config.json"),
            ],
          }),
        }),
      }),
    ]);
    expect(xSpreadsheetMockState.instances).toHaveLength(0);
  });

  it("reads the current ONLYOFFICE spreadsheet selection for XLSX annotations", async () => {
    const { DocumentViewer } = await import("./document-viewer.web");
    const onAnnotationTargetSelect = vi.fn();
    onlyOfficeMockState.connectorResult = {
      sheetName: "Budget",
      address: "B2:C4",
      text: "Revenue 120000",
      value: "120000",
      formula: "=SUM(C3:C4)",
    };

    render(
      <DocumentViewer
        kind="xlsx"
        bytes={createWorkbookBytes()}
        mimeType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        fileName="budget.xlsx"
        sourceUrl="http://localhost:6767/api/workspace-files/raw?cwd=/repo&path=budget.xlsx&access_token=secret"
        annotationMode
        onAnnotationTargetSelect={onAnnotationTargetSelect}
      />,
    );

    fireEvent.click(await screen.findByTestId("document-xlsx-onlyoffice-read-selection-button"));

    expect(onAnnotationTargetSelect).toHaveBeenCalledWith({
      kind: "xlsx",
      label: "Budget!B2:C4",
      locator: {
        type: "range",
        source: "onlyoffice_selection",
        fileName: "budget.xlsx",
        sheet: "Budget",
        range: "B2:C4",
        text: "Revenue 120000",
        value: "120000",
        formula: "=SUM(C3:C4)",
      },
      context: "text=Revenue 120000; value=120000; formula==SUM(C3:C4)",
    });
  });

  it("falls back to the ONLYOFFICE plugin selection cache when connector is unavailable", async () => {
    const { DocumentViewer } = await import("./document-viewer.web");
    const onAnnotationTargetSelect = vi.fn();
    onlyOfficeMockState.connectorAvailable = false;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          selection: {
            sheetName: "Overview",
            address: "G5:H7",
            value: "96000",
          },
        }),
    } as Response);

    render(
      <DocumentViewer
        kind="xlsx"
        bytes={createWorkbookBytes()}
        mimeType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        fileName="budget.xlsx"
        sourceUrl="http://localhost:6767/api/workspace-files/raw?cwd=/repo&path=budget.xlsx&access_token=secret"
        annotationMode
        onAnnotationTargetSelect={onAnnotationTargetSelect}
      />,
    );

    fireEvent.click(await screen.findByTestId("document-xlsx-onlyoffice-read-selection-button"));

    await waitFor(() => {
      expect(onAnnotationTargetSelect).toHaveBeenCalledWith({
        kind: "xlsx",
        label: "Overview!G5:H7",
        locator: {
          type: "range",
          source: "onlyoffice_selection",
          fileName: "budget.xlsx",
          sheet: "Overview",
          range: "G5:H7",
          value: "96000",
        },
        context: "value=96000",
      });
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/onlyoffice/selection-capture"),
      {
        cache: "no-store",
      },
    );
  });

  it("does not create PDF targets from preview clicks or drags", async () => {
    const { DocumentViewer } = await import("./document-viewer.web");
    const onAnnotationTargetSelect = vi.fn();

    render(
      <DocumentViewer
        kind="pdf"
        bytes={new Uint8Array([1, 2, 3])}
        mimeType="application/pdf"
        fileName="brief.pdf"
        annotationMode
        onAnnotationTargetSelect={onAnnotationTargetSelect}
      />,
    );

    const page = await screen.findByTestId("pdf-page");
    const clickTarget = screen.getByTestId("pdf-click-target");
    mockPdfPreviewRects(page, {
      left: 80,
      top: 160,
      width: 500,
      height: 900,
    } as DOMRect);

    fireEvent.mouseDown(clickTarget, {
      clientX: 180,
      clientY: 280,
    });
    fireEvent.mouseUp(clickTarget, {
      clientX: 340,
      clientY: 520,
    });
    fireEvent.click(clickTarget, {
      clientX: 340,
      clientY: 520,
    });

    expect(onAnnotationTargetSelect).not.toHaveBeenCalled();
  });

  it("uses EmbedPDF builtin annotations as PDF annotation targets", async () => {
    const { registry, annotationCapability, emitAnnotationEvent } = createEmbedPdfRegistryMock({
      annotation: true,
    });
    pdfViewerMockState.registry = registry;
    const { DocumentViewer } = await import("./document-viewer.web");
    const onAnnotationTargetSelect = vi.fn();

    render(
      <DocumentViewer
        kind="pdf"
        bytes={new Uint8Array([1, 2, 3])}
        mimeType="application/pdf"
        fileName="brief.pdf"
        annotationMode
        onAnnotationTargetSelect={onAnnotationTargetSelect}
      />,
    );

    await screen.findByTestId("pdf-page");
    await waitFor(() => {
      expect(annotationCapability.onAnnotationEvent).toHaveBeenCalled();
    });
    emitAnnotationEvent({
      type: "create",
      documentId: "doc",
      pageIndex: 0,
      committed: true,
      annotation: {
        id: "anno-1",
        type: 5,
        pageIndex: 0,
        rect: { origin: { x: 100, y: 200 }, size: { width: 120, height: 40 } },
        contents: "改成红色字",
        strokeColor: "#ff0000",
        opacity: 0.5,
      },
    });

    expect(onAnnotationTargetSelect).toHaveBeenCalledTimes(1);
    expect(onAnnotationTargetSelect).toHaveBeenCalledWith({
      kind: "pdf",
      label: "PDF 第 1 页内置标注",
      locator: {
        type: "builtin_annotation",
        coordinateSpace: "pdf_page_normalized",
        annotationId: "anno-1",
        annotationType: "square",
        rawAnnotationType: "5",
        pageNumber: 1,
        x: 0.4,
        y: 0.275,
        x1: 0.25,
        y1: 0.25,
        x2: 0.55,
        y2: 0.3,
        width: 0.3,
        height: 0.05,
        rectPdf: JSON.stringify({ origin: { x: 100, y: 200 }, size: { width: 120, height: 40 } }),
        targetPolicy:
          "Modify visible PDF content inside or intersecting this annotation area; do not modify the annotation shape itself unless the instruction explicitly asks.",
        pageWidthPdf: 400,
        pageHeightPdf: 800,
        color: "#ff0000",
        opacity: 0.5,
      },
      context:
        "target=page 1 square annotation area (normalized PDF page coordinates: x1=0.25, y1=0.25, x2=0.55, y2=0.3, center=(0.4, 0.275)). Apply the requested edit to visible PDF content inside or intersecting this marked area, not to unrelated nearby sections.; contents=改成红色字; color=#ff0000; opacity=0.5",
    });
  });

  it("uses EmbedPDF annotations even when Doya annotation mode is off", async () => {
    const { registry, annotationCapability, emitAnnotationEvent } = createEmbedPdfRegistryMock({
      annotation: true,
    });
    pdfViewerMockState.registry = registry;
    const { DocumentViewer } = await import("./document-viewer.web");
    const onAnnotationTargetSelect = vi.fn();

    render(
      <DocumentViewer
        kind="pdf"
        bytes={new Uint8Array([1, 2, 3])}
        mimeType="application/pdf"
        fileName="brief.pdf"
        annotationMode={false}
        onAnnotationTargetSelect={onAnnotationTargetSelect}
      />,
    );

    await screen.findByTestId("pdf-page");
    await waitFor(() => {
      expect(annotationCapability.onAnnotationEvent).toHaveBeenCalled();
    });
    emitAnnotationEvent({
      type: "create",
      documentId: "doc",
      pageIndex: 0,
      committed: true,
      annotation: {
        id: "anno-mode-off",
        type: 1,
        pageIndex: 0,
        rect: { origin: { x: 100, y: 200 }, size: { width: 120, height: 40 } },
        contents: "改成红色",
      },
    });

    expect(onAnnotationTargetSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "PDF 第 1 页内置标注",
        context: expect.stringContaining("contents=改成红色"),
      }),
    );
  });

  it("includes EmbedPDF annotation replies in the PDF target context", async () => {
    const { registry, annotationCapability, emitAnnotationEvent } = createEmbedPdfRegistryMock({
      annotation: true,
    });
    pdfViewerMockState.registry = registry;
    const { DocumentViewer } = await import("./document-viewer.web");
    const onAnnotationTargetSelect = vi.fn();

    render(
      <DocumentViewer
        kind="pdf"
        bytes={new Uint8Array([1, 2, 3])}
        mimeType="application/pdf"
        fileName="brief.pdf"
        annotationMode={false}
        onAnnotationTargetSelect={onAnnotationTargetSelect}
      />,
    );

    await screen.findByTestId("pdf-page");
    await waitFor(() => {
      expect(annotationCapability.onAnnotationEvent).toHaveBeenCalled();
    });
    const parentAnnotation = {
      id: "anno-parent",
      type: 1,
      pageIndex: 0,
      rect: { origin: { x: 100, y: 200 }, size: { width: 120, height: 40 } },
      contents: "",
    };
    emitAnnotationEvent({
      type: "create",
      documentId: "doc",
      pageIndex: 0,
      committed: true,
      annotation: parentAnnotation,
    });
    emitAnnotationEvent({
      type: "create",
      documentId: "doc",
      pageIndex: 0,
      committed: true,
      annotation: {
        id: "anno-reply",
        type: 1,
        pageIndex: 0,
        rect: { origin: { x: 100, y: 200 }, size: { width: 120, height: 40 } },
        contents: "改成红色",
        inReplyToId: "anno-parent",
        replyType: 1,
      },
    });

    expect(onAnnotationTargetSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({
        label: "PDF 第 1 页内置标注",
        context: expect.stringContaining("replies=改成红色"),
      }),
    );
  });

  it("selects a DOCX element target from a rendered Word preview", async () => {
    const { DocumentViewer } = await import("./document-viewer.web");
    const onAnnotationTargetSelect = vi.fn();

    render(
      <DocumentViewer
        kind="docx"
        bytes={new Uint8Array([1, 2, 3])}
        mimeType="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        fileName="prd.docx"
        annotationMode
        onAnnotationTargetSelect={onAnnotationTargetSelect}
      />,
    );

    fireEvent.click(await screen.findByTestId("docx-click-target"));

    expect(onAnnotationTargetSelect).toHaveBeenCalledWith({
      kind: "docx",
      label: "p: Revenue target",
      locator: {
        type: "element",
        pageNumber: 1,
        path: "section:nth-of-type(1) > p:nth-of-type(1)",
        clickedPath: "section:nth-of-type(1) > p:nth-of-type(1) > strong:nth-of-type(1)",
      },
      context: "Revenue target",
    });
  });

  it("marks selected DOCX semantic blocks in the preview", async () => {
    const { DocumentViewer } = await import("./document-viewer.web");

    render(
      <DocumentViewer
        kind="docx"
        bytes={new Uint8Array([1, 2, 3])}
        mimeType="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        fileName="prd.docx"
        annotationMode
        selectedAnnotationTarget={SELECTED_DOCX_TARGET}
        pendingAnnotationTargets={PENDING_DOCX_TARGETS}
      />,
    );

    const clickTarget = await screen.findByTestId("docx-click-target");
    const semanticTarget = clickTarget.closest("p");

    expect(semanticTarget).toBeInstanceOf(HTMLElement);
    await waitFor(() => {
      expect((semanticTarget as HTMLElement).dataset.doyaDocxAnnotationState).toBe("selected");
    });
  });

  it("uses selected DOCX text as the annotation context when available", async () => {
    const { DocumentViewer } = await import("./document-viewer.web");
    const onAnnotationTargetSelect = vi.fn();

    render(
      <DocumentViewer
        kind="docx"
        bytes={new Uint8Array([1, 2, 3])}
        mimeType="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        fileName="prd.docx"
        annotationMode
        onAnnotationTargetSelect={onAnnotationTargetSelect}
      />,
    );

    const clickTarget = await screen.findByTestId("docx-click-target");
    mockSelectionInside(clickTarget, "  Revenue\n target  ");
    fireEvent.click(clickTarget);

    expect(onAnnotationTargetSelect).toHaveBeenCalledWith({
      kind: "docx",
      label: "Word 选中文本",
      locator: {
        type: "selection",
        pageNumber: 1,
        path: "section:nth-of-type(1) > p:nth-of-type(1)",
        clickedPath: "section:nth-of-type(1) > p:nth-of-type(1) > strong:nth-of-type(1)",
      },
      context: "Revenue target",
    });
  });
});

function mockSelectionInside(element: HTMLElement, text: string): void {
  const textNode = element.firstChild ?? element;
  vi.spyOn(window, "getSelection").mockReturnValue({
    anchorNode: textNode,
    focusNode: textNode,
    rangeCount: 1,
    toString: () => text,
  } as unknown as Selection);
}

function mockPdfPreviewRects(
  page: HTMLElement,
  pageRect: DOMRect,
  contentRect: DOMRect = pageRect,
): void {
  const content = screen.getByTestId("pdf-page-content");
  vi.spyOn(page, "getBoundingClientRect").mockReturnValue(pageRect);
  vi.spyOn(content, "getBoundingClientRect").mockReturnValue(contentRect);
}

type EmbedPdfRegistryMock = ReturnType<typeof createEmbedPdfRegistryMock>["registry"];

interface EmbedPdfAnnotationEventMock {
  type: "create" | "update";
  documentId: string;
  pageIndex: number;
  committed: boolean;
  annotation: EmbedPdfAnnotationMock;
}

interface EmbedPdfAnnotationMock {
  id: string;
  type: string | number;
  pageIndex: number;
  rect: { origin: { x: number; y: number }; size: { width: number; height: number } };
  contents?: string;
  strokeColor?: string;
  opacity?: number;
  inReplyToId?: string;
  replyType?: number;
}

function createEmbedPdfRegistryMock(input?: { annotation?: boolean }) {
  const annotationEventListeners = new Set<(event: EmbedPdfAnnotationEventMock) => void>();
  const trackedAnnotations = new Map<
    string,
    { commitState: "dirty"; object: EmbedPdfAnnotationMock }
  >();
  const getDocumentState = () => ({
    pages: Array.from(trackedAnnotations.values()).reduce<Record<number, string[]>>(
      (pages, tracked) => {
        const page = pages[tracked.object.pageIndex] ?? [];
        page.push(tracked.object.id);
        pages[tracked.object.pageIndex] = page;
        return pages;
      },
      {},
    ),
    byUid: Object.fromEntries(trackedAnnotations),
    selectedUid: null,
    selectedUids: [],
    activeToolId: null,
    hasPendingChanges: true,
    locked: { type: "none" },
  });
  const interactionCapability = {
    activate: vi.fn(),
    activateDefaultMode: vi.fn(),
    registerMode: vi.fn(),
  };
  const annotationCapability = {
    getAnnotationById: vi.fn((id: string) => trackedAnnotations.get(id) ?? null),
    getAnnotations: vi.fn(() => Array.from(trackedAnnotations.values())),
    getSelectedAnnotations: vi.fn(() => []),
    getState: vi.fn(getDocumentState),
    onAnnotationEvent: vi.fn((listener: (event: EmbedPdfAnnotationEventMock) => void) => {
      annotationEventListeners.add(listener);
      return () => annotationEventListeners.delete(listener);
    }),
    onStateChange: vi.fn(() => () => {}),
  };
  const registry = {
    getPlugin: vi.fn((pluginId: string) => {
      if (pluginId === "annotation" && input?.annotation) {
        return { provides: () => annotationCapability };
      }
      if (pluginId === "interaction-manager") {
        return { provides: () => interactionCapability };
      }
      return null;
    }),
    getStore: vi.fn(() => ({
      getState: () => ({
        core: {
          activeDocumentId: "doc",
          documents: {
            doc: {
              document: {
                pages: [
                  { size: { width: 400, height: 800 } },
                  { size: { width: 400, height: 800 } },
                ],
              },
            },
          },
        },
      }),
    })),
  };
  return {
    registry,
    annotationCapability,
    interactionCapability,
    emitAnnotationEvent(event: EmbedPdfAnnotationEventMock) {
      if (event.type === "create" || event.type === "update") {
        trackedAnnotations.set(event.annotation.id, {
          commitState: "dirty",
          object: event.annotation,
        });
      }
      annotationEventListeners.forEach((listener) => listener(event));
    },
  };
}

function createWorkbookBytes(): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Budget", "", ""],
    ["Revenue", 120_000, { f: "SUM(C3:C4)", t: "n", v: 150_000, w: "$150,000" }],
    ["Retail", 0, 70_000],
    ["Delivery", 0, 80_000],
  ]);
  sheet["!merges"] = [{ e: { c: 2, r: 0 }, s: { c: 0, r: 0 } }];
  sheet["!cols"] = [{ wpx: 180 }, { wpx: 120 }, { wpx: 140 }];
  XLSX.utils.book_append_sheet(workbook, sheet, "Budget");
  const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  return new Uint8Array(output);
}

function createCsvBytes(): Uint8Array {
  return new TextEncoder().encode("Metric,Budget\nRevenue,150000\n");
}

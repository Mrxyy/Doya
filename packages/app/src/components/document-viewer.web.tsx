import { PptxViewer } from "@aiden0z/pptx-renderer";
import { PDFViewer } from "@embedpdf/react-pdf-viewer";
import { renderAsync } from "docx-preview";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import * as XLSX from "xlsx";
import { translateNow } from "@/i18n/i18n";

export type DocumentViewerKind = "pdf" | "docx" | "pptx" | "csv" | "xlsx";

export interface DocumentViewerProps {
  kind: DocumentViewerKind;
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
}

type RenderState = { status: "idle" | "loading" | "ready" } | { status: "error"; message: string };

interface SpreadsheetPreview {
  sheetNames: string[];
  activeSheetName: string;
  rows: string[][];
  rowCount: number;
  columnCount: number;
  truncatedRows: boolean;
  truncatedColumns: boolean;
}

const SPREADSHEET_MAX_ROWS = 500;
const SPREADSHEET_MAX_COLUMNS = 80;

function createDocumentBlobUrl(input: { bytes: Uint8Array; mimeType: string }): string {
  return URL.createObjectURL(new Blob([getArrayBuffer(input.bytes)], { type: input.mimeType }));
}

function getArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

function useDocumentBlobUrl(input: { bytes: Uint8Array; mimeType: string }): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const nextUrl = createDocumentBlobUrl(input);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [input.bytes, input.mimeType]);

  return url;
}

function PdfDocumentViewer({ bytes, mimeType }: Pick<DocumentViewerProps, "bytes" | "mimeType">) {
  const url = useDocumentBlobUrl({ bytes, mimeType });
  if (!url) {
    return <DocumentLoadingState label={translateNow("ui.loading.pdf")} />;
  }
  return (
    <div style={webStyles.fill}>
      <PDFViewer config={{ src: url, theme: { preference: "system" } }} style={webStyles.fill} />
    </div>
  );
}

function DocxDocumentViewer({ bytes }: Pick<DocumentViewerProps, "bytes">) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const renderVersionRef = useRef(0);
  const [state, setState] = useState<RenderState>({ status: "idle" });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    let canceled = false;
    const renderVersion = renderVersionRef.current + 1;
    renderVersionRef.current = renderVersion;
    const renderHost = document.createElement("div");
    setState({ status: "loading" });
    host.replaceChildren();

    async function renderDocx() {
      try {
        await renderAsync(getArrayBuffer(bytes), renderHost, undefined, {
          className: "paseo-docx",
          inWrapper: true,
          renderAltChunks: false,
          useBase64URL: true,
        });
        if (canceled || renderVersionRef.current !== renderVersion) {
          return;
        }
        host.replaceChildren(...Array.from(renderHost.childNodes));
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
      host.replaceChildren();
    };
  }, [bytes]);

  return (
    <div style={webStyles.docxRoot}>
      {state.status === "idle" || state.status === "loading" ? (
        <DocumentLoadingOverlay label={translateNow("ui.loading.docx")} />
      ) : null}
      {state.status === "error" ? <DocumentErrorOverlay message={state.message} /> : null}
      <div
        aria-label={translateNow("ui.docx.preview.title")}
        ref={hostRef}
        style={webStyles.docxHost}
      />
    </div>
  );
}

function PptxDocumentViewer({ bytes }: Pick<DocumentViewerProps, "bytes">) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const abortController = new AbortController();
    const viewer = new PptxViewer(host, {
      fitMode: "contain",
      zoomPercent: 100,
      scrollContainer: host,
    });
    setIsLoading(true);
    setError(null);

    void viewer
      .open(getArrayBuffer(bytes), {
        renderMode: "list",
        listOptions: { windowed: true, showSlideLabels: true },
        signal: abortController.signal,
      })
      .catch((error) => {
        if (abortController.signal.aborted) {
          return;
        }
        setError(error instanceof Error ? error.message : translateNow("ui.failed.to.render.pptx"));
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => {
      abortController.abort();
      viewer.destroy();
      host.replaceChildren();
    };
  }, [bytes]);

  return (
    <div style={webStyles.pptxFrame}>
      {isLoading ? <DocumentLoadingOverlay label={translateNow("ui.loading.pptx")} /> : null}
      {error ? <DocumentErrorOverlay message={error} /> : null}
      <div ref={hostRef} style={webStyles.pptxHost} />
    </div>
  );
}

function parseSpreadsheetPreview(input: {
  kind: Extract<DocumentViewerKind, "csv" | "xlsx">;
  bytes: Uint8Array;
  activeSheetName?: string;
}): SpreadsheetPreview {
  const workbook =
    input.kind === "csv"
      ? XLSX.read(new TextDecoder().decode(input.bytes), { type: "string", raw: true })
      : XLSX.read(input.bytes, { type: "array", cellDates: true });
  const sheetNames = workbook.SheetNames;
  const activeSheetName =
    input.activeSheetName && sheetNames.includes(input.activeSheetName)
      ? input.activeSheetName
      : (sheetNames[0] ?? "Sheet1");
  const sheet = workbook.Sheets[activeSheetName];
  if (!sheet) {
    return {
      sheetNames,
      activeSheetName,
      rows: [],
      rowCount: 0,
      columnCount: 0,
      truncatedRows: false,
      truncatedColumns: false,
    };
  }

  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: "",
    raw: false,
  });
  const columnCount = rawRows.reduce((max, row) => Math.max(max, row.length), 0);
  const rows = rawRows
    .slice(0, SPREADSHEET_MAX_ROWS)
    .map((row) => row.slice(0, SPREADSHEET_MAX_COLUMNS).map((cell) => String(cell ?? "")));
  return {
    sheetNames,
    activeSheetName,
    rows,
    rowCount: rawRows.length,
    columnCount,
    truncatedRows: rawRows.length > SPREADSHEET_MAX_ROWS,
    truncatedColumns: columnCount > SPREADSHEET_MAX_COLUMNS,
  };
}

function SpreadsheetDocumentViewer({
  kind,
  bytes,
}: Pick<DocumentViewerProps, "bytes"> & {
  kind: Extract<DocumentViewerKind, "csv" | "xlsx">;
}) {
  const [activeSheetName, setActiveSheetName] = useState<string | undefined>(undefined);
  const preview = useMemo(
    () => parseSpreadsheetPreview({ kind, bytes, activeSheetName }),
    [activeSheetName, bytes, kind],
  );
  const columnIndexes = useMemo(
    () =>
      Array.from({ length: Math.min(preview.columnCount, SPREADSHEET_MAX_COLUMNS) }, (_, i) => i),
    [preview.columnCount],
  );

  if (preview.rowCount === 0 || preview.columnCount === 0) {
    return <DocumentErrorState message={translateNow("ui.spreadsheet.empty")} />;
  }

  return (
    <div style={webStyles.spreadsheetRoot}>
      {preview.sheetNames.length > 1 ? (
        <div style={webStyles.sheetTabs}>
          {preview.sheetNames.map((sheetName) => (
            <button
              key={sheetName}
              type="button"
              style={
                sheetName === preview.activeSheetName
                  ? webStyles.sheetTabActive
                  : webStyles.sheetTab
              }
              onClick={() => setActiveSheetName(sheetName)}
            >
              {sheetName}
            </button>
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
        <table style={webStyles.spreadsheetTable}>
          <thead>
            <tr>
              <th style={webStyles.cornerHeaderCell} />
              {columnIndexes.map((columnIndex) => (
                <th key={columnIndex} style={webStyles.columnHeaderCell}>
                  {columnIndex + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th style={webStyles.rowHeaderCell}>{rowIndex + 1}</th>
                {columnIndexes.map((columnIndex) => (
                  <td key={columnIndex} style={webStyles.spreadsheetCell}>
                    {row[columnIndex] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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

export function DocumentViewer({ kind, bytes, mimeType }: DocumentViewerProps) {
  const stableBytes = useMemo(() => bytes, [bytes]);
  if (kind === "pdf") {
    return <PdfDocumentViewer bytes={stableBytes} mimeType={mimeType} />;
  }
  if (kind === "docx") {
    return <DocxDocumentViewer bytes={stableBytes} />;
  }
  if (kind === "pptx") {
    return <PptxDocumentViewer bytes={stableBytes} />;
  }
  return <SpreadsheetDocumentViewer kind={kind} bytes={stableBytes} />;
}

const webStyles = {
  fill: {
    width: "100%",
    height: "100%",
    minHeight: 0,
  },
  docxRoot: {
    position: "relative",
    width: "100%",
    height: "100%",
    minHeight: 0,
    overflow: "hidden",
    background: "var(--paseo-surface1, #f4f4f5)",
  },
  docxHost: {
    width: "100%",
    height: "100%",
    minHeight: 0,
    overflow: "auto",
    padding: "24px 0",
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
  spreadsheetRoot: {
    width: "100%",
    height: "100%",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    background: "var(--paseo-surface0, #fff)",
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

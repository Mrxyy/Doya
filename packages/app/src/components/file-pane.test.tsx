// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pressable, Text } from "react-native";
import type { DocumentAnnotationTarget, DocumentViewerKind } from "@/components/document-viewer";
import { FilePane } from "@/components/file-pane";
import { useSessionStore, type Agent } from "@/stores/session-store";

const mockDocumentTargets: Record<DocumentViewerKind, DocumentAnnotationTarget> = {
  csv: {
    kind: "csv",
    label: "Budget!C2",
    locator: {
      type: "cell",
      sheet: "Budget",
      cell: "C2",
      row: 2,
      column: 3,
      rawValue: "150000",
    },
    context: "display=150000",
  },
  docx: {
    kind: "docx",
    label: "DOCX 选中文本",
    locator: {
      type: "text",
      selectedText: "Revenue target",
      path: "section:nth-child(1) > p:nth-child(1)",
    },
    context: "Revenue target",
  },
  pdf: {
    kind: "pdf",
    label: "PDF 第 2 页点击位置",
    locator: {
      type: "point",
      pageNumber: 2,
      x: 0.3,
      y: 0.25,
      selectedText: "Quarterly revenue",
    },
    context: "Quarterly revenue",
  },
  pptx: {
    kind: "pptx",
    label: "PPTX 第 1 页",
    locator: {
      type: "page",
      pageNumber: 1,
    },
  },
  xlsx: {
    kind: "xlsx",
    label: "Budget!C2",
    locator: {
      type: "cell",
      sheet: "Budget",
      cell: "C2",
      row: 2,
      column: 3,
      rawValue: "150000",
      formula: "=SUM(C3:C4)",
    },
    context: "display=150000; formula =SUM(C3:C4)",
  },
};
const waitingPollLocation = { path: "reports/budget.xlsx" };
const sourceAgentFileLocation = { path: "output/spreadsheets/report.xlsx" };
const documentViewerMounts: string[] = [];

const theme = vi.hoisted(() => ({
  borderRadius: {
    base: 4,
    lg: 12,
  },
  borderWidth: {
    1: 1,
  },
  colors: {
    accentBorder: "#dbeafe",
    border: "#e5e7eb",
    destructive: "#dc2626",
    foreground: "#111827",
    foregroundMuted: "#6b7280",
    surface0: "#ffffff",
    surface1: "#f8fafc",
    syntax: {
      attribute: "#2563eb",
      comment: "#6b7280",
      function: "#9333ea",
      keyword: "#dc2626",
      number: "#16a34a",
      operator: "#111827",
      property: "#0f766e",
      punctuation: "#64748b",
      string: "#15803d",
      type: "#d97706",
      variable: "#111827",
    },
  },
  fontFamily: {
    mono: "monospace",
  },
  fontSize: {
    code: 13,
    lg: 18,
    sm: 14,
    xs: 12,
  },
  fontWeight: {
    semibold: "600",
  },
  spacing: {
    1: 4,
    2: 8,
    3: 12,
    4: 16,
  },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  useUnistyles: () => ({ rt: { breakpoint: "lg" }, theme }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    disabled,
    onPress,
    testID,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onPress?: () => void;
    testID?: string;
  }) => (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} testID={testID}>
      <Text>{children}</Text>
    </Pressable>
  ),
}));

vi.mock("@/components/document-viewer", () => ({
  DocumentViewer: ({
    annotationMode,
    bytes,
    kind,
    onAnnotationTargetSelect,
  }: {
    annotationMode?: boolean;
    bytes?: Uint8Array;
    kind: DocumentViewerKind;
    onAnnotationTargetSelect?: (target: DocumentAnnotationTarget) => void;
  }) => {
    React.useEffect(() => {
      documentViewerMounts.push(`${kind}:${bytes?.[0] ?? "missing"}`);
      return undefined;
    }, [bytes, kind]);

    const handlePress = React.useCallback(() => {
      if (annotationMode) {
        onAnnotationTargetSelect?.(mockDocumentTargets[kind]);
      }
    }, [annotationMode, kind, onAnnotationTargetSelect]);

    return (
      <Pressable accessibilityRole="button" onPress={handlePress} testID="document-viewer-mock">
        <Text>{annotationMode ? "annotation-on" : "annotation-off"}</Text>
        <Text>{`${kind}-preview-version-${bytes?.[0] ?? "missing"}`}</Text>
      </Pressable>
    );
  },
}));

vi.mock("react-native-markdown-display", () => ({
  default: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
  MarkdownIt: () => ({}),
}));

vi.mock("@/components/use-web-scrollbar", () => ({
  useWebScrollViewScrollbar: () => ({
    onContentSizeChange: vi.fn(),
    onLayout: vi.fn(),
    onScroll: vi.fn(),
    overlay: null,
  }),
}));

vi.mock("@/hooks/use-web-scrollbar-style", () => ({
  useWebScrollbarStyle: () => ({}),
}));

vi.mock("@/i18n/i18n", () => ({
  translateNow: (key: string) => key,
  useI18n: () => ({ locale: "zh-CN" }),
}));

vi.mock("@/attachments/use-attachment-preview-url", () => ({
  useAttachmentPreviewUrl: () => null,
}));

describe("FilePane document annotation flow", () => {
  const serverId = "server-file-pane";
  const sourceAgentId = "agent-file-pane";
  let queryClient: QueryClient;

  beforeEach(() => {
    documentViewerMounts.length = 0;
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    useSessionStore.getState().clearSession(serverId);
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    useSessionStore.getState().clearSession(serverId);
    vi.restoreAllMocks();
  });

  it("reads source-agent file tabs from the source agent cwd", async () => {
    const file = createFileReadResult({
      firstByte: 4,
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      path: "output/spreadsheets/report.xlsx",
    });
    const readFile = vi.fn().mockResolvedValue(file);
    const client = {
      buildWorkspaceFileOnlyOfficePreviewUrl: vi.fn(() => "http://localhost/preview.xlsx"),
      readFile,
    } as unknown as DaemonClient;
    useSessionStore.getState().initializeSession(serverId, client);
    useSessionStore
      .getState()
      .setAgents(
        serverId,
        new Map([[sourceAgentId, createAgent({ cwd: "/agent-cwd", status: "idle" })]]),
      );

    render(
      <QueryClientProvider client={queryClient}>
        <FilePane
          serverId={serverId}
          sourceAgentId={sourceAgentId}
          workspaceRoot="/workspace-cwd"
          location={sourceAgentFileLocation}
        />
      </QueryClientProvider>,
    );

    await screen.findByText("xlsx-preview-version-4");
    expect(readFile).toHaveBeenCalledWith("/agent-cwd", "output/spreadsheets/report.xlsx");
  });

  it.each([
    {
      name: "spreadsheet",
      file: createFileReadResult({
        firstByte: 1,
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        path: "reports/budget.xlsx",
      }),
      updatedFile: createFileReadResult({
        firstByte: 9,
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        modifiedAt: "2026-06-12T00:00:01.000Z",
        path: "reports/budget.xlsx",
      }),
      goal: "modify_spreadsheet",
      location: { path: "reports/budget.xlsx" },
      path: "reports/budget.xlsx",
      refreshedPreviewText: "xlsx-preview-version-9",
      targetText: "Budget!C2",
      instruction: "把预算改成 20 万，并保持公式联动",
    },
    {
      name: "docx",
      file: createFileReadResult({
        firstByte: 2,
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        path: "docs/prd.docx",
      }),
      updatedFile: createFileReadResult({
        firstByte: 8,
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        modifiedAt: "2026-06-12T00:00:01.000Z",
        path: "docs/prd.docx",
      }),
      goal: "modify_docx",
      location: { path: "docs/prd.docx" },
      path: "docs/prd.docx",
      refreshedPreviewText: "docx-preview-version-8",
      targetText: "Revenue target",
      instruction: "把这段改成更正式的 PRD 表述",
    },
    {
      name: "pdf",
      file: createFileReadResult({
        firstByte: 3,
        mime: "application/pdf",
        path: "briefs/market.pdf",
      }),
      updatedFile: createFileReadResult({
        firstByte: 7,
        mime: "application/pdf",
        modifiedAt: "2026-06-12T00:00:01.000Z",
        path: "briefs/market.pdf",
      }),
      goal: "modify_pdf",
      location: { path: "briefs/market.pdf" },
      path: "briefs/market.pdf",
      refreshedPreviewText: "pdf-preview-version-7",
      targetText: "Quarterly revenue",
      instruction: "把这里的数字改成红色强调",
    },
  ])(
    "sends saved $name annotations to the source agent and refreshes after completion",
    async ({
      file,
      goal,
      instruction,
      location,
      path,
      refreshedPreviewText,
      targetText,
      updatedFile,
    }) => {
      const readFile = vi.fn().mockResolvedValueOnce(file).mockResolvedValue(updatedFile);
      const sendAgentMessage = vi.fn().mockResolvedValue(undefined);
      const client = {
        buildWorkspaceFileOnlyOfficePreviewUrl: vi.fn(() => "http://localhost/preview.xlsx"),
        readFile,
        sendAgentMessage,
      } as unknown as DaemonClient;
      useSessionStore.getState().initializeSession(serverId, client);
      setSourceAgentStatus("idle");

      render(
        <QueryClientProvider client={queryClient}>
          <FilePane
            serverId={serverId}
            sourceAgentId={sourceAgentId}
            workspaceRoot="/workspace"
            location={location}
          />
        </QueryClientProvider>,
      );

      await screen.findByTestId("document-viewer-mock");
      fireEvent.click(screen.getByTestId("document-annotation-mode-button"));
      fireEvent.click(screen.getByTestId("document-viewer-mock"));
      fireEvent.change(screen.getByTestId("document-annotation-instruction-input"), {
        target: { value: instruction },
      });
      fireEvent.click(screen.getByTestId("document-annotation-add-button"));
      fireEvent.click(screen.getByTestId("document-annotation-apply-button"));

      await waitFor(() => expect(sendAgentMessage).toHaveBeenCalledTimes(1));
      const [agentId, prompt, options] = sendAgentMessage.mock.calls[0];
      expect(agentId).toBe(sourceAgentId);
      expect(options).toEqual({ messageId: expect.stringMatching(/^msg_/) });
      expect(prompt).toContain("<paseo-expected-target");
      expect(prompt).toContain(`goal="${goal}"`);
      expect(prompt).toContain(path);
      expect(prompt).toContain(targetText);
      expect(prompt).toContain(instruction);
      expect(screen.getByTestId("document-annotation-item")).toBeTruthy();

      const session = useSessionStore.getState().sessions[serverId];
      const optimisticItems = [
        ...(session?.agentStreamHead.get(sourceAgentId) ?? []),
        ...(session?.agentStreamTail.get(sourceAgentId) ?? []),
      ];
      expect(optimisticItems).toContainEqual(
        expect.objectContaining({
          kind: "user_message",
          text: prompt,
        }),
      );

      setSourceAgentStatus("running");
      await screen.findByText("等待 AI 完成...");
      expect(screen.getByTestId("document-annotation-apply-overlay")).toBeTruthy();
      setSourceAgentStatus("idle");

      await waitFor(() => expect(readFile).toHaveBeenCalledTimes(2));
      await screen.findByText(refreshedPreviewText);
      expect(screen.queryByTestId("document-annotation-item")).toBeNull();
      expect(screen.queryByTestId("document-annotation-apply-overlay")).toBeNull();
    },
  );

  it("polls and refreshes the preview while waiting if running status is not observed", async () => {
    const file = createFileReadResult({
      firstByte: 1,
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      path: "reports/budget.xlsx",
    });
    const updatedFile = createFileReadResult({
      firstByte: 9,
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      modifiedAt: "2026-06-12T00:00:01.000Z",
      path: "reports/budget.xlsx",
    });
    const readFile = vi.fn().mockResolvedValueOnce(file).mockResolvedValue(updatedFile);
    const sendAgentMessage = vi.fn().mockResolvedValue(undefined);
    const client = {
      buildWorkspaceFileOnlyOfficePreviewUrl: vi.fn(() => "http://localhost/preview.xlsx"),
      readFile,
      sendAgentMessage,
    } as unknown as DaemonClient;
    useSessionStore.getState().initializeSession(serverId, client);
    setSourceAgentStatus("idle");

    render(
      <QueryClientProvider client={queryClient}>
        <FilePane
          serverId={serverId}
          sourceAgentId={sourceAgentId}
          workspaceRoot="/workspace"
          location={waitingPollLocation}
        />
      </QueryClientProvider>,
    );

    await screen.findByText("xlsx-preview-version-1");
    fireEvent.click(screen.getByTestId("document-annotation-mode-button"));
    fireEvent.click(screen.getByTestId("document-viewer-mock"));
    fireEvent.change(screen.getByTestId("document-annotation-instruction-input"), {
      target: { value: "把预算改成 20 万" },
    });
    fireEvent.click(screen.getByTestId("document-annotation-add-button"));
    fireEvent.click(screen.getByTestId("document-annotation-apply-button"));

    await waitFor(() => expect(sendAgentMessage).toHaveBeenCalledTimes(1));
    expect(screen.getByText("等待 AI 完成...")).toBeTruthy();
    expect(screen.getByTestId("document-annotation-item")).toBeTruthy();
    expect(screen.getByTestId("document-annotation-apply-overlay")).toBeTruthy();

    await waitFor(() => expect(readFile).toHaveBeenCalledTimes(2), { timeout: 3500 });
    await screen.findByText("xlsx-preview-version-9");
    await screen.findByText("应用标注");
    expect(screen.queryByTestId("document-annotation-item")).toBeNull();
    expect(screen.queryByTestId("document-annotation-apply-overlay")).toBeNull();
  });

  it("finishes waiting when polling detects changed bytes with unchanged metadata", async () => {
    const file = createFileReadResult({
      firstByte: 1,
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      path: "reports/budget.xlsx",
    });
    const updatedFile = createFileReadResult({
      firstByte: 9,
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      path: "reports/budget.xlsx",
    });
    const readFile = vi.fn().mockResolvedValueOnce(file).mockResolvedValue(updatedFile);
    const sendAgentMessage = vi.fn().mockResolvedValue(undefined);
    const client = {
      buildWorkspaceFileOnlyOfficePreviewUrl: vi.fn(() => "http://localhost/preview.xlsx"),
      readFile,
      sendAgentMessage,
    } as unknown as DaemonClient;
    useSessionStore.getState().initializeSession(serverId, client);
    setSourceAgentStatus("idle");

    render(
      <QueryClientProvider client={queryClient}>
        <FilePane
          serverId={serverId}
          sourceAgentId={sourceAgentId}
          workspaceRoot="/workspace"
          location={waitingPollLocation}
        />
      </QueryClientProvider>,
    );

    await screen.findByText("xlsx-preview-version-1");
    fireEvent.click(screen.getByTestId("document-annotation-mode-button"));
    fireEvent.click(screen.getByTestId("document-viewer-mock"));
    fireEvent.change(screen.getByTestId("document-annotation-instruction-input"), {
      target: { value: "保持元数据不变但更新内容" },
    });
    fireEvent.click(screen.getByTestId("document-annotation-add-button"));
    fireEvent.click(screen.getByTestId("document-annotation-apply-button"));

    await waitFor(() => expect(sendAgentMessage).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("document-annotation-item")).toBeTruthy();
    await waitFor(() => expect(readFile).toHaveBeenCalledTimes(2), { timeout: 3500 });
    await screen.findByText("xlsx-preview-version-9");
    await screen.findByText("应用标注");
    expect(screen.queryByTestId("document-annotation-item")).toBeNull();
    expect(documentViewerMounts).toContain("xlsx:1");
    expect(documentViewerMounts).toContain("xlsx:9");
  });

  function setSourceAgentStatus(status: Agent["status"]) {
    useSessionStore
      .getState()
      .setAgents(serverId, new Map([[sourceAgentId, createAgent({ status })]]));
  }
});

function createFileReadResult(input: {
  firstByte: number;
  mime: string;
  modifiedAt?: string;
  path: string;
}) {
  return {
    bytes: new Uint8Array([input.firstByte, 2, 3]),
    kind: "binary" as const,
    mime: input.mime,
    modifiedAt: input.modifiedAt ?? "2026-06-12T00:00:00.000Z",
    path: input.path,
    size: 3,
  };
}

function createAgent(input: { cwd?: string; status: Agent["status"] }): Agent {
  return {
    archivedAt: null,
    attentionReason: null,
    attentionTimestamp: null,
    availableModes: [],
    capabilities: {
      supportsDynamicModes: false,
      supportsMcpServers: false,
      supportsReasoningStream: false,
      supportsRewindBoth: false,
      supportsRewindConversation: false,
      supportsRewindFiles: false,
      supportsSessionPersistence: true,
      supportsStreaming: true,
      supportsToolInvocations: false,
    },
    createdAt: new Date("2026-06-12T00:00:00.000Z"),
    currentModeId: null,
    cwd: input.cwd ?? "/workspace",
    features: [],
    id: "agent-file-pane",
    labels: {},
    lastActivityAt: new Date("2026-06-12T00:00:00.000Z"),
    lastError: null,
    lastUserMessageAt: null,
    model: null,
    parentAgentId: null,
    pendingPermissions: [],
    persistence: null,
    provider: "codex",
    requiresAttention: false,
    serverId: "server-file-pane",
    status: input.status,
    title: null,
    updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  };
}

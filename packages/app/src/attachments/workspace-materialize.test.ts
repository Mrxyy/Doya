import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import type { AttachmentMetadata } from "@/attachments/types";
import { releaseAttachmentPreviewUrl, resolveAttachmentPreviewUrl } from "@/attachments/service";
import {
  materializeWorkspaceFileAttachments,
  materializeWorkspaceImageAttachmentsForSubmit,
} from "./workspace-materialize";

vi.mock("@/attachments/service", () => ({
  releaseAttachmentPreviewUrl: vi.fn(),
  resolveAttachmentPreviewUrl: vi.fn(),
}));

function attachment(input: Partial<AttachmentMetadata> = {}): AttachmentMetadata {
  return {
    id: "file-1",
    mimeType: "application/pdf",
    storageType: "web-indexeddb",
    storageKey: "file-1",
    fileName: "report.pdf",
    byteSize: 2048,
    createdAt: 1,
    ...input,
  };
}

describe("materializeWorkspaceFileAttachments", () => {
  const materializeWorkspaceAttachments = vi.fn();
  const uploadWorkspaceAttachment = vi.fn();

  beforeEach(() => {
    vi.mocked(releaseAttachmentPreviewUrl).mockReset();
    vi.mocked(resolveAttachmentPreviewUrl).mockReset();
    materializeWorkspaceAttachments.mockReset();
    uploadWorkspaceAttachment.mockReset();
    vi.unstubAllGlobals();
  });

  it("uploads browser-stored files to the workspace with a raw file body", async () => {
    const blob = new Blob(["hello"], { type: "application/pdf" });
    vi.mocked(resolveAttachmentPreviewUrl).mockResolvedValue("blob:report");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(blob, { status: 200 })),
    );
    uploadWorkspaceAttachment.mockResolvedValue({
      cwd: "/repo",
      file: {
        title: "report.pdf",
        mimeType: "application/pdf",
        path: "attachments/abc-report.pdf",
      },
    });
    materializeWorkspaceAttachments.mockResolvedValue({
      cwd: "/repo",
      files: [],
      error: null,
    });

    const result = await materializeWorkspaceFileAttachments({
      client: { materializeWorkspaceAttachments, uploadWorkspaceAttachment },
      agentId: "agent-1",
      files: [attachment()],
    });

    expect(uploadWorkspaceAttachment).toHaveBeenCalledWith({
      agentId: "agent-1",
      fileName: "report.pdf",
      mimeType: "application/pdf",
      body: blob,
    });
    expect(materializeWorkspaceAttachments).not.toHaveBeenCalled();
    expect(releaseAttachmentPreviewUrl).toHaveBeenCalledWith({
      attachment: attachment(),
      url: "blob:report",
    });
    expect(result).toEqual([
      {
        type: "text",
        mimeType: "text/plain",
        title: "report.pdf",
        text: [
          "Uploaded file: report.pdf",
          "MIME type: application/pdf",
          "Workspace path: attachments/abc-report.pdf",
          "Use the workspace path above when the user asks about this file.",
        ].join("\n"),
      },
    ]);
  });

  it("returns workspace-backed image metadata with cwd and raw URL", async () => {
    const blob = new Blob(["image"], { type: "image/png" });
    vi.mocked(resolveAttachmentPreviewUrl).mockResolvedValue("blob:image");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(blob, { status: 200 })),
    );
    uploadWorkspaceAttachment.mockResolvedValue({
      cwd: "/repo",
      file: {
        title: "screenshot.png",
        mimeType: "image/png",
        path: "attachments/abc-screenshot.png",
      },
    });

    const result = await materializeWorkspaceImageAttachmentsForSubmit({
      client: {
        materializeWorkspaceAttachments,
        uploadWorkspaceAttachment,
        buildWorkspaceFileRawUrl: ({ cwd, path }) => `raw:${cwd}:${path}`,
      },
      agentId: "agent-1",
      images: [attachment({ mimeType: "image/png", fileName: "screenshot.png" })],
    });

    expect(result.images).toEqual([
      {
        kind: "workspace_image",
        id: "file-1",
        cwd: "/repo",
        path: "attachments/abc-screenshot.png",
        url: "raw:/repo:attachments/abc-screenshot.png",
        mimeType: "image/png",
        fileName: "screenshot.png",
        createdAt: 1,
      },
    ]);
    expect(result.images[0]).not.toHaveProperty("preview");
  });

  it("preserves the upload client receiver when calling uploadWorkspaceAttachment", async () => {
    const blob = new Blob(["hello"], { type: "application/pdf" });
    vi.mocked(resolveAttachmentPreviewUrl).mockResolvedValue("blob:report");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(blob, { status: 200 })),
    );
    const client = {
      prefix: "attachments",
      materializeWorkspaceAttachments,
      async uploadWorkspaceAttachment(
        this: { prefix: string },
        input: { fileName?: string | null },
      ) {
        return {
          file: {
            title: input.fileName ?? "attached-file",
            mimeType: "application/pdf",
            path: `${this.prefix}/abc-report.pdf`,
          },
        };
      },
    };

    const result = await materializeWorkspaceFileAttachments({
      client,
      agentId: "agent-1",
      files: [attachment()],
    });

    expect(textAttachment(result[0]).text).toContain("Workspace path: attachments/abc-report.pdf");
  });

  it("copies desktop files by source path instead of encoding bytes", async () => {
    materializeWorkspaceAttachments.mockResolvedValue({
      cwd: "/repo",
      files: [
        {
          title: "report.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          path: "attachments/abc-report.docx",
        },
      ],
      error: null,
    });

    await materializeWorkspaceFileAttachments({
      client: { materializeWorkspaceAttachments },
      cwd: "/repo",
      files: [
        attachment({
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          storageType: "desktop-file",
          storageKey: "/Users/me/Downloads/report.docx",
          fileName: "report.docx",
        }),
      ],
    });

    expect(uploadWorkspaceAttachment).not.toHaveBeenCalled();
    expect(materializeWorkspaceAttachments).toHaveBeenCalledWith({
      cwd: "/repo",
      files: [
        {
          fileName: "report.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          sourcePath: "/Users/me/Downloads/report.docx",
        },
      ],
    });
  });

  it("reports the file name when browser-stored files cannot be uploaded", async () => {
    vi.mocked(resolveAttachmentPreviewUrl).mockResolvedValue("blob:missing");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );

    await expect(
      materializeWorkspaceFileAttachments({
        client: { materializeWorkspaceAttachments, uploadWorkspaceAttachment },
        agentId: "agent-1",
        files: [attachment({ fileName: "missing.docx" })],
      }),
    ).rejects.toThrow(
      'Failed to upload attachment "missing.docx" to the workspace. Remove it and upload it again.',
    );
    expect(materializeWorkspaceAttachments).not.toHaveBeenCalled();
    expect(uploadWorkspaceAttachment).not.toHaveBeenCalled();
  });

  it("uploads from a provided fallback preview URL when stored bytes are unavailable", async () => {
    const blob = new Blob(["image"], { type: "image/png" });
    vi.mocked(resolveAttachmentPreviewUrl).mockRejectedValue(
      new Error("Attachment file-1 was not found in IndexedDB."),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(blob, { status: 200 })),
    );
    uploadWorkspaceAttachment.mockResolvedValue({
      cwd: "/repo",
      file: {
        title: "ai-edit-source.png",
        mimeType: "image/png",
        path: "attachments/abc-ai-edit-source.png",
      },
    });

    const result = await materializeWorkspaceFileAttachments({
      client: { materializeWorkspaceAttachments, uploadWorkspaceAttachment },
      agentId: "agent-1",
      files: [
        {
          ...attachment({ fileName: "ai-edit-source.png", mimeType: "image/png" }),
          fallbackPreviewUrl: "blob:visible-source",
        },
      ],
    });

    expect(fetch).toHaveBeenCalledWith("blob:visible-source");
    expect(uploadWorkspaceAttachment).toHaveBeenCalledWith({
      agentId: "agent-1",
      fileName: "ai-edit-source.png",
      mimeType: "image/png",
      body: blob,
    });
    expect(releaseAttachmentPreviewUrl).not.toHaveBeenCalled();
    expect(textAttachment(result[0]).text).toContain(
      "Workspace path: attachments/abc-ai-edit-source.png",
    );
  });

  it("prefers the fallback preview URL when one is provided", async () => {
    const blob = new Blob(["mask"], { type: "image/png" });
    vi.mocked(resolveAttachmentPreviewUrl).mockResolvedValue("blob:stale-mask");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(blob, { status: 200 })),
    );
    uploadWorkspaceAttachment.mockResolvedValue({
      cwd: "/repo",
      file: {
        title: "ai-edit-selection-mask.png",
        mimeType: "image/png",
        path: "attachments/abc-ai-edit-selection-mask.png",
      },
    });

    await materializeWorkspaceFileAttachments({
      client: { materializeWorkspaceAttachments, uploadWorkspaceAttachment },
      agentId: "agent-1",
      files: [
        {
          ...attachment({ fileName: "ai-edit-selection-mask.png", mimeType: "image/png" }),
          fallbackPreviewUrl: "data:image/png;base64,bWFzaw==",
        },
      ],
    });

    expect(resolveAttachmentPreviewUrl).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("data:image/png;base64,bWFzaw==");
    expect(uploadWorkspaceAttachment).toHaveBeenCalledWith({
      agentId: "agent-1",
      fileName: "ai-edit-selection-mask.png",
      mimeType: "image/png",
      body: blob,
    });
    expect(releaseAttachmentPreviewUrl).not.toHaveBeenCalled();
  });
});

function textAttachment(
  attachment: AgentAttachment | undefined,
): Extract<AgentAttachment, { type: "text" }> {
  expect(attachment?.type).toBe("text");
  return attachment as Extract<AgentAttachment, { type: "text" }>;
}

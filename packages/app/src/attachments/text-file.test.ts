import { Buffer } from "buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttachmentMetadata } from "@/attachments/types";
import { encodeFilesAsTextAttachments, isTextFileAttachment } from "./text-file";

function attachment(input: Partial<AttachmentMetadata> = {}): AttachmentMetadata {
  return {
    id: "file-1",
    mimeType: "text/plain",
    storageType: "web-indexeddb",
    storageKey: "file-1",
    fileName: "notes.txt",
    byteSize: 12,
    createdAt: 1,
    ...input,
  };
}

describe("isTextFileAttachment", () => {
  it("accepts text mime types and known source file extensions", () => {
    expect(isTextFileAttachment(attachment({ mimeType: "text/markdown" }))).toBe(true);
    expect(
      isTextFileAttachment(
        attachment({ mimeType: "application/octet-stream", fileName: "component.tsx" }),
      ),
    ).toBe(true);
  });

  it("rejects unknown binary-looking files", () => {
    expect(
      isTextFileAttachment(
        attachment({ mimeType: "application/octet-stream", fileName: "archive.zip" }),
      ),
    ).toBe(false);
  });
});

describe("encodeFilesAsTextAttachments", () => {
  const encodeAttachments = vi.fn();

  beforeEach(() => {
    encodeAttachments.mockReset();
  });

  it("embeds readable text file contents", async () => {
    encodeAttachments.mockResolvedValue([
      { data: Buffer.from("# Notes", "utf8").toString("base64"), mimeType: "text/markdown" },
    ]);

    const result = await encodeFilesAsTextAttachments(
      [attachment({ mimeType: "text/markdown", fileName: "notes.md" })],
      encodeAttachments,
    );

    expect(result).toEqual([
      {
        type: "text",
        mimeType: "text/plain",
        title: "notes.md",
        text: "File: notes.md\n\n# Notes",
      },
    ]);
  });

  it("sends binary files as file attachments with their bytes", async () => {
    encodeAttachments.mockResolvedValue([
      { data: Buffer.from("binary-docx", "utf8").toString("base64"), mimeType: "application/zip" },
    ]);

    const result = await encodeFilesAsTextAttachments(
      [attachment({ mimeType: "application/zip", fileName: "archive.zip", byteSize: 2048 })],
      encodeAttachments,
    );

    expect(encodeAttachments).toHaveBeenCalledWith([
      attachment({ mimeType: "application/zip", fileName: "archive.zip", byteSize: 2048 }),
    ]);
    expect(result).toEqual([
      {
        type: "file",
        mimeType: "application/zip",
        title: "archive.zip",
        data: Buffer.from("binary-docx", "utf8").toString("base64"),
      },
    ]);
  });

  it("sends desktop binary files as source-path file attachments", async () => {
    const result = await encodeFilesAsTextAttachments(
      [
        attachment({
          mimeType: "application/pdf",
          storageType: "desktop-file",
          storageKey: "/Users/test/.paseo/attachments/report.pdf",
          fileName: "report.pdf",
          byteSize: 2048,
        }),
      ],
      encodeAttachments,
    );

    expect(encodeAttachments).not.toHaveBeenCalled();
    expect(result).toEqual([
      {
        type: "file",
        mimeType: "application/pdf",
        title: "report.pdf",
        sourcePath: "/Users/test/.paseo/attachments/report.pdf",
      },
    ]);
  });

  it("describes binary files when their bytes cannot be encoded", async () => {
    encodeAttachments.mockResolvedValue(undefined);

    const result = await encodeFilesAsTextAttachments(
      [attachment({ mimeType: "application/zip", fileName: "archive.zip", byteSize: 2048 })],
      encodeAttachments,
    );

    expect(result).toEqual([
      {
        type: "text",
        mimeType: "text/plain",
        title: "archive.zip",
        text: [
          "File: archive.zip",
          "",
          "MIME type: application/zip",
          "Attachment ID: file-1",
          "Storage type: web-indexeddb",
          "Size: 2048 bytes",
          "Content could not be encoded for this message.",
        ].join("\n"),
      },
    ]);
  });
});

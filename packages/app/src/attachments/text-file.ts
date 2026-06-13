import { Buffer } from "buffer";
import type { AgentAttachment } from "@getdoya/protocol/messages";
import type { AttachmentMetadata } from "@/attachments/types";

interface EncodedAttachment {
  data: string;
  mimeType: string;
}
type EncodeAttachments = (
  attachments: readonly AttachmentMetadata[] | undefined,
) => Promise<EncodedAttachment[] | undefined>;

const TEXT_MIME_TYPES = new Set([
  "application/javascript",
  "application/json",
  "application/sql",
  "application/typescript",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
]);

const TEXT_FILE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".env",
  ".go",
  ".h",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".log",
  ".lua",
  ".md",
  ".mjs",
  ".php",
  ".plist",
  ".properties",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".svelte",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
]);

export function isTextFileAttachment(metadata: AttachmentMetadata): boolean {
  const mimeType = metadata.mimeType.toLowerCase();
  if (mimeType.startsWith("text/") || TEXT_MIME_TYPES.has(mimeType)) {
    return true;
  }

  return TEXT_FILE_EXTENSIONS.has(getFileExtension(metadata.fileName));
}

function getFileExtension(fileName: string | null | undefined): string {
  if (!fileName) {
    return "";
  }
  const index = fileName.lastIndexOf(".");
  if (index <= 0 || index === fileName.length - 1) {
    return "";
  }
  return fileName.slice(index).toLowerCase();
}

export async function encodeFilesAsTextAttachments(
  files: readonly AttachmentMetadata[],
  encodeAttachments: EncodeAttachments = defaultEncodeAttachmentsForSend,
): Promise<AgentAttachment[]> {
  const attachments = await Promise.all(
    files.map(async (file) => {
      const title = file.fileName ?? "Attached file";
      if (isTextFileAttachment(file)) {
        const text = await readTextFileAttachment(file, encodeAttachments);
        return {
          type: "text",
          mimeType: "text/plain",
          title,
          text: [`File: ${title}`, "", text].join("\n"),
        } satisfies AgentAttachment;
      }

      if (canUseWorkspaceSourcePath(file)) {
        return {
          type: "file",
          mimeType: file.mimeType,
          title,
          sourcePath: file.storageKey,
        } satisfies AgentAttachment;
      }

      const encodedFiles = await encodeAttachments([file]);
      const encoded = encodedFiles?.[0];
      if (!encoded) {
        return {
          type: "text",
          mimeType: "text/plain",
          title,
          text: [`File: ${title}`, "", describeUnavailableFileAttachment(file)].join("\n"),
        } satisfies AgentAttachment;
      }
      return {
        type: "file",
        mimeType: encoded.mimeType,
        title,
        data: encoded.data,
      } satisfies AgentAttachment;
    }),
  );
  return attachments;
}

function canUseWorkspaceSourcePath(file: AttachmentMetadata): boolean {
  return file.storageType === "desktop-file" && file.storageKey.trim().length > 0;
}

async function defaultEncodeAttachmentsForSend(
  attachments: readonly AttachmentMetadata[] | undefined,
): Promise<EncodedAttachment[] | undefined> {
  const service = await import("@/attachments/service");
  return await service.encodeAttachmentsForSend(attachments);
}

async function readTextFileAttachment(
  file: AttachmentMetadata,
  encodeAttachments: EncodeAttachments,
): Promise<string> {
  const encodedFiles = await encodeAttachments([file]);
  const encoded = encodedFiles?.[0];
  if (!encoded) {
    throw new Error(`Failed to encode file attachment ${file.id}.`);
  }
  return Buffer.from(encoded.data, "base64").toString("utf8");
}

function describeUnavailableFileAttachment(file: AttachmentMetadata): string {
  const details = [
    `MIME type: ${file.mimeType}`,
    `Attachment ID: ${file.id}`,
    `Storage type: ${file.storageType}`,
  ];
  if (typeof file.byteSize === "number") {
    details.push(`Size: ${file.byteSize} bytes`);
  }
  details.push("Content could not be encoded for this message.");
  return details.join("\n");
}

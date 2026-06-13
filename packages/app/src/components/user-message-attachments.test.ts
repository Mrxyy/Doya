import { describe, expect, it } from "vitest";
import type { AgentAttachment } from "@getdoya/protocol/messages";
import type { AttachmentMetadata } from "@/attachments/types";
import type { UserMessageImageAttachment } from "@/types/stream";
import { filterUserMessageDisplayAttachments } from "./user-message-attachments";

function uploadedFileAttachment(input: {
  title: string;
  mimeType: string;
  path: string;
}): Extract<AgentAttachment, { type: "text" }> {
  return {
    type: "text",
    mimeType: "text/plain",
    title: input.title,
    text: [
      `Uploaded file: ${input.title}`,
      `MIME type: ${input.mimeType}`,
      `Workspace path: ${input.path}`,
      "Use the workspace path above when the user asks about this file.",
    ].join("\n"),
  };
}

describe("filterUserMessageDisplayAttachments", () => {
  it("hides prompt attachments that are already displayed as workspace images", () => {
    const image: UserMessageImageAttachment = {
      kind: "workspace_image",
      id: "img-1",
      path: "attachments/1-screenshot.png",
      mimeType: "image/png",
      fileName: "screenshot.png",
      createdAt: 1,
    };
    const imagePromptAttachment = uploadedFileAttachment({
      title: "screenshot.png",
      mimeType: "image/png",
      path: "attachments/1-screenshot.png",
    });
    const fileAttachment = uploadedFileAttachment({
      title: "notes.md",
      mimeType: "text/markdown",
      path: "attachments/2-notes.md",
    });

    expect(
      filterUserMessageDisplayAttachments({
        images: [image],
        attachments: [imagePromptAttachment, fileAttachment],
      }),
    ).toEqual([fileAttachment]);
  });

  it("keeps image files that were uploaded as file attachments", () => {
    const imageFileAttachment = uploadedFileAttachment({
      title: "screenshot.png",
      mimeType: "image/png",
      path: "attachments/1-screenshot.png",
    });

    expect(
      filterUserMessageDisplayAttachments({
        images: [],
        attachments: [imageFileAttachment],
      }),
    ).toEqual([imageFileAttachment]);
  });

  it("hides image attachments whenever an image is already displayed above", () => {
    const localImage: AttachmentMetadata = {
      id: "local-img",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "local-img",
      fileName: "screenshot.png",
      createdAt: 1,
    };
    const imageFileAttachment = uploadedFileAttachment({
      title: "different-generated-name.png",
      mimeType: "image/png",
      path: "attachments/different-generated-name.png",
    });

    expect(
      filterUserMessageDisplayAttachments({
        images: [localImage],
        attachments: [imageFileAttachment],
      }),
    ).toEqual([]);
  });

  it("hides duplicate image attachments when the prompt path is absolute", () => {
    const image: UserMessageImageAttachment = {
      kind: "workspace_image",
      id: "img-1",
      path: "attachments/2170b175-screenshot.png",
      mimeType: "image/png",
      fileName: "2170b175-screenshot.png",
      createdAt: 1,
    };
    const imagePromptAttachment = uploadedFileAttachment({
      title: "2170b175-screenshot.png",
      mimeType: "image/png",
      path: "/Users/me/.doya/accounts/workspaces/ws-1/projects/project-1/attachments/2170b175-screenshot.png",
    });

    expect(
      filterUserMessageDisplayAttachments({
        images: [image],
        attachments: [imagePromptAttachment],
      }),
    ).toEqual([]);
  });

  it("hides duplicate image file chips by title when the image is already shown", () => {
    const image: UserMessageImageAttachment = {
      kind: "workspace_image",
      id: "img-1",
      path: "attachments/2170b175-screenshot.png",
      mimeType: "image/png",
      fileName: "2170b175-screenshot.png",
      createdAt: 1,
    };
    const chipOnlyAttachment: AgentAttachment = {
      type: "file",
      mimeType: "image/png",
      title: "2170b175-screenshot.png",
    };

    expect(
      filterUserMessageDisplayAttachments({
        images: [image],
        attachments: [chipOnlyAttachment],
      }),
    ).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import type { AttachmentMetadata } from "@/attachments/types";
import type { StreamItem } from "@/types/stream";
import {
  AI_CREATION_PLACEHOLDER_ID,
  applyAiCreationMessageDisplayMetadata,
  extractAiCreationFinalPptxPath,
  extractAiCreationPptPreviewPath,
  normalizeAiCreationStream,
} from "./ai-creation";

function timestamp(seed: number): Date {
  return new Date(`2026-01-01T00:00:${seed.toString().padStart(2, "0")}.000Z`);
}

function userMessage(id: string, seed: number): Extract<StreamItem, { kind: "user_message" }> {
  return {
    kind: "user_message",
    id,
    text: id,
    timestamp: timestamp(seed),
  };
}

function assistantMessage(
  id: string,
  text: string,
  seed: number,
): Extract<StreamItem, { kind: "assistant_message" }> {
  return {
    kind: "assistant_message",
    id,
    text,
    timestamp: timestamp(seed),
  };
}

function toolCall(id: string, seed: number): Extract<StreamItem, { kind: "tool_call" }> {
  return {
    kind: "tool_call",
    id,
    timestamp: timestamp(seed),
    payload: {
      source: "orchestrator",
      data: {
        toolCallId: id,
        toolName: "Shell",
        arguments: "echo hi",
        result: null,
        status: "completed",
      },
    },
  };
}

function image(id: string, seed = 1): AttachmentMetadata {
  return {
    id,
    mimeType: "image/png",
    storageType: "web-indexeddb",
    storageKey: id,
    createdAt: timestamp(seed).getTime(),
  };
}

describe("normalizeAiCreationStream", () => {
  it("shows only the loading placeholder while the image agent is still running", () => {
    const result = normalizeAiCreationStream({
      agentStatus: "running",
      tail: [
        userMessage("u1", 1),
        assistantMessage("status", "I am generating an image.", 2),
        toolCall("shell-1", 3),
        assistantMessage("preview", "![](/tmp/generated/preview.png)", 4),
      ],
      head: [assistantMessage("saving", "Saving the image.", 5)],
    });

    expect(result.tail.map((item) => item.id)).toEqual(["u1"]);
    expect(result.head.map((item) => item.id)).toEqual([AI_CREATION_PLACEHOLDER_ID]);
  });

  it("shows only the final image after the image agent finishes", () => {
    const result = normalizeAiCreationStream({
      agentStatus: "idle",
      tail: [
        userMessage("u1", 1),
        assistantMessage("status", "I am generating an image.", 2),
        toolCall("shell-1", 3),
        assistantMessage("preview", "![](/tmp/generated/preview.png)", 4),
        toolCall("shell-2", 5),
        assistantMessage("final", "Done.\n\n![](/repo/assets/final.png)", 6),
      ],
      head: [],
    });

    expect(result.tail.map((item) => item.id)).toEqual(["u1", "final"]);
    expect(result.tail[1]).toMatchObject({
      kind: "assistant_message",
      text: "![](/repo/assets/final.png)",
    });
    expect(result.head).toEqual([]);
  });

  it("shows the final pptx result after the slides agent finishes", () => {
    const result = normalizeAiCreationStream({
      agentStatus: "idle",
      intent: "ppt_creation",
      tail: [
        userMessage("u1", 1),
        assistantMessage("status", "I am creating slides.", 2),
        toolCall("shell-1", 3),
        assistantMessage(
          "final",
          "projects/harvard-campus/exports/harvard-campus-introduction.pptx",
          4,
        ),
      ],
      head: [],
    });

    expect(result.tail.map((item) => item.id)).toEqual(["u1", "status", "shell-1", "final"]);
    expect(result.tail[3]).toMatchObject({
      kind: "assistant_message",
      text: "[projects/harvard-campus/exports/harvard-campus-introduction.pptx](projects/harvard-campus/exports/harvard-campus-introduction.pptx)",
    });
    expect(extractAiCreationFinalPptxPath(result.tail[3]?.text ?? "")).toBe(
      "projects/harvard-campus/exports/harvard-campus-introduction.pptx",
    );
  });

  it("preserves normal work progress while the slides agent is running", () => {
    const result = normalizeAiCreationStream({
      agentStatus: "running",
      intent: "ppt_creation",
      tail: [
        userMessage("u1", 1),
        assistantMessage("status", "Reading PPT Master skill.", 2),
        toolCall("shell-1", 3),
      ],
      head: [assistantMessage("progress", "Generating SVG page 1.", 4)],
    });

    expect(result.tail.map((item) => item.id)).toEqual(["u1", "status", "shell-1"]);
    expect(result.head.map((item) => item.id)).toEqual(["progress"]);
  });

  it("extracts the slides preview path while the slides agent is running", () => {
    expect(
      extractAiCreationPptPreviewPath(
        "Preview: `projects/seasonal_best_cities_ppt169_20260609/svg_output/`",
      ),
    ).toBe("projects/seasonal_best_cities_ppt169_20260609/svg_output/");
  });

  it("preserves each completed turn result while the latest turn is loading", () => {
    const result = normalizeAiCreationStream({
      agentStatus: "running",
      tail: [
        userMessage("u1", 1),
        toolCall("shell-1", 2),
        assistantMessage("final-1", "![](/repo/assets/first.png)", 3),
        userMessage("u2", 4),
        assistantMessage("status-2", "Editing image.", 5),
        assistantMessage("preview-2", "![](/tmp/generated/preview.png)", 6),
        assistantMessage("final-2", "![](/repo/assets/second.png)", 7),
        userMessage("u3", 8),
        assistantMessage("status-3", "Working on another edit.", 9),
      ],
      head: [toolCall("shell-3", 10), assistantMessage("preview-3", "![](/tmp/preview-3.png)", 11)],
    });

    expect(result.tail.map((item) => item.id)).toEqual(["u1", "final-1", "u2", "final-2", "u3"]);
    expect(result.tail[1]).toMatchObject({
      kind: "assistant_message",
      text: "![](/repo/assets/first.png)",
    });
    expect(result.tail[3]).toMatchObject({
      kind: "assistant_message",
      text: "![](/repo/assets/second.png)",
    });
    expect(result.head.map((item) => item.id)).toEqual([AI_CREATION_PLACEHOLDER_ID]);
  });

  it("restores persisted user message display metadata by message id", () => {
    const selectionImage = image("source-image");
    const referenceImage = image("reference-image", 2);
    const canonical = {
      ...userMessage("message-1", 1),
      text: "编辑图片：改成蓝色头发",
    };

    const result = applyAiCreationMessageDisplayMetadata(
      [canonical],
      [
        {
          messageId: "message-1",
          images: [selectionImage, referenceImage],
          selectionPreviewUri: "blob:http://localhost/source-image",
          selectionImageSource: "/tmp/source-image.png",
          selectionImage,
        },
      ],
    );

    expect(result[0]).toMatchObject({
      kind: "user_message",
      images: [referenceImage],
      selectionPreviewUri: "blob:http://localhost/source-image",
      selectionImageSource: "/tmp/source-image.png",
      selectionImage,
    });
  });

  it("restores display metadata by text when the provider rewrites the message id", () => {
    const selectionImage = image("source-image");
    const canonical = {
      ...userMessage("provider-owned-id", 1),
      text: "编辑图片： 将两个图片混合在一起",
    };

    const result = applyAiCreationMessageDisplayMetadata(
      [canonical],
      [
        {
          messageId: "client-message-id",
          text: "编辑图片：将两个图片混合在一起",
          images: [selectionImage],
          selectionImage,
          allowOrderFallback: false,
        },
      ],
    );

    expect(result[0]).toMatchObject({
      kind: "user_message",
      selectionImage,
    });
    expect(result[0]).not.toHaveProperty("images");
  });

  it("replaces the internal image edit prompt with display text by message id", () => {
    const canonical = {
      ...userMessage("message-1", 1),
      text: [
        "Use the Codex imagegen skill for this guided image edit.",
        "Edit the uploaded workspace source image with this instruction:",
        "改成蓝色眼睛",
        "Uploaded file: ai-edit-source.png",
      ].join("\n"),
    };

    const result = applyAiCreationMessageDisplayMetadata(
      [canonical],
      [
        {
          messageId: "message-1",
          text: "编辑图片：改成蓝色眼睛",
          allowOrderFallback: false,
        },
      ],
    );

    expect(result[0]).toMatchObject({
      kind: "user_message",
      text: "编辑图片：改成蓝色眼睛",
    });
  });

  it("replaces the internal image edit prompt by order when the provider rewrites the message id", () => {
    const canonical = {
      ...userMessage("provider-owned-id", 1),
      text: [
        "Use the Codex imagegen skill for this guided image edit.",
        "Edit the uploaded workspace source image with this instruction:",
        "改成蓝色眼睛",
        "Uploaded file: ai-edit-source.png",
      ].join("\n"),
    };

    const result = applyAiCreationMessageDisplayMetadata(
      [canonical],
      [
        {
          messageId: "client-message-id",
          text: "编辑图片：改成蓝色眼睛",
        },
      ],
    );

    expect(result[0]).toMatchObject({
      kind: "user_message",
      text: "编辑图片：改成蓝色眼睛",
    });
  });

  it("does not use cross-agent text metadata as an order fallback", () => {
    const selectionImage = image("source-image");
    const canonical = userMessage("provider-owned-id", 1);

    const result = applyAiCreationMessageDisplayMetadata(
      [canonical],
      [
        {
          agentId: "other-agent",
          messageId: "client-message-id",
          text: "编辑图片：改成黄色头发",
          selectionImage,
          allowOrderFallback: false,
        },
      ],
    );

    expect(result[0]).not.toHaveProperty("selectionImage");
  });

  it("does not restore selection metadata onto image generation messages", () => {
    const selectionImage = image("source-image");
    const canonical = {
      ...userMessage("provider-owned-id", 1),
      text: "生成图片：创建一个蓝眼睛卡通美女",
    };

    const result = applyAiCreationMessageDisplayMetadata(
      [canonical],
      [
        {
          messageId: "client-message-id",
          selectionImage,
        },
      ],
    );

    expect(result[0]).not.toHaveProperty("selectionImage");
  });

  it("uses same-agent text metadata as an order fallback only for edit messages", () => {
    const selectionImage = image("source-image");
    const canonical = {
      ...userMessage("provider-owned-id", 1),
      text: "编辑图片：改成黄色头发",
    };

    const result = applyAiCreationMessageDisplayMetadata(
      [canonical],
      [
        {
          agentId: "same-agent",
          messageId: "client-message-id",
          text: "编辑图片：不同文案",
          selectionImage,
        },
      ],
    );

    expect(result[0]).toMatchObject({
      selectionImage,
    });
  });

  it("restores display metadata by order when refreshed canonical text differs", () => {
    const selectionImage = image("source-image");
    const canonical = {
      ...userMessage("provider-owned-id", 1),
      text: "编辑图片：Provider rewritten prompt with image editing instructions.",
    };

    const result = applyAiCreationMessageDisplayMetadata(
      [canonical],
      [
        {
          messageId: "client-message-id",
          text: "编辑图片：改成红白头发",
          selectionImage,
        },
      ],
    );

    expect(result[0]).toMatchObject({
      kind: "user_message",
      selectionImage,
    });
  });

  it("restores display metadata when refreshed canonical text contains the display text", () => {
    const selectionImage = image("source-image");
    const canonical = {
      ...userMessage("provider-owned-id", 1),
      text: "编辑图片：改成黄色头发\n\nExtra canonical provider context.",
    };

    const result = applyAiCreationMessageDisplayMetadata(
      [canonical],
      [
        {
          agentId: "other-agent",
          messageId: "client-message-id",
          text: "编辑图片：改成黄色头发",
          selectionImage,
          allowOrderFallback: false,
        },
      ],
    );

    expect(result[0]).toMatchObject({
      selectionImage,
    });
  });

  it("restores legacy display metadata without text to the next bare user message", () => {
    const selectionImage = image("legacy-source-image");
    const canonical = {
      ...userMessage("provider-owned-id", 1),
      text: "编辑图片：改成蓝色头发",
    };

    const result = applyAiCreationMessageDisplayMetadata(
      [canonical],
      [
        {
          messageId: "client-message-id",
          images: [selectionImage],
          selectionImage,
        },
      ],
    );

    expect(result[0]).toMatchObject({
      kind: "user_message",
      selectionImage,
    });
    expect(result[0]).not.toHaveProperty("images");
  });
});

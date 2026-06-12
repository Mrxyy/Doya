import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { parsePaseoMessageRenderParts } from "@/utils/paseo-message-markup";
import {
  AI_CREATION_PLACEHOLDER_ID,
  extractDocumentAnnotationResultDisplay,
  extractAiCreationFinalDocumentPath,
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

function handshakeUserMessage(
  id: string,
  seed: number,
  input: { kind: string; goal: string; text: string; prompt?: string },
): Extract<StreamItem, { kind: "user_message" }> {
  return {
    ...userMessage(id, seed),
    text: [
      input.prompt ?? id,
      `<paseo-expected-target version="1" kind="${input.kind}" goal="${input.goal}" id="${id}" text="${input.text}" desc="Expected task handshake." />`,
    ].join("\n\n"),
  };
}

function aiCreationCardUserMessage(
  id: string,
  seed: number,
  input: { kind: string; title: string; summary?: string },
): Extract<StreamItem, { kind: "user_message" }> {
  return {
    ...userMessage(id, seed),
    text: `<paseo-ui version="1" kind="${input.kind}" render="card" visibility="summary" id="${id}" desc="AI creation card.">
  <paseo-ui-content desc="User-visible card content.">
    <paseo-title desc="Title shown in the user message card.">${input.title}</paseo-title>
    <paseo-summary desc="Short user-visible summary.">${input.summary ?? "Create it"}</paseo-summary>
  </paseo-ui-content>
  <paseo-ai desc="Task instructions.">Create it.</paseo-ai>
</paseo-ui>`,
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

function targetMessage(
  id: string,
  seed: number,
  input: { kind: string; goal: string; targetId: string; text: string },
): Extract<StreamItem, { kind: "assistant_message" }> {
  return assistantMessage(
    id,
    `<paseo-target version="1" kind="${input.kind}" goal="${input.goal}" id="${input.targetId}" desc="Active response target.">${input.text}</paseo-target>`,
    seed,
  );
}

function pptProgressMessage(
  id: string,
  seed: number,
  input: { title: string; summary: string; previewPath?: string },
): Extract<StreamItem, { kind: "assistant_message" }> {
  const previewField = input.previewPath
    ? `<paseo-field name="preview_path" label="预览" desc="Live PPT preview path.">${input.previewPath}</paseo-field>`
    : "";
  return assistantMessage(
    id,
    `<paseo-ui version="1" kind="ai_creation.slides.progress" render="status" visibility="summary" desc="Human-visible PPT creation progress.">
  <paseo-ui-content desc="Visible progress content.">
    <paseo-title desc="Progress title.">${input.title}</paseo-title>
    <paseo-summary desc="Progress summary.">${input.summary}</paseo-summary>
    ${previewField}
  </paseo-ui-content>
</paseo-ui>`,
    seed,
  );
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

function streamItemText(item: StreamItem | undefined): string {
  return item?.kind === "assistant_message" || item?.kind === "user_message" ? item.text : "";
}

describe("normalizeAiCreationStream", () => {
  it("shows only the loading placeholder while the image agent is still running", () => {
    const result = normalizeAiCreationStream({
      agentStatus: "running",
      tail: [
        handshakeUserMessage("u1", 1, {
          kind: "ai_creation.image.generate",
          goal: "generate_image",
          text: "生成图片",
        }),
        targetMessage("target", 2, {
          kind: "ai_creation.image.generate",
          goal: "generate_image",
          targetId: "u1",
          text: "生成图片",
        }),
        assistantMessage("status", "I am generating an image.", 3),
        toolCall("shell-1", 3),
        assistantMessage("preview", "![](/tmp/generated/preview.png)", 4),
      ],
      head: [assistantMessage("saving", "Saving the image.", 5)],
    });

    expect(result.tail.map((item) => item.id)).toEqual(["u1"]);
    expect(result.head.map((item) => item.id)).toEqual([AI_CREATION_PLACEHOLDER_ID]);
    expect(streamItemText(result.head[0])).toBe("生成图片");
  });

  it("shows only the final image after the image agent finishes", () => {
    const result = normalizeAiCreationStream({
      agentStatus: "idle",
      tail: [
        handshakeUserMessage("u1", 1, {
          kind: "ai_creation.image.generate",
          goal: "generate_image",
          text: "生成图片",
        }),
        targetMessage("target", 2, {
          kind: "ai_creation.image.generate",
          goal: "generate_image",
          targetId: "u1",
          text: "生成图片",
        }),
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
      tail: [
        handshakeUserMessage("u1", 1, {
          kind: "ai_creation.slides.create",
          goal: "create_pptx",
          text: "创建 PPT",
        }),
        targetMessage("target", 2, {
          kind: "ai_creation.slides.create",
          goal: "create_pptx",
          targetId: "u1",
          text: "创建 PPT",
        }),
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

    expect(result.tail.map((item) => item.id)).toEqual(["u1", "final"]);
    expect(result.tail[1]).toMatchObject({
      kind: "assistant_message",
      text: "[projects/harvard-campus/exports/harvard-campus-introduction.pptx](projects/harvard-campus/exports/harvard-campus-introduction.pptx)",
    });
    expect(extractAiCreationFinalPptxPath(streamItemText(result.tail[1]))).toBe(
      "projects/harvard-campus/exports/harvard-campus-introduction.pptx",
    );
  });

  it("preserves normal work progress without a matched handshake", () => {
    const result = normalizeAiCreationStream({
      agentStatus: "running",
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

  it("hides slides creation internals without requiring a target handshake", () => {
    const result = normalizeAiCreationStream({
      agentStatus: "running",
      tail: [
        aiCreationCardUserMessage("u1", 1, {
          kind: "ai_creation.slides.create",
          title: "创建 PPT",
        }),
        assistantMessage("status-1", "我会读取 PPT Master 技能并准备依赖。", 2),
        toolCall("shell-1", 3),
        pptProgressMessage("preview", 4, {
          title: "Preview ready",
          summary: "The live preview is ready. Slides will appear as they are created.",
          previewPath: "projects/seasonal_best_cities_ppt169_20260609/svg_output/",
        }),
        assistantMessage("status-2", "我会开始写入项目文件。", 5),
        toolCall("shell-2", 6),
        assistantMessage("legacy-slide-internal", "Slide saved: slide_01.svg", 7),
        pptProgressMessage("slide-1", 8, {
          title: "Slide 1 ready",
          summary: "Cover is ready in the live preview.",
        }),
        pptProgressMessage("slide-2", 9, {
          title: "Slide 2 ready",
          summary: "Market Timing is ready in the live preview.",
        }),
      ],
      head: [],
    });

    expect(result.tail.map((item) => item.id)).toEqual(["u1", "preview", "slide-1", "slide-2"]);
    expect(result.head).toEqual([]);
    expect(extractAiCreationPptPreviewPath(streamItemText(result.tail[1]))).toBe(
      "projects/seasonal_best_cities_ppt169_20260609/svg_output/",
    );
    expect(parsePaseoMessageRenderParts(streamItemText(result.tail[2]))).toMatchObject([
      { kind: "card", card: { kind: "ai_creation.slides.progress", title: "Slide 1 ready" } },
    ]);
    expect(parsePaseoMessageRenderParts(streamItemText(result.tail[3]))).toMatchObject([
      { kind: "card", card: { kind: "ai_creation.slides.progress", title: "Slide 2 ready" } },
    ]);
  });

  it("shows the final slides result without requiring a target handshake", () => {
    const result = normalizeAiCreationStream({
      agentStatus: "idle",
      tail: [
        aiCreationCardUserMessage("u1", 1, {
          kind: "ai_creation.slides.create",
          title: "创建 PPT",
        }),
        assistantMessage("status", "我会读取 PPT Master 技能。", 2),
        toolCall("shell-1", 3),
        pptProgressMessage("preview", 4, {
          title: "Preview ready",
          summary: "The live preview is ready.",
          previewPath: "projects/seasonal_best_cities/svg_output/",
        }),
        pptProgressMessage("slide-1", 5, {
          title: "Slide 1 ready",
          summary: "Cover is ready in the live preview.",
        }),
        assistantMessage(
          "final",
          "projects/seasonal_best_cities/exports/seasonal-best-cities.pptx",
          6,
        ),
      ],
      head: [],
    });

    expect(result.tail.map((item) => item.id)).toEqual(["u1", "preview", "slide-1", "final"]);
    expect(result.tail[3]).toMatchObject({
      kind: "assistant_message",
      text: "[projects/seasonal_best_cities/exports/seasonal-best-cities.pptx](projects/seasonal_best_cities/exports/seasonal-best-cities.pptx)",
    });
  });

  it("preserves normal progress when the user message has no expected handshake", () => {
    const result = normalizeAiCreationStream({
      agentStatus: "running",
      tail: [
        { ...userMessage("provider-owned-id", 1), text: "生成一份含公式和图表的餐厅季度预算表" },
        assistantMessage(
          "target",
          'prefix <paseo-target version="1" kind="ai_creation.spreadsheet.create" goal="create_spreadsheet" id="client-message-id">创建表格</paseo-target>',
          2,
        ),
        assistantMessage("status", "我将生成真实的 XLSX 文件。", 3),
        toolCall("shell-1", 4),
      ],
      head: [],
    });

    expect(result.tail.map((item) => item.id)).toEqual([
      "provider-owned-id",
      "target",
      "status",
      "shell-1",
    ]);
    expect(result.head).toEqual([]);
  });

  it("shows the placeholder after a matched handshake even before a final result is found", () => {
    const result = normalizeAiCreationStream({
      agentStatus: "idle",
      tail: [
        handshakeUserMessage("u1", 1, {
          kind: "ai_creation.spreadsheet.create",
          goal: "create_spreadsheet",
          text: "创建表格",
        }),
        targetMessage("target", 2, {
          kind: "ai_creation.spreadsheet.create",
          goal: "create_spreadsheet",
          targetId: "u1",
          text: "创建表格",
        }),
        assistantMessage("status", "我正在创建 XLSX。", 3),
        toolCall("shell-1", 4),
      ],
      head: [],
    });

    expect(result.tail.map((item) => item.id)).toEqual(["u1"]);
    expect(result.head.map((item) => item.id)).toEqual([AI_CREATION_PLACEHOLDER_ID]);
    expect(streamItemText(result.head[0])).toBe("创建表格");
  });

  it("shows the placeholder when the live stream emits an empty assistant item before the target", () => {
    const result = normalizeAiCreationStream({
      agentStatus: "running",
      tail: [
        handshakeUserMessage("u1", 1, {
          kind: "ai_creation.spreadsheet.create",
          goal: "create_spreadsheet",
          text: "创建表格",
        }),
        assistantMessage("empty-assistant", "   ", 2),
      ],
      head: [
        targetMessage("target", 3, {
          kind: "ai_creation.spreadsheet.create",
          goal: "create_spreadsheet",
          targetId: "u1",
          text: "创建表格",
        }),
        assistantMessage("status", "我会创建一个 XLSX 文件。", 4),
      ],
    });

    expect(result.tail.map((item) => item.id)).toEqual(["u1"]);
    expect(result.head.map((item) => item.id)).toEqual([AI_CREATION_PLACEHOLDER_ID]);
    expect(streamItemText(result.head[0])).toBe("创建表格");
  });

  it("shows the placeholder when live target and progress arrive in different stream segments", () => {
    const result = normalizeAiCreationStream({
      agentStatus: "running",
      tail: [
        handshakeUserMessage("u1", 1, {
          kind: "ai_creation.spreadsheet.create",
          goal: "create_spreadsheet",
          text: "创建表格",
        }),
        assistantMessage("status", "我将生成一个包含预算明细的 XLSX 文件。", 3),
        toolCall("shell-1", 4),
      ],
      head: [
        targetMessage("target", 2, {
          kind: "ai_creation.spreadsheet.create",
          goal: "create_spreadsheet",
          targetId: "u1",
          text: "创建表格",
        }),
      ],
    });

    expect(result.tail.map((item) => item.id)).toEqual(["u1"]);
    expect(result.head.map((item) => item.id)).toEqual([AI_CREATION_PLACEHOLDER_ID]);
    expect(streamItemText(result.head[0])).toBe("创建表格");
  });

  it("shows the placeholder while the opening target tag is still streaming", () => {
    const result = normalizeAiCreationStream({
      agentStatus: "running",
      tail: [
        handshakeUserMessage("u1", 1, {
          kind: "ai_creation.spreadsheet.create",
          goal: "create_spreadsheet",
          text: "创建表格",
        }),
      ],
      head: [
        assistantMessage(
          "partial-target",
          '<paseo-target version="1" kind="ai_creation.spreadsheet.create" goal="create_spreadsheet" id="u1">创建表格</',
          2,
        ),
      ],
    });

    expect(result.tail.map((item) => item.id)).toEqual(["u1"]);
    expect(result.head.map((item) => item.id)).toEqual([AI_CREATION_PLACEHOLDER_ID]);
    expect(streamItemText(result.head[0])).toBe("创建表格");
  });

  it("shows the placeholder before the streaming target attributes are complete", () => {
    const result = normalizeAiCreationStream({
      agentStatus: "running",
      tail: [
        handshakeUserMessage("u1", 1, {
          kind: "ai_creation.spreadsheet.create",
          goal: "create_spreadsheet",
          text: "创建表格",
        }),
      ],
      head: [assistantMessage("partial-target", '<paseo-target version="1" kind=', 2)],
    });

    expect(result.tail.map((item) => item.id)).toEqual(["u1"]);
    expect(result.head.map((item) => item.id)).toEqual([AI_CREATION_PLACEHOLDER_ID]);
    expect(streamItemText(result.head[0])).toBe("创建表格");
  });

  it("shows the final document result after a document agent finishes", () => {
    const result = normalizeAiCreationStream({
      agentStatus: "idle",
      tail: [
        handshakeUserMessage("u1", 1, {
          kind: "ai_creation.document.pdf.create",
          goal: "create_pdf",
          text: "创建 PDF",
        }),
        targetMessage("target", 2, {
          kind: "ai_creation.document.pdf.create",
          goal: "create_pdf",
          targetId: "u1",
          text: "创建 PDF",
        }),
        assistantMessage("status", "正在生成 PDF。", 2),
        toolCall("shell-1", 3),
        assistantMessage("final", "Done: output/documents/product-plan.pdf", 4),
      ],
      head: [],
    });

    expect(result.tail.map((item) => item.id)).toEqual(["u1", "final"]);
    expect(result.tail[1]).toMatchObject({
      kind: "assistant_message",
      text: "[output/documents/product-plan.pdf](output/documents/product-plan.pdf)",
    });
    expect(extractAiCreationFinalDocumentPath(streamItemText(result.tail[1]))).toBe(
      "output/documents/product-plan.pdf",
    );
  });

  it("shows the updated document result after applying preview annotations", () => {
    const result = normalizeAiCreationStream({
      agentStatus: "idle",
      tail: [
        handshakeUserMessage("u1", 1, {
          kind: "document.apply_annotations",
          goal: "modify_spreadsheet",
          text: "修改文件",
        }),
        targetMessage("target", 2, {
          kind: "document.apply_annotations",
          goal: "modify_spreadsheet",
          targetId: "u1",
          text: "修改文件",
        }),
        assistantMessage("status", "正在根据标注修改表格。", 3),
        toolCall("shell-1", 4),
        assistantMessage("final", "已更新：output/spreadsheets/restaurant_budget_updated.xlsx", 5),
      ],
      head: [],
    });

    expect(result.tail.map((item) => item.id)).toEqual(["u1", "final"]);
    expect(result.tail[1]).toMatchObject({
      kind: "assistant_message",
      text: "[output/spreadsheets/restaurant_budget_updated.xlsx](output/spreadsheets/restaurant_budget_updated.xlsx)",
    });
    expect(extractAiCreationFinalDocumentPath(streamItemText(result.tail[1]))).toBe(
      "output/spreadsheets/restaurant_budget_updated.xlsx",
    );
  });

  it("extracts legacy Excel xls result paths after applying preview annotations", () => {
    const result = normalizeAiCreationStream({
      agentStatus: "idle",
      tail: [
        handshakeUserMessage("u1", 1, {
          kind: "document.apply_annotations",
          goal: "modify_spreadsheet",
          text: "修改文件",
        }),
        targetMessage("target", 2, {
          kind: "document.apply_annotations",
          goal: "modify_spreadsheet",
          targetId: "u1",
          text: "修改文件",
        }),
        assistantMessage("final", "已更新：output/spreadsheets/restaurant_budget_updated.xls", 3),
      ],
      head: [],
    });

    expect(result.tail.map((item) => item.id)).toEqual(["u1", "final"]);
    expect(result.tail[1]).toMatchObject({
      kind: "assistant_message",
      text: "[output/spreadsheets/restaurant_budget_updated.xls](output/spreadsheets/restaurant_budget_updated.xls)",
    });
    expect(extractAiCreationFinalDocumentPath(streamItemText(result.tail[1]))).toBe(
      "output/spreadsheets/restaurant_budget_updated.xls",
    );
  });

  it("preserves document annotation result cards instead of flattening them to links", () => {
    const resultCard = `<paseo-ui
  version="1"
  kind="document.apply_annotations.result"
  render="result-card"
  visibility="summary"
  id="u1"
>
  <paseo-ui-content>
    <paseo-title>文件标注已应用</paseo-title>
    <paseo-summary>已按标注更新预算表。</paseo-summary>
    <paseo-field name="updated_file" label="文件">output/spreadsheets/restaurant_budget_updated.xlsx</paseo-field>
  </paseo-ui-content>
</paseo-ui>`;

    const result = normalizeAiCreationStream({
      agentStatus: "idle",
      tail: [
        handshakeUserMessage("u1", 1, {
          kind: "document.apply_annotations",
          goal: "modify_spreadsheet",
          text: "修改文件",
        }),
        targetMessage("target", 2, {
          kind: "document.apply_annotations",
          goal: "modify_spreadsheet",
          targetId: "u1",
          text: "修改文件",
        }),
        assistantMessage("status", "正在根据标注修改表格。", 3),
        toolCall("shell-1", 4),
        assistantMessage("final", resultCard, 5),
      ],
      head: [],
    });

    expect(result.tail.map((item) => item.id)).toEqual(["u1", "final"]);
    expect(streamItemText(result.tail[1])).toBe(resultCard);
    expect(parsePaseoMessageRenderParts(streamItemText(result.tail[1]))).toMatchObject([
      {
        kind: "card",
        card: {
          kind: "document.apply_annotations.result",
          title: "文件标注已应用",
          fields: [
            { name: "updated_file", value: "output/spreadsheets/restaurant_budget_updated.xlsx" },
          ],
        },
      },
    ]);
    expect(extractAiCreationFinalDocumentPath(streamItemText(result.tail[1]))).toBe(
      "output/spreadsheets/restaurant_budget_updated.xlsx",
    );
    expect(extractDocumentAnnotationResultDisplay(streamItemText(result.tail[1]))).toEqual({
      path: "output/spreadsheets/restaurant_budget_updated.xlsx",
      summary: "已按标注更新预算表。",
      title: "文件标注已应用",
    });
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
        handshakeUserMessage("u1", 1, {
          kind: "ai_creation.image.generate",
          goal: "generate_image",
          text: "生成图片",
        }),
        targetMessage("target-1", 2, {
          kind: "ai_creation.image.generate",
          goal: "generate_image",
          targetId: "u1",
          text: "生成图片",
        }),
        toolCall("shell-1", 2),
        assistantMessage("final-1", "![](/repo/assets/first.png)", 3),
        handshakeUserMessage("u2", 4, {
          kind: "ai_creation.image.edit",
          goal: "edit_image",
          text: "编辑图片",
        }),
        targetMessage("target-2", 5, {
          kind: "ai_creation.image.edit",
          goal: "edit_image",
          targetId: "u2",
          text: "编辑图片",
        }),
        assistantMessage("status-2", "Editing image.", 5),
        assistantMessage("preview-2", "![](/tmp/generated/preview.png)", 6),
        assistantMessage("final-2", "![](/repo/assets/second.png)", 7),
        handshakeUserMessage("u3", 8, {
          kind: "ai_creation.image.edit",
          goal: "edit_image",
          text: "编辑图片",
        }),
        targetMessage("target-3", 9, {
          kind: "ai_creation.image.edit",
          goal: "edit_image",
          targetId: "u3",
          text: "编辑图片",
        }),
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
});

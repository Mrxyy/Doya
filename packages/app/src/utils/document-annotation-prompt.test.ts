import { describe, expect, it } from "vitest";
import {
  buildApplyDocumentAnnotationsPrompt,
  getDocumentAnnotationGoal,
  isDocumentAnnotationKind,
} from "./document-annotation-prompt";
import {
  getDoyaMessageVisibleText,
  parseDoyaExpectedTargets,
  parseDoyaMessageCard,
} from "./doya-message-markup";

describe("document annotation prompt", () => {
  it("builds a spreadsheet annotation prompt with cell locator data", () => {
    const prompt = buildApplyDocumentAnnotationsPrompt({
      messageId: "msg_1",
      filePath: "output/budget.xlsx",
      kind: "xlsx",
      defaultLocale: "zh",
      annotations: [
        {
          target: {
            kind: "xlsx",
            label: "Summary!B4",
            locator: {
              type: "cell",
              sheet: "Summary",
              cell: "B4",
              row: 4,
              column: 2,
            },
            context: "$120,000",
          },
          instruction: "把预算改成 15 万，并保持公式联动",
        },
      ],
    });

    expect(parseDoyaExpectedTargets(prompt)).toEqual([
      {
        kind: "document.apply_annotations",
        goal: "modify_spreadsheet",
        id: "msg_1",
        text: "修改文件",
      },
    ]);
    expect(parseDoyaMessageCard(prompt)).toMatchObject({
      kind: "document.apply_annotations",
      title: "应用文件标注",
      fields: [
        { name: "file", label: "文件", value: "output/budget.xlsx" },
        { name: "annotation_count", label: "标注数", value: "1" },
      ],
    });
    expect(prompt).toContain('"sheet": "Summary"');
    expect(prompt).toContain('"cell": "B4"');
    expect(prompt).toContain("把预算改成 15 万，并保持公式联动");
    expect(prompt).toContain('kind="document.apply_annotations.result"');
    expect(prompt).toContain('id="msg_1"');
    expect(prompt).toContain('<doya-field name="updated_file" label="文件"');
    expect(prompt).toContain("Save the applied changes back to the exact file path above");
    expect(prompt).toContain("required for the currently open Doya preview to hot refresh");
    expect(prompt).toContain(
      "For in-place edits, updated_file must be the original file path above.",
    );
    expect(prompt).toContain("sheet + cell address identify the target");
    expect(prompt).toContain("Preserve formulas unless the annotation explicitly asks");
    expect(getDoyaMessageVisibleText(prompt).trim()).toBe(
      "请根据当前文件预览中保存的标注修改文件，并尽量保存回当前文件路径以便预览自动刷新。",
    );
  });

  it("includes PDF builtin annotation metadata", () => {
    const prompt = buildApplyDocumentAnnotationsPrompt({
      messageId: "msg_pdf",
      filePath: "brief.pdf",
      kind: "pdf",
      defaultLocale: "zh",
      annotations: [
        {
          target: {
            kind: "pdf",
            label: "PDF 第 2 页内置标注",
            locator: {
              type: "builtin_annotation",
              coordinateSpace: "pdf_page_normalized",
              annotationId: "anno-1",
              annotationType: "highlight",
              pageNumber: 2,
              x: 0.25,
              y: 0.5,
              rectPdf: '{"origin":{"x":100,"y":200},"size":{"width":120,"height":40}}',
              color: "#ff0000",
            },
            context: "contents=这里增加一条风险提示; color=#ff0000",
          },
          instruction: "这里增加一条风险提示",
        },
      ],
    });

    expect(getDocumentAnnotationGoal("pdf")).toBe("modify_pdf");
    expect(prompt).toContain('"type": "builtin_annotation"');
    expect(prompt).toContain('"annotationId": "anno-1"');
    expect(prompt).toContain('"annotationType": "highlight"');
    expect(prompt).toContain('"pageNumber": 2');
    expect(prompt).toContain('"rectPdf"');
    expect(prompt).toContain('Use locator.type="builtin_annotation" as the authoritative target');
    expect(prompt).toContain("Never export only the annotation, shape, or overlay layer");
    expect(prompt).toContain("If only the PDF is available");
  });

  it("includes DOCX-specific guidance for context and style preservation", () => {
    const prompt = buildApplyDocumentAnnotationsPrompt({
      messageId: "msg_docx",
      filePath: "prd.docx",
      kind: "docx",
      defaultLocale: "zh",
      annotations: [
        {
          target: {
            kind: "docx",
            label: "p: Old title",
            locator: {
              type: "element",
              pageNumber: 1,
              path: "section:nth-of-type(1) > p:nth-of-type(1)",
            },
            context: "Old title",
          },
          instruction: "改成新标题",
        },
      ],
    });

    expect(getDocumentAnnotationGoal("docx")).toBe("modify_docx");
    expect(prompt).toContain("Use selected text and nearby context as the primary anchor");
    expect(prompt).toContain("preserving surrounding styles");
    expect(prompt).toContain('"path": "section:nth-of-type(1) &gt; p:nth-of-type(1)"');
  });

  it("preserves legacy Excel xls file paths while using spreadsheet goals", () => {
    const prompt = buildApplyDocumentAnnotationsPrompt({
      messageId: "msg_xls",
      filePath: "output/legacy-budget.xls",
      kind: "xlsx",
      defaultLocale: "zh",
      annotations: [
        {
          target: {
            kind: "xlsx",
            label: "Sheet1!A1",
            locator: {
              type: "cell",
              sheet: "Sheet1",
              cell: "A1",
              row: 1,
              column: 1,
            },
            context: "Budget",
          },
          instruction: "标题改成中文",
        },
      ],
    });

    expect(parseDoyaExpectedTargets(prompt)[0]).toMatchObject({
      kind: "document.apply_annotations",
      goal: "modify_spreadsheet",
      text: "修改文件",
    });
    expect(prompt).toContain("output/legacy-budget.xls");
    expect(prompt).toContain('"cell": "A1"');
  });

  it("limits document preview annotations to implemented preview kinds", () => {
    expect(isDocumentAnnotationKind("docx")).toBe(true);
    expect(isDocumentAnnotationKind("pdf")).toBe(true);
    expect(isDocumentAnnotationKind("xlsx")).toBe(true);
    expect(isDocumentAnnotationKind("csv")).toBe(true);
    expect(isDocumentAnnotationKind("pptx")).toBe(false);
  });
});

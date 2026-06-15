import type { DocumentAnnotationTarget, DocumentViewerKind } from "@/components/document-viewer";
import type { Locale } from "@/i18n/i18n";
import {
  buildDoyaMessageMeta,
  buildDoyaResponseLanguageInstruction,
  escapeDoyaMarkupContent,
  escapeDoyaMarkupText,
} from "@/utils/doya-message-markup";

export interface DocumentAnnotationPromptAnnotation {
  target: DocumentAnnotationTarget;
  instruction: string;
}

export function buildApplyDocumentAnnotationsPrompt(input: {
  messageId: string;
  filePath: string;
  kind: DocumentViewerKind;
  annotations: DocumentAnnotationPromptAnnotation[];
  defaultLocale: Locale;
}): string {
  const escapedMessageId = escapeDoyaMarkupText(input.messageId);
  const escapedFilePath = escapeDoyaMarkupContent(input.filePath);
  const kindLabel = getDocumentKindLabel(input.kind);
  const goal = getDocumentAnnotationGoal(input.kind);
  const kindInstructions = getDocumentKindInstructions(input.kind);
  const languageInstruction = buildDoyaResponseLanguageInstruction({
    defaultLocale: input.defaultLocale,
    userText: input.annotations.map((annotation) => annotation.instruction).join("\n"),
  });
  const annotationsJson = JSON.stringify(
    input.annotations.map((annotation, index) => ({
      index: index + 1,
      target: annotation.target,
      instruction: annotation.instruction,
    })),
    null,
    2,
  );
  return `${buildDoyaMessageMeta()}

请根据当前文件预览中保存的标注修改文件，并尽量保存回当前文件路径以便预览自动刷新。

<doya-expected-target
  version="1"
  kind="document.apply_annotations"
  goal="${goal}"
  id="${escapedMessageId}"
  text="修改文件"
  desc="Exact target handshake that the assistant must emit before doing any work."
/>

<doya-ui
  version="1"
  kind="document.apply_annotations"
  render="card"
  visibility="summary"
  id="${escapedMessageId}"
  desc="A Doya-renderable task card for applying saved document preview annotations."
>
  <doya-ui-content desc="User-visible card content. Doya may render this instead of the full prompt.">
    <doya-title desc="Title shown in the user message card.">应用文件标注</doya-title>
    <doya-summary desc="Short user-visible summary of this task.">根据预览中保存的标注修改 ${escapeDoyaMarkupContent(kindLabel)}</doya-summary>
    <doya-field name="file" label="文件" desc="Workspace-relative file path.">${escapedFilePath}</doya-field>
    <doya-field name="annotation_count" label="标注数" desc="Number of saved preview annotations.">${input.annotations.length}</doya-field>
  </doya-ui-content>

  <doya-ai desc="Task instructions the AI must follow. Doya may hide this section from the chat UI.">
${escapeDoyaMarkupText(languageInstruction)}

Apply the saved document preview annotations to this workspace file:
${escapedFilePath}

File kind: ${escapeDoyaMarkupContent(input.kind)}

The annotations below describe what the user marked in the preview and how they want it changed.
Use locator data to find the corresponding content. Treat locator coordinates as preview hints; prefer stable semantic anchors such as sheet/cell, selected text, page number, DOM path, and context text when available.

Annotations JSON:
${escapeDoyaMarkupContent(annotationsJson)}

Requirements:
1. Save the applied changes back to the exact file path above whenever safely possible. This is required for the currently open Doya preview to hot refresh.
2. Do not create a new file merely for convenience. Only create a clearly named updated file in the same workspace if in-place editing is not practical for this format or would risk corrupting the original.
3. If you create a new file, explain that in the result summary and put the new workspace-relative path in updated_file.
4. Preserve unrelated content, formatting, formulas, charts, images, and page structure unless an annotation asks otherwise.
5. For spreadsheets, use the sheet name and cell address as the primary target.
6. For DOCX, use selected text/context and page/path hints to locate the paragraph or object.
7. For PDF, use locator.type="builtin_annotation" as the primary target. It comes from the PDF viewer's native annotation tools and carries annotation type, PDF rect, colors, opacity, and optional contents. The marked annotation area is the location to edit.
8. Save the updated file and reply with the changed file path. For in-place edits, updated_file must be the original file path above.

Format-specific guidance:
${escapeDoyaMarkupContent(kindInstructions)}
  </doya-ai>

  <doya-reply desc="Preferred response format. Doya may render a matching result block specially.">
When finished, reply with exactly one result card followed by no extra prose unless an error prevents completion.

Use this shape and preserve the id "${escapedMessageId}":
<doya-ui
  version="1"
  kind="document.apply_annotations.result"
  render="result-card"
  visibility="summary"
  id="${escapedMessageId}"
  desc="Result card for applied document preview annotations."
>
  <doya-ui-content desc="User-visible result content.">
    <doya-title desc="Result title.">文件标注已应用</doya-title>
    <doya-summary desc="Short summary of the applied changes.">Summarize what changed.</doya-summary>
    <doya-field name="updated_file" label="文件" desc="Workspace-relative path to the updated file.">path/to/updated-file</doya-field>
  </doya-ui-content>
  <doya-ai desc="Private note for Doya.">Include only factual completion details. Do not include hidden reasoning.</doya-ai>
</doya-ui>
  </doya-reply>
</doya-ui>`;
}

export function getDocumentAnnotationGoal(kind: DocumentViewerKind): string {
  if (kind === "docx") return "modify_docx";
  if (kind === "pdf") return "modify_pdf";
  if (kind === "xlsx" || kind === "csv") return "modify_spreadsheet";
  if (kind === "pptx") return "modify_pptx";
  return "modify_file";
}

export function isDocumentAnnotationKind(kind: DocumentViewerKind): boolean {
  return kind === "docx" || kind === "pdf" || kind === "xlsx" || kind === "csv";
}

function getDocumentKindLabel(kind: DocumentViewerKind): string {
  if (kind === "docx") return "Word 文档";
  if (kind === "pdf") return "PDF 文档";
  if (kind === "xlsx" || kind === "csv") return "表格文件";
  if (kind === "pptx") return "PPTX 文件";
  return "文件";
}

function getDocumentKindInstructions(kind: DocumentViewerKind): string {
  if (kind === "xlsx" || kind === "csv") {
    return [
      "- Treat spreadsheet locators as authoritative: sheet + cell address identify the target.",
      '- Treat locator.type="range" as an authoritative worksheet range selected inside the spreadsheet editor.',
      '- Treat locator.type="drawing" as an authoritative selected spreadsheet object such as a chart, image, or shape. Use sheet, drawingIndex, drawingType, text, and drawingSelectionState as the object anchor.',
      "- Preserve formulas unless the annotation explicitly asks to replace them; when changing a formula-driven cell, prefer updating the formula inputs or formula itself so dependent summaries and charts stay linked.",
      "- Preserve existing worksheets, tables, charts, number formats, merged cells, and column widths unless the annotation asks otherwise.",
      "- For CSV, preserve the tabular data shape and delimiter semantics; if formulas/charts are requested, create an XLSX only when necessary and state that in the result.",
    ].join("\n");
  }
  if (kind === "docx") {
    return [
      "- Use selected text and nearby context as the primary anchor; use page/path only as preview hints because DOCX pagination can shift after edits.",
      "- When both path and clickedPath are present, treat path as the nearest semantic document block and clickedPath as the precise clicked inline/rendered element.",
      "- Edit the matching paragraph, run, table cell, image, or heading while preserving surrounding styles, numbering, tables, headers, footers, and page breaks.",
      "- If multiple matches exist, choose the one whose page/path/context best matches the annotation and mention any ambiguity in the result summary.",
    ].join("\n");
  }
  if (kind === "pdf") {
    return [
      "- Do not depend on selecting PDF text. Doya PDF annotations come from the PDF viewer's native annotation tools.",
      '- Use locator.type="builtin_annotation" as the authoritative target. It may include annotationType, rectPdf, color, opacity, contents, segmentRectsPdf, verticesPdf, or inkListPdf.',
      '- For builtin annotations, coordinateSpace="pdf_page_normalized" means x/y/x1/y1/x2/y2/width/height are normalized 0..1 PDF page coordinates; coordinateSpace="pdf_page_units" means they are raw PDF page units.',
      "- Treat square/circle/polygon/ink annotations as visual locators drawn by the user. Apply the requested edit to the visible PDF content inside or intersecting the marked area. Do not edit another section with similar text, and do not edit the annotation shape itself unless the instruction explicitly asks.",
      "- If the requested edit is a style change such as color/font/weight, apply it to text or graphic objects overlapped by the locator rectangle. If exact object extraction is hard, use the locator rectangle as the clipping/search area on the specified page.",
      "- Use contents/subject as the user's note when present, and use the separate instruction field as the requested edit.",
      "- If the PDF source is directly editable, update that source and regenerate the PDF. If only the PDF is available, apply the requested visible change to the PDF itself when practical.",
      "- Never export only the annotation, shape, or overlay layer. The updated PDF must preserve the original page content as the base and include the requested visible changes on top of or within that content.",
      "- Preserve page count, existing visual layout, links, and images unless the annotation asks otherwise.",
      "- If exact in-place PDF editing is unsafe, create an updated PDF beside the original and explain why a new file was needed.",
    ].join("\n");
  }
  return "- Apply annotations using the most stable locator/context data available and preserve unrelated content.";
}

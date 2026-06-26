import {
  AI_CREATION_STYLE_PROMPT_LABELS,
  type AiCreationAspectRatio,
  type AiCreationMode,
  type AiCreationVisualStyle,
} from "@/ai-creation/options";
import { buildAiCreationSlidesPrompt } from "@/ai-creation/slides-prompt";
import { translateNow, type Locale } from "@/i18n/i18n";
import {
  buildDoyaMessageMeta,
  buildDoyaResponseLanguageInstruction,
  escapeDoyaMarkupText,
} from "@/utils/doya-message-markup";

export interface ComposerAiCreationPromptContext {
  mode: Extract<AiCreationMode, "image" | "slides" | "pdf" | "word" | "spreadsheet">;
  displayText: string;
  ratio: AiCreationAspectRatio;
  style: AiCreationVisualStyle;
}

export function buildComposerAiCreationPrompt(input: {
  context: ComposerAiCreationPromptContext;
  messageId: string;
  attachmentCount: number;
  defaultLocale: Locale;
}): string {
  const prompt = input.context.displayText.trim();
  const baseInput = {
    messageId: input.messageId,
    mode: input.context.mode,
    prompt,
    sourceCount: input.attachmentCount,
    defaultLocale: input.defaultLocale,
  };
  if (input.context.mode === "image") {
    return buildAiCreationMarkupPrompt({
      ...baseInput,
      ratio: input.context.ratio,
      style: AI_CREATION_STYLE_PROMPT_LABELS[input.context.style],
      aiInstructions: buildImagePrompt({
        prompt,
        ratio: input.context.ratio,
        style: input.context.style,
        referenceCount: input.attachmentCount,
      }),
    });
  }
  if (input.context.mode === "slides") {
    return buildAiCreationMarkupPrompt({
      ...baseInput,
      ratio: input.context.ratio,
      aiInstructions: buildAiCreationSlidesPrompt({
        prompt,
        ratio: input.context.ratio,
        sourceFileCount: input.attachmentCount,
        defaultLocale: input.defaultLocale,
      }),
    });
  }
  if (input.context.mode === "pdf") {
    return buildAiCreationMarkupPrompt({
      ...baseInput,
      aiInstructions: buildDocumentPrompt({
        kind: "pdf",
        prompt,
        sourceFileCount: input.attachmentCount,
      }),
    });
  }
  if (input.context.mode === "word") {
    return buildAiCreationMarkupPrompt({
      ...baseInput,
      aiInstructions: buildDocumentPrompt({
        kind: "word",
        prompt,
        sourceFileCount: input.attachmentCount,
      }),
    });
  }
  return buildAiCreationMarkupPrompt({
    ...baseInput,
    aiInstructions: buildDocumentPrompt({
      kind: "spreadsheet",
      prompt,
      sourceFileCount: input.attachmentCount,
    }),
  });
}

function buildAiCreationMarkupPrompt(input: {
  messageId: string;
  mode: ComposerAiCreationPromptContext["mode"];
  prompt: string;
  aiInstructions: string;
  defaultLocale: Locale;
  ratio?: string;
  style?: string;
  sourceCount?: number;
}): string {
  const config = getMarkupConfig(input.mode);
  const escapedMessageId = escapeDoyaMarkupText(input.messageId);
  const escapedPrompt = escapeDoyaMarkupText(input.prompt);
  const languageInstruction = buildDoyaResponseLanguageInstruction({
    defaultLocale: input.defaultLocale,
    userText: input.prompt,
  });
  const expectedTarget =
    input.mode === "slides"
      ? ""
      : `
<doya-expected-target
  version="1"
  kind="${config.kind}"
  goal="${config.goal}"
  id="${escapedMessageId}"
  text="${config.targetText}"
  desc="Exact target handshake that the assistant must emit before doing any work."
/>
`;
  const fields = [
    `<doya-field name="request" label="${escapeDoyaMarkupText(translateNow("aiCreation.markup.field.request"))}" desc="Original user creation request.">${escapedPrompt}</doya-field>`,
    input.ratio
      ? `<doya-field name="ratio" label="${escapeDoyaMarkupText(translateNow("aiCreation.markup.field.ratio"))}" desc="Requested output aspect ratio.">${escapeDoyaMarkupText(input.ratio)}</doya-field>`
      : null,
    input.style
      ? `<doya-field name="style" label="${escapeDoyaMarkupText(translateNow("aiCreation.markup.field.style"))}" desc="Requested visual style.">${escapeDoyaMarkupText(input.style)}</doya-field>`
      : null,
    typeof input.sourceCount === "number" && input.sourceCount > 0
      ? `<doya-field name="source_count" label="${escapeDoyaMarkupText(translateNow("aiCreation.markup.field.sourceCount"))}" desc="Number of attached source files or images.">${input.sourceCount}</doya-field>`
      : null,
  ].filter((field): field is string => Boolean(field));

  return `${buildDoyaMessageMeta()}

${config.normalInstruction}
${expectedTarget}
<doya-ui
  version="1"
  kind="${config.kind}"
  render="card"
  visibility="summary"
  id="${escapedMessageId}"
  desc="${config.cardDesc}"
>
  <doya-ui-content desc="User-visible card content. Doya may render this instead of the full prompt.">
    <doya-title desc="Title shown in the user message card.">${config.title}</doya-title>
    <doya-summary desc="Short user-visible summary of this task.">${escapedPrompt}</doya-summary>
    ${fields.join("\n    ")}
  </doya-ui-content>

  <doya-ai desc="Task instructions the AI must follow. Doya may hide this section from the chat UI.">
${escapeDoyaMarkupText(languageInstruction)}

${escapeDoyaMarkupText(input.aiInstructions)}
  </doya-ai>

  <doya-reply desc="Preferred response format. Doya may render a matching result block specially.">
Follow the final reply requirements in <doya-ai>. Preserve the request id "${escapedMessageId}" if you emit a matching result block.
  </doya-reply>
</doya-ui>`;
}

function getMarkupConfig(mode: ComposerAiCreationPromptContext["mode"]): {
  kind: string;
  goal: string;
  targetText: string;
  title: string;
  normalInstruction: string;
  cardDesc: string;
} {
  if (mode === "slides") {
    return {
      kind: "ai_creation.slides.create",
      goal: "create_pptx",
      targetText: translateNow("aiCreation.display.slidesPrefix"),
      title: translateNow("aiCreation.display.slidesPrefix"),
      normalInstruction: translateNow("aiCreation.markup.instruction.slides"),
      cardDesc: "A Doya-renderable task card for an AI slide deck creation request.",
    };
  }
  if (mode === "pdf") {
    return {
      kind: "ai_creation.document.pdf.create",
      goal: "create_pdf",
      targetText: translateNow("aiCreation.display.pdfPrefix"),
      title: translateNow("aiCreation.display.pdfPrefix"),
      normalInstruction: translateNow("aiCreation.markup.instruction.pdf"),
      cardDesc: "A Doya-renderable task card for an AI PDF creation request.",
    };
  }
  if (mode === "word") {
    return {
      kind: "ai_creation.document.word.create",
      goal: "create_docx",
      targetText: translateNow("aiCreation.display.wordPrefix"),
      title: translateNow("aiCreation.display.wordPrefix"),
      normalInstruction: translateNow("aiCreation.markup.instruction.word"),
      cardDesc: "A Doya-renderable task card for an AI Word document creation request.",
    };
  }
  if (mode === "spreadsheet") {
    return {
      kind: "ai_creation.spreadsheet.create",
      goal: "create_spreadsheet",
      targetText: translateNow("aiCreation.display.spreadsheetPrefix"),
      title: translateNow("aiCreation.display.spreadsheetPrefix"),
      normalInstruction: translateNow("aiCreation.markup.instruction.spreadsheet"),
      cardDesc: "A Doya-renderable task card for an AI spreadsheet creation request.",
    };
  }
  return {
    kind: "ai_creation.image.generate",
    goal: "generate_image",
    targetText: translateNow("aiCreation.display.createPrefix"),
    title: translateNow("aiCreation.display.createPrefix"),
    normalInstruction: translateNow("aiCreation.markup.instruction.create"),
    cardDesc: "A Doya-renderable task card for an AI image generation request.",
  };
}

function buildImagePrompt(input: {
  prompt: string;
  ratio: string;
  style: AiCreationVisualStyle;
  referenceCount: number;
}): string {
  const lines = [
    "Use the Codex imagegen skill for this request.",
    "This is an AI creation surface. Do not explain your reasoning, workflow, shell commands, or implementation steps in the final conversation.",
    "Create a raster image from this prompt:",
    input.prompt,
    "",
    `Aspect ratio: ${input.ratio}`,
    `Style: ${AI_CREATION_STYLE_PROMPT_LABELS[input.style]}`,
    "Save the final image into the current workspace if a workspace-bound asset is produced.",
    "When the final image is saved, reply with Markdown image syntax only, using the workspace-relative path, for example: ![](assets/generated-image.png)",
  ];
  if (input.referenceCount > 0) {
    lines.push(
      `Reference files attached: ${input.referenceCount}. Treat them as visual references.`,
    );
  }
  return lines.join("\n");
}

function buildDocumentPrompt(input: {
  kind: "pdf" | "word" | "spreadsheet";
  prompt: string;
  sourceFileCount: number;
}): string {
  let output = "spreadsheet";
  if (input.kind === "pdf") {
    output = "PDF";
  } else if (input.kind === "word") {
    output = "Word document";
  }
  return [
    `Create a ${output} for this request:`,
    input.prompt,
    "",
    "Use the existing AI creation workflow available in this workspace.",
    "Save the finished file into the current workspace and reply with the workspace-relative file path.",
    input.sourceFileCount > 0
      ? `Attached source files: ${input.sourceFileCount}. Use them as source material.`
      : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

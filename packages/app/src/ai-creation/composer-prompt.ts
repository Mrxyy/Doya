import {
  AI_CREATION_STYLE_PROMPT_LABELS,
  type AiCreationAspectRatio,
  type AiCreationMode,
  type AiCreationVisualStyle,
} from "@/ai-creation/options";
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
      aiInstructions: buildSlidesPrompt({
        prompt,
        ratio: input.context.ratio,
        sourceFileCount: input.attachmentCount,
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

function buildSlidesPrompt(input: {
  prompt: string;
  ratio: AiCreationAspectRatio;
  sourceFileCount: number;
}): string {
  const format = input.ratio === "4:3" ? "ppt43" : "ppt169";
  return [
    "You are creating a PowerPoint deck for the Doya AI Creation slides surface.",
    "Doya has already prepared the bundled PPT Master skill link at `.doya/skills/ppt-master` before this agent starts.",
    "This is an AI creation surface. Keep user-facing progress minimal.",
    "Do not narrate skill reading, dependency installation, shell commands, file inspection, design reasoning, or implementation steps.",
    'Human-visible progress protocol: before the final reply, only send progress by emitting a `<doya-ui kind="ai_creation.slides.progress">` block.',
    "Only mark information as human-visible when it helps the user follow PPT creation: confirmation readiness, preview readiness, deck outline, design direction, source processing, each slide becoming ready, export start, or PPTX readiness.",
    "For preview readiness, include the preview path in a field named `preview_path` inside the same progress block.",
    "Do not use the generic presentations skill or artifact-tool workflow for this request.",
    "Do not search for PPT Master in other directories.",
    "Do not use web search for PPT Master.",
    "Do not git clone, fetch, or download PPT Master.",
    'If `.doya/skills/ppt-master/SKILL.md` is missing, stop immediately and reply exactly: "PPT Master skill link missing: .doya/skills/ppt-master/SKILL.md".',
    "Read `.doya/skills/ppt-master/SKILL.md` and follow that workflow exactly.",
    "Begin the PPT Master workflow immediately. Do not wait for a target handshake, confirmation, or user reply before creating the project.",
    "Doya provides its own built-in slide preview service. Do not run PPT Master's `scripts/svg_editor/server.py`, do not start Flask, and do not open localhost preview ports yourself.",
    "Doya also provides its own built-in Confirm UI. When PPT Master Step 4 asks you to run `scripts/confirm_ui/server.py`, do not run that local server, do not start Flask, and do not open localhost confirmation ports.",
    "Instead, write `projects/<project>/confirm_ui/recommendations.json`, then send a human-visible progress block with a `confirm_path` field set to `projects/<project>/confirm_ui/`. Doya will render the inline confirmation card in chat and write `projects/<project>/confirm_ui/result.json` when the user confirms.",
    "After sending the confirmation progress block, stop at the confirmation barrier. Until `projects/<project>/confirm_ui/result.json` exists or the user replies in chat with explicit choices, do not create the design spec, do not create `svg_output`, do not send a `preview_path`, do not generate slide SVGs, and do not continue to any later PPT Master step.",
    "When the confirmation barrier resolves, read `result.json` if it exists, honor the confirmed values exactly, and only then continue the PPT Master workflow.",
    "After confirmation is resolved and project initialization creates `projects/<project>/`, ensure `projects/<project>/svg_output/` exists even if it is still empty, then immediately send a human-visible progress block with a `preview_path` field set to `projects/<project>/svg_output/`.",
    "You must send the preview-ready progress block before generating or writing the first slide.",
    "After sending preview progress, continue the PPT Master workflow without waiting for the user.",
    "Write generated SVG pages into `projects/<project>/svg_output/` strictly one page at a time. Save `slide_01.svg` as soon as it is complete, then continue to `slide_02.svg`, and so on.",
    "Only after the skill link exists, install Python requirements if needed: `pip install -r .doya/skills/ppt-master/requirements.txt`.",
    "",
    "User request:",
    input.prompt,
    "",
    `Canvas format: ${format}`,
    `Source file count: ${input.sourceFileCount}`,
    input.sourceFileCount > 0
      ? "If source files are attached, the daemon writes them into `attachments/` and includes their paths in the structured attachment text. Use those workspace paths as PPT Master source files."
      : null,
    "",
    "Run the PPT Master pipeline end to end:",
    "source_to_md -> project_manager init/import-sources -> Strategist design_spec/spec_lock -> sequential SVG pages -> svg_quality_checker -> total_md_split -> finalize_svg -> svg_to_pptx.",
    "",
    "The output must be a native editable PPTX in `projects/<project>/exports/`.",
    "Do not create a screenshot-only deck.",
    "Do not explain internal commands in the final reply unless a blocking error occurs.",
    "Final reply: only provide the PPTX path and optional preview path.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
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

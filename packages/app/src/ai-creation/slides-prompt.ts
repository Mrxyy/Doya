import type { AiCreationAspectRatio } from "@/ai-creation/options";
import type { Locale } from "@/i18n/i18n";
import { translate } from "@/i18n/translate";

export function buildAiCreationSlidesPrompt(input: {
  prompt: string;
  ratio: AiCreationAspectRatio;
  sourceFileCount: number;
  defaultLocale: Locale;
}): string {
  const format = input.ratio === "4:3" ? "ppt43" : "ppt169";
  const previewReadyTitle = translate(
    "aiCreation.progress.slidesPreviewReady",
    input.defaultLocale,
  );
  const slideReadyTitle = translate("aiCreation.progress.slidesPageReady", input.defaultLocale, {
    number: 1,
  });
  const coverReadySummary = translate("aiCreation.progress.slidesCoverReady", input.defaultLocale);
  const lines = [
    "You are creating a PowerPoint deck for the Doya AI Creation slides surface.",
    "Doya has already prepared the bundled PPT Master skill link at `.doya/skills/ppt-master` before this agent starts.",
    "This is an AI creation surface. Keep user-facing progress minimal.",
    "Do not narrate skill reading, dependency installation, shell commands, file inspection, design reasoning, or implementation steps.",
    'Human-visible progress protocol: before the final reply, only send progress by emitting a `<doya-ui kind="ai_creation.slides.progress">` block.',
    "Only mark information as human-visible when it helps the user follow PPT creation: confirmation readiness, preview readiness, deck outline, design direction, source processing, each slide becoming ready, export start, or PPTX readiness.",
    "Do not expose implementation details in human-visible progress: no SVG, .svg filenames, shell commands, script names, dependency names, or internal file inspection.",
    "All human-visible progress titles and summaries must follow the response-language instruction above. Do not copy English titles such as `Slide 1 ready`, `Deck outline ready`, or `Preview ready` when the response language is Chinese.",
    "Use this protocol shape for progress:",
    `<doya-ui version="1" kind="ai_creation.slides.progress" render="status" visibility="summary" desc="Human-visible PPT creation progress."><doya-ui-content desc="Visible progress content."><doya-title desc="Progress title.">${slideReadyTitle}</doya-title><doya-summary desc="Progress summary.">${coverReadySummary}</doya-summary></doya-ui-content></doya-ui>`,
    "For preview readiness and confirmation readiness, include `doya-field` elements inside the same `doya-ui-content` block.",
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
    `Streaming preview contract: after confirmation is resolved and project initialization creates \`projects/<project>/\`, ensure \`projects/<project>/svg_output/\` exists even if it is still empty, then immediately send a human-visible progress block titled \`${previewReadyTitle}\` with a \`preview_path\` field set to \`projects/<project>/svg_output/\`.`,
    "You must send the preview-ready progress block before generating or writing the first slide.",
    "After sending preview progress, continue the PPT Master workflow without waiting for the user.",
    "Write generated SVG pages into `projects/<project>/svg_output/` strictly one page at a time. Save `slide_01.svg` as soon as it is complete, then continue to `slide_02.svg`, and so on.",
    "Do not batch-generate all slide SVG files before writing them to disk. Do not wait until all slides are ready before exposing the preview directory.",
    `After each slide page is saved, send one human-visible progress block titled like \`${slideReadyTitle}\`, with a summary using the user-facing slide title, for example \`${coverReadySummary}\` Then continue with the next page.`,
    "Doya polls the preview directory and will show new slides as they appear.",
    "Treat tasteful animation as part of a finished AI-generated presentation, not as a user-only advanced option. Independently choose whether each deck should have page transitions, per-element entrance animation, or no motion based on the content, audience, and visual style.",
    "For most generated decks, export the final PPTX with subtle per-element animation enabled by passing `-a auto` to `svg_to_pptx.py`. Use `--animation-trigger after-previous` for click-free presentation flow unless the user explicitly asks for presenter-paced click reveals.",
    'When a slide has clear semantic sections, make sure the SVG uses top-level `<g id="...">` groups so PPT Master can animate meaningful regions such as title, chart, cards, timeline steps, image hero, and takeaway instead of animating tiny atoms. Keep chrome/background/header/footer groups named as chrome so they do not animate.',
    "If the deck is highly formal, print-oriented, compliance-heavy, or the user asks for no animation, keep element animation off and rely on the default page transition. If a specific reveal order matters, create and validate `animations.json` before export instead of relying only on `-a auto`.",
    "Only after the skill link exists, install Python requirements if needed: `pip install -r .doya/skills/ppt-master/requirements.txt`.",
    "",
    "User request:",
    input.prompt,
    "",
    `Canvas format: ${format}`,
    `Source file count: ${input.sourceFileCount}`,
    "If source files are attached, the daemon writes them into `attachments/` and includes their paths in the structured attachment text. Use those workspace paths as PPT Master source files.",
    "",
    "Run the PPT Master pipeline end to end:",
    "source_to_md -> project_manager init/import-sources -> Strategist design_spec/spec_lock -> sequential SVG pages -> svg_quality_checker -> total_md_split -> finalize_svg -> svg_to_pptx.",
    "",
    "The output must be a native editable PPTX in `projects/<project>/exports/`.",
    "Do not create a screenshot-only deck.",
    "Do not explain internal commands in the final reply unless a blocking error occurs.",
    "Final reply: only provide the PPTX path and optional preview path.",
  ];
  return lines.join("\n");
}

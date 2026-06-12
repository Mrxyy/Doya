import { translateNow } from "@/i18n/i18n";

const IMAGEGEN_PROMPT_PREFIX = "Use the Codex imagegen skill for this request.";
const SLIDES_PROMPT_PREFIX =
  "You are creating a PowerPoint deck for the Paseo AI Creation slides surface.";
const DOCUMENT_PROMPT_PREFIXES = {
  pdf: "You are creating a PDF document for the Paseo AI Creation surface.",
  word: "You are creating a Word document for the Paseo AI Creation surface.",
  spreadsheet: "You are creating a spreadsheet for the Paseo AI Creation surface.",
} as const;

type AiCreationTitleMode = "image" | "slides" | "pdf" | "word" | "spreadsheet" | "edit";

export function extractAiCreationDisplayText(text: string): string | null {
  if (text.includes("<paseo-ui")) {
    return null;
  }

  if (text.startsWith(SLIDES_PROMPT_PREFIX)) {
    const marker = "User request:";
    const markerIndex = text.indexOf(marker);
    if (markerIndex < 0) {
      return translateNow("aiCreation.display.slidesPrefix");
    }
    const promptTail = text.slice(markerIndex + marker.length).trimStart();
    const promptEnd = promptTail.search(/\n\s*\n/);
    const prompt = (promptEnd >= 0 ? promptTail.slice(0, promptEnd) : promptTail).trim();
    return prompt
      ? translateNow("aiCreation.display.slidesMessage", { prompt })
      : translateNow("aiCreation.display.slidesPrefix");
  }

  const documentMode = (
    Object.keys(DOCUMENT_PROMPT_PREFIXES) as Array<keyof typeof DOCUMENT_PROMPT_PREFIXES>
  ).find((mode) => text.startsWith(DOCUMENT_PROMPT_PREFIXES[mode]));
  if (documentMode) {
    const marker = "User request:";
    const markerIndex = text.indexOf(marker);
    const prefixKey = `aiCreation.display.${documentMode}Prefix` as const;
    const messageKey = `aiCreation.display.${documentMode}Message` as const;
    if (markerIndex < 0) {
      return translateNow(prefixKey);
    }
    const promptTail = text.slice(markerIndex + marker.length).trimStart();
    const promptEnd = promptTail.search(/\n\s*\n/);
    const prompt = (promptEnd >= 0 ? promptTail.slice(0, promptEnd) : promptTail).trim();
    return prompt ? translateNow(messageKey, { prompt }) : translateNow(prefixKey);
  }

  if (!text.startsWith(IMAGEGEN_PROMPT_PREFIX)) {
    return null;
  }

  const createMarker = "Create a raster image from this prompt:";
  const editMarker = "Edit the attached image with this instruction:";
  const createMarkerIndex = text.indexOf(createMarker);
  const editMarkerIndex = text.indexOf(editMarker);
  const marker = createMarkerIndex >= 0 ? createMarker : editMarker;
  const markerIndex = createMarkerIndex >= 0 ? createMarkerIndex : editMarkerIndex;
  if (markerIndex < 0) {
    return null;
  }

  const promptStart = markerIndex + marker.length;
  const promptTail = text.slice(promptStart).trimStart();
  const promptEnd = promptTail.search(/\n\s*\n/);
  const prompt = (promptEnd >= 0 ? promptTail.slice(0, promptEnd) : promptTail).trim();
  if (!prompt) {
    return null;
  }
  return marker === editMarker
    ? translateNow("aiCreation.display.editMessage", { prompt })
    : translateNow("aiCreation.display.createMessage", { prompt });
}

export function buildAiCreationTitle(input: { mode: AiCreationTitleMode; prompt: string }): string {
  const prompt = input.prompt.trim();
  let prefix: string;
  let title: string;
  if (input.mode === "edit") {
    prefix = translateNow("aiCreation.display.editPrefix");
    title = translateNow("aiCreation.display.editMessage", { prompt });
  } else if (input.mode === "slides") {
    prefix = translateNow("aiCreation.display.slidesPrefix");
    title = translateNow("aiCreation.display.slidesMessage", { prompt });
  } else if (input.mode === "pdf") {
    prefix = translateNow("aiCreation.display.pdfPrefix");
    title = translateNow("aiCreation.display.pdfMessage", { prompt });
  } else if (input.mode === "word") {
    prefix = translateNow("aiCreation.display.wordPrefix");
    title = translateNow("aiCreation.display.wordMessage", { prompt });
  } else if (input.mode === "spreadsheet") {
    prefix = translateNow("aiCreation.display.spreadsheetPrefix");
    title = translateNow("aiCreation.display.spreadsheetMessage", { prompt });
  } else {
    prefix = translateNow("aiCreation.display.createPrefix");
    title = translateNow("aiCreation.display.createMessage", { prompt });
  }
  if (!prompt) {
    return prefix;
  }
  return title.slice(0, 80);
}

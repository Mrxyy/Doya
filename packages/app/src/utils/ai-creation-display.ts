import { translateNow } from "@/i18n/i18n";

const IMAGEGEN_PROMPT_PREFIX = "Use the Codex imagegen skill for this request.";

export function extractAiCreationDisplayText(text: string): string | null {
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
  const prefix =
    marker === editMarker
      ? translateNow("aiCreation.display.editPrefix")
      : translateNow("aiCreation.display.createPrefix");
  return `${prefix}: ${prompt}`;
}

export function buildAiCreationTitle(input: { mode: "image" | "edit"; prompt: string }): string {
  const prompt = input.prompt.trim();
  const prefix =
    input.mode === "edit"
      ? translateNow("aiCreation.display.editPrefix")
      : translateNow("aiCreation.display.createPrefix");
  if (!prompt) {
    return prefix;
  }
  return `${prefix}: ${prompt}`.slice(0, 80);
}

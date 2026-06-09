import type { AttachmentMetadata } from "@/attachments/types";

export interface AiCreationEditSource {
  entry: "result-edit";
  image: AttachmentMetadata;
  previewUri: string;
  imageSource: string;
  sourceAgentId: string;
  sourceServerId: string;
}

let editSource: AiCreationEditSource | null = null;

export function setAiCreationEditSource(source: AiCreationEditSource): void {
  editSource = source;
}

export function takeAiCreationEditSource(): AiCreationEditSource | null {
  const source = editSource;
  editSource = null;
  return source;
}

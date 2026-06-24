import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AgentAttachment } from "@getdoya/protocol/messages";
import type { AttachmentMetadata } from "@/attachments/types";
import type { UserMessageImageAttachment } from "@/types/stream";

const STORAGE_KEY = "doya:ai-creation-message-display:v1";

export interface AiCreationMessageDisplayMetadata {
  images?: UserMessageImageAttachment[];
  displayAttachments?: AgentAttachment[];
  selectionPreviewUri?: string;
  selectionImageSource?: string;
  selectionImage?: AttachmentMetadata;
}

export interface AiCreationMessageDisplayEntry extends AiCreationMessageDisplayMetadata {
  agentId?: string;
  messageId: string;
  text?: string;
  allowOrderFallback?: boolean;
}

type StoredMetadataByKey = Record<string, AiCreationMessageDisplayMetadata & { text?: string }>;

function displayMetadataKey(input: {
  serverId: string;
  agentId: string;
  messageId: string;
}): string {
  return `${input.serverId}:${input.agentId}:${input.messageId}`;
}

function normalizeMetadata(
  value: AiCreationMessageDisplayMetadata,
): AiCreationMessageDisplayMetadata {
  const images = value.selectionImage
    ? value.images?.filter((image) => image.id !== value.selectionImage?.id)
    : value.images;
  return {
    ...(images && images.length > 0 ? { images } : {}),
    ...("displayAttachments" in value
      ? { displayAttachments: value.displayAttachments ?? [] }
      : {}),
    ...(value.selectionPreviewUri ? { selectionPreviewUri: value.selectionPreviewUri } : {}),
    ...(value.selectionImageSource ? { selectionImageSource: value.selectionImageSource } : {}),
    ...(value.selectionImage ? { selectionImage: value.selectionImage } : {}),
  };
}

async function readAll(): Promise<StoredMetadataByKey> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as StoredMetadataByKey;
  } catch {
    return {};
  }
}

async function writeAll(value: StoredMetadataByKey): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export async function saveAiCreationMessageDisplayMetadata(input: {
  serverId: string;
  agentId: string;
  messageId: string;
  text?: string;
  metadata: AiCreationMessageDisplayMetadata;
}): Promise<void> {
  const metadata = normalizeMetadata(input.metadata);
  if (
    !input.text &&
    !metadata.images &&
    !metadata.displayAttachments &&
    !metadata.selectionPreviewUri &&
    !metadata.selectionImageSource &&
    !metadata.selectionImage
  ) {
    return;
  }
  const all = await readAll();
  all[displayMetadataKey(input)] = {
    ...metadata,
    ...(input.text ? { text: input.text } : {}),
  };
  await writeAll(all);
}

export async function loadAiCreationMessageDisplayMetadata(input: {
  serverId: string;
  agentId: string;
}): Promise<AiCreationMessageDisplayEntry[]> {
  const all = await readAll();
  const prefix = `${input.serverId}:${input.agentId}:`;
  const entries: AiCreationMessageDisplayEntry[] = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(prefix)) {
      continue;
    }
    entries.push({
      agentId: input.agentId,
      messageId: key.slice(prefix.length),
      ...value,
    });
  }
  return entries;
}

export async function loadAiCreationServerMessageDisplayMetadata(input: {
  serverId: string;
  preferredAgentId?: string;
}): Promise<AiCreationMessageDisplayEntry[]> {
  const all = await readAll();
  const prefix = `${input.serverId}:`;
  const entries: AiCreationMessageDisplayEntry[] = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(prefix)) {
      continue;
    }
    const rest = key.slice(prefix.length);
    const separatorIndex = rest.indexOf(":");
    if (separatorIndex < 0) {
      continue;
    }
    const agentId = rest.slice(0, separatorIndex);
    const messageId = rest.slice(separatorIndex + 1);
    const isPreferredAgent = agentId === input.preferredAgentId;
    if (!isPreferredAgent && !value.text?.trim()) {
      continue;
    }
    entries.push({
      agentId,
      messageId,
      ...value,
      allowOrderFallback: isPreferredAgent,
    });
  }
  return entries;
}

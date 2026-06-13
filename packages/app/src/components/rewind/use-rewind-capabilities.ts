import { useMemo } from "react";
import type { AgentCapabilityFlags } from "@getdoya/protocol/agent-types";
import { translateNow } from "@/i18n/i18n";

export type RewindMode = "conversation" | "files" | "both";

export interface RewindMenuItem {
  mode: RewindMode;
  label: string;
  testID: string;
}

export function resolveRewindMenuItems(
  capabilities:
    | Pick<
        AgentCapabilityFlags,
        "supportsRewindConversation" | "supportsRewindFiles" | "supportsRewindBoth"
      >
    | null
    | undefined,
): RewindMenuItem[] {
  if (!capabilities) {
    return [];
  }
  const items: RewindMenuItem[] = [];
  if (capabilities.supportsRewindConversation) {
    items.push({
      mode: "conversation",
      label: translateNow("ui.rewind.conversation.j8j44o"),
      testID: "rewind-menu-conversation",
    });
  }
  if (capabilities.supportsRewindFiles) {
    items.push({
      mode: "files",
      label: translateNow("ui.rewind.files.7w34s2"),
      testID: "rewind-menu-files",
    });
  }
  if (capabilities.supportsRewindBoth) {
    items.push({
      mode: "both",
      label: translateNow("ui.rewind.conversation.and.files.13q0nee"),
      testID: "rewind-menu-both",
    });
  }
  return items;
}

export function useRewindCapabilities(
  capabilities: Parameters<typeof resolveRewindMenuItems>[0],
): RewindMenuItem[] {
  return useMemo(() => resolveRewindMenuItems(capabilities), [capabilities]);
}

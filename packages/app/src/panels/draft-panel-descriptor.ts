import type { ComponentType } from "react";
import type { PanelDescriptor, PanelIconProps } from "@/panels/panel-registry";
import { translateNow } from "@/i18n/i18n";

export function buildDraftPanelDescriptor(input: {
  isCreating: boolean;
  pendingPrompt?: string | null;
  icon: ComponentType<PanelIconProps>;
}): PanelDescriptor {
  const { icon, isCreating, pendingPrompt } = input;
  const creatingLabel = pendingPrompt?.trim() || "New Agent";
  if (isCreating) {
    return {
      label: creatingLabel,
      subtitle: "Creating agent",
      titleState: "ready",
      icon,
      statusBucket: "running",
    };
  }

  return {
    label: translateNow("ui.new.agent.1xe0nd1"),
    subtitle: "New Agent",
    titleState: "ready",
    icon,
    statusBucket: null,
  };
}

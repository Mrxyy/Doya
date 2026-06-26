import { View } from "react-native";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import { translateNow } from "@/i18n/i18n";
import { MessageSquare } from "@/components/icons/lucide";

function useHomePresetConversationPanelDescriptor(target: {
  kind: "homePresetConversation";
  prompt: string;
}): PanelDescriptor {
  return {
    label: target.prompt,
    subtitle: translateNow("home.newSession.title"),
    titleState: "ready",
    icon: MessageSquare,
    statusBucket: null,
  };
}

function HomePresetConversationPanel() {
  return <View />;
}

export const homePresetConversationPanelRegistration: PanelRegistration<"homePresetConversation"> =
  {
    kind: "homePresetConversation",
    component: HomePresetConversationPanel,
    useDescriptor: useHomePresetConversationPanelDescriptor,
  };

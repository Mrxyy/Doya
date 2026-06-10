import { useMemo } from "react";
import { Presentation } from "lucide-react-native";
import { Text, View } from "react-native";
import invariant from "tiny-invariant";
import { StyleSheet } from "react-native-unistyles";
import { PptPreviewFrame } from "@/components/ppt-preview-frame";
import { translateNow } from "@/i18n/i18n";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { buildWorkspacePptPreviewUrl } from "@/workspace/ppt-preview";

function usePptPreviewPanelDescriptor(target: {
  kind: "pptPreview";
  agentId: string;
  projectName: string;
}): PanelDescriptor {
  return {
    label: target.projectName,
    subtitle: translateNow("ui.slides.preview"),
    titleState: "ready",
    icon: Presentation,
    statusBucket: null,
  };
}

function PptPreviewPanel() {
  const { serverId, target } = usePaneContext();
  invariant(target.kind === "pptPreview", "PptPreviewPanel requires pptPreview target");
  const activeConnection = useHostRuntimeSnapshot(serverId)?.activeConnection ?? null;
  const previewUrl = useMemo(
    () =>
      buildWorkspacePptPreviewUrl({
        activeConnection,
        agentId: target.agentId,
        projectName: target.projectName,
      }),
    [activeConnection, target.agentId, target.projectName],
  );

  if (!previewUrl) {
    return (
      <View style={styles.centered}>
        <Text>{translateNow("ui.slides.preview.unavailable")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <PptPreviewFrame
        title={translateNow("ui.slides.preview.title", { name: target.projectName })}
        url={previewUrl}
      />
    </View>
  );
}

export const pptPreviewPanelRegistration: PanelRegistration<"pptPreview"> = {
  kind: "pptPreview",
  component: PptPreviewPanel,
  useDescriptor: usePptPreviewPanelDescriptor,
};

const styles = StyleSheet.create(() => ({
  container: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: "transparent",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
}));

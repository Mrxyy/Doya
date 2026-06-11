import { useCallback, useEffect, useMemo, useState } from "react";
import { Presentation } from "lucide-react-native";
import { Text, View } from "react-native";
import invariant from "tiny-invariant";
import { StyleSheet } from "react-native-unistyles";
import { PptPreviewFrame } from "@/components/ppt-preview-frame";
import { useToast } from "@/contexts/toast-context";
import { translateNow } from "@/i18n/i18n";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { buildOptimisticUserMessage, generateMessageId } from "@/types/stream";
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

function buildApplyAnnotationsPrompt(projectName: string): string {
  const projectPath = JSON.stringify(`projects/${projectName}`);
  return `Apply the saved PPT preview annotations for project "${projectName}".

Use the bundled PPT Master live-preview annotation workflow. Do not restart the preview server, do not run scripts/svg_editor/server.py, and do not create a new deck from scratch.

Steps:
1. Inspect pending annotations with:
   python3 .paseo/skills/ppt-master/scripts/check_annotations.py ${projectPath}
2. If there are no annotations, tell me that no saved annotations were found and stop.
3. For every listed annotation, edit the targeted SVG element in ${projectPath}/svg_output/ according to the annotation text. Treat saved browser direct edits as already applied and preserve them.
4. Remove data-edit-target and data-edit-annotation from each element after applying its requested change.
5. Run the normal PPT Master finalize/export steps to regenerate the native editable PPTX in ${projectPath}/exports/.
6. Reply with a concise summary of what changed and the new PPTX path.`;
}

function PptPreviewPanel() {
  const { serverId, target } = usePaneContext();
  invariant(target.kind === "pptPreview", "PptPreviewPanel requires pptPreview target");
  const runtimeSnapshot = useHostRuntimeSnapshot(serverId);
  const activeConnection = runtimeSnapshot?.activeConnection ?? null;
  const client = runtimeSnapshot?.client ?? null;
  const toast = useToast();
  const appendOptimisticUserMessageToAgentStream = useSessionStore(
    (state) => state.appendOptimisticUserMessageToAgentStream,
  );
  const agentId = target.agentId;
  const projectName = target.projectName;
  const agentStatus = useSessionStore((state) => {
    const session = state.sessions[serverId];
    return (
      session?.agents.get(agentId)?.status ?? session?.agentDetails.get(agentId)?.status ?? null
    );
  });
  const [applyPhase, setApplyPhase] = useState<"idle" | "waiting" | "running">("idle");
  const [applyCompletionToken, setApplyCompletionToken] = useState(0);
  const previewUrl = useMemo(
    () =>
      buildWorkspacePptPreviewUrl({
        activeConnection,
        agentId,
        projectName,
      }),
    [activeConnection, agentId, projectName],
  );
  const handleApplyAnnotations = useCallback(() => {
    const activeClient = client;
    if (!activeClient) {
      toast.error(translateNow("ui.host.is.not.connected.n90cm6"));
      setApplyCompletionToken((token) => token + 1);
      return;
    }
    setApplyPhase(agentStatus === "running" ? "running" : "waiting");

    async function sendApplyAnnotationsPrompt(
      connectedClient: NonNullable<typeof client>,
    ): Promise<void> {
      const prompt = buildApplyAnnotationsPrompt(projectName);
      const messageId = generateMessageId();
      appendOptimisticUserMessageToAgentStream(
        serverId,
        agentId,
        buildOptimisticUserMessage({
          id: messageId,
          text: prompt,
          timestamp: new Date(),
        }),
        { placement: "active-head", skipIfUserMessageExists: true },
      );

      try {
        await connectedClient.sendAgentMessage(agentId, prompt, { messageId });
        toast.show(translateNow("ui.slides.annotations.apply.sent"), { variant: "success" });
      } catch (error) {
        setApplyPhase("idle");
        setApplyCompletionToken((token) => token + 1);
        toast.error(
          error instanceof Error
            ? error.message
            : translateNow("ui.slides.annotations.apply.failed"),
        );
      }
    }

    void sendApplyAnnotationsPrompt(activeClient);
  }, [
    agentId,
    agentStatus,
    appendOptimisticUserMessageToAgentStream,
    client,
    projectName,
    serverId,
    toast,
  ]);

  useEffect(() => {
    if (applyPhase === "waiting" && agentStatus === "running") {
      setApplyPhase("running");
      return;
    }
    if (applyPhase === "running" && agentStatus !== "running") {
      setApplyPhase("idle");
      setApplyCompletionToken((token) => token + 1);
    }
  }, [agentStatus, applyPhase]);

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
        applyAnnotationsCompletionToken={applyCompletionToken}
        onApplyAnnotations={handleApplyAnnotations}
        title={translateNow("ui.slides.preview.title", { name: projectName })}
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

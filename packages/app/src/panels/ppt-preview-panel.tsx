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
import { buildPaseoMessageMeta, escapePaseoMarkupText } from "@/utils/paseo-message-markup";
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

function buildApplyAnnotationsPrompt(projectName: string, messageId: string): string {
  const projectPath = `projects/${projectName}`;
  const projectPathArg = JSON.stringify(projectPath);
  const escapedProjectName = escapePaseoMarkupText(projectName);
  const escapedProjectPath = escapePaseoMarkupText(projectPath);
  const escapedMessageId = escapePaseoMarkupText(messageId);
  return `${buildPaseoMessageMeta()}

请根据当前 PPT 预览中保存的标注修改幻灯片，并导出新的可编辑 PPTX。

<paseo-expected-target
  version="1"
  kind="ppt.apply_annotations"
  goal="modify_pptx"
  id="${escapedMessageId}"
  text="修改 PPTX"
  desc="Exact target handshake that the assistant must emit before doing any work."
/>

<paseo-ui
  version="1"
  kind="ppt.apply_annotations"
  render="card"
  visibility="summary"
  id="${escapedMessageId}"
  desc="A Paseo-renderable task card for applying saved PPT preview annotations."
>
  <paseo-ui-content desc="User-visible card content. Paseo may render this instead of the full prompt.">
    <paseo-title desc="Title shown in the user message card.">应用 PPT 标注</paseo-title>
    <paseo-summary desc="Short user-visible summary of this task.">根据当前预览页保存的标注修改幻灯片</paseo-summary>
    <paseo-field name="project" label="项目" desc="PPT Master project directory name.">${escapedProjectName}</paseo-field>
  </paseo-ui-content>

  <paseo-ai desc="Task instructions the AI must follow. Paseo may hide this section from the chat UI.">
Apply the saved PPT preview annotations for project "${escapedProjectName}".

Use the bundled PPT Master live-preview annotation workflow.
Do not restart the preview server.
Do not run scripts/svg_editor/server.py.
Do not create a new deck from scratch.

Steps:
1. Inspect pending annotations with:
   python3 .paseo/skills/ppt-master/scripts/check_annotations.py ${projectPathArg}
2. If there are no annotations, tell me that no saved annotations were found and stop.
3. For every listed annotation, edit the targeted SVG element in ${escapedProjectPath}/svg_output/ according to the annotation text. Treat saved browser direct edits as already applied and preserve them.
4. Remove data-edit-target and data-edit-annotation from each element after applying its requested change.
5. Run the normal PPT Master finalize/export steps to regenerate the native editable PPTX in ${escapedProjectPath}/exports/.
  </paseo-ai>

  <paseo-reply desc="Preferred response format. Paseo may render a matching result block specially.">
When finished, reply with a concise summary and the exported PPTX path.

If possible, wrap the result in this structure and preserve the id "${escapedMessageId}":

<paseo-ui
  version="1"
  kind="ppt.apply_annotations.result"
  render="result-card"
  visibility="summary"
  id="${escapedMessageId}"
  desc="A Paseo-renderable result card for the PPT annotation application task."
>
  <paseo-ui-content desc="User-visible result content.">
    <paseo-title desc="Result card title.">PPT 标注已应用</paseo-title>
    <paseo-summary desc="Short summary of what changed.">一句话总结实际修改内容</paseo-summary>
    <paseo-field name="pptx_path" label="导出文件" desc="Path to the exported editable PPTX.">导出的 PPTX 路径</paseo-field>
  </paseo-ui-content>
  <paseo-ai desc="Optional technical notes for the conversation record.">
Briefly mention important implementation notes or warnings, if any.
  </paseo-ai>
</paseo-ui>
  </paseo-reply>
</paseo-ui>

完成后告诉我你改了什么，以及新的 PPTX 文件路径。

Project path for reference: ${escapedProjectPath}`;
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
      const messageId = generateMessageId();
      const prompt = buildApplyAnnotationsPrompt(projectName, messageId);
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

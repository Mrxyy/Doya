import { Suspense, lazy } from "react";
import { Text, View } from "react-native";
import invariant from "tiny-invariant";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelRegistration } from "@/panels/panel-registry";
import { useWorkspaceExecutionAuthority } from "@/stores/session-store-hooks";
import { translateNow } from "@/i18n/i18n";
import { FileText } from "@/components/icons/lucide";

const LazyFilePane = lazy(() =>
  import("@/components/file-pane").then((module) => ({ default: module.FilePane })),
);

const CENTERED_PADDED_STYLE = {
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
} as const;

function useFilePanelDescriptor(target: { kind: "file"; path: string }) {
  const fileName = target.path.split("/").findLast(Boolean) ?? target.path;
  return {
    label: fileName,
    subtitle: target.path,
    titleState: "ready" as const,
    icon: FileText,
    statusBucket: null,
  };
}

function FilePanel() {
  const { serverId, workspaceId, target } = usePaneContext();
  const workspaceAuthority = useWorkspaceExecutionAuthority(serverId, workspaceId);
  const workspaceDirectory = workspaceAuthority?.ok
    ? workspaceAuthority.authority.workspaceDirectory
    : null;
  invariant(target.kind === "file", "FilePanel requires file target");
  if (!workspaceDirectory) {
    return (
      <View style={CENTERED_PADDED_STYLE}>
        <Text>{translateNow("ui.workspace.execution.directory.not.found.o5uqnz")}</Text>
      </View>
    );
  }
  return (
    <Suspense fallback={null}>
      <LazyFilePane
        serverId={serverId}
        sourceAgentId={target.sourceAgentId}
        workspaceRoot={workspaceDirectory}
        location={target}
      />
    </Suspense>
  );
}

export const filePanelRegistration: PanelRegistration<"file"> = {
  kind: "file",
  component: FilePanel,
  useDescriptor: useFilePanelDescriptor,
};

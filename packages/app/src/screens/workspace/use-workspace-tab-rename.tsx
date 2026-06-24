import { useCallback, useState } from "react";
import { type QueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@getdoya/client/internal/daemon-client";
import type { ListTerminalsResponse } from "@getdoya/protocol/messages";
import { loadAccountBootstrapSession } from "@/account/account-api";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { updateControlSession } from "@/control/control-api";
import { useSessionStore } from "@/stores/session-store";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { translateNow } from "@/i18n/i18n";

interface RenamingTabState {
  kind: "terminal" | "agent";
  id: string;
  currentTitle: string;
  controlSessionId?: string | null;
}

interface UseWorkspaceTabRenameInput {
  client: DaemonClient | null;
  normalizedServerId: string;
  queryClient: QueryClient;
  terminalsData: ListTerminalsResponse["payload"] | undefined;
  terminalsQueryKey: readonly unknown[];
}

interface UseWorkspaceTabRenameResult {
  renamingTab: RenamingTabState | null;
  handleRenameTab: (tab: WorkspaceTabDescriptor) => void;
  handleRenameModalSubmit: (nextTitle: string) => Promise<void>;
  handleRenameModalClose: () => void;
}

export function useWorkspaceTabRename(
  input: UseWorkspaceTabRenameInput,
): UseWorkspaceTabRenameResult {
  const { client, normalizedServerId, queryClient, terminalsData, terminalsQueryKey } = input;
  const [renamingTab, setRenamingTab] = useState<RenamingTabState | null>(null);

  const handleRenameTab = useCallback(
    (tab: WorkspaceTabDescriptor) => {
      if (tab.target.kind === "terminal") {
        const { terminalId } = tab.target;
        const terminal = terminalsData?.terminals.find((entry) => entry.id === terminalId) ?? null;
        const currentTitle = terminal?.title ?? terminal?.name ?? "";
        setRenamingTab({ kind: "terminal", id: terminalId, currentTitle });
        return;
      }
      if (tab.target.kind === "agent") {
        const { agentId } = tab.target;
        const session = useSessionStore.getState().sessions[normalizedServerId];
        const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId) ?? null;
        const currentTitle = agent?.title ?? "";
        setRenamingTab({
          kind: "agent",
          id: agentId,
          currentTitle,
          controlSessionId: agent?.labels?.["doya.control.sessionId"] ?? null,
        });
      }
    },
    [normalizedServerId, terminalsData],
  );

  const handleRenameModalSubmit = useCallback(
    async (nextTitle: string) => {
      if (!renamingTab) return;
      if (!client) {
        throw new Error(translateNow("ui.host.is.not.connected.n90cm6"));
      }
      const trimmed = nextTitle.trim();
      if (renamingTab.kind === "terminal") {
        const result = await client.renameTerminal({
          terminalId: renamingTab.id,
          title: trimmed,
        });
        if (!result.success) {
          throw new Error(result.error ?? "Failed to rename terminal");
        }
        void queryClient.invalidateQueries({ queryKey: terminalsQueryKey });
        return;
      }
      await client.updateAgent(renamingTab.id, { name: trimmed });
      if (renamingTab.controlSessionId) {
        const accountSession = await loadAccountBootstrapSession();
        if (!accountSession) {
          throw new Error(translateNow("ui.login.required.short"));
        }
        await updateControlSession({
          accountSession,
          sessionId: renamingTab.controlSessionId,
          title: trimmed,
        });
      }
      void queryClient.invalidateQueries({
        queryKey: ["sidebarAgentsList", normalizedServerId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["allAgents", normalizedServerId],
      });
    },
    [client, normalizedServerId, queryClient, renamingTab, terminalsQueryKey],
  );

  const handleRenameModalClose = useCallback(() => {
    setRenamingTab(null);
  }, []);

  return {
    renamingTab,
    handleRenameTab,
    handleRenameModalSubmit,
    handleRenameModalClose,
  };
}

export interface WorkspaceTabRenameModalProps {
  renamingTab: RenamingTabState | null;
  onClose: () => void;
  onSubmit: (nextTitle: string) => Promise<void>;
}

export function WorkspaceTabRenameModal({
  renamingTab,
  onClose,
  onSubmit,
}: WorkspaceTabRenameModalProps) {
  const title =
    renamingTab?.kind === "terminal"
      ? translateNow("ui.rename.terminal")
      : translateNow("ui.rename.agent");
  const initialValue = renamingTab?.currentTitle ?? "";
  const testID = renamingTab
    ? `workspace-tab-rename-modal-${renamingTab.kind}-${renamingTab.id}`
    : undefined;
  return (
    <AdaptiveRenameModal
      visible={renamingTab !== null}
      title={title}
      initialValue={initialValue}
      submitLabel={translateNow("ui.rename.14f8jfi")}
      maxLength={200}
      onClose={onClose}
      onSubmit={onSubmit}
      testID={testID}
    />
  );
}

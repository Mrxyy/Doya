import { useCallback } from "react";
import { useAccountWorkspaceMetadata } from "@/account/use-account-workspace-metadata";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { generateDraftId } from "@/stores/draft-keys";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { openProjectDirectly } from "@/hooks/open-project";
import type { WorkspaceDescriptor } from "@/stores/session-store";

export interface OpenProjectOptions {
  transformWorkspace?: (workspace: WorkspaceDescriptor) => WorkspaceDescriptor;
}

export function useOpenProject(
  serverId: string | null,
): (path: string, options?: OpenProjectOptions) => Promise<boolean> {
  const normalizedServerId = serverId?.trim() ?? "";
  const client = useHostRuntimeClient(normalizedServerId);
  const isConnected = useHostRuntimeIsConnected(normalizedServerId);
  const accountSession = useAccountWorkspaceMetadata(normalizedServerId);
  const mergeWorkspaces = useSessionStore((state) => state.mergeWorkspaces);
  const setHasHydratedWorkspaces = useSessionStore((state) => state.setHasHydratedWorkspaces);

  return useCallback(
    async (path: string, options?: OpenProjectOptions) => {
      return openProjectDirectly({
        serverId: normalizedServerId,
        projectPath: path,
        isConnected,
        client,
        accountSession,
        transformWorkspace: options?.transformWorkspace,
        mergeWorkspaces,
        setHasHydratedWorkspaces,
        openDraftTab: (workspaceKey: string) =>
          useWorkspaceLayoutStore.getState().openTabFocused(workspaceKey, {
            kind: "draft",
            draftId: generateDraftId(),
          }),
        navigateToWorkspace,
      });
    },
    [
      accountSession,
      client,
      isConnected,
      mergeWorkspaces,
      normalizedServerId,
      setHasHydratedWorkspaces,
    ],
  );
}

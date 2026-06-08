import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AccountBootstrapSession } from "@/account/account-api";
import { isPathInAccountWorkspace } from "@/account/account-workspace-display";
import { normalizeWorkspaceDescriptor, type WorkspaceDescriptor } from "@/stores/session-store";
import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";

export interface OpenProjectDirectlyInput {
  serverId: string;
  projectPath: string;
  isConnected: boolean;
  client: Pick<DaemonClient, "openProject"> | null;
  accountSession?: AccountBootstrapSession | null;
  transformWorkspace?: (workspace: WorkspaceDescriptor) => WorkspaceDescriptor;
  mergeWorkspaces: (serverId: string, workspaces: Iterable<WorkspaceDescriptor>) => void;
  setHasHydratedWorkspaces: (serverId: string, hydrated: boolean) => void;
  openDraftTab: (workspaceKey: string) => string | null;
  navigateToWorkspace: (serverId: string, workspaceId: string) => void;
}

export async function openProjectDirectly(input: OpenProjectDirectlyInput): Promise<boolean> {
  const normalizedServerId = input.serverId.trim();
  const trimmedPath = input.projectPath.trim();
  if (!normalizedServerId || !trimmedPath || !input.client || !input.isConnected) {
    return false;
  }
  if (
    input.accountSession !== undefined &&
    !isPathInAccountWorkspace({ session: input.accountSession, path: trimmedPath })
  ) {
    return false;
  }

  const payload = await input.client.openProject(trimmedPath);
  if (payload.error || !payload.workspace) {
    return false;
  }

  const normalizedWorkspace = normalizeWorkspaceDescriptor(payload.workspace);
  const workspace = input.transformWorkspace
    ? input.transformWorkspace(normalizedWorkspace)
    : normalizedWorkspace;
  input.mergeWorkspaces(normalizedServerId, [workspace]);
  input.setHasHydratedWorkspaces(normalizedServerId, true);

  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: normalizedServerId,
    workspaceId: workspace.id,
  });
  if (!workspaceKey) {
    return false;
  }

  input.openDraftTab(workspaceKey);
  input.navigateToWorkspace(normalizedServerId, workspace.id);
  return true;
}

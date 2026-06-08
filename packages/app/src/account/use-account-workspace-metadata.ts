import { useCallback, useEffect, useState } from "react";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import {
  loadAccountBootstrapSession,
  subscribeAccountSessionChanges,
  type AccountBootstrapSession,
} from "@/account/account-api";
import {
  applyAccountProjectDisplay,
  applyAccountWorkspaceDisplay,
  doesAccountSessionOwnWorkspace,
  findAccountProjectForWorkspaceDirectory,
} from "@/account/account-workspace-display";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";

export function useAccountWorkspaceMetadata(
  serverId: string | null,
): AccountBootstrapSession | null {
  const [session, setSession] = useState<AccountBootstrapSession | null>(null);
  const accountWorkspaces = useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      if (!serverId || !session) {
        return [];
      }
      const workspaces = state.sessions[serverId]?.workspaces;
      if (!workspaces) {
        return [];
      }
      return Array.from(workspaces.values()).filter((workspace) =>
        doesAccountSessionOwnWorkspace({
          session,
          workspaceDirectory: workspace.workspaceDirectory,
        }),
      );
    },
    equal,
  );
  const mergeWorkspaces = useSessionStore((state) => state.mergeWorkspaces);
  const reloadSession = useCallback((isDisposed?: () => boolean) => {
    void (async () => {
      const stored = await loadAccountBootstrapSession();
      if (!isDisposed?.()) {
        setSession(stored);
      }
    })();
  }, []);

  useEffect(() => {
    let disposed = false;
    const isDisposed = () => disposed;
    reloadSession(isDisposed);
    const unsubscribe = subscribeAccountSessionChanges(() => reloadSession(isDisposed));
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [reloadSession]);

  useEffect(() => {
    if (!serverId || !session || accountWorkspaces.length === 0) {
      return;
    }
    const nextWorkspaces = accountWorkspaces
      .map((workspace) => applyAccountDisplayForWorkspace({ workspace, session }))
      .filter((workspace, index) => {
        const current = accountWorkspaces[index];
        return (
          current &&
          (workspace.name !== current.name ||
            workspace.projectDisplayName !== current.projectDisplayName ||
            workspace.projectCustomName !== current.projectCustomName)
        );
      });
    if (nextWorkspaces.length === 0) {
      return;
    }
    mergeWorkspaces(serverId, nextWorkspaces);
  }, [accountWorkspaces, mergeWorkspaces, serverId, session]);

  return session;
}

function applyAccountDisplayForWorkspace(input: {
  workspace: WorkspaceDescriptor;
  session: AccountBootstrapSession;
}): WorkspaceDescriptor {
  const project = findAccountProjectForWorkspaceDirectory({
    session: input.session,
    workspaceDirectory: input.workspace.workspaceDirectory,
  });
  return project
    ? applyAccountProjectDisplay({
        workspace: input.workspace,
        session: input.session,
        project,
      })
    : applyAccountWorkspaceDisplay({
        workspace: input.workspace,
        session: input.session,
      });
}

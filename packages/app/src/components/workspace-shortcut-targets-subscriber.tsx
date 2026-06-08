import { useEffect, useMemo } from "react";
import { useAccountWorkspaceMetadata } from "@/account/use-account-workspace-metadata";
import { useSidebarWorkspacesList } from "@/hooks/use-sidebar-workspaces-list";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import { buildSidebarShortcutModel } from "@/utils/sidebar-shortcuts";

export function WorkspaceShortcutTargetsSubscriber({
  enabled,
  serverId,
}: {
  enabled: boolean;
  serverId: string | null;
}) {
  const accountSession = useAccountWorkspaceMetadata(serverId);
  const { projects } = useSidebarWorkspacesList({
    serverId,
    enabled,
    accountSession,
    requireAccount: true,
  });
  const collapsedProjectKeys = useSidebarCollapsedSectionsStore(
    (state) => state.collapsedProjectKeys,
  );
  const setSidebarShortcutWorkspaceTargets = useKeyboardShortcutsStore(
    (state) => state.setSidebarShortcutWorkspaceTargets,
  );

  const shortcutModel = useMemo(
    () =>
      buildSidebarShortcutModel({
        projects,
        collapsedProjectKeys,
      }),
    [collapsedProjectKeys, projects],
  );

  useEffect(() => {
    if (!enabled || !serverId) {
      setSidebarShortcutWorkspaceTargets([]);
      return;
    }

    setSidebarShortcutWorkspaceTargets(shortcutModel.shortcutTargets);
  }, [enabled, serverId, setSidebarShortcutWorkspaceTargets, shortcutModel.shortcutTargets]);

  useEffect(() => {
    return () => {
      setSidebarShortcutWorkspaceTargets([]);
    };
  }, [setSidebarShortcutWorkspaceTargets]);

  return null;
}

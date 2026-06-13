import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { WorkspaceDescriptorPayload } from "@getdoya/protocol/messages";
import {
  normalizeWorkspaceDescriptor,
  useSessionStore,
  type WorkspaceDescriptor,
} from "@/stores/session-store";
import type { AccountBootstrapSession, AccountProjectRecord } from "@/account/account-api";
import {
  accountProjectDisplayName,
  doesAccountSessionOwnWorkspace,
  findAccountProjectForWorkspaceDirectory,
} from "@/account/account-workspace-display";
import { selectPrHintFromStatus } from "@/git/use-pr-status-query";
import { useWorkspaceStructureForFilter } from "@/stores/session-store-hooks";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { shouldSuppressWorkspaceForLocalArchive } from "@/contexts/session-workspace-upserts";
import {
  buildSidebarProjectsFromStructure,
  computeSidebarOrderUpdates,
  deriveSidebarLoadingState,
  type SidebarProjectEntry,
  type SidebarWorkspaceEntry,
} from "./sidebar-workspaces-view-model";

export {
  appendMissingOrderKeys,
  applyStoredOrdering,
  buildSidebarProjectsFromStructure,
  computeSidebarOrderUpdates,
  deriveSidebarLoadingState,
  type SidebarLoadingState,
  type SidebarOrderUpdates,
  type SidebarProjectEntry,
  type SidebarStateBucket,
  type SidebarWorkspaceEntry,
} from "./sidebar-workspaces-view-model";

export function createSidebarWorkspaceEntry(input: {
  serverId: string;
  workspace: WorkspaceDescriptor;
}): SidebarWorkspaceEntry {
  return {
    workspaceKey: `${input.serverId}:${input.workspace.id}`,
    serverId: input.serverId,
    workspaceId: input.workspace.id,
    projectKey: input.workspace.project?.projectKey ?? input.workspace.projectId,
    projectRootPath: input.workspace.projectRootPath,
    workspaceDirectory: input.workspace.workspaceDirectory,
    projectKind: input.workspace.projectKind,
    workspaceKind: input.workspace.workspaceKind,
    name: input.workspace.name,
    statusBucket: input.workspace.status,
    archivingAt: input.workspace.archivingAt,
    diffStat: input.workspace.diffStat,
    prHint: selectPrHintFromStatus(input.workspace.githubRuntime?.pullRequest),
    archiveHasUncommittedChanges: input.workspace.gitRuntime?.isDirty ?? null,
    archiveUnpushedCommitCount: input.workspace.gitRuntime?.aheadOfOrigin ?? null,
    scripts: input.workspace.scripts,
    hasRunningScripts: input.workspace.scripts.some((script) => script.lifecycle === "running"),
  };
}

const EMPTY_ORDER: string[] = [];
const EMPTY_PROJECTS: SidebarProjectEntry[] = [];

export interface SidebarWorkspacesListResult {
  projects: SidebarProjectEntry[];
  isLoading: boolean;
  isInitialLoad: boolean;
  isRevalidating: boolean;
  refreshAll: () => void;
}

function toWorkspaceDescriptor(payload: WorkspaceDescriptorPayload): WorkspaceDescriptor {
  return normalizeWorkspaceDescriptor(payload);
}

function mergeAccountProjectsIntoSidebar(input: {
  accountProjects: AccountProjectRecord[];
  workspaceProjects: SidebarProjectEntry[];
}): SidebarProjectEntry[] {
  if (input.accountProjects.length === 0) {
    return EMPTY_PROJECTS;
  }

  const workspaceProjectByAccountProjectId = new Map<string, SidebarProjectEntry>();
  const unmatchedWorkspaceProjects = [...input.workspaceProjects];
  for (const accountProject of input.accountProjects) {
    const index = unmatchedWorkspaceProjects.findIndex((project) =>
      sidebarProjectMatchesAccountProject(project, accountProject),
    );
    if (index < 0) {
      continue;
    }
    const [workspaceProject] = unmatchedWorkspaceProjects.splice(index, 1);
    if (workspaceProject) {
      workspaceProjectByAccountProjectId.set(accountProject.projectId, workspaceProject);
    }
  }

  return input.accountProjects.map((accountProject) => {
    const workspaceProject = workspaceProjectByAccountProjectId.get(accountProject.projectId);
    if (workspaceProject) {
      const primaryWorkspace = selectPrimaryAccountProjectWorkspace({
        accountProject,
        workspaces: workspaceProject.workspaces,
      });
      return {
        ...workspaceProject,
        projectKey: accountProject.projectId,
        projectName: accountProjectDisplayName(accountProject.displayName),
        projectKind: "directory",
        iconWorkingDir: accountProject.cwd,
        workspaces: primaryWorkspace
          ? [
              mapWorkspaceToAccountProject({
                workspace: primaryWorkspace,
                accountProject,
              }),
            ]
          : [],
      };
    }
    return {
      projectKey: accountProject.projectId,
      projectName: accountProjectDisplayName(accountProject.displayName),
      projectKind: "directory",
      iconWorkingDir: accountProject.cwd,
      workspaces: [],
    };
  });
}

function selectPrimaryAccountProjectWorkspace(input: {
  accountProject: AccountProjectRecord;
  workspaces: SidebarWorkspaceEntry[];
}): SidebarWorkspaceEntry | null {
  const exactWorkspace = input.workspaces.find(
    (workspace) => workspace.workspaceDirectory === input.accountProject.cwd,
  );
  return exactWorkspace ?? input.workspaces[0] ?? null;
}

function mapWorkspaceToAccountProject(input: {
  workspace: SidebarWorkspaceEntry;
  accountProject: AccountProjectRecord;
}): SidebarWorkspaceEntry {
  return {
    workspaceKey: input.workspace.workspaceKey,
    serverId: input.workspace.serverId,
    workspaceId: input.workspace.workspaceId,
    projectKey: input.accountProject.projectId,
    projectRootPath: input.accountProject.cwd,
    workspaceDirectory: input.workspace.workspaceDirectory,
    projectKind: input.workspace.projectKind,
    workspaceKind: input.workspace.workspaceKind,
    name: input.workspace.name,
    statusBucket: input.workspace.statusBucket,
    archivingAt: input.workspace.archivingAt,
    diffStat: input.workspace.diffStat,
    prHint: input.workspace.prHint,
    archiveHasUncommittedChanges: input.workspace.archiveHasUncommittedChanges,
    archiveUnpushedCommitCount: input.workspace.archiveUnpushedCommitCount,
    scripts: input.workspace.scripts,
    hasRunningScripts: input.workspace.hasRunningScripts,
  };
}

function sidebarProjectMatchesAccountProject(
  sidebarProject: SidebarProjectEntry,
  accountProject: AccountProjectRecord,
): boolean {
  if (sidebarProject.projectKey === accountProject.projectId) {
    return true;
  }
  if (sidebarProject.iconWorkingDir === accountProject.cwd) {
    return true;
  }
  return sidebarProject.workspaces.some((workspace) => {
    const workspaceDirectory = workspace.workspaceDirectory?.trim();
    return Boolean(
      workspaceDirectory &&
      (workspaceDirectory === accountProject.cwd ||
        workspaceDirectory.startsWith(`${accountProject.cwd}/`) ||
        workspaceDirectory.startsWith(`${accountProject.cwd}\\`)),
    );
  });
}

export function useSidebarWorkspacesList(options?: {
  serverId?: string | null;
  enabled?: boolean;
  accountSession?: AccountBootstrapSession | null;
  requireAccount?: boolean;
}): SidebarWorkspacesListResult {
  const runtime = getHostRuntimeStore();

  const serverId = useMemo(() => {
    const value = options?.serverId;
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }, [options?.serverId]);
  const isActive = Boolean(serverId) && options?.enabled !== false;
  const persistedProjectOrder = useSidebarOrderStore((state) =>
    isActive && serverId ? (state.projectOrderByServerId[serverId] ?? EMPTY_ORDER) : EMPTY_ORDER,
  );
  const hasHydratedWorkspaces = useSessionStore((state) =>
    isActive && serverId ? (state.sessions[serverId]?.hasHydratedWorkspaces ?? false) : false,
  );
  const shouldFilterByAccount = options?.requireAccount === true;
  const accountSession = options?.accountSession ?? null;
  const workspaceFilter = useCallback(
    (workspace: WorkspaceDescriptor) => {
      if (!shouldFilterByAccount) {
        return true;
      }
      if (!accountSession) {
        return false;
      }
      if (
        !doesAccountSessionOwnWorkspace({
          session: accountSession,
          workspaceDirectory: workspace.workspaceDirectory,
        })
      ) {
        return false;
      }
      return Boolean(
        findAccountProjectForWorkspaceDirectory({
          session: accountSession,
          workspaceDirectory: workspace.workspaceDirectory,
        }),
      );
    },
    [accountSession, shouldFilterByAccount],
  );
  const projectDisplayNameForWorkspace = useCallback(
    (workspace: WorkspaceDescriptor) => {
      if (!shouldFilterByAccount || !accountSession) {
        return null;
      }
      return (
        findAccountProjectForWorkspaceDirectory({
          session: accountSession,
          workspaceDirectory: workspace.workspaceDirectory,
        })?.displayName ?? null
      );
    },
    [accountSession, shouldFilterByAccount],
  );
  const workspaceStructure = useWorkspaceStructureForFilter(
    isActive ? serverId : null,
    workspaceFilter,
    projectDisplayNameForWorkspace,
  );

  const connectionStatus = useSyncExternalStore(
    (onStoreChange) =>
      isActive && serverId ? runtime.subscribe(serverId, onStoreChange) : () => {},
    () => {
      if (!isActive || !serverId) {
        return "idle";
      }
      const snapshot = runtime.getSnapshot(serverId);
      return snapshot?.connectionStatus ?? "idle";
    },
    () => {
      if (!isActive || !serverId) {
        return "idle";
      }
      const snapshot = runtime.getSnapshot(serverId);
      return snapshot?.connectionStatus ?? "idle";
    },
  );

  const projects = useMemo(() => {
    if (!serverId) {
      return EMPTY_PROJECTS;
    }
    const workspaceProjects = buildSidebarProjectsFromStructure({
      serverId,
      projects: workspaceStructure.projects,
    });
    if (!shouldFilterByAccount || !accountSession) {
      return workspaceProjects.length === 0 ? EMPTY_PROJECTS : workspaceProjects;
    }
    return mergeAccountProjectsIntoSidebar({
      accountProjects: accountSession.projects.filter(
        (project) => project.workspaceId === accountSession.workspace.workspaceId,
      ),
      workspaceProjects,
    });
  }, [accountSession, serverId, shouldFilterByAccount, workspaceStructure]);

  useEffect(() => {
    if (!serverId) {
      return;
    }
  }, [connectionStatus, hasHydratedWorkspaces, projects, serverId]);

  useEffect(() => {
    if (!serverId) {
      return;
    }

    const orderStore = useSidebarOrderStore.getState();
    const updates = computeSidebarOrderUpdates({
      projects,
      persistedProjectOrder,
      getWorkspaceOrder: (projectKey) => orderStore.getWorkspaceOrder(serverId, projectKey),
    });

    if (updates.projectOrder) {
      orderStore.setProjectOrder(serverId, updates.projectOrder);
    }
    for (const { projectKey, order } of updates.workspaceOrders) {
      orderStore.setWorkspaceOrder(serverId, projectKey, order);
    }
  }, [persistedProjectOrder, projects, serverId]);

  const refreshAll = useCallback(() => {
    if (!isActive || !serverId || connectionStatus !== "online") {
      return;
    }
    const client = runtime.getClient(serverId);
    if (!client) {
      return;
    }
    void (async () => {
      const next = new Map<string, WorkspaceDescriptor>();
      let cursor: string | null = null;
      try {
        while (true) {
          const payload = await client.fetchWorkspaces({
            sort: [{ key: "activity_at", direction: "desc" }],
            page: cursor ? { limit: 200, cursor } : { limit: 200 },
          });
          for (const entry of payload.entries) {
            const workspace = toWorkspaceDescriptor(entry);
            if (shouldSuppressWorkspaceForLocalArchive({ serverId, workspace })) {
              continue;
            }
            next.set(workspace.id, workspace);
          }
          if (!payload.pageInfo.hasMore || !payload.pageInfo.nextCursor) {
            break;
          }
          cursor = payload.pageInfo.nextCursor;
        }
        const store = useSessionStore.getState();
        store.setWorkspaces(serverId, next);
        store.setHasHydratedWorkspaces(serverId, true);
      } catch (error) {
        console.error("[WorkspaceFetch][sidebar-refresh] failed", {
          serverId,
          cursor,
          error,
        });
        // ignore explicit refresh failures; hook keeps existing data
      }
    })();
  }, [connectionStatus, isActive, runtime, serverId]);

  const loadingState = deriveSidebarLoadingState({
    isActive,
    serverId,
    hasHydratedWorkspaces,
    hasProjects: projects.length > 0,
  });

  return {
    projects,
    ...loadingState,
    refreshAll,
  };
}

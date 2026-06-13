import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DaemonClient } from "@getdoya/client/internal/daemon-client";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { normalizeWorkspaceDescriptor, type WorkspaceDescriptor } from "@/stores/session-store";
import { buildProjects, type ProjectHost, type ProjectSummary } from "@/utils/projects";
import {
  loadAccountBootstrapSession,
  subscribeAccountSessionChanges,
  type AccountBootstrapSession,
} from "@/account/account-api";
import {
  applyAccountProjectDisplay,
  doesAccountSessionOwnWorkspace,
  findAccountProjectForWorkspaceDirectory,
} from "@/account/account-workspace-display";

export const projectsQueryKey = ["projects"] as const;

export interface ProjectHostError {
  serverId: string;
  serverName: string;
  message: string;
}

export interface UseProjectsResult {
  projects: ProjectSummary[];
  hostErrors: ProjectHostError[];
  isLoading: boolean;
  isFetching: boolean;
  refetch: () => void;
}

export interface ProjectsRuntimeSnapshot {
  connectionStatus: string;
}

export interface ProjectsRuntime {
  getClient(serverId: string): Pick<DaemonClient, "fetchWorkspaces"> | null;
  getSnapshot(serverId: string): ProjectsRuntimeSnapshot | null | undefined;
}

export interface ProjectsHostInput {
  serverId: string;
  serverName: string;
}

export interface FetchAggregatedProjectsInput {
  hosts: ProjectsHostInput[];
  runtime: ProjectsRuntime;
  accountSession?: AccountBootstrapSession | null;
}

export interface FetchAggregatedProjectsResult {
  projects: ProjectSummary[];
  hostErrors: ProjectHostError[];
}

interface HostWorkspacesResult {
  host: ProjectHost;
  error: ProjectHostError | null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchAllWorkspaceDescriptors(
  client: Pick<DaemonClient, "fetchWorkspaces">,
): Promise<WorkspaceDescriptor[]> {
  const entries: WorkspaceDescriptor[] = [];
  let cursor: string | null = null;

  while (true) {
    const payload = await client.fetchWorkspaces({
      sort: [{ key: "name", direction: "asc" }],
      page: cursor ? { limit: 200, cursor } : { limit: 200 },
    });
    entries.push(...payload.entries.map((entry) => normalizeWorkspaceDescriptor(entry)));
    if (!payload.pageInfo.hasMore || !payload.pageInfo.nextCursor) {
      break;
    }
    cursor = payload.pageInfo.nextCursor;
  }

  return entries;
}

function applyAccountProjectScope(
  workspaces: WorkspaceDescriptor[],
  accountSession: AccountBootstrapSession | null | undefined,
): WorkspaceDescriptor[] {
  if (!accountSession) {
    return workspaces;
  }
  const scopedWorkspaces: WorkspaceDescriptor[] = [];
  for (const workspace of workspaces) {
    if (
      !doesAccountSessionOwnWorkspace({
        session: accountSession,
        workspaceDirectory: workspace.workspaceDirectory,
      })
    ) {
      continue;
    }
    const project = findAccountProjectForWorkspaceDirectory({
      session: accountSession,
      workspaceDirectory: workspace.workspaceDirectory,
    });
    if (!project) {
      continue;
    }
    scopedWorkspaces.push(
      applyAccountProjectDisplay({
        workspace,
        session: accountSession,
        project,
      }),
    );
  }
  return scopedWorkspaces;
}

export async function fetchAggregatedProjects(
  input: FetchAggregatedProjectsInput,
): Promise<FetchAggregatedProjectsResult> {
  const results = await Promise.all(
    input.hosts.map(async (host): Promise<HostWorkspacesResult> => {
      const snapshot = input.runtime.getSnapshot(host.serverId);
      const isOnline = snapshot?.connectionStatus === "online";
      const client = input.runtime.getClient(host.serverId);

      if (!client || !isOnline) {
        return {
          host: {
            serverId: host.serverId,
            serverName: host.serverName,
            isOnline,
            workspaces: [],
          },
          error: null,
        };
      }

      try {
        return {
          host: {
            serverId: host.serverId,
            serverName: host.serverName,
            isOnline,
            workspaces: applyAccountProjectScope(
              await fetchAllWorkspaceDescriptors(client),
              input.accountSession,
            ),
          },
          error: null,
        };
      } catch (error) {
        return {
          host: {
            serverId: host.serverId,
            serverName: host.serverName,
            isOnline,
            workspaces: [],
          },
          error: {
            serverId: host.serverId,
            serverName: host.serverName,
            message: toErrorMessage(error),
          },
        };
      }
    }),
  );

  const hostErrors = results.flatMap((result) => (result.error ? [result.error] : []));
  return {
    ...buildProjects({ hosts: results.map((result) => result.host) }),
    hostErrors,
  };
}

export function useProjects(): UseProjectsResult {
  const hosts = useHosts();
  const runtime = getHostRuntimeStore();
  const accountSession = useAccountBootstrapSessionForProjects();
  const hostInputs = useMemo<ProjectsHostInput[]>(
    () =>
      hosts.map((host) => ({
        serverId: host.serverId,
        serverName: host.label,
      })),
    [hosts],
  );

  const projectsQuery = useQuery({
    queryKey: [
      ...projectsQueryKey,
      accountSession === undefined ? "loading-account" : (accountSession?.user.userId ?? "guest"),
      accountSession?.workspace.workspaceId ?? "",
      accountSession?.projects.map((project) => project.projectId).join(",") ?? "",
    ],
    queryFn: () =>
      fetchAggregatedProjects({
        hosts: hostInputs,
        runtime,
        accountSession: accountSession ?? null,
      }),
    enabled: accountSession !== undefined,
  });

  return {
    projects: projectsQuery.data?.projects ?? [],
    hostErrors: projectsQuery.data?.hostErrors ?? [],
    isLoading: accountSession === undefined || projectsQuery.isLoading,
    isFetching: projectsQuery.isFetching,
    refetch: () => {
      void projectsQuery.refetch();
    },
  };
}

function useAccountBootstrapSessionForProjects(): AccountBootstrapSession | null | undefined {
  const [accountSession, setAccountSession] = useState<AccountBootstrapSession | null | undefined>(
    undefined,
  );
  const reloadSession = useCallback((isDisposed?: () => boolean) => {
    void (async () => {
      const stored = await loadAccountBootstrapSession();
      if (!isDisposed?.()) {
        setAccountSession(stored);
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

  return accountSession;
}

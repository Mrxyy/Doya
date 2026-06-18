import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import type { WorkspaceDescriptor } from "@/stores/session-store";

export type WorkspaceRouteState =
  | { kind: "ready" }
  | {
      kind: "reconnecting";
      hostName: string;
      hostAddress?: string;
      connectionStatus: Exclude<HostRuntimeConnectionStatus, "online">;
      lastError: string | null;
    }
  | {
      kind: "unreachable";
      hostName: string;
      hostAddress?: string;
      connectionStatus: Exclude<HostRuntimeConnectionStatus, "online">;
      lastError: string | null;
    }
  | { kind: "loading"; hostName: string; hostAddress?: string }
  | { kind: "missing"; hostName: string };

export function resolveWorkspaceRouteState(input: {
  hostName: string;
  hostAddress?: string;
  connectionStatus: HostRuntimeConnectionStatus;
  lastError: string | null;
  workspace: WorkspaceDescriptor | null;
  hasHydratedWorkspaces: boolean;
}): WorkspaceRouteState {
  const addressFields = input.hostAddress ? { hostAddress: input.hostAddress } : {};

  if (input.workspace) {
    if (input.connectionStatus === "online") {
      return { kind: "ready" };
    }

    return {
      kind: "reconnecting",
      hostName: input.hostName,
      ...addressFields,
      connectionStatus: input.connectionStatus,
      lastError: input.lastError,
    };
  }

  if (input.connectionStatus === "online") {
    if (input.hasHydratedWorkspaces) {
      return { kind: "missing", hostName: input.hostName };
    }

    return { kind: "loading", hostName: input.hostName, ...addressFields };
  }

  return {
    kind: "unreachable",
    hostName: input.hostName,
    ...addressFields,
    connectionStatus: input.connectionStatus,
    lastError: input.lastError,
  };
}

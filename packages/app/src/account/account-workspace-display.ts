import type { AccountBootstrapSession, AccountProjectRecord } from "@/account/account-api";
import { translateNow } from "@/i18n/i18n";
import type { WorkspaceDescriptor } from "@/stores/session-store";

const ACCOUNT_WORKSPACE_PATH_PATTERN =
  /(?:^|[/\\])accounts[/\\]workspaces[/\\]ws_[^/\\]+(?:[/\\].*)?$/;
const LEGACY_ZH_DEFAULT_ACCOUNT_PROJECT_NAME = "\u65b0\u9879\u76ee";
const LEGACY_DEFAULT_ACCOUNT_PROJECT_NAMES = new Set([
  "New project",
  LEGACY_ZH_DEFAULT_ACCOUNT_PROJECT_NAME,
]);

export function isAccountWorkspaceDirectory(path: string | null | undefined): boolean {
  return ACCOUNT_WORKSPACE_PATH_PATTERN.test(path?.trim() ?? "");
}

export function applyAccountWorkspaceFallbackDisplay(
  workspace: WorkspaceDescriptor,
): WorkspaceDescriptor {
  if (!isAccountWorkspaceDirectory(workspace.workspaceDirectory)) {
    return workspace;
  }
  const accountProjectName =
    workspace.projectDisplayName || translateNow("account.workspace.displayName");
  return {
    ...workspace,
    name: workspace.name.startsWith("ws_")
      ? translateNow("account.workspace.fallbackName")
      : workspace.name,
    projectDisplayName: accountProjectName,
    projectCustomName: accountProjectName,
  };
}

export function applyAccountWorkspaceDisplay(input: {
  workspace: WorkspaceDescriptor;
  session: AccountBootstrapSession;
}): WorkspaceDescriptor {
  const workspaceName = input.session.workspace.displayName.trim() || input.workspace.name;
  return {
    ...input.workspace,
    name: workspaceName,
    projectDisplayName: workspaceName,
    projectCustomName: workspaceName,
  };
}

export function applyAccountProjectDisplay(input: {
  workspace: WorkspaceDescriptor;
  session: AccountBootstrapSession;
  project: AccountProjectRecord;
}): WorkspaceDescriptor {
  const projectName =
    accountProjectDisplayName(input.project.displayName).trim() || input.workspace.name;
  return {
    ...input.workspace,
    name: projectName,
    projectDisplayName: projectName,
    projectCustomName: projectName,
  };
}

export function accountProjectDisplayName(displayName: string): string {
  const trimmed = displayName.trim();
  return LEGACY_DEFAULT_ACCOUNT_PROJECT_NAMES.has(trimmed)
    ? translateNow("account.project.defaultName")
    : displayName;
}

export function findAccountProjectForWorkspaceDirectory(input: {
  session: AccountBootstrapSession;
  workspaceDirectory: string | null | undefined;
}): AccountProjectRecord | null {
  const workspaceDirectory = input.workspaceDirectory?.trim();
  if (!workspaceDirectory) {
    return null;
  }
  const projects = [...input.session.projects].sort((a, b) => b.cwd.length - a.cwd.length);
  return (
    projects.find(
      (project) =>
        workspaceDirectory === project.cwd ||
        workspaceDirectory.startsWith(`${project.cwd}/`) ||
        workspaceDirectory.startsWith(`${project.cwd}\\`),
    ) ?? null
  );
}

export function isPathInAccountWorkspace(input: {
  session: AccountBootstrapSession | null;
  path: string | null | undefined;
}): boolean {
  const sessionCwd = input.session?.workspace.runtime?.cwd?.trim();
  const candidatePath = input.path?.trim();
  return Boolean(sessionCwd && candidatePath && isSameOrChildPath(candidatePath, sessionCwd));
}

export function isAccountSessionUsableForDirectHost(input: {
  session: AccountBootstrapSession | null | undefined;
  endpoint: string | null | undefined;
}): boolean {
  const sessionEndpoint = normalizeAccountApiEndpoint(input.session?.apiBaseUrl);
  const hostEndpoint = normalizeDirectHostEndpoint(input.endpoint);
  return Boolean(sessionEndpoint && hostEndpoint && sessionEndpoint === hostEndpoint);
}

export function selectAccountSessionForDirectHost(input: {
  session: AccountBootstrapSession | null | undefined;
  endpoint: string | null | undefined;
}): AccountBootstrapSession | null {
  return isAccountSessionUsableForDirectHost(input) ? (input.session ?? null) : null;
}

export function doesAccountSessionOwnWorkspace(input: {
  session: AccountBootstrapSession | null;
  workspaceDirectory: string | null | undefined;
}): boolean {
  return isPathInAccountWorkspace({
    session: input.session,
    path: input.workspaceDirectory,
  });
}

function normalizeAccountApiEndpoint(apiBaseUrl: string | null | undefined): string | null {
  const trimmed = apiBaseUrl?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return normalizeDirectHostEndpoint(new URL(trimmed).host);
  } catch {
    return null;
  }
}

function normalizeDirectHostEndpoint(endpoint: string | null | undefined): string | null {
  const trimmed = endpoint?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
    const hostname = normalizeLoopbackHostname(parsed.hostname.toLowerCase());
    return parsed.port ? `${hostname}:${parsed.port}` : hostname;
  } catch {
    return null;
  }
}

function normalizeLoopbackHostname(hostname: string): string {
  return hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]"
    ? "localhost"
    : hostname;
}

function isSameOrChildPath(candidatePath: string, parentPath: string): boolean {
  return (
    candidatePath === parentPath ||
    candidatePath.startsWith(`${parentPath}/`) ||
    candidatePath.startsWith(`${parentPath}\\`)
  );
}

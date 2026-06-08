import type { AccountBootstrapSession, AccountProjectRecord } from "@/account/account-api";
import { translateNow } from "@/i18n/i18n";
import type { WorkspaceDescriptor } from "@/stores/session-store";

const ACCOUNT_WORKSPACE_PATH_PATTERN =
  /(?:^|[/\\])accounts[/\\]workspaces[/\\]ws_[^/\\]+(?:[/\\].*)?$/;
const LEGACY_DEFAULT_ACCOUNT_PROJECT_NAMES = new Set(["New project", "新项目"]);

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

export function doesAccountSessionOwnWorkspace(input: {
  session: AccountBootstrapSession | null;
  workspaceDirectory: string | null | undefined;
}): boolean {
  return isPathInAccountWorkspace({
    session: input.session,
    path: input.workspaceDirectory,
  });
}

function isSameOrChildPath(candidatePath: string, parentPath: string): boolean {
  return (
    candidatePath === parentPath ||
    candidatePath.startsWith(`${parentPath}/`) ||
    candidatePath.startsWith(`${parentPath}\\`)
  );
}

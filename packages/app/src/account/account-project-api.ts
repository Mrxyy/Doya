import { postLegacyAccountApi, type AccountProjectRecord } from "@/account/account-api";
import { isControlApiConfigured } from "@/control/control-api";
import { translateNow } from "@/i18n/i18n";

interface AccountCreateProjectResponse {
  project: AccountProjectRecord;
}

interface AccountDeleteProjectResponse {
  projects: AccountProjectRecord[];
}

interface AccountRenameProjectResponse {
  projects: AccountProjectRecord[];
}

export async function createAccountProject(input: {
  userId: string;
  workspaceId: string;
  accessToken: string;
  displayName: string;
}): Promise<AccountProjectRecord> {
  rejectControlWorkspaceProjectMutation(input.workspaceId);
  const payload = await postLegacyAccountApi<AccountCreateProjectResponse>(
    "/api/account/projects",
    input,
  );
  return payload.project;
}

export async function deleteAccountProject(input: {
  userId: string;
  workspaceId: string;
  projectId: string;
  accessToken: string;
}): Promise<AccountProjectRecord[]> {
  rejectControlWorkspaceProjectMutation(input.workspaceId);
  const payload = await postLegacyAccountApi<AccountDeleteProjectResponse>(
    "/api/account/projects/delete",
    input,
  );
  return payload.projects ?? [];
}

export async function renameAccountProject(input: {
  userId: string;
  workspaceId: string;
  projectId: string;
  accessToken: string;
  displayName: string;
}): Promise<AccountProjectRecord[]> {
  rejectControlWorkspaceProjectMutation(input.workspaceId);
  const payload = await postLegacyAccountApi<AccountRenameProjectResponse>(
    "/api/account/projects/rename",
    input,
  );
  return payload.projects ?? [];
}

function rejectControlWorkspaceProjectMutation(workspaceId: string): void {
  if (isControlApiConfigured() || workspaceId.startsWith("control:")) {
    throw new Error(translateNow("openProject.error.createProject"));
  }
}

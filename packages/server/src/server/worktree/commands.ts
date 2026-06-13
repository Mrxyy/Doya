import { join } from "node:path";

import { getDoyaWorktreesRoot, isDoyaOwnedWorktreeCwd } from "../../utils/worktree.js";
import {
  archiveDoyaWorktree,
  type ArchiveDoyaWorktreeDependencies,
} from "../doya-worktree-archive-service.js";
import type {
  CreateDoyaWorktreeInput,
  CreateDoyaWorktreeResult,
} from "../doya-worktree-service.js";
import { toWorktreeWireError, type WorktreeWireError } from "../worktree-errors.js";
import type { WorkspaceGitService, WorkspaceGitWorktreeInfo } from "../workspace-git-service.js";

export interface ListDoyaWorktreesCommandDependencies {
  workspaceGitService: Pick<WorkspaceGitService, "listWorktrees">;
}

export interface ListDoyaWorktreesCommandInput {
  cwd: string;
  reason?: string;
}

export async function listDoyaWorktreesCommand(
  dependencies: ListDoyaWorktreesCommandDependencies,
  input: ListDoyaWorktreesCommandInput,
): Promise<WorkspaceGitWorktreeInfo[]> {
  if (input.reason) {
    return dependencies.workspaceGitService.listWorktrees(input.cwd, { reason: input.reason });
  }
  return dependencies.workspaceGitService.listWorktrees(input.cwd);
}

type CreateDoyaWorktreeWorkflow<Result extends CreateDoyaWorktreeResult> = (
  input: CreateDoyaWorktreeInput,
) => Promise<Result>;

export interface CreateDoyaWorktreeCommandDependencies<
  Result extends CreateDoyaWorktreeResult = CreateDoyaWorktreeResult,
> {
  doyaHome?: string;
  worktreesRoot?: string;
  createDoyaWorktreeWorkflow?: CreateDoyaWorktreeWorkflow<Result>;
}

export type CreateDoyaWorktreeCommandInput = Omit<
  CreateDoyaWorktreeInput,
  "doyaHome" | "doyaHome" | "runSetup"
> & {
  doyaHome?: string;
  worktreesRoot?: string;
};

export type CreateDoyaWorktreeCommandResult<Result extends CreateDoyaWorktreeResult> =
  | {
      ok: true;
      createdWorktree: Result;
    }
  | {
      ok: false;
      error: WorktreeWireError;
      cause: unknown;
    };

export async function createDoyaWorktreeCommand<Result extends CreateDoyaWorktreeResult>(
  dependencies: CreateDoyaWorktreeCommandDependencies<Result>,
  input: CreateDoyaWorktreeCommandInput,
): Promise<CreateDoyaWorktreeCommandResult<Result>> {
  try {
    if (!dependencies.createDoyaWorktreeWorkflow) {
      throw new Error("Doya worktree service is not configured");
    }

    const createdWorktree = await dependencies.createDoyaWorktreeWorkflow({
      ...input,
      runSetup: false,
      doyaHome: input.doyaHome ?? dependencies.doyaHome,
      worktreesRoot: input.worktreesRoot ?? dependencies.worktreesRoot,
    });
    return { ok: true, createdWorktree };
  } catch (error) {
    return {
      ok: false,
      error: toWorktreeWireError(error),
      cause: error,
    };
  }
}

export interface ArchiveDoyaWorktreeCommandDependencies extends Omit<
  ArchiveDoyaWorktreeDependencies,
  "workspaceGitService"
> {
  workspaceGitService: Pick<WorkspaceGitService, "getSnapshot" | "listWorktrees">;
}

export interface ArchiveDoyaWorktreeCommandInput {
  requestId: string;
  repoRoot?: string | null;
  worktreePath?: string;
  worktreeSlug?: string;
  branchName?: string;
}

export type ArchiveDoyaWorktreeCommandResult =
  | {
      ok: true;
      removedAgents: string[];
    }
  | {
      ok: false;
      code: "NOT_ALLOWED";
      message: string;
      removedAgents: [];
    };

export async function archiveDoyaWorktreeCommand(
  dependencies: ArchiveDoyaWorktreeCommandDependencies,
  input: ArchiveDoyaWorktreeCommandInput,
): Promise<ArchiveDoyaWorktreeCommandResult> {
  const resolvedTarget = await resolveArchiveTarget(dependencies, input);
  const ownership = await isDoyaOwnedWorktreeCwd(resolvedTarget.targetPath, {
    doyaHome: dependencies.doyaHome,
    worktreesRoot: dependencies.worktreesRoot,
  });

  if (!ownership.allowed) {
    return {
      ok: false,
      code: "NOT_ALLOWED",
      message: "Worktree is not a Doya-owned worktree",
      removedAgents: [],
    };
  }

  const repoRoot = ownership.repoRoot ?? resolvedTarget.repoRoot ?? null;
  const removedAgents = await archiveDoyaWorktree(dependencies, {
    targetPath: resolvedTarget.targetPath,
    repoRoot,
    worktreesRoot: ownership.worktreeRoot,
    worktreesBaseRoot: dependencies.worktreesRoot,
    requestId: input.requestId,
  });

  return {
    ok: true,
    removedAgents,
  };
}

interface ResolvedArchiveTarget {
  targetPath: string;
  repoRoot: string | null;
}

async function resolveArchiveTarget(
  dependencies: ArchiveDoyaWorktreeCommandDependencies,
  input: ArchiveDoyaWorktreeCommandInput,
): Promise<ResolvedArchiveTarget> {
  const repoRoot = input.repoRoot ?? null;
  if (input.worktreePath) {
    return { targetPath: input.worktreePath, repoRoot };
  }

  if (input.worktreeSlug) {
    if (!repoRoot) {
      throw new Error("repoRoot is required when worktreeSlug is supplied");
    }
    return {
      targetPath: await resolveWorktreeSlugPath(dependencies, repoRoot, input.worktreeSlug),
      repoRoot,
    };
  }

  if (repoRoot && input.branchName) {
    const worktrees = await dependencies.workspaceGitService.listWorktrees(repoRoot);
    const match = worktrees.find((entry) => entry.branchName === input.branchName);
    if (!match) {
      throw new Error(`Doya worktree not found for branch ${input.branchName}`);
    }
    return { targetPath: match.path, repoRoot };
  }

  throw new Error("worktreePath, worktreeSlug, or repoRoot+branchName is required");
}

async function resolveWorktreeSlugPath(
  dependencies: ArchiveDoyaWorktreeCommandDependencies,
  repoRoot: string,
  worktreeSlug: string,
): Promise<string> {
  const worktreesRoot = await getDoyaWorktreesRoot(
    repoRoot,
    dependencies.doyaHome,
    dependencies.worktreesRoot,
  );
  return join(worktreesRoot, worktreeSlug);
}

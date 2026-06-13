import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  DoyaConfigRawSchema,
  type DoyaConfigRaw,
  type DoyaConfigRevision,
  type ProjectConfigRpcError,
} from "@getdoya/protocol/doya-config-schema";
export {
  DoyaConfigRevisionSchema,
  ProjectConfigRpcErrorSchema,
  type DoyaConfigRevision,
  type ProjectConfigRpcError,
} from "@getdoya/protocol/doya-config-schema";

export const DOYA_CONFIG_FILE_NAME = "doya.json";
export const LEGACY_DOYA_CONFIG_FILE_NAME = "doya.json";

export type ReadDoyaConfigForEditResult =
  | { ok: true; config: DoyaConfigRaw | null; revision: DoyaConfigRevision | null }
  | { ok: false; error: ProjectConfigRpcError };

export type WriteDoyaConfigForEditResult =
  | { ok: true; config: DoyaConfigRaw; revision: DoyaConfigRevision }
  | { ok: false; error: ProjectConfigRpcError };

export interface WriteDoyaConfigForEditInput {
  repoRoot: string;
  config: DoyaConfigRaw;
  expectedRevision: DoyaConfigRevision | null;
}

export function resolveDoyaConfigPath(repoRoot: string): string {
  return join(repoRoot, DOYA_CONFIG_FILE_NAME);
}

export function resolveDoyaConfigPathForRead(repoRoot: string): string {
  const doyaConfigPath = resolveDoyaConfigPath(repoRoot);
  if (existsSync(doyaConfigPath)) {
    return doyaConfigPath;
  }
  return join(repoRoot, LEGACY_DOYA_CONFIG_FILE_NAME);
}

export function statDoyaConfigPath(repoRoot: string): DoyaConfigRevision | null {
  const configPath = resolveDoyaConfigPathForRead(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  const stats = statSync(configPath);
  return {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
}

export function readDoyaConfigJson(repoRoot: string): unknown {
  const configPath = resolveDoyaConfigPathForRead(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  return JSON.parse(readFileSync(configPath, "utf8"));
}

export function readDoyaConfigForEdit(repoRoot: string): ReadDoyaConfigForEditResult {
  try {
    const json = readDoyaConfigJson(repoRoot);
    if (json === null) {
      return { ok: true, config: null, revision: null };
    }
    return {
      ok: true,
      config: DoyaConfigRawSchema.parse(json),
      revision: statDoyaConfigPath(repoRoot),
    };
  } catch {
    return {
      ok: false,
      error: { code: "invalid_project_config" },
    };
  }
}

export function writeDoyaConfigForEdit(
  input: WriteDoyaConfigForEditInput,
): WriteDoyaConfigForEditResult {
  const parsed = DoyaConfigRawSchema.safeParse(input.config);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_project_config" } };
  }

  const configPath = resolveDoyaConfigPath(input.repoRoot);
  const tempPath = join(
    input.repoRoot,
    `.${DOYA_CONFIG_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    writeFileSync(tempPath, `${JSON.stringify(parsed.data, null, 2)}\n`);
    const currentRevision = statDoyaConfigPath(input.repoRoot);
    if (!doyaConfigRevisionsEqual(currentRevision, input.expectedRevision)) {
      removeTempDoyaConfig(tempPath);
      return {
        ok: false,
        error: { code: "stale_project_config", currentRevision },
      };
    }

    renameSync(tempPath, configPath);
    const revision = statDoyaConfigPath(input.repoRoot);
    if (!revision) {
      return { ok: false, error: { code: "write_failed" } };
    }
    return { ok: true, config: parsed.data, revision };
  } catch {
    removeTempDoyaConfig(tempPath);
    return { ok: false, error: { code: "write_failed" } };
  }
}

function doyaConfigRevisionsEqual(
  left: DoyaConfigRevision | null,
  right: DoyaConfigRevision | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.mtimeMs === right.mtimeMs && left.size === right.size;
}

function removeTempDoyaConfig(tempPath: string): void {
  try {
    rmSync(tempPath, { force: true });
  } catch {
    // Best-effort cleanup only; callers need the original write outcome.
  }
}

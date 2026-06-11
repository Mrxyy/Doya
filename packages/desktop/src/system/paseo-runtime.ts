import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { chmodSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PRIVATE_DIRECTORY_MODE = 0o700;

interface SpawnProcessOptions extends Omit<SpawnOptions, "env"> {
  env?: NodeJS.ProcessEnv;
  envMode?: "external" | "internal";
  envOverlay?: NodeJS.ProcessEnv;
}

function expandHomeDir(input: string): string {
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  if (input === "~") {
    return os.homedir();
  }
  return input;
}

function ensurePrivateDirectory(directoryPath: string): void {
  mkdirSync(directoryPath, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  if (process.platform === "win32") {
    return;
  }
  try {
    chmodSync(directoryPath, PRIVATE_DIRECTORY_MODE);
  } catch {
    // Keep startup resilient if the filesystem does not support POSIX modes.
  }
}

export function resolvePaseoHome(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.PASEO_HOME ?? "~/.paseo";
  const resolved = path.resolve(expandHomeDir(raw));
  ensurePrivateDirectory(resolved);
  return resolved;
}

export function spawnProcess(
  command: string,
  args: string[],
  options?: SpawnProcessOptions,
): ChildProcess {
  const spawnOptions = { ...(options ?? {}) } as SpawnOptions & {
    envMode?: unknown;
    envOverlay?: unknown;
  };
  delete spawnOptions.envMode;
  delete spawnOptions.envOverlay;

  return spawn(command, args, {
    ...spawnOptions,
    env: { ...(options?.env ?? process.env), ...options?.envOverlay },
    windowsHide: true,
  });
}

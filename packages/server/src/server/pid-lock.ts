import { open, readFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { hostname } from "node:os";
import { z } from "zod";

export const pidLockInfoSchema = z.object({
  pid: z.number(),
  startedAt: z.string(),
  hostname: z.string(),
  uid: z.number(),
  listen: z.string().nullable(),
  desktopManaged: z.boolean().optional(),
});

export interface PidLockInfo extends z.infer<typeof pidLockInfoSchema> {}

function parsePidLockInfo(raw: unknown): PidLockInfo | null {
  const result = pidLockInfoSchema.safeParse(raw);
  return result.success ? result.data : null;
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

export class PidLockError extends Error {
  constructor(
    message: string,
    public readonly existingLock?: PidLockInfo,
  ) {
    super(message);
    this.name = "PidLockError";
  }
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const DOYA_PID_FILENAME = "doya.pid";
const LEGACY_DOYA_PID_FILENAME = "doya.pid";

function getPidFilePath(doyaHome: string): string {
  return join(doyaHome, DOYA_PID_FILENAME);
}

function getLegacyPidFilePath(doyaHome: string): string {
  return join(doyaHome, LEGACY_DOYA_PID_FILENAME);
}

async function readPidLockFile(pidPath: string): Promise<PidLockInfo | null> {
  try {
    const content = await readFile(pidPath, "utf-8");
    return parsePidLockInfo(JSON.parse(content));
  } catch {
    return null;
  }
}

async function resolveExistingPidLock(doyaHome: string): Promise<{
  pidPath: string;
  lock: PidLockInfo;
} | null> {
  const pidPaths = [getPidFilePath(doyaHome), getLegacyPidFilePath(doyaHome)];
  for (const pidPath of pidPaths) {
    const lock = await readPidLockFile(pidPath);
    if (lock) {
      return { pidPath, lock };
    }
  }
  return null;
}

function resolveOwnerPid(ownerPid?: number): number {
  if (typeof ownerPid === "number" && Number.isInteger(ownerPid) && ownerPid > 0) {
    return ownerPid;
  }
  return process.pid;
}

export async function acquirePidLock(
  doyaHome: string,
  listen: string | null,
  options?: { ownerPid?: number },
): Promise<void> {
  const pidPath = getPidFilePath(doyaHome);

  // Ensure doyaHome directory exists
  if (!existsSync(doyaHome)) {
    await mkdir(doyaHome, { recursive: true });
  }

  const existing = await resolveExistingPidLock(doyaHome);
  const existingLock = existing?.lock ?? null;

  // Check if existing lock is stale
  const lockOwnerPid = resolveOwnerPid(options?.ownerPid);
  if (existingLock) {
    if (isPidRunning(existingLock.pid)) {
      if (existingLock.pid === lockOwnerPid) {
        return;
      }

      throw new PidLockError(
        `Another Doya daemon is already running (PID ${existingLock.pid}, started ${existingLock.startedAt})`,
        existingLock,
      );
    }
    // Stale lock - remove it
    await unlink(existing?.pidPath ?? pidPath).catch(() => {});
  }

  // Create new lock with exclusive flag
  const lockInfo: PidLockInfo = {
    pid: lockOwnerPid,
    startedAt: new Date().toISOString(),
    hostname: hostname(),
    uid: process.getuid?.() ?? 0,
    listen,
    ...(process.env.DOYA_DESKTOP_MANAGED === "1" ? { desktopManaged: true } : {}),
  };

  let fd;
  try {
    fd = await open(pidPath, "wx");
    await fd.write(JSON.stringify(lockInfo));
  } catch (err) {
    if (isErrnoException(err) && err.code === "EEXIST") {
      // Race condition - another process created the file
      // Re-read and check
      try {
        const content = await readFile(pidPath, "utf-8");
        const raceLock = parsePidLockInfo(JSON.parse(content));
        if (raceLock) {
          throw new PidLockError(
            `Another Doya daemon is already running (PID ${raceLock.pid})`,
            raceLock,
          );
        }
        throw new PidLockError("Failed to acquire PID lock due to race condition");
      } catch (innerErr) {
        if (innerErr instanceof PidLockError) throw innerErr;
        throw new PidLockError("Failed to acquire PID lock due to race condition");
      }
    }
    throw err;
  } finally {
    await fd?.close();
  }
}

export async function updatePidLock(
  doyaHome: string,
  patch: { listen: string },
  options?: { ownerPid?: number },
): Promise<void> {
  const pidPath = existsSync(getPidFilePath(doyaHome))
    ? getPidFilePath(doyaHome)
    : getLegacyPidFilePath(doyaHome);
  const lockOwnerPid = resolveOwnerPid(options?.ownerPid);
  const content = await readFile(pidPath, "utf-8");
  const existingLock = parsePidLockInfo(JSON.parse(content));
  if (!existingLock) {
    throw new PidLockError("Cannot update PID lock: invalid lock file");
  }

  if (existingLock.pid !== lockOwnerPid) {
    throw new PidLockError(`Cannot update PID lock owned by PID ${existingLock.pid}`, existingLock);
  }

  const updatedLock: PidLockInfo = {
    ...existingLock,
    ...patch,
  };

  const fd = await open(pidPath, "r+");
  try {
    await fd.truncate(0);
    await fd.writeFile(JSON.stringify(updatedLock));
  } finally {
    await fd.close();
  }
}

export async function releasePidLock(
  doyaHome: string,
  options?: { ownerPid?: number },
): Promise<void> {
  const lockOwnerPid = resolveOwnerPid(options?.ownerPid);
  for (const pidPath of [getPidFilePath(doyaHome), getLegacyPidFilePath(doyaHome)]) {
    try {
      // Only remove if it's our lock
      const content = await readFile(pidPath, "utf-8");
      const lock = parsePidLockInfo(JSON.parse(content));
      if (lock?.pid === lockOwnerPid) {
        await unlink(pidPath);
      }
    } catch {
      // Ignore errors - lock may already be gone
    }
  }
}

export async function getPidLockInfo(doyaHome: string): Promise<PidLockInfo | null> {
  const pidPath = getPidFilePath(doyaHome);
  try {
    const content = await readFile(pidPath, "utf-8");
    return parsePidLockInfo(JSON.parse(content));
  } catch {
    return null;
  }
}

export async function isLocked(doyaHome: string): Promise<{ locked: boolean; info?: PidLockInfo }> {
  const info = await getPidLockInfo(doyaHome);
  if (!info) {
    return { locked: false };
  }
  if (!isPidRunning(info.pid)) {
    return { locked: false, info };
  }
  return { locked: true, info };
}

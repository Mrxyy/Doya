import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import express from "express";
import { z } from "zod";
import type { Logger } from "pino";

const execFileAsync = promisify(execFile);

const workingContextSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("git"),
    repoUrl: z.string().min(1),
    branch: z.string().optional(),
    baseCommit: z.string().optional(),
  }),
  z.object({
    type: z.literal("uploaded_files"),
    snapshotId: z.string().min(1),
  }),
  z.object({
    type: z.literal("generated_workspace"),
    snapshotId: z.string().optional(),
  }),
]);

const createRuntimeSchema = z.object({
  sessionId: z.string().min(1),
  runtimeId: z.string().optional(),
  workingContext: workingContextSchema.optional(),
  fileSnapshot: z
    .object({
      files: z.array(
        z.object({
          path: z.string().min(1),
          contentBase64: z.string().min(1),
          mode: z.number().int().nonnegative().nullable().optional(),
        }),
      ),
    })
    .optional()
    .nullable(),
});

const runtimeIdParamSchema = z.object({
  runtimeId: z.string().min(1),
});

type RuntimeStatus = "starting" | "running" | "stopped" | "lost";
type WorkingContext = z.infer<typeof workingContextSchema>;
type RuntimeFileSnapshot = NonNullable<z.infer<typeof createRuntimeSchema>["fileSnapshot"]>;

interface RuntimeRecord {
  runtimeId: string;
  sessionId: string;
  nodeId: string;
  workspaceDir: string;
  status: RuntimeStatus;
  workingContext: WorkingContext | null;
  leasedAt: string;
  lastHeartbeatAt: string;
  releasedAt: string | null;
}

export interface RuntimeApiOptions {
  doyaHome: string;
  nodeId: string;
  logger: Logger;
}

export function createRuntimeApiRouter(options: RuntimeApiOptions): express.Router {
  const router = express.Router();
  const runtimes = new Map<string, RuntimeRecord>();

  router.post("/", (req, res) => {
    void (async () => {
      const parsed = createRuntimeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid runtime request" });
        return;
      }

      const runtimeId = sanitizeRuntimeId(parsed.data.runtimeId ?? `rt_${randomUUID()}`);
      const workspaceDir = path.join(options.doyaHome, "runtimes", runtimeId, "workspace");
      const now = new Date().toISOString();
      const record: RuntimeRecord = {
        runtimeId,
        sessionId: parsed.data.sessionId,
        nodeId: options.nodeId,
        workspaceDir,
        status: "starting",
        workingContext: parsed.data.workingContext ?? null,
        leasedAt: now,
        lastHeartbeatAt: now,
        releasedAt: null,
      };
      runtimes.set(runtimeId, record);

      try {
        await prepareRuntimeWorkspace({
          workspaceDir,
          workingContext: record.workingContext,
          fileSnapshot: parsed.data.fileSnapshot ?? null,
        });
        record.status = "running";
        record.lastHeartbeatAt = new Date().toISOString();
        res.json({ runtime: record });
      } catch (error) {
        runtimes.delete(runtimeId);
        options.logger.error({ err: error, runtimeId, workspaceDir }, "Failed to create runtime");
        res.status(500).json({ error: "Unable to create runtime workspace" });
      }
    })();
  });

  router.post("/:runtimeId/attach", (req, res) => {
    const record = getRuntimeRecord(req.params, runtimes);
    if (!record) {
      res.status(404).json({ error: "Runtime not found" });
      return;
    }
    record.lastHeartbeatAt = new Date().toISOString();
    res.json({ runtime: record });
  });

  router.post("/:runtimeId/stop", (req, res) => {
    const record = getRuntimeRecord(req.params, runtimes);
    if (!record) {
      res.status(404).json({ error: "Runtime not found" });
      return;
    }
    record.status = "stopped";
    record.releasedAt = new Date().toISOString();
    record.lastHeartbeatAt = record.releasedAt;
    res.json({ runtime: record });
  });

  router.get("/:runtimeId/status", (req, res) => {
    const record = getRuntimeRecord(req.params, runtimes);
    if (!record) {
      res.status(404).json({ error: "Runtime not found" });
      return;
    }
    res.json({ runtime: record });
  });

  return router;
}

function getRuntimeRecord(
  params: Record<string, string>,
  runtimes: Map<string, RuntimeRecord>,
): RuntimeRecord | null {
  const parsed = runtimeIdParamSchema.safeParse(params);
  if (!parsed.success) {
    return null;
  }
  return runtimes.get(parsed.data.runtimeId) ?? null;
}

function sanitizeRuntimeId(input: string): string {
  const safe = input.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 96);
  return safe || `rt_${randomUUID()}`;
}

async function prepareRuntimeWorkspace(input: {
  workspaceDir: string;
  workingContext: WorkingContext | null;
  fileSnapshot: RuntimeFileSnapshot | null;
}): Promise<void> {
  const context = input.workingContext;
  if (!context || context.type === "generated_workspace") {
    await mkdir(input.workspaceDir, { recursive: true });
    return;
  }

  if (context.type === "uploaded_files") {
    await mkdir(input.workspaceDir, { recursive: true });
    if (!input.fileSnapshot) {
      throw new Error("Uploaded file snapshot payload is required");
    }
    await restoreFileSnapshot({
      workspaceDir: input.workspaceDir,
      snapshot: input.fileSnapshot,
    });
    return;
  }

  await mkdir(path.dirname(input.workspaceDir), { recursive: true });
  await execFileAsync("git", ["clone", context.repoUrl, input.workspaceDir], {
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
  if (context.branch) {
    await execFileAsync("git", ["checkout", context.branch], {
      cwd: input.workspaceDir,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
  }
  if (context.baseCommit) {
    await execFileAsync("git", ["checkout", context.baseCommit], {
      cwd: input.workspaceDir,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
  }
}

async function restoreFileSnapshot(input: {
  workspaceDir: string;
  snapshot: RuntimeFileSnapshot;
}): Promise<void> {
  await mkdir(input.workspaceDir, { recursive: true });
  for (const file of input.snapshot.files) {
    const targetPath = resolveSnapshotFilePath(input.workspaceDir, file.path);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, Buffer.from(file.contentBase64, "base64"));
    if (typeof file.mode === "number") {
      await chmod(targetPath, file.mode);
    }
  }
}

function resolveSnapshotFilePath(workspaceDir: string, filePath: string): string {
  const normalized = path.normalize(filePath).replace(/^[/\\]+/, "");
  if (!normalized || normalized === "." || normalized.startsWith("..")) {
    throw new Error(`Invalid snapshot file path: ${filePath}`);
  }
  const targetPath = path.resolve(workspaceDir, normalized);
  const workspaceRoot = path.resolve(workspaceDir);
  if (targetPath !== workspaceRoot && !targetPath.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw new Error(`Snapshot file path escapes workspace: ${filePath}`);
  }
  return targetPath;
}

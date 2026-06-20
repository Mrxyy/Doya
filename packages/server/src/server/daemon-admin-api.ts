import { statfs } from "node:fs/promises";
import os from "node:os";
import express from "express";
import { MutableDaemonConfigPatchSchema } from "@getdoya/protocol/messages";
import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@getdoya/protocol/messages";

export interface DaemonAdminApiOptions {
  doyaHome: string;
  nodeId: string;
  getConfig?: () => MutableDaemonConfig;
  patchConfig?: (patch: MutableDaemonConfigPatch) => MutableDaemonConfig;
  requestRestart?: (input: { requestId: string; reason?: string }) => void;
}

export function createDaemonAdminApiRouter(options: DaemonAdminApiOptions): express.Router {
  const router = express.Router();

  router.get("/load", (_req, res) => {
    void (async () => {
      const memoryTotalBytes = os.totalmem();
      const memoryFreeBytes = os.freemem();
      const memoryUsedBytes = Math.max(0, memoryTotalBytes - memoryFreeBytes);
      res.json({
        status: "ok",
        nodeId: options.nodeId,
        sampledAt: new Date().toISOString(),
        cpu: {
          loadAverage: os.loadavg(),
        },
        memory: {
          totalBytes: memoryTotalBytes,
          freeBytes: memoryFreeBytes,
          usedBytes: memoryUsedBytes,
          usedRatio: memoryTotalBytes > 0 ? memoryUsedBytes / memoryTotalBytes : 0,
        },
        disk: await readDiskUsage(options.doyaHome),
        uptimeSeconds: os.uptime(),
      });
    })();
  });

  router.post("/restart", (req, res) => {
    const reason =
      typeof req.body?.reason === "string" && req.body.reason.trim().length > 0
        ? req.body.reason.trim()
        : "admin_daemon_restart";
    const requestId =
      typeof req.body?.requestId === "string" && req.body.requestId.trim().length > 0
        ? req.body.requestId.trim()
        : `admin_restart_${Date.now()}`;
    if (!options.requestRestart) {
      res.status(501).json({ error: "Daemon restart is not available." });
      return;
    }
    options.requestRestart({ requestId, reason });
    res.status(202).json({
      status: "restart_requested",
      nodeId: options.nodeId,
      requestId,
      reason,
    });
  });

  router.get("/config", (_req, res) => {
    if (!options.getConfig) {
      res.status(501).json({ error: "Daemon config is not available." });
      return;
    }
    res.json({ config: options.getConfig() });
  });

  router.patch("/config", (req, res) => {
    if (!options.patchConfig) {
      res.status(501).json({ error: "Daemon config is not available." });
      return;
    }
    const result = MutableDaemonConfigPatchSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: result.error.issues[0]?.message ?? "Invalid daemon config" });
      return;
    }
    res.json({ config: options.patchConfig(result.data) });
  });

  return router;
}

async function readDiskUsage(path: string): Promise<{
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedRatio: number;
} | null> {
  try {
    const stats = await statfs(path);
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    return {
      totalBytes,
      freeBytes,
      usedBytes,
      usedRatio: totalBytes > 0 ? usedBytes / totalBytes : 0,
    };
  } catch {
    return null;
  }
}

import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { z } from "zod";

const ensureUserWorkspaceSchema = z.object({
  userId: z.string().min(1),
});

const allocateSessionWorkDirSchema = z.object({
  userId: z.string().min(1),
  sessionId: z.string().min(1),
});

const deleteSessionWorkDirsSchema = z.object({
  userId: z.string().min(1),
  sessionIds: z.array(z.string().min(1)).min(1),
});

export interface UserWorkspaceApiOptions {
  doyaHome: string;
}

export function createUserWorkspaceApiRouter(options: UserWorkspaceApiOptions): express.Router {
  const router = express.Router();

  router.post("/ensure", (req, res) => {
    void (async () => {
      const parsed = ensureUserWorkspaceSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid user workspace request" });
        return;
      }
      const workspace = resolveUserWorkspace(options.doyaHome, parsed.data.userId);
      await mkdir(workspace.workspaceDir, { recursive: true });
      res.json({ workspace });
    })();
  });

  router.post("/session-workdirs", (req, res) => {
    void (async () => {
      const parsed = allocateSessionWorkDirSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid session workdir request" });
        return;
      }
      const workspace = resolveUserWorkspace(options.doyaHome, parsed.data.userId);
      const workDir = resolveSessionWorkDir(workspace.workspaceDir, parsed.data.sessionId);
      await mkdir(workDir, { recursive: true });
      res.json({
        workspace,
        workDir,
      });
    })();
  });

  router.delete("/session-workdirs", (req, res) => {
    void (async () => {
      const parsed = deleteSessionWorkDirsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid session workdir cleanup request" });
        return;
      }
      const deleted: Array<{ sessionId: string; workDir: string; deleted: boolean }> = [];
      const failed: Array<{ sessionId: string; error: string }> = [];
      const workspace = resolveUserWorkspace(options.doyaHome, parsed.data.userId);
      for (const sessionId of parsed.data.sessionIds) {
        const workDir = resolveSessionWorkDir(workspace.workspaceDir, sessionId);
        try {
          await rm(workDir, { recursive: true, force: true });
          deleted.push({ sessionId, workDir, deleted: true });
        } catch (error) {
          failed.push({
            sessionId,
            error: error instanceof Error ? error.message : "Unable to delete session workdir",
          });
        }
      }
      res.json({ deleted, failed });
    })();
  });

  return router;
}

function resolveUserWorkspace(
  doyaHome: string,
  userId: string,
): {
  workspaceId: string;
  workspaceDir: string;
} {
  const userSegment = sanitizePathSegment(userId);
  return {
    workspaceId: `uws_${userSegment}`,
    workspaceDir: path.join(doyaHome, "user-workspaces", userSegment),
  };
}

function resolveSessionWorkDir(workspaceDir: string, sessionId: string): string {
  return path.join(workspaceDir, "sessions", sanitizePathSegment(sessionId));
}

function sanitizePathSegment(input: string): string {
  const safe = input.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 96);
  return safe || randomUUID();
}

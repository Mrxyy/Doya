import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError, type ZodType } from "zod";
import type { DaemonNodeRecord } from "../domain.js";
import { NotFoundError, type AdminSessionCleanupTarget, type ControlStore } from "../store.js";
import {
  allocateSessionWorkDirBodySchema,
  appendMessageBodySchema,
  cleanupDaemonSessionsBodySchema,
  createArtifactBodySchema,
  createFileSnapshotBodySchema,
  createRuntimeAllocationBodySchema,
  daemonConfigPatchBodySchema,
  createSessionBodySchema,
  loginBodySchema,
  registerBodySchema,
  registerNodeBodySchema,
  runtimeSyncArtifactBodySchema,
  runtimeSyncEventBodySchema,
  setDefaultDaemonBodySchema,
  upsertAgentBindingBodySchema,
  upsertUserDaemonWorkspaceBodySchema,
  updateDaemonNodeBodySchema,
  updateSessionBodySchema,
} from "./schemas.js";

interface AuthContext {
  userId: string;
  accessToken: string;
}

type AuthenticatedRequest = Request & { auth?: AuthContext };

export function createControlApp(store: ControlStore): express.Express {
  const app = express();
  app.use(applyCorsHeaders);
  app.options("*", (_req, res) => {
    res.status(204).end();
  });
  app.use(express.json({ limit: "30mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post(
    "/api/account/register",
    asyncHandler(async (req, res) => {
      const body = parseBody(registerBodySchema, req.body);
      res.status(201).json(await store.registerOrLogin(body));
    }),
  );

  app.post(
    "/api/account/login",
    asyncHandler(async (req, res) => {
      const body = parseBody(loginBodySchema, req.body);
      res.json(await store.login(body));
    }),
  );

  app.get(
    "/api/account/session",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const auth = requireRequestAuth(req);
      const user = await store.getUserByToken(auth);
      res.json({ user, accessToken: auth.accessToken });
    }),
  );

  app.get(
    "/api/sessions",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
      res.json({ sessions: await store.listSessions({ userId: requireUserId(req), limit }) });
    }),
  );

  app.post(
    "/api/sessions",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(createSessionBodySchema, req.body);
      const session = await store.createSession({
        userId: requireUserId(req),
        title: body.title,
        workingContext: body.workingContext,
      });
      res.status(201).json({ session });
    }),
  );

  app.get(
    "/api/sessions/:sessionId",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      res.json({
        session: await store.getSession({
          sessionId: req.params.sessionId,
          userId: requireUserId(req),
        }),
      });
    }),
  );

  app.patch(
    "/api/sessions/:sessionId",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(updateSessionBodySchema, req.body);
      res.json({
        session: await store.updateSession({
          sessionId: req.params.sessionId,
          userId: requireUserId(req),
          title: body.title,
          status: body.status,
        }),
      });
    }),
  );

  app.delete(
    "/api/sessions/:sessionId",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      await store.deleteSession({ sessionId: req.params.sessionId, userId: requireUserId(req) });
      res.status(204).end();
    }),
  );

  app.get(
    "/api/sessions/:sessionId/messages",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      res.json({
        messages: await store.listMessages({
          sessionId: req.params.sessionId,
          userId: requireUserId(req),
        }),
      });
    }),
  );

  app.post(
    "/api/sessions/:sessionId/messages",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(appendMessageBodySchema, req.body);
      const message = await store.appendMessage({
        sessionId: req.params.sessionId,
        userId: requireUserId(req),
        role: body.role,
        externalId: body.externalId,
        content: body.content,
      });
      res.status(201).json({ message });
    }),
  );

  app.get(
    "/api/sessions/:sessionId/artifacts",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      res.json({
        artifacts: await store.listArtifacts({
          sessionId: req.params.sessionId,
          userId: requireUserId(req),
        }),
      });
    }),
  );

  app.post(
    "/api/sessions/:sessionId/artifacts",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(createArtifactBodySchema, req.body);
      const artifact = await store.createArtifact({
        sessionId: req.params.sessionId,
        userId: requireUserId(req),
        type: body.type,
        name: body.name,
        uri: body.uri,
        externalId: body.externalId,
        metadata: body.metadata,
      });
      res.status(201).json({ artifact });
    }),
  );

  app.post(
    "/api/file-snapshots",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(createFileSnapshotBodySchema, req.body);
      const snapshot = await store.createFileSnapshot({
        userId: requireUserId(req),
        files: body.files.map((file) => ({
          path: file.path,
          contentBase64: file.contentBase64,
          mode: file.mode ?? null,
        })),
      });
      res.status(201).json({ snapshot });
    }),
  );

  app.get(
    "/api/file-snapshots/:snapshotId",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      res.json({
        snapshot: await store.getFileSnapshot({
          snapshotId: req.params.snapshotId,
          userId: requireUserId(req),
        }),
      });
    }),
  );

  app.post(
    "/api/nodes/register",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(registerNodeBodySchema, req.body);
      res.status(201).json({ node: toPublicDaemonNode(await store.registerNode(body)) });
    }),
  );

  app.post(
    "/api/runtime-sync/events",
    asyncHandler(async (req, res) => {
      const body = parseBody(runtimeSyncEventBodySchema, req.body);
      const allocation = await store.getRuntimeAllocationByRuntimeId({
        sessionId: body.sessionId,
        runtimeId: body.runtimeId,
        nodeId: body.nodeId,
      });
      await store.touchRuntimeAllocation({ allocationId: allocation.id });
      const session = await store.getSession({ sessionId: body.sessionId });
      const synced = await appendRuntimeSyncEvent({
        store,
        userId: session.userId,
        sessionId: session.id,
        runtimeId: body.runtimeId,
        agentId: body.agentId,
        event: body.event,
      });
      res.status(201).json({ synced });
    }),
  );

  app.post(
    "/api/runtime-sync/artifacts",
    asyncHandler(async (req, res) => {
      const body = parseBody(runtimeSyncArtifactBodySchema, req.body);
      const allocation = await store.getRuntimeAllocationByRuntimeId({
        sessionId: body.sessionId,
        runtimeId: body.runtimeId,
        nodeId: body.nodeId,
      });
      await store.touchRuntimeAllocation({ allocationId: allocation.id });
      const session = await store.getSession({ sessionId: body.sessionId });
      const artifact = await store.createArtifact({
        sessionId: session.id,
        userId: session.userId,
        type: body.artifact.type,
        name: body.artifact.name,
        uri: body.artifact.uri,
        externalId:
          body.artifact.externalId ??
          buildRuntimeArtifactExternalId({
            runtimeId: body.runtimeId,
            agentId: body.agentId,
            uri: body.artifact.uri,
          }),
        metadata: body.artifact.metadata ?? null,
      });
      res.status(201).json({ artifact });
    }),
  );

  app.get(
    "/api/nodes",
    requireAuth(store),
    asyncHandler(async (_req, res) => {
      res.json({ nodes: (await store.listNodes()).map(toPublicDaemonNode) });
    }),
  );

  app.get(
    "/api/admin/daemon-overview",
    requireAuth(store),
    asyncHandler(async (_req, res) => {
      const overview = await store.getAdminOverview();
      res.json({
        ...overview,
        daemonNodes: await Promise.all(
          overview.daemonNodes.map(async (summary) => {
            const node = await store.getNode(summary.node.id);
            return Object.assign({}, summary, {
              load: await getDaemonLoad(node).catch((error) => ({
                status: "unavailable" as const,
                error: error instanceof Error ? error.message : "Unable to read daemon load",
              })),
            });
          }),
        ),
      });
    }),
  );

  app.patch(
    "/api/admin/default-daemon",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(setDefaultDaemonBodySchema, req.body);
      res.json({ settings: await store.setDefaultDaemonNode(body.nodeId) });
    }),
  );

  app.patch(
    "/api/admin/nodes/:nodeId",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(updateDaemonNodeBodySchema, req.body);
      res.json({
        node: toPublicDaemonNode(
          await store.updateNode({
            nodeId: req.params.nodeId,
            status: body.status,
          }),
        ),
      });
    }),
  );

  app.delete(
    "/api/admin/nodes/:nodeId",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      await store.removeNode(req.params.nodeId);
      res.status(204).end();
    }),
  );

  app.post(
    "/api/admin/nodes/:nodeId/restart",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const node = await store.getNode(req.params.nodeId);
      res.status(202).json({
        restart: await restartDaemonNode(node),
      });
    }),
  );

  app.get(
    "/api/admin/nodes/:nodeId/config",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const node = await store.getNode(req.params.nodeId);
      res.json({ config: await getDaemonConfig(node) });
    }),
  );

  app.patch(
    "/api/admin/nodes/:nodeId/config",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(daemonConfigPatchBodySchema, req.body);
      const node = await store.getNode(req.params.nodeId);
      res.json({ config: await patchDaemonConfig(node, body) });
    }),
  );

  app.post(
    "/api/admin/nodes/:nodeId/cleanup-sessions",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(cleanupDaemonSessionsBodySchema, req.body);
      const targets = await store.getAdminSessionCleanupTargets({
        nodeId: req.params.nodeId,
        sessionIds: body.sessionIds,
      });
      const node = await store.getNode(req.params.nodeId);
      const workDirCleanup = body.deleteWorkDirs
        ? await deleteDaemonSessionWorkDirs({ node, targets })
        : { deleted: [], failed: [] };
      const controlCleanup = await store.cleanupAdminSessions({
        nodeId: req.params.nodeId,
        sessionIds: targets.map((target) => target.session.id),
        deleteSessions: body.deleteSessions ?? true,
        workDirDeletedSessionIds: workDirCleanup.deleted.map((entry) => entry.sessionId),
      });
      res.json({
        cleanup: {
          requestedSessionCount: body.sessionIds.length,
          matchedSessionCount: targets.length,
          ...controlCleanup,
          workDirCleanup,
        },
      });
    }),
  );

  app.get(
    "/api/nodes/:nodeId/user-workspace",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      res.json({
        workspace: await store.getUserDaemonWorkspace({
          userId: requireUserId(req),
          nodeId: req.params.nodeId,
        }),
      });
    }),
  );

  app.post(
    "/api/nodes/:nodeId/user-workspace",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(upsertUserDaemonWorkspaceBodySchema, req.body);
      res.status(201).json({
        workspace: await store.upsertUserDaemonWorkspace({
          userId: requireUserId(req),
          nodeId: req.params.nodeId,
          workspaceDir: body.workspaceDir,
          status: body.status,
        }),
      });
    }),
  );

  app.get(
    "/api/sessions/:sessionId/agent-binding",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const binding = await store.getActiveAgentBinding({
        sessionId: req.params.sessionId,
        userId: requireUserId(req),
      });
      if (!binding) {
        res.json({ binding: null, node: null });
        return;
      }
      const node = await store.getNode(binding.nodeId).catch(() => null);
      res.json({ binding, node: node ? toPublicDaemonNode(node) : null });
    }),
  );

  app.post(
    "/api/nodes/:nodeId/user-workspace/ensure",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const existing = await store.getUserDaemonWorkspace({
        userId,
        nodeId: req.params.nodeId,
      });
      if (existing) {
        res.json({ workspace: existing });
        return;
      }
      const node = await store.getNode(req.params.nodeId);
      const daemonWorkspace = await ensureDaemonUserWorkspace({ node, userId });
      res.status(201).json({
        workspace: await store.upsertUserDaemonWorkspace({
          userId,
          nodeId: req.params.nodeId,
          workspaceDir: daemonWorkspace.workspace.workspaceDir,
          status: "active",
        }),
      });
    }),
  );

  app.post(
    "/api/sessions/:sessionId/agent-binding",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(upsertAgentBindingBodySchema, req.body);
      const binding = await store.upsertAgentBinding({
        sessionId: req.params.sessionId,
        userId: requireUserId(req),
        nodeId: body.nodeId,
        agentId: body.agentId,
        userWorkspaceId: body.userWorkspaceId,
        workspaceId: body.workspaceId,
        cwd: body.cwd,
        status: body.status,
      });
      const node = await store.getNode(binding.nodeId).catch(() => null);
      res.status(201).json({ binding, node: node ? toPublicDaemonNode(node) : null });
    }),
  );

  app.post(
    "/api/sessions/:sessionId/workdir",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const userId = requireUserId(req);
      const body = parseBody(allocateSessionWorkDirBodySchema, req.body);
      const userWorkspace = await store.getUserDaemonWorkspace({
        userId,
        nodeId: body.nodeId,
      });
      if (!userWorkspace) {
        throw new NotFoundError("User daemon workspace not found");
      }
      const node = await store.getNode(body.nodeId);
      const allocation = await allocateDaemonSessionWorkDir({
        node,
        userId,
        sessionId: req.params.sessionId,
      });
      const runtime = await store.createRuntimeAllocation({
        sessionId: req.params.sessionId,
        userId,
        nodeId: body.nodeId,
        runtimeId: body.runtimeId ?? `rt_${req.params.sessionId}`,
        providerId: body.providerId,
        modelId: body.modelId,
        selectionReason: body.selectionReason,
        userWorkspaceId: userWorkspace.id,
        workspaceDir: allocation.workDir,
        status: "running",
      });
      res.status(201).json({ runtime, userWorkspace });
    }),
  );

  app.post(
    "/api/sessions/:sessionId/runtimes",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      const body = parseBody(createRuntimeAllocationBodySchema, req.body);
      const runtime = await store.createRuntimeAllocation({
        sessionId: req.params.sessionId,
        userId: requireUserId(req),
        nodeId: body.nodeId,
        runtimeId: body.runtimeId,
        providerId: body.providerId,
        modelId: body.modelId,
        selectionReason: body.selectionReason,
        userWorkspaceId: body.userWorkspaceId,
        workspaceDir: body.workspaceDir,
        status: body.status,
      });
      res.status(201).json({ runtime });
    }),
  );

  app.get(
    "/api/sessions/:sessionId/runtimes/active",
    requireAuth(store),
    asyncHandler(async (req, res) => {
      res.json({
        runtime: await store.getActiveRuntime({
          sessionId: req.params.sessionId,
          userId: requireUserId(req),
        }),
      });
    }),
  );

  app.use(errorHandler);
  return app;
}

function requireAuth(store: ControlStore) {
  return asyncHandler(async (req: AuthenticatedRequest, res, next) => {
    const userId = readHeader(req, "x-doya-user-id");
    const accessToken = readAuthorizationBearer(req) ?? readHeader(req, "x-doya-access-token");
    if (!userId || !accessToken) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    await store.getUserByToken({ userId, accessToken });
    req.auth = { userId, accessToken };
    next();
  });
}

function requireUserId(req: Request): string {
  return requireRequestAuth(req).userId;
}

function requireRequestAuth(req: Request): AuthContext {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) {
    throw new Error("Missing auth context");
  }
  return auth;
}

function readHeader(req: Request, name: string): string | null {
  const value = req.header(name);
  return value && value.trim().length > 0 ? value.trim() : null;
}

function readAuthorizationBearer(req: Request): string | null {
  const header = req.header("authorization");
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  return schema.parse(body);
}

function applyCorsHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Doya-User-Id, X-Doya-Access-Token",
  );
  res.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  next();
}

function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof ZodError) {
    res.status(400).json({ error: error.issues[0]?.message ?? "Invalid request" });
    return;
  }
  if (error instanceof NotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : "Request failed";
  res.status(400).json({ error: message });
}

function toPublicDaemonNode(node: DaemonNodeRecord): Omit<DaemonNodeRecord, "runtimeAuthToken"> {
  const { runtimeAuthToken: _runtimeAuthToken, ...publicNode } = node;
  return publicNode;
}

async function ensureDaemonUserWorkspace(input: {
  node: DaemonNodeRecord;
  userId: string;
}): Promise<{ workspace: { workspaceDir: string } }> {
  try {
    return await postDaemonJson<{ workspace: { workspaceDir: string } }>(
      input.node,
      "/api/user-workspaces/ensure",
      { userId: input.userId },
    );
  } catch (error) {
    if (!isDaemonRouteMissingError(error)) {
      throw error;
    }
    return {
      workspace: {
        workspaceDir: path.join(resolveDaemonHome(input.node), "user-workspaces", input.userId),
      },
    };
  }
}

async function allocateDaemonSessionWorkDir(input: {
  node: DaemonNodeRecord;
  userId: string;
  sessionId: string;
}): Promise<{ workDir: string }> {
  try {
    return await postDaemonJson<{ workDir: string }>(
      input.node,
      "/api/user-workspaces/session-workdirs",
      {
        userId: input.userId,
        sessionId: input.sessionId,
      },
    );
  } catch (error) {
    if (!isDaemonRouteMissingError(error)) {
      throw error;
    }
    return {
      workDir: path.join(
        resolveDaemonHome(input.node),
        "user-workspaces",
        input.userId,
        "sessions",
        input.sessionId,
      ),
    };
  }
}

async function getDaemonLoad(node: DaemonNodeRecord): Promise<DaemonLoadResult> {
  return await requestDaemonJson<DaemonLoadResult>(node, {
    method: "GET",
    endpointPath: "/api/admin/daemon/load",
  });
}

async function restartDaemonNode(node: DaemonNodeRecord): Promise<DaemonRestartResult> {
  return await requestDaemonJson<DaemonRestartResult>(node, {
    method: "POST",
    endpointPath: "/api/admin/daemon/restart",
    body: {
      requestId: `control_admin_restart_${node.id}_${Date.now()}`,
      reason: "control_admin_restart",
    },
  });
}

async function getDaemonConfig(node: DaemonNodeRecord): Promise<DaemonMutableConfig> {
  const payload = await requestDaemonJson<{ config: DaemonMutableConfig }>(node, {
    method: "GET",
    endpointPath: "/api/admin/daemon/config",
  });
  return payload.config;
}

async function patchDaemonConfig(
  node: DaemonNodeRecord,
  patch: DaemonMutableConfigPatch,
): Promise<DaemonMutableConfig> {
  const payload = await requestDaemonJson<{ config: DaemonMutableConfig }>(node, {
    method: "PATCH",
    endpointPath: "/api/admin/daemon/config",
    body: patch,
  });
  return payload.config;
}

async function deleteDaemonSessionWorkDirs(input: {
  node: DaemonNodeRecord;
  targets: AdminSessionCleanupTarget[];
}): Promise<DaemonSessionWorkDirCleanupResult> {
  const deleted: DaemonDeletedSessionWorkDir[] = [];
  const failed: DaemonFailedSessionWorkDir[] = [];
  const targetsByUserId = new Map<string, string[]>();
  for (const target of input.targets) {
    const current = targetsByUserId.get(target.session.userId) ?? [];
    current.push(target.session.id);
    targetsByUserId.set(target.session.userId, current);
  }
  for (const [userId, sessionIds] of targetsByUserId) {
    try {
      const result = await requestDaemonJson<DaemonSessionWorkDirCleanupResult>(input.node, {
        method: "DELETE",
        endpointPath: "/api/user-workspaces/session-workdirs",
        body: { userId, sessionIds },
      });
      deleted.push(...result.deleted);
      failed.push(...result.failed);
    } catch (error) {
      for (const sessionId of sessionIds) {
        failed.push({
          sessionId,
          error: error instanceof Error ? error.message : "Unable to delete session workdir",
        });
      }
    }
  }
  return { deleted, failed };
}

async function postDaemonJson<TResponse extends object>(
  node: DaemonNodeRecord,
  endpointPath: string,
  body: unknown,
): Promise<TResponse> {
  return await requestDaemonJson<TResponse>(node, { method: "POST", endpointPath, body });
}

async function requestDaemonJson<TResponse extends object>(
  node: DaemonNodeRecord,
  input: {
    method: "DELETE" | "GET" | "PATCH" | "POST";
    endpointPath: string;
    body?: unknown;
  },
): Promise<TResponse> {
  const response = await fetch(
    `${normalizeDaemonHttpBaseUrl(node.endpoint)}${input.endpointPath}`,
    {
      method: input.method,
      headers: {
        "Content-Type": "application/json",
        ...(node.runtimeAuthToken ? { Authorization: `Bearer ${node.runtimeAuthToken}` } : {}),
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    },
  );
  let payload: TResponse | { error?: string };
  try {
    payload = (await response.json()) as TResponse | { error?: string };
  } catch {
    throw new DaemonApiResponseError(
      `Daemon API returned non-JSON response (${response.status})`,
      response.status,
    );
  }
  if (!response.ok) {
    throw new DaemonApiResponseError(
      "error" in payload && payload.error ? payload.error : "Daemon API request failed",
      response.status,
    );
  }
  return payload as TResponse;
}

interface DaemonLoadResult {
  status: "ok";
  nodeId: string;
  sampledAt: string;
  cpu: {
    loadAverage: number[];
  };
  memory: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedRatio: number;
  };
  disk: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedRatio: number;
  } | null;
  uptimeSeconds: number;
}

interface DaemonRestartResult {
  status: "restart_requested";
  nodeId: string;
  requestId: string;
  reason: string;
}

interface DaemonMutableConfig {
  mcp: {
    injectIntoAgents: boolean;
  };
  appendSystemPrompt: string;
}

interface DaemonMutableConfigPatch {
  mcp?: {
    injectIntoAgents?: boolean;
  };
  appendSystemPrompt?: string;
}

interface DaemonDeletedSessionWorkDir {
  sessionId: string;
  workDir: string;
  deleted: boolean;
}

interface DaemonFailedSessionWorkDir {
  sessionId: string;
  error: string;
}

interface DaemonSessionWorkDirCleanupResult {
  deleted: DaemonDeletedSessionWorkDir[];
  failed: DaemonFailedSessionWorkDir[];
}

class DaemonApiResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function isDaemonRouteMissingError(error: unknown): boolean {
  return error instanceof DaemonApiResponseError && error.status === 404;
}

function resolveDaemonHome(node: DaemonNodeRecord): string {
  if (node.doyaHome) {
    return node.doyaHome;
  }
  return process.env.DOYA_HOME ?? path.join(process.env.HOME ?? ".", ".doya");
}

function normalizeDaemonHttpBaseUrl(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/$/, "");
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  if (trimmed.startsWith("ws://")) {
    return `http://${trimmed.slice("ws://".length)}`;
  }
  if (trimmed.startsWith("wss://")) {
    return `https://${trimmed.slice("wss://".length)}`;
  }
  return `http://${trimmed}`;
}

async function appendRuntimeSyncEvent(input: {
  store: ControlStore;
  userId: string;
  sessionId: string;
  runtimeId: string;
  agentId: string;
  event: unknown;
}): Promise<boolean> {
  const status = readRuntimeSessionStatus(input.event);
  if (status) {
    await input.store.updateSession({
      sessionId: input.sessionId,
      userId: input.userId,
      status,
    });
    return true;
  }

  const artifact = readRuntimeTimelineArtifact(input.event);
  if (artifact) {
    await input.store.createArtifact({
      sessionId: input.sessionId,
      userId: input.userId,
      type: artifact.type,
      name: artifact.name,
      uri: artifact.uri,
      externalId: buildRuntimeTimelineArtifactExternalId({
        runtimeId: input.runtimeId,
        agentId: input.agentId,
        artifactId: artifact.artifactId,
      }),
      metadata: artifact.metadata,
    });
    return true;
  }

  const timeline = readRuntimeTimelineItem(input.event);
  if (!timeline) {
    return false;
  }
  const externalId = buildRuntimeTimelineExternalId({
    runtimeId: input.runtimeId,
    agentId: input.agentId,
    item: timeline.item,
  });
  await input.store.appendMessage({
    sessionId: input.sessionId,
    userId: input.userId,
    role: timeline.role,
    externalId,
    content: timeline.content,
  });
  return true;
}

function readRuntimeSessionStatus(event: unknown): "idle" | "running" | "done" | "error" | null {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return null;
  }
  const eventRecord = event as Record<string, unknown>;
  switch (eventRecord.type) {
    case "turn_started":
      return "running";
    case "turn_completed":
      return "done";
    case "turn_failed":
      return "error";
    case "turn_canceled":
      return "idle";
    default:
      return null;
  }
}

function readRuntimeTimelineArtifact(event: unknown): {
  artifactId: string;
  type: string;
  name: string;
  uri: string;
  metadata: unknown;
} | null {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return null;
  }
  const eventRecord = event as Record<string, unknown>;
  if (eventRecord.type !== "timeline") {
    return null;
  }
  const item = eventRecord.item;
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }
  const itemRecord = item as Record<string, unknown>;
  if (itemRecord.type !== "artifact") {
    return null;
  }
  const payload = itemRecord.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const payloadRecord = payload as Record<string, unknown>;
  const artifactId = typeof payloadRecord.id === "string" ? payloadRecord.id.trim() : "";
  const type = typeof payloadRecord.type === "string" ? payloadRecord.type.trim() : "";
  const name = typeof payloadRecord.title === "string" ? payloadRecord.title.trim() : "";
  if (!artifactId || !type || !name) {
    return null;
  }
  return {
    artifactId,
    type,
    name,
    uri: `runtime-artifact://${encodeURIComponent(artifactId)}`,
    metadata: {
      source: "runtime_timeline",
      item: itemRecord,
      content: typeof payloadRecord.content === "string" ? payloadRecord.content : "",
      isBase64: payloadRecord.isBase64 === true,
    },
  };
}

function readRuntimeTimelineItem(event: unknown): {
  role: "user" | "assistant" | "system" | "tool";
  item: Record<string, unknown>;
  content: unknown;
} | null {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return null;
  }
  const eventRecord = event as Record<string, unknown>;
  if (eventRecord.type !== "timeline") {
    return null;
  }
  const item = eventRecord.item;
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }
  const itemRecord = item as Record<string, unknown>;
  switch (itemRecord.type) {
    case "user_message":
      return {
        role: "user",
        item: itemRecord,
        content: {
          text: typeof itemRecord.text === "string" ? itemRecord.text : "",
          source: "runtime_timeline",
          item: itemRecord,
        },
      };
    case "assistant_message":
      return {
        role: "assistant",
        item: itemRecord,
        content: {
          text: typeof itemRecord.text === "string" ? itemRecord.text : "",
          source: "runtime_timeline",
          item: itemRecord,
        },
      };
    case "reasoning":
    case "todo":
    case "compaction":
    case "error":
      return {
        role: "system",
        item: itemRecord,
        content: {
          source: "runtime_timeline",
          item: itemRecord,
        },
      };
    case "tool_call":
      return {
        role: "tool",
        item: itemRecord,
        content: {
          source: "runtime_timeline",
          item: itemRecord,
        },
      };
    default:
      return null;
  }
}

function buildRuntimeTimelineExternalId(input: {
  runtimeId: string;
  agentId: string;
  item: Record<string, unknown>;
}): string {
  const messageId = typeof input.item.messageId === "string" ? input.item.messageId : null;
  const callId =
    readNestedString(input.item, ["detail", "callId"]) ??
    readNestedString(input.item, ["detail", "id"]);
  const stableId = messageId ?? callId ?? hashStableJson(input.item);
  return `runtime:${input.runtimeId}:agent:${input.agentId}:timeline:${input.item.type}:${stableId}`;
}

function readNestedString(value: unknown, pathSegments: string[]): string | null {
  let cursor = value;
  for (const key of pathSegments) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
      return null;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === "string" ? cursor : null;
}

function hashStableJson(value: unknown): string {
  const text = JSON.stringify(value) ?? "";
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function buildRuntimeArtifactExternalId(input: {
  runtimeId: string;
  agentId: string;
  uri: string;
}): string {
  return `runtime:${input.runtimeId}:agent:${input.agentId}:artifact:${hashStableJson(input.uri)}`;
}

function buildRuntimeTimelineArtifactExternalId(input: {
  runtimeId: string;
  agentId: string;
  artifactId: string;
}): string {
  return `runtime:${input.runtimeId}:agent:${input.agentId}:timeline:artifact:${input.artifactId}`;
}

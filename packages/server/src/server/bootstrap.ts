import express from "express";
import { createServer as createHTTPServer, type IncomingMessage, type ServerResponse } from "http";
import { constants, createWriteStream, existsSync, unlinkSync } from "fs";
import { mkdir, open, readFile, stat } from "fs/promises";
import { randomUUID } from "node:crypto";
import { hostname as getHostname } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Logger } from "pino";
import { createBranchChangeRouteHandler } from "./script-route-branch-handler.js";
import { ConversationRecordingStore } from "./recordings/conversation-recording-store.js";

export type ListenTarget =
  | { type: "tcp"; host: string; port: number }
  | { type: "socket"; path: string }
  | { type: "pipe"; path: string };

function resolveBoundListenTarget(
  listenTarget: ListenTarget,
  httpServer: ReturnType<typeof createHTTPServer>,
): ListenTarget {
  if (listenTarget.type !== "tcp") {
    return listenTarget;
  }

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("HTTP server did not expose a TCP address after listening");
  }

  return {
    type: "tcp",
    host: listenTarget.host,
    port: address.port,
  };
}

// Matches a Windows drive-letter path like C:\ or D:\
const WINDOWS_DRIVE_RE = /^[A-Za-z]:\\/;

export function parseListenString(listen: string): ListenTarget {
  // 1. Windows named pipes: \\.\pipe\... or pipe://...
  if (listen.startsWith("\\\\.\\pipe\\") || listen.startsWith("pipe://")) {
    return {
      type: "pipe",
      path: listen.startsWith("pipe://") ? listen.slice("pipe://".length) : listen,
    };
  }
  // 2. Explicit unix:// prefix
  if (listen.startsWith("unix://")) {
    return { type: "socket", path: listen.slice(7) };
  }
  // 3. Reject Windows absolute drive paths — they are not Unix sockets
  if (WINDOWS_DRIVE_RE.test(listen)) {
    throw new Error(`Invalid listen string (Windows path is not a valid listen target): ${listen}`);
  }
  // 4. POSIX absolute path (/ or ~) — Unix socket
  if (listen.startsWith("/") || listen.startsWith("~")) {
    return { type: "socket", path: listen };
  }
  // 5. Pure numeric — TCP port on 127.0.0.1
  const trimmed = listen.trim();
  if (/^\d+$/.test(trimmed)) {
    const port = parseInt(trimmed, 10);
    return { type: "tcp", host: "127.0.0.1", port };
  }
  // 6. host:port — TCP
  if (listen.includes(":")) {
    const [host, portStr] = listen.split(":");
    const parsedPort = parseInt(portStr, 10);
    if (!Number.isFinite(parsedPort)) {
      throw new Error(`Invalid port in listen string: ${listen}`);
    }
    return { type: "tcp", host: host || "127.0.0.1", port: parsedPort };
  }
  throw new Error(`Invalid listen string: ${listen}`);
}

function formatListenTarget(listenTarget: ListenTarget | null): string | null {
  if (!listenTarget) {
    return null;
  }
  if (listenTarget.type === "tcp") {
    return `${listenTarget.host}:${listenTarget.port}`;
  }
  return listenTarget.path;
}

import { VoiceAssistantWebSocketServer } from "./websocket-server.js";
import { createGitHubService } from "../services/github-service.js";
import { createDoyaWorktree as createRegisteredDoyaWorktree } from "./doya-worktree-service.js";
import { createDoyaWorktreeWorkflow } from "./worktree-session.js";
import { DownloadTokenStore } from "./file-download/token-store.js";
import type { OpenAiSpeechProviderConfig } from "./speech/providers/openai/config.js";
import type { LocalSpeechProviderConfig } from "./speech/providers/local/config.js";
import type { RequestedSpeechProviders } from "./speech/speech-types.js";
import { createSpeechService } from "./speech/speech-runtime.js";
import { AgentManager } from "./agent/agent-manager.js";
import { AgentStorage } from "./agent/agent-storage.js";
import { attachAgentStoragePersistence } from "./persistence-hooks.js";
import { createAgentMcpServer } from "./agent/mcp-server.js";
import { ProviderSnapshotManager } from "./agent/provider-snapshot-manager.js";
import { bootstrapWorkspaceRegistries } from "./workspace-registry-bootstrap.js";
import { WorkspaceReconciliationService } from "./workspace-reconciliation-service.js";
import { FileBackedProjectRegistry, FileBackedWorkspaceRegistry } from "./workspace-registry.js";
import { FileBackedChatService } from "./chat/chat-service.js";
import { CheckoutDiffManager } from "./checkout-diff-manager.js";
import { LoopService } from "./loop-service.js";
import { ScheduleService } from "./schedule/service.js";
import { DaemonConfigStore } from "./daemon-config-store.js";
import { WorkspaceGitServiceImpl } from "./workspace-git-service.js";
import { archivePersistedWorkspaceRecord } from "./workspace-archive-service.js";
import { setupAutoArchiveOnMerge } from "./auto-archive-on-merge/index.js";
import { wrapSessionMessage, type SessionOutboundMessage } from "./messages.js";
import type { TerminalManager } from "../terminal/terminal-manager.js";
import { createConfiguredTerminalManager } from "../terminal/terminal-manager-factory.js";
import { createConnectionOfferV2, encodeOfferToFragmentUrl } from "./connection-offer.js";
import { loadOrCreateDaemonKeyPair } from "./daemon-keypair.js";
import { startRelayTransport, type RelayTransportController } from "./relay-transport.js";
import type { PushNotificationSender } from "./push/notifications.js";
import { getOrCreateServerId } from "./server-id.js";
import { resolveDaemonVersion } from "./daemon-version.js";
import type { AgentClient, AgentProvider } from "./agent/agent-sdk-types.js";
import type {
  AgentProviderRuntimeSettingsMap,
  ProviderOverride,
} from "./agent/provider-launch-config.js";
import type { PersistedConfig } from "./persisted-config.js";
import {
  ScriptRouteStore,
  createScriptProxyMiddleware,
  createScriptProxyUpgradeHandler,
} from "./script-proxy.js";
import { ScriptHealthMonitor } from "./script-health-monitor.js";
import { createScriptStatusEmitter } from "./script-status-projection.js";
import { WorkspaceScriptRuntimeStore } from "./workspace-script-runtime-store.js";
import { isHostnameAllowed, type HostnamesConfig } from "./hostnames.js";
import { createRequireBearerMiddleware, type DaemonAuthConfig } from "./auth.js";
import {
  AccountControlPlane,
  AccountControlPlaneError,
  type AccountAuthResult,
} from "./account-control-plane.js";
import { createPptPreviewRouter } from "./ai-creation/ppt-preview-service.js";
import { createPptConfirmRouter } from "./ai-creation/ppt-confirm-service.js";
import { getDownloadableFileInfo } from "./file-explorer/service.js";
import { createOnlyOfficeXlsxPreviewBuffer } from "./onlyoffice-xlsx-preview.js";
import { createRuntimeApiRouter } from "./runtime-api.js";
import { createUserWorkspaceApiRouter } from "./user-workspace-api.js";
import { createDaemonAdminApiRouter } from "./daemon-admin-api.js";
import { createControlTimelineSync } from "./control-timeline-sync.js";

type AgentMcpTransportMap = Map<string, StreamableHTTPServerTransport>;

const MAX_MCP_DEBUG_BATCH_ITEMS = 10;
const REDACTED_LOG_VALUE = "[redacted]";
const DOWNLOAD_OPEN_FLAGS =
  process.platform === "win32" ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW;
const ONLYOFFICE_PREVIEW_XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ONLYOFFICE_SELECTION_PLUGIN_GUID = "asc.{6D5C3F73-B91E-4A5A-90A0-9B3B23D20A1D}";

interface OnlyOfficeSelectionCapture {
  kind?: "range" | "drawing";
  documentKey: string;
  sheetName: string;
  address: string;
  drawingIndex?: number;
  drawingSelectionState?: string;
  drawingType?: string;
  text?: string;
  value?: string;
  formula?: string;
  updatedAt: number;
}

function formatHostForHttpUrl(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function resolveAgentMcpClientHost(host: string): string {
  if (host === "0.0.0.0") {
    return "127.0.0.1";
  }
  if (host === "::" || host === "[::]") {
    return "::1";
  }
  return host;
}

function createAgentMcpBaseUrl(listenTarget: ListenTarget | null): string | null {
  if (!listenTarget || listenTarget.type !== "tcp") {
    return null;
  }
  const host = resolveAgentMcpClientHost(listenTarget.host);
  return new URL(
    "/mcp/agents",
    `http://${formatHostForHttpUrl(host)}:${listenTarget.port}`,
  ).toString();
}

function getRequestPublicBaseUrl(req: express.Request): string {
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const protocol =
    forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : req.protocol;
  return `${protocol}://${req.get("host") ?? "localhost"}`;
}

function readLockedProviderModel(
  value: unknown,
): NonNullable<DoyaDaemonConfig["lockedProviderModel"]> | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  const record = value;
  if (typeof record.provider !== "string" || typeof record.model !== "string") {
    return null;
  }
  const provider = record.provider.trim();
  const model = record.model.trim();
  if (!provider || !model) {
    return null;
  }
  const lockedProviderModel: NonNullable<DoyaDaemonConfig["lockedProviderModel"]> = {
    provider,
    model,
  };
  if (typeof record.modeId === "string" && record.modeId.trim()) {
    lockedProviderModel.modeId = record.modeId.trim();
  }
  if (typeof record.thinkingOptionId === "string" && record.thinkingOptionId.trim()) {
    lockedProviderModel.thinkingOptionId = record.thinkingOptionId.trim();
  }
  if (isPlainRecord(record.featureValues)) {
    lockedProviderModel.featureValues = record.featureValues;
  }
  return lockedProviderModel;
}

async function streamLocalFile(input: {
  absolutePath: string;
  cacheControl?: string;
  contentType: string;
  logger: Logger;
  res: express.Response;
}): Promise<void> {
  let fileHandle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    fileHandle = await open(input.absolutePath, DOWNLOAD_OPEN_FLAGS);
    const fileStats = await fileHandle.stat();
    if (!fileStats.isFile()) {
      input.res.status(404).json({ error: "File not found" });
      return;
    }

    input.res.setHeader("Content-Type", input.contentType);
    input.res.setHeader("Content-Length", fileStats.size.toString());
    if (input.cacheControl) {
      input.res.setHeader("Cache-Control", input.cacheControl);
    }

    const stream = fileHandle.createReadStream();
    fileHandle = null;
    await pipeline(stream, input.res);
  } catch (err) {
    input.logger.error({ err, path: input.absolutePath }, "Failed to stream local file");
    if (!input.res.headersSent) {
      input.res.status(404).json({ error: "File not found" });
    } else if (!input.res.writableEnded) {
      input.res.end();
    }
  } finally {
    await fileHandle?.close().catch(() => undefined);
  }
}

function formatAccountAuthResult(result: AccountAuthResult): object {
  return {
    user: {
      userId: result.user.userId,
      email: result.user.email,
      phone: result.user.phone,
    },
    accessToken: result.accessToken,
    workspace: {
      workspaceId: result.workspace.workspaceId,
      displayName: result.workspace.displayName,
      runtime: {
        cwd: result.workspace.cwd,
      },
    },
    projects: result.projects.map((project) => ({
      projectId: project.projectId,
      workspaceId: project.workspaceId,
      displayName: project.displayName,
      cwd: project.cwd,
    })),
  };
}

function summarizeAgentMcpDebugMessage(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      type: body === null ? "null" : typeof body,
    };
  }

  const record = body as Record<string, unknown>;
  const method = typeof record.method === "string" ? record.method : undefined;
  return {
    type: "object",
    ...(typeof record.jsonrpc === "string" ? { jsonrpc: record.jsonrpc } : {}),
    ...(method ? { method } : {}),
    hasId: Object.prototype.hasOwnProperty.call(record, "id"),
    hasParams: Object.prototype.hasOwnProperty.call(record, "params"),
  };
}

function summarizeAgentMcpDebugBody(body: unknown): Record<string, unknown> {
  if (!Array.isArray(body)) {
    return summarizeAgentMcpDebugMessage(body);
  }

  const messages = body.slice(0, MAX_MCP_DEBUG_BATCH_ITEMS).map(summarizeAgentMcpDebugMessage);
  return {
    type: "batch",
    count: body.length,
    messages,
    ...(body.length > messages.length ? { omitted: body.length - messages.length } : {}),
  };
}

export type DoyaOpenAIConfig = OpenAiSpeechProviderConfig;
export type DoyaLocalSpeechConfig = LocalSpeechProviderConfig;

export interface DoyaSpeechSttLanguages {
  dictation?: string;
  voice?: string;
}

export interface DoyaSpeechConfig {
  providers: RequestedSpeechProviders;
  sttLanguages?: DoyaSpeechSttLanguages;
  local?: DoyaLocalSpeechConfig;
}

export type DaemonLifecycleIntent =
  | {
      type: "shutdown";
      clientId: string;
      requestId: string;
    }
  | {
      type: "restart";
      clientId: string;
      requestId: string;
      reason?: string;
    };

export interface DoyaDaemonConfig {
  listen: string;
  doyaHome?: string;
  worktreesRoot?: string;
  corsAllowedOrigins: string[];
  allowedHosts?: HostnamesConfig;
  hostnames?: HostnamesConfig;
  mcpEnabled?: boolean;
  mcpInjectIntoAgents?: boolean;
  autoArchiveAfterMerge?: boolean;
  appendSystemPrompt?: string;
  staticDir: string;
  mcpDebug: boolean;
  isDev?: boolean;
  agentClients: Partial<Record<AgentProvider, AgentClient>>;
  agentStoragePath: string;
  relayEnabled?: boolean;
  relayEndpoint?: string;
  relayPublicEndpoint?: string;
  relayUseTls?: boolean;
  relayPublicUseTls?: boolean;
  appBaseUrl?: string;
  auth?: DaemonAuthConfig;
  openai?: DoyaOpenAIConfig;
  speech?: DoyaSpeechConfig;
  voiceLlmProvider?: AgentProvider | null;
  voiceLlmProviderExplicit?: boolean;
  voiceLlmModel?: string | null;
  dictationFinalTimeoutMs?: number;
  downloadTokenTtlMs?: number;
  agentProviderSettings?: AgentProviderRuntimeSettingsMap;
  metadataGeneration?: {
    providers?: Array<{
      provider: string;
      model?: string;
      thinkingOptionId?: string;
    }>;
  };
  lockedProviderModel?: {
    provider: AgentProvider;
    model: string;
    modeId?: string;
    thinkingOptionId?: string;
    featureValues?: Record<string, unknown>;
  } | null;
  providerOverrides?: Record<string, ProviderOverride>;
  log?: PersistedConfig["log"];
  onLifecycleIntent?: (intent: DaemonLifecycleIntent) => void;
  pushNotificationSender?: PushNotificationSender;
}

export interface DoyaDaemon {
  config: DoyaDaemonConfig;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  terminalManager: TerminalManager;
  scriptRouteStore: ScriptRouteStore;
  scriptRuntimeStore: WorkspaceScriptRuntimeStore;
  start(): Promise<void>;
  stop(): Promise<void>;
  getListenTarget(): ListenTarget | null;
}

export async function createDoyaDaemon(
  config: DoyaDaemonConfig,
  rootLogger: Logger,
): Promise<DoyaDaemon> {
  const logger = rootLogger.child({ module: "bootstrap" });
  const bootstrapStart = performance.now();
  const elapsed = () => `${(performance.now() - bootstrapStart).toFixed(0)}ms`;
  const daemonVersion = resolveDaemonVersion(import.meta.url);
  const doyaHome = config.doyaHome;
  if (!doyaHome) {
    throw new Error("Doya daemon requires doyaHome");
  }
  const daemonConfigStore = new DaemonConfigStore(
    doyaHome,
    {
      mcp: { injectIntoAgents: config.mcpInjectIntoAgents ?? true },
      providers: Object.fromEntries(
        Object.entries(config.providerOverrides ?? {}).map(([providerId, override]) => [
          providerId,
          {
            ...(override.enabled !== undefined ? { enabled: override.enabled } : {}),
            ...(override.additionalModels ? { additionalModels: override.additionalModels } : {}),
          },
        ]),
      ),
      metadataGeneration: {
        providers: config.metadataGeneration?.providers ?? [],
      },
      agents: {
        lockedProviderModel: config.lockedProviderModel ?? null,
      },
      autoArchiveAfterMerge: config.autoArchiveAfterMerge ?? false,
      appendSystemPrompt: config.appendSystemPrompt ?? "",
    },
    logger,
  );

  const serverId = getOrCreateServerId(doyaHome, { logger });
  const daemonKeyPair = await loadOrCreateDaemonKeyPair(doyaHome, logger);
  let relayTransport: RelayTransportController | null = null;

  const staticDir = config.staticDir;
  const downloadTokenTtlMs = config.downloadTokenTtlMs ?? 60000;

  const downloadTokenStore = new DownloadTokenStore({
    ttlMs: downloadTokenTtlMs,
  });

  const listenTarget = parseListenString(config.listen);

  const app = express();
  let boundListenTarget: ListenTarget | null = null;
  let workspaceRegistry: FileBackedWorkspaceRegistry | null = null;

  const scriptRouteStore = new ScriptRouteStore();
  const scriptRuntimeStore = new WorkspaceScriptRuntimeStore();
  const configuredHostnames = config.hostnames ?? config.allowedHosts;
  let wsServer: VoiceAssistantWebSocketServer | null = null;
  const scriptHealthMonitor = new ScriptHealthMonitor({
    routeStore: scriptRouteStore,
    onChange: createScriptStatusEmitter({
      sessions: () =>
        wsServer?.listActiveSessions().map((session) => ({
          emit: (message) => session.emitServerMessage(message),
        })) ?? [],
      routeStore: scriptRouteStore,
      runtimeStore: scriptRuntimeStore,
      daemonPort: () => (boundListenTarget?.type === "tcp" ? boundListenTarget.port : null),
      resolveWorkspaceDirectory: async (workspaceId) =>
        (await workspaceRegistry?.get(workspaceId))?.cwd ?? null,
      logger,
    }),
  });
  const handleBranchChange = createBranchChangeRouteHandler({
    routeStore: scriptRouteStore,
    onRoutesChanged: (workspaceId) => {
      scriptHealthMonitor.invalidateWorkspace(workspaceId);
    },
    logger,
  });

  // Host allowlist / DNS rebinding protection (vite-like semantics).
  // For non-TCP (unix sockets), skip host validation.
  if (listenTarget.type === "tcp") {
    app.use((req, res, next) => {
      const hostHeader = typeof req.headers.host === "string" ? req.headers.host : undefined;
      if (!isHostnameAllowed(hostHeader, configuredHostnames)) {
        res.status(403).json({ error: "Invalid Host header" });
        return;
      }
      next();
    });
  }

  // CORS - allow same-origin + configured origins
  const allowedOrigins = new Set([
    ...config.corsAllowedOrigins,
    // Packaged desktop renderers use custom protocol schemes.
    "doya://app",
    // For TCP, add localhost variants
    ...(listenTarget.type === "tcp"
      ? [
          `http://${listenTarget.host}:${listenTarget.port}`,
          `http://localhost:${listenTarget.port}`,
          `http://127.0.0.1:${listenTarget.port}`,
        ]
      : []),
  ]);

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (allowedOrigins.has("*") || allowedOrigins.has(origin))) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Doya-File-Mime-Type, X-Doya-User-Id, X-Doya-Access-Token",
      );
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(
    createRequireBearerMiddleware(config.auth, (context) => {
      logger.warn(context, "Rejected HTTP request with invalid daemon password");
    }),
  );

  // Script proxy — intercepts requests for registered *.localhost hostnames
  // and forwards them to the corresponding local script port. Placed after
  // host/CORS/auth checks but before the rest of the routes.
  app.use(createScriptProxyMiddleware({ routeStore: scriptRouteStore, logger }));

  // Serve static files from public directory
  app.use("/public", express.static(staticDir));

  // Middleware
  app.use(express.json());
  const onlyOfficeSelectionCaptures = new Map<string, OnlyOfficeSelectionCapture>();

  const accountControlPlane = new AccountControlPlane({ doyaHome });
  const sendAccountError = (res: express.Response, error: unknown): void => {
    if (error instanceof AccountControlPlaneError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    logger.error({ err: error }, "Account API request failed");
    res.status(500).json({ error: "账号服务请求失败" });
  };

  app.post("/api/account/register", (req, res) => {
    void (async () => {
      try {
        const result = await accountControlPlane.register({
          email: typeof req.body?.email === "string" ? req.body.email : "",
          displayName: typeof req.body?.displayName === "string" ? req.body.displayName : undefined,
        });
        res.json(formatAccountAuthResult(result));
      } catch (error) {
        sendAccountError(res, error);
      }
    })();
  });

  app.post("/api/account/login", (req, res) => {
    void (async () => {
      try {
        const result = await accountControlPlane.login({
          email: typeof req.body?.email === "string" ? req.body.email : "",
        });
        res.json(formatAccountAuthResult(result));
      } catch (error) {
        sendAccountError(res, error);
      }
    })();
  });

  app.post("/api/account/session", (req, res) => {
    void (async () => {
      try {
        const result = await accountControlPlane.getSession({
          userId: typeof req.body?.userId === "string" ? req.body.userId : "",
          accessToken: typeof req.body?.accessToken === "string" ? req.body.accessToken : "",
        });
        res.json(formatAccountAuthResult(result));
      } catch (error) {
        sendAccountError(res, error);
      }
    })();
  });

  app.post("/api/account/projects", (req, res) => {
    void (async () => {
      try {
        const project = await accountControlPlane.createProject({
          userId: typeof req.body?.userId === "string" ? req.body.userId : "",
          workspaceId: typeof req.body?.workspaceId === "string" ? req.body.workspaceId : "",
          accessToken: typeof req.body?.accessToken === "string" ? req.body.accessToken : "",
          displayName: typeof req.body?.displayName === "string" ? req.body.displayName : "",
        });
        res.json({ project });
      } catch (error) {
        sendAccountError(res, error);
      }
    })();
  });

  app.post("/api/account/projects/delete", (req, res) => {
    void (async () => {
      try {
        const projects = await accountControlPlane.deleteProject({
          userId: typeof req.body?.userId === "string" ? req.body.userId : "",
          workspaceId: typeof req.body?.workspaceId === "string" ? req.body.workspaceId : "",
          projectId: typeof req.body?.projectId === "string" ? req.body.projectId : "",
          accessToken: typeof req.body?.accessToken === "string" ? req.body.accessToken : "",
        });
        res.json({
          projects: projects.map((project) => ({
            projectId: project.projectId,
            workspaceId: project.workspaceId,
            displayName: project.displayName,
            cwd: project.cwd,
          })),
        });
      } catch (error) {
        sendAccountError(res, error);
      }
    })();
  });

  app.post("/api/account/projects/rename", (req, res) => {
    void (async () => {
      try {
        const projects = await accountControlPlane.renameProject({
          userId: typeof req.body?.userId === "string" ? req.body.userId : "",
          workspaceId: typeof req.body?.workspaceId === "string" ? req.body.workspaceId : "",
          projectId: typeof req.body?.projectId === "string" ? req.body.projectId : "",
          accessToken: typeof req.body?.accessToken === "string" ? req.body.accessToken : "",
          displayName: typeof req.body?.displayName === "string" ? req.body.displayName : "",
        });
        res.json({
          projects: projects.map((project) => ({
            projectId: project.projectId,
            workspaceId: project.workspaceId,
            displayName: project.displayName,
            cwd: project.cwd,
          })),
        });
      } catch (error) {
        sendAccountError(res, error);
      }
    })();
  });

  app.use(
    "/api/runtimes",
    createRuntimeApiRouter({
      doyaHome,
      nodeId: serverId,
      logger,
    }),
  );
  app.use(
    "/api/user-workspaces",
    createUserWorkspaceApiRouter({
      doyaHome,
    }),
  );
  app.use(
    "/api/admin/daemon",
    createDaemonAdminApiRouter({
      doyaHome,
      nodeId: serverId,
      getConfig: () => daemonConfigStore.get(),
      patchConfig: (patch) => daemonConfigStore.patch(patch),
      requestRestart: ({ requestId, reason }) => {
        config.onLifecycleIntent?.({
          type: "restart",
          clientId: "daemon-admin-api",
          requestId,
          ...(reason ? { reason } : {}),
        });
      },
    }),
  );

  // Health check endpoint
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/api/status", (_req, res) => {
    res.json({
      status: "server_info",
      serverId,
      hostname: getHostname(),
      version: daemonVersion,
      listen: formatListenTarget(boundListenTarget ?? listenTarget),
    });
  });

  const handleFileDownload = async (req: express.Request, res: express.Response): Promise<void> => {
    const token =
      typeof req.query.token === "string" && req.query.token.trim().length > 0
        ? req.query.token.trim()
        : null;

    if (!token) {
      res.status(400).json({ error: "Missing download token" });
      return;
    }

    const entry = downloadTokenStore.resolveToken(token);
    if (!entry) {
      res.status(403).json({ error: "Invalid or expired token" });
      return;
    }

    let fileHandle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      fileHandle = await open(entry.absolutePath, DOWNLOAD_OPEN_FLAGS);
      const fileStats = await fileHandle.stat();
      if (!fileStats.isFile()) {
        res.status(404).json({ error: "File not found" });
        return;
      }

      res.setHeader("Content-Type", entry.mimeType);
      res.setHeader("Content-Disposition", buildAttachmentContentDisposition(entry.fileName));
      res.setHeader("Content-Length", fileStats.size.toString());

      const stream = fileHandle.createReadStream();
      fileHandle = null;
      stream.on("error", (err) => {
        logger.error({ err }, "Failed to stream download");
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to read file" });
        } else {
          res.end();
        }
      });
      stream.pipe(res);
    } catch (err) {
      logger.error({ err }, "Failed to download file");
      if (!res.headersSent) {
        res.status(404).json({ error: "File not found" });
      }
    } finally {
      await fileHandle?.close().catch(() => undefined);
    }
  };

  app.get("/api/files/download", (req, res) => {
    void handleFileDownload(req, res);
  });

  function buildAttachmentContentDisposition(fileName: string): string {
    const fallbackFileName = buildAsciiFileNameFallback(fileName);
    const encodedFileName = encodeRfc5987Value(fileName);
    return `attachment; filename="${fallbackFileName}"; filename*=UTF-8''${encodedFileName}`;
  }

  function buildAsciiFileNameFallback(fileName: string): string {
    const fallback = fileName
      .replace(/[^\x20-\x7E]+/g, "_")
      .replace(/["\\\r\n]/g, "_")
      .trim();
    return fallback || "download";
  }

  function encodeRfc5987Value(value: string): string {
    return encodeURIComponent(value).replace(
      /['()*]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  }

  const handleWorkspaceFileRaw = async (
    req: express.Request,
    res: express.Response,
  ): Promise<void> => {
    const cwd = typeof req.query.cwd === "string" ? req.query.cwd.trim() : "";
    const requestedPath = typeof req.query.path === "string" ? req.query.path.trim() : "";
    if (!cwd || !requestedPath) {
      res.status(400).json({ error: "cwd and path are required" });
      return;
    }

    try {
      const info = await getDownloadableFileInfo({
        root: cwd,
        relativePath: requestedPath,
      });
      await streamLocalFile({
        absolutePath: info.absolutePath,
        cacheControl: "private, max-age=3600",
        contentType: info.mimeType,
        logger,
        res,
      });
    } catch (err) {
      logger.error({ err, cwd, path: requestedPath }, "Failed to stream workspace file");
      if (!res.headersSent) {
        res.status(404).json({ error: "File not found" });
      }
    }
  };

  const handleWorkspaceFileOnlyOfficePreview = async (
    req: express.Request,
    res: express.Response,
  ): Promise<void> => {
    const cwd = typeof req.query.cwd === "string" ? req.query.cwd.trim() : "";
    const requestedPath = typeof req.query.path === "string" ? req.query.path.trim() : "";
    if (!cwd || !requestedPath) {
      res.status(400).json({ error: "cwd and path are required" });
      return;
    }

    try {
      const info = await getDownloadableFileInfo({
        root: cwd,
        relativePath: requestedPath,
      });
      if (path.extname(info.absolutePath).toLowerCase() !== ".xlsx") {
        await streamLocalFile({
          absolutePath: info.absolutePath,
          cacheControl: "no-store",
          contentType: info.mimeType,
          logger,
          res,
        });
        return;
      }

      try {
        const sourceBuffer = await readFile(info.absolutePath);
        const previewBuffer = await createOnlyOfficeXlsxPreviewBuffer(sourceBuffer);
        res.setHeader("Content-Type", ONLYOFFICE_PREVIEW_XLSX_MIME_TYPE);
        res.setHeader("Content-Length", previewBuffer.byteLength.toString());
        res.setHeader("Cache-Control", "no-store");
        res.send(previewBuffer);
      } catch (err) {
        logger.warn(
          { err, cwd, path: requestedPath },
          "Failed to prepare XLSX for ONLYOFFICE preview",
        );
        await streamLocalFile({
          absolutePath: info.absolutePath,
          cacheControl: "no-store",
          contentType: info.mimeType,
          logger,
          res,
        });
      }
    } catch (err) {
      logger.error({ err, cwd, path: requestedPath }, "Failed to stream ONLYOFFICE preview file");
      if (!res.headersSent) {
        res.status(404).json({ error: "File not found" });
      }
    }
  };

  app.get("/api/workspace-files/raw", (req, res) => {
    void handleWorkspaceFileRaw(req, res);
  });

  app.get("/api/workspace-files/onlyoffice-preview", (req, res) => {
    void handleWorkspaceFileOnlyOfficePreview(req, res);
  });

  app.get("/api/onlyoffice/doya-selection-plugin/config.json", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const documentKey =
      typeof req.query.document_key === "string" ? req.query.document_key.trim() : "";
    const accessToken =
      typeof req.query.access_token === "string" ? req.query.access_token.trim() : "";
    const version = typeof req.query.v === "string" ? req.query.v.trim() : "";
    const baseUrl = getRequestPublicBaseUrl(req);
    const pluginBaseUrl = `${baseUrl}/api/onlyoffice/doya-selection-plugin/`;
    const url = new URL("index.html", pluginBaseUrl);
    url.searchParams.set("document_key", documentKey);
    if (version) {
      url.searchParams.set("v", version);
    }
    if (accessToken) {
      url.searchParams.set("access_token", accessToken);
    }
    const variationUrl = `index.html${url.search}`;
    res.setHeader("Cache-Control", "no-store");
    res.json({
      baseUrl: pluginBaseUrl,
      guid: ONLYOFFICE_SELECTION_PLUGIN_GUID,
      name: "Doya Selection Bridge",
      variations: [
        {
          EditorsSupport: ["cell"],
          description: "Shares the current spreadsheet selection with Doya.",
          events: ["onDocumentContentReady"],
          initDataType: "none",
          initOnSelectionChanged: true,
          isDisplayedInViewer: true,
          isSystem: true,
          isViewer: true,
          isVisual: false,
          type: "background",
          url: variationUrl,
        },
      ],
    });
  });

  app.get("/api/onlyoffice/doya-selection-plugin/index.html", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const documentKey =
      typeof req.query.document_key === "string" ? req.query.document_key.trim() : "";
    const accessToken =
      typeof req.query.access_token === "string" ? req.query.access_token.trim() : "";
    const version = typeof req.query.v === "string" ? req.query.v.trim() : "";
    const baseUrl = getRequestPublicBaseUrl(req);
    const scriptUrl = new URL("/api/onlyoffice/doya-selection-plugin/plugin.js", baseUrl);
    scriptUrl.searchParams.set("document_key", documentKey);
    if (version) {
      scriptUrl.searchParams.set("v", version);
    }
    if (accessToken) {
      scriptUrl.searchParams.set("access_token", accessToken);
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Doya Selection Bridge</title>
    <script type="text/javascript" src="https://onlyoffice.github.io/sdkjs-plugins/v1/plugins.js"></script>
    <script type="text/javascript" src="${escapeHtmlAttribute(scriptUrl.toString())}"></script>
  </head>
  <body></body>
</html>`);
  });

  app.get("/api/onlyoffice/doya-selection-plugin/plugin.js", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const documentKey =
      typeof req.query.document_key === "string" ? req.query.document_key.trim() : "";
    const accessToken =
      typeof req.query.access_token === "string" ? req.query.access_token.trim() : "";
    const baseUrl = getRequestPublicBaseUrl(req);
    const captureUrl = new URL("/api/onlyoffice/selection-capture", baseUrl);
    captureUrl.searchParams.set("document_key", documentKey);
    if (accessToken) {
      captureUrl.searchParams.set("access_token", accessToken);
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.send(`(function () {
  "use strict";
  var documentKey = ${JSON.stringify(documentKey)};
  var captureUrl = ${JSON.stringify(captureUrl.toString())};
  var lastPayload = "";
  var timer = null;
  var started = false;

  function safeString(value) {
    if (value === null || value === undefined) return "";
    var text = "";
    if (typeof value === "string") {
      text = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      text = String(value);
    } else {
      try {
        text = JSON.stringify(value);
      } catch (error) {
        text = "";
      }
    }
    return text.length > 2000 ? text.slice(0, 2000) + "..." : text;
  }

  function reportSelection() {
    if (!window.Asc || !window.Asc.plugin || !window.Asc.plugin.callCommand) return;
    window.Asc.plugin.onCommandCallback = handleSelectionResult;
    window.Asc.plugin.callCommand(function () {
      function readValue(read) {
        try {
          return read();
        } catch (error) {
          return "";
        }
      }
      function readSingleCellValue(address, read) {
        if (!address || address.indexOf(":") !== -1) return "";
        return readValue(read);
      }
      function readArray(read) {
        var value = readValue(read);
        return Array.isArray(value) ? value : [];
      }
      function safeText(value) {
        return typeof value === "string" && value.trim() ? value.trim() : "";
      }
      function safeString(value) {
        if (value === null || value === undefined) return "";
        var text = "";
        if (typeof value === "string") {
          text = value;
        } else if (typeof value === "number" || typeof value === "boolean") {
          text = String(value);
        } else {
          try {
            text = JSON.stringify(value);
          } catch (error) {
            text = "";
          }
        }
        return text.length > 4000 ? text.slice(0, 4000) + "..." : text;
      }
      function readDrawingText(drawing, fallback) {
        return (
          safeText(readValue(function () { return drawing && drawing.GetTitle && drawing.GetTitle(); })) ||
          safeText(readValue(function () { return drawing && drawing.GetName && drawing.GetName(); })) ||
          fallback
        );
      }
      function compactSelectionState(value, depth) {
        if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
        if (depth <= 0) return undefined;
        if (Array.isArray(value)) {
          return value.slice(0, 20).map(function (item) { return compactSelectionState(item, depth - 1); });
        }
        if (typeof value !== "object") return undefined;
        var result = {};
        Object.getOwnPropertyNames(value)
          .slice(0, 80)
          .forEach(function (key) {
            if (!/^(selection|selected|chart|data|dLbl|label|idx|index|point|series|type|name|title|id|target|object|text|value|x|y|pos|state)/i.test(key)) return;
            var compactValue = compactSelectionState(readValue(function () { return value[key]; }), depth - 1);
            if (compactValue !== undefined) result[key] = compactValue;
          });
        return Object.keys(result).length ? result : undefined;
      }
      function stringifySelectionState(value) {
        var compactValue = compactSelectionState(value, 5);
        if (compactValue === undefined) return "";
        try {
          return JSON.stringify(compactValue).slice(0, 4000);
        } catch (error) {
          return "";
        }
      }
      function drawingIdentity(drawing) {
        return JSON.stringify([
          safeString(readValue(function () { return drawing && drawing.GetClassType && drawing.GetClassType(); })),
          safeString(readValue(function () { return drawing && drawing.GetName && drawing.GetName(); })),
          safeString(readValue(function () { return drawing && drawing.GetTitle && drawing.GetTitle(); }))
        ]);
      }
      function findDrawingIndex(allDrawings, drawing) {
        var directIndex = allDrawings.indexOf(drawing);
        if (directIndex >= 0) return directIndex + 1;
        var identity = drawingIdentity(drawing);
        for (var index = 0; index < allDrawings.length; index += 1) {
          if (drawingIdentity(allDrawings[index]) === identity) return index + 1;
        }
        return 1;
      }
      try {
        var sheet = Api.GetActiveSheet && Api.GetActiveSheet();
        var sheetName = readValue(function () { return sheet && sheet.GetName && sheet.GetName(); }) || "Sheet1";
        var selection = sheet && sheet.GetSelection && sheet.GetSelection();
        var address =
          readValue(function () { return selection && selection.GetAddress && selection.GetAddress(false, false, "xlA1", false); }) ||
          readValue(function () { return selection && selection.GetAddress && selection.GetAddress(); });
        var selectedDrawings = readArray(function () { return sheet && sheet.GetSelectedDrawings && sheet.GetSelectedDrawings(); });
        if (!selectedDrawings.length) {
          selectedDrawings = readArray(function () { return sheet && sheet.GetSelectedShapes && sheet.GetSelectedShapes(); });
        }
        var allDrawings = readArray(function () { return sheet && sheet.GetAllDrawings && sheet.GetAllDrawings(); });
        if (selectedDrawings.length) {
          var drawing = selectedDrawings[0];
          var drawingIndex = findDrawingIndex(allDrawings, drawing);
          var drawingType = safeText(readValue(function () { return drawing && drawing.GetClassType && drawing.GetClassType(); })) || "drawing";
          var drawingAddress = "drawing:" + drawingIndex;
          return JSON.stringify({
            kind: "drawing",
            sheetName: sheetName,
            address: drawingAddress,
            drawingIndex: drawingIndex,
            drawingSelectionState: stringifySelectionState(readValue(function () { return drawing && drawing.Drawing && drawing.Drawing.getSelectionState && drawing.Drawing.getSelectionState(); })),
            drawingType: drawingType,
            text: readDrawingText(drawing, drawingAddress)
          });
        }
        if (!address) return null;
        return JSON.stringify({
          kind: "range",
          sheetName: sheetName,
          address: address || "",
          formula: readSingleCellValue(address, function () { return selection && selection.GetFormula && selection.GetFormula(); }),
          text: readSingleCellValue(address, function () { return selection && selection.GetText && selection.GetText(); }),
          value: readSingleCellValue(address, function () { return selection && selection.GetValue && selection.GetValue(); })
        });
      } catch (error) {
        return null;
      }
    }, false, true, handleSelectionResult);
  }

  function parseSelectionResult(result) {
    if (!result) return null;
    if (typeof result === "string") {
      try {
        return JSON.parse(result);
      } catch (error) {
        return null;
      }
    }
    return result;
  }

  function handleSelectionResult(result) {
      result = parseSelectionResult(result);
      if (!result || !result.address) return;
      var payload = {
        documentKey: documentKey,
        kind: safeString(result.kind),
        sheetName: safeString(result.sheetName) || "Sheet1",
        address: safeString(result.address),
        drawingIndex: result.drawingIndex,
        drawingSelectionState: safeString(result.drawingSelectionState),
        drawingType: safeString(result.drawingType),
        formula: safeString(result.formula),
        text: safeString(result.text),
        value: safeString(result.value)
      };
      var serialized = JSON.stringify(payload);
      if (serialized === lastPayload) return;
      lastPayload = serialized;
      fetch(captureUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: serialized
      }).catch(function () {});
  }

  function startReporting() {
    if (started) return;
    started = true;
    reportSelection();
    timer = window.setInterval(reportSelection, 800);
  }

  window.Asc.plugin.init = function () {
    window.Asc.plugin.event_onDocumentContentReady = startReporting;
    window.setTimeout(startReporting, 1500);
  };
  window.Asc.plugin.button = function () {};
  window.addEventListener("unload", function () {
    if (timer) window.clearInterval(timer);
  });
})();`);
  });

  app.post("/api/onlyoffice/selection-capture", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const capture = normalizeOnlyOfficeSelectionCapture(req.body);
    const documentKey =
      typeof req.query.document_key === "string" ? req.query.document_key.trim() : "";
    if (!capture || capture.documentKey !== documentKey) {
      res.status(400).json({ error: "Invalid selection capture" });
      return;
    }
    onlyOfficeSelectionCaptures.set(capture.documentKey, capture);
    res.json({ ok: true });
  });

  app.get("/api/onlyoffice/selection-capture", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const documentKey =
      typeof req.query.document_key === "string" ? req.query.document_key.trim() : "";
    res.setHeader("Cache-Control", "no-store");
    res.json({
      selection: documentKey ? (onlyOfficeSelectionCaptures.get(documentKey) ?? null) : null,
    });
  });

  app.post("/api/onlyoffice/callback", (_req, res) => {
    res.json({ error: 0 });
  });

  const httpServer = createHTTPServer(app);

  // Script proxy WebSocket upgrade handler — must be registered before the
  // VoiceAssistantWebSocketServer attaches its own "upgrade" listener so that
  // script-bound upgrades are forwarded first. The handler is a no-op for
  // requests that don't match a registered script route.
  const scriptProxyUpgradeHandler = createScriptProxyUpgradeHandler({
    routeStore: scriptRouteStore,
    logger,
  });
  httpServer.on("upgrade", scriptProxyUpgradeHandler);

  const agentStorage = new AgentStorage(config.agentStoragePath, logger);
  const projectRegistry = new FileBackedProjectRegistry(
    path.join(doyaHome, "projects", "projects.json"),
    logger,
  );
  workspaceRegistry = new FileBackedWorkspaceRegistry(
    path.join(doyaHome, "projects", "workspaces.json"),
    logger,
  );
  const chatService = new FileBackedChatService({
    doyaHome,
    logger,
  });
  const terminalManager = createConfiguredTerminalManager();
  const github = createGitHubService();
  const workspaceGitService = new WorkspaceGitServiceImpl({
    logger,
    doyaHome,
    worktreesRoot: config.worktreesRoot,
    deps: {
      github,
    },
  });
  const providerSnapshotLogger = logger.child({ module: "provider-snapshot-manager" });
  const providerSnapshotManager = new ProviderSnapshotManager({
    logger: providerSnapshotLogger,
    runtimeSettings: config.agentProviderSettings,
    providerOverrides: config.providerOverrides,
    workspaceGitService,
    isDev: config.isDev === true,
    extraClients: config.agentClients,
  });
  const initialAgentManagerState = providerSnapshotManager.getAgentManagerProviderState();
  const conversationRecordingStore = new ConversationRecordingStore(
    path.join(doyaHome, "recordings"),
  );
  const controlTimelineSync = createControlTimelineSync({ logger });
  const agentManager = new AgentManager({
    clients: initialAgentManagerState.clients,
    providerDefinitions: initialAgentManagerState.providerDefinitions,
    registry: agentStorage,
    appendSystemPrompt: config.appendSystemPrompt,
    lockedProviderModel: config.lockedProviderModel ?? null,
    onRawStreamEvent: ({ agentId, event, labels }) => {
      conversationRecordingStore.recordAgentStreamEvent(agentId, event);
      return controlTimelineSync.sync({ agentId, event, labels });
    },
    logger,
  });
  const handleWorkspaceAttachmentUpload = async (
    req: express.Request,
    res: express.Response,
  ): Promise<void> => {
    const requestCwd = typeof req.query.cwd === "string" ? req.query.cwd.trim() : "";
    const agentId = typeof req.query.agentId === "string" ? req.query.agentId.trim() : "";
    const agentCwd = agentId ? agentManager.getAgent(agentId)?.cwd : undefined;
    const cwd = requestCwd || agentCwd || "";
    if (!cwd) {
      res.status(400).json({ error: "cwd or a valid agentId is required" });
      return;
    }

    try {
      const cwdStats = await stat(cwd);
      if (!cwdStats.isDirectory()) {
        res.status(400).json({ error: `Attachment workspace is not a directory: ${cwd}` });
        return;
      }

      const form = await parseMultipartFormData(req);
      const file = form.get("file");
      if (!(file instanceof Blob)) {
        res.status(400).json({ error: "Multipart field 'file' is required" });
        return;
      }
      const uploadedFile = file as Blob & { name?: string };
      const formFileName = typeof uploadedFile.name === "string" ? uploadedFile.name.trim() : "";
      const rawFileName =
        typeof req.query.fileName === "string" && req.query.fileName.trim().length > 0
          ? req.query.fileName.trim()
          : formFileName || "attached-file";
      const formMimeType = form.get("mimeType");
      const mimeType =
        typeof formMimeType === "string" && formMimeType.trim()
          ? formMimeType.trim()
          : uploadedFile.type || "application/octet-stream";

      const attachmentDir = path.join(cwd, "attachments");
      await mkdir(attachmentDir, { recursive: true });
      const filePath = path.join(attachmentDir, buildWorkspaceAttachmentFileName(rawFileName));
      await pipeline(
        Readable.fromWeb(uploadedFile.stream() as Parameters<typeof Readable.fromWeb>[0]),
        createWriteStream(filePath, { flags: "wx" }),
      );

      res.json({
        cwd,
        file: {
          title: rawFileName,
          mimeType,
          path: normalizeWorkspaceRelativePath(path.relative(cwd, filePath)),
        },
      });
    } catch (error) {
      logger.error({ err: error, cwd }, "Failed to upload workspace attachment");
      res.status(500).json({ error: "Failed to upload attachment to workspace" });
    }
  };

  app.post("/api/workspace-attachments/upload", (req, res) => {
    void handleWorkspaceAttachmentUpload(req, res);
  });

  app.use("/ppt-preview", createPptPreviewRouter({ agentManager, logger }));
  app.use("/ppt-confirm", createPptConfirmRouter({ agentManager, logger }));

  const detachAgentStoragePersistence = attachAgentStoragePersistence(
    logger,
    agentManager,
    agentStorage,
  );
  await agentStorage.initialize();
  logger.info({ elapsed: elapsed() }, "Agent storage initialized");
  await bootstrapWorkspaceRegistries({
    doyaHome,
    agentStorage,
    projectRegistry,
    workspaceRegistry,
    workspaceGitService,
    logger,
  });
  logger.info({ elapsed: elapsed() }, "Workspace registries bootstrapped");
  const workspaceReconciliation = new WorkspaceReconciliationService({
    projectRegistry,
    workspaceRegistry,
    logger,
    workspaceGitService,
  });
  void (async () => {
    try {
      const result = await workspaceReconciliation.runOnce();
      logger.info(
        {
          elapsed: elapsed(),
          changeCount: result.changesApplied.length,
        },
        "Workspace registries reconciled",
      );
    } catch (error) {
      logger.error({ err: error }, "Background workspace reconciliation failed");
    }
  })();
  await chatService.initialize();
  logger.info({ elapsed: elapsed() }, "Chat service initialized");
  const checkoutDiffManager = new CheckoutDiffManager({
    logger,
    workspaceGitService,
  });
  const loopService = new LoopService({
    doyaHome,
    logger,
    agentManager,
  });
  await loopService.initialize();
  logger.info({ elapsed: elapsed() }, "Loop service initialized");
  const scheduleService = new ScheduleService({
    doyaHome,
    logger,
    agentManager,
    agentStorage,
  });
  await scheduleService.start();
  agentManager.setAgentArchivedCallback(async (agentId) => {
    try {
      await scheduleService.deleteForAgent(agentId);
    } catch (error) {
      logger.warn({ err: error, agentId }, "Failed to delete schedules for archived agent");
    }
  });
  logger.info({ elapsed: elapsed() }, "Schedule service initialized");
  logger.info({ elapsed: elapsed() }, "Loading persisted agent registry");
  const persistedRecords = await agentStorage.list();
  logger.info(
    { elapsed: elapsed() },
    `Agent registry loaded (${persistedRecords.length} record${persistedRecords.length === 1 ? "" : "s"}); agents will initialize on demand`,
  );
  logger.info(
    "Voice mode configured for agent-scoped resume flow (no dedicated voice assistant provider)",
  );
  logger.info({ elapsed: elapsed() }, "Preparing voice and MCP runtime");

  const archiveWorkspaceRecordExternal = async (workspaceId: string) => {
    const sessions = wsServer?.listActiveSessions() ?? [];
    if (sessions.length > 0) {
      await Promise.all(
        sessions.map((session) => session.archiveWorkspaceRecordForExternalMutation(workspaceId)),
      );
      return;
    }

    await archivePersistedWorkspaceRecord({
      workspaceId,
      workspaceRegistry,
      projectRegistry,
    });
  };
  const markWorkspaceArchivingExternal = (workspaceIds: Iterable<string>, archivingAt: string) => {
    const workspaceIdList = Array.from(workspaceIds);
    for (const session of wsServer?.listActiveSessions() ?? []) {
      session.markWorkspaceArchivingForExternalMutation(workspaceIdList, archivingAt);
    }
  };
  const clearWorkspaceArchivingExternal = (workspaceIds: Iterable<string>) => {
    const workspaceIdList = Array.from(workspaceIds);
    for (const session of wsServer?.listActiveSessions() ?? []) {
      session.clearWorkspaceArchivingForExternalMutation(workspaceIdList);
    }
  };
  const emitWorkspaceUpdatesExternal = async (workspaceIds: Iterable<string>) => {
    const workspaceIdList = Array.from(workspaceIds);
    await Promise.all(
      (wsServer?.listActiveSessions() ?? []).map((session) =>
        session.emitWorkspaceUpdatesForExternalWorkspaceIds(workspaceIdList),
      ),
    );
  };
  const emitExternalSessionMessage = (message: SessionOutboundMessage) => {
    wsServer?.broadcast(wrapSessionMessage(message));
  };

  setupAutoArchiveOnMerge({
    doyaHome,
    worktreesRoot: config.worktreesRoot,
    daemonConfigStore,
    workspaceGitService,
    github,
    agentManager,
    agentStorage,
    terminalManager,
    logger,
    archiveWorkspaceRecord: archiveWorkspaceRecordExternal,
    markWorkspaceArchiving: markWorkspaceArchivingExternal,
    clearWorkspaceArchiving: clearWorkspaceArchivingExternal,
    emitWorkspaceUpdatesForWorkspaceIds: emitWorkspaceUpdatesExternal,
  });

  const mcpEnabled = config.mcpEnabled ?? true;
  let agentMcpBaseUrl: string | null = null;
  if (mcpEnabled) {
    const agentMcpRoute = "/mcp/agents";
    const agentMcpTransports: AgentMcpTransportMap = new Map();

    const createAgentMcpTransport = async (params?: {
      callerAgentId?: string;
      voiceOnly?: boolean;
    }) => {
      const agentMcpServer = await createAgentMcpServer({
        agentManager,
        agentStorage,
        terminalManager,
        getDaemonTcpPort: () => (boundListenTarget?.type === "tcp" ? boundListenTarget.port : null),
        scheduleService,
        providerSnapshotManager,
        github,
        workspaceGitService,
        archiveWorkspaceRecord: archiveWorkspaceRecordExternal,
        emitWorkspaceUpdatesForWorkspaceIds: emitWorkspaceUpdatesExternal,
        markWorkspaceArchiving: markWorkspaceArchivingExternal,
        clearWorkspaceArchiving: clearWorkspaceArchivingExternal,
        createDoyaWorktree: async (input, serviceOptions) => {
          return createDoyaWorktreeWorkflow(
            {
              doyaHome,
              worktreesRoot: config.worktreesRoot,
              createDoyaWorktree: async (workflowInput, workflowOptions) => {
                return createRegisteredDoyaWorktree(workflowInput, {
                  github,
                  ...(workflowOptions?.resolveDefaultBranch
                    ? {
                        resolveDefaultBranch: workflowOptions.resolveDefaultBranch,
                      }
                    : {}),
                  projectRegistry,
                  workspaceRegistry,
                  workspaceGitService,
                });
              },
              warmWorkspaceGitData: async (workspace) => {
                await Promise.all(
                  wsServer
                    ?.listActiveSessions()
                    .map((session) => session.warmWorkspaceGitDataForWorkspace(workspace)) ?? [],
                );
              },
              emitWorkspaceUpdateForCwd: async (cwd, emitOptions) => {
                await Promise.all(
                  wsServer
                    ?.listActiveSessions()
                    .map((session) => session.emitWorkspaceUpdatesForExternalCwds([cwd])) ?? [],
                );
                void emitOptions;
              },
              cacheWorkspaceSetupSnapshot: () => {},
              emit: emitExternalSessionMessage,
              sessionLogger: logger,
              terminalManager,
              archiveWorkspaceRecord: archiveWorkspaceRecordExternal,
              scriptRouteStore,
              scriptRuntimeStore,
              getDaemonTcpPort: () =>
                boundListenTarget?.type === "tcp" ? boundListenTarget.port : null,
              getDaemonTcpHost: () =>
                boundListenTarget?.type === "tcp" ? boundListenTarget.host : null,
              onScriptsChanged: null,
            },
            input,
            serviceOptions,
          );
        },
        doyaHome,
        worktreesRoot: config.worktreesRoot,
        callerAgentId: params?.callerAgentId,
        enableVoiceTools: false,
        voiceOnly: params?.voiceOnly ?? false,
        resolveSpeakHandler: (agentId) => wsServer?.resolveVoiceSpeakHandler(agentId) ?? null,
        resolveCallerContext: (agentId) => wsServer?.resolveVoiceCallerContext(agentId) ?? null,
        logger,
      });

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          agentMcpTransports.set(sessionId, transport);
          logger.debug({ sessionId }, "Agent MCP session initialized");
        },
        onsessionclosed: (sessionId) => {
          agentMcpTransports.delete(sessionId);
          logger.debug({ sessionId }, "Agent MCP session closed");
        },
        // NOTE: We enforce a Vite-like host allowlist at the app/websocket layer.
        // StreamableHTTPServerTransport's built-in check requires exact Host header matches.
        enableDnsRebindingProtection: false,
      });

      Object.assign(transport, {
        onclose: () => {
          if (transport.sessionId) {
            agentMcpTransports.delete(transport.sessionId);
          }
        },
        onerror: (err: Error) => {
          logger.error({ err }, "Agent MCP transport error");
        },
      });

      await agentMcpServer.connect(transport);
      return transport;
    };

    const runAgentMcpRequest = async (
      req: express.Request,
      res: express.Response,
    ): Promise<void> => {
      if (config.mcpDebug) {
        logger.debug(
          {
            method: req.method,
            url: req.originalUrl,
            sessionId: req.header("mcp-session-id"),
            authorization: req.header("authorization") ? REDACTED_LOG_VALUE : undefined,
            body: summarizeAgentMcpDebugBody(req.body),
          },
          "Agent MCP request",
        );
      }
      try {
        const sessionId = req.header("mcp-session-id");
        let transport = sessionId ? agentMcpTransports.get(sessionId) : undefined;

        if (!transport) {
          if (req.method !== "POST") {
            res.status(400).json({
              jsonrpc: "2.0",
              error: {
                code: -32000,
                message: "Missing or invalid MCP session",
              },
              id: null,
            });
            return;
          }
          if (!isInitializeRequest(req.body)) {
            res.status(400).json({
              jsonrpc: "2.0",
              error: {
                code: -32000,
                message: "Initialization request expected",
              },
              id: null,
            });
            return;
          }
          const callerAgentIdRaw = req.query.callerAgentId;
          let callerAgentId: string | undefined;
          if (typeof callerAgentIdRaw === "string") {
            callerAgentId = callerAgentIdRaw;
          } else if (Array.isArray(callerAgentIdRaw) && typeof callerAgentIdRaw[0] === "string") {
            callerAgentId = callerAgentIdRaw[0];
          }
          const voiceOnlyRaw = req.query.voiceOnly;
          const voiceOnly =
            voiceOnlyRaw === "1" ||
            voiceOnlyRaw === "true" ||
            (Array.isArray(voiceOnlyRaw) &&
              (voiceOnlyRaw[0] === "1" || voiceOnlyRaw[0] === "true"));
          transport = await createAgentMcpTransport({ callerAgentId, voiceOnly });
        }

        await transport.handleRequest(
          req as unknown as IncomingMessage,
          res as unknown as ServerResponse,
          req.body,
        );
      } catch (err) {
        logger.error({ err }, "Failed to handle Agent MCP request");
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: "Internal MCP server error",
            },
            id: null,
          });
        }
      }
    };

    const handleAgentMcpRequest: express.RequestHandler = (req, res) => {
      void runAgentMcpRequest(req, res);
    };

    app.post(agentMcpRoute, handleAgentMcpRequest);
    app.get(agentMcpRoute, handleAgentMcpRequest);
    app.delete(agentMcpRoute, handleAgentMcpRequest);
    logger.info({ route: agentMcpRoute }, "Agent MCP server mounted on main app");
  } else {
    logger.info("Agent MCP HTTP endpoint disabled");
  }

  const speechService = createSpeechService({
    logger,
    openaiConfig: config.openai,
    speechConfig: config.speech,
  });
  logger.info({ elapsed: elapsed() }, "Speech service created");

  logger.info({ elapsed: elapsed() }, "Bootstrap complete, ready to start listening");

  const start = async () => {
    // Start main HTTP server
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        httpServer.off("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        httpServer.off("error", onError);
        const logAndResolve = async () => {
          boundListenTarget = resolveBoundListenTarget(listenTarget, httpServer);
          const mcpBaseUrl = mcpEnabled ? createAgentMcpBaseUrl(boundListenTarget) : null;
          agentMcpBaseUrl = config.mcpInjectIntoAgents === false ? null : mcpBaseUrl;
          agentManager.setMcpBaseUrl(agentMcpBaseUrl);
          daemonConfigStore.onFieldChange("mcp.injectIntoAgents", (value) => {
            agentManager.setMcpBaseUrl(value ? mcpBaseUrl : null);
          });
          daemonConfigStore.onFieldChange("appendSystemPrompt", (value) => {
            agentManager.setAppendSystemPrompt(typeof value === "string" ? value : "");
          });
          daemonConfigStore.onFieldChange("agents.lockedProviderModel", (value) => {
            agentManager.setLockedProviderModel(readLockedProviderModel(value));
          });
          const relayEnabled = config.relayEnabled ?? true;
          const relayEndpoint = config.relayEndpoint ?? "relay.doya.sh:443";
          const relayPublicEndpoint = config.relayPublicEndpoint ?? relayEndpoint;
          const relayUseTls = config.relayUseTls ?? relayEndpoint === "relay.doya.sh:443";
          const relayPublicUseTls = config.relayPublicUseTls ?? relayUseTls;
          const appBaseUrl = config.appBaseUrl ?? "https://app.doya.sh";

          if (boundListenTarget.type === "tcp") {
            logger.info(
              {
                host: boundListenTarget.host,
                port: boundListenTarget.port,
                authRequired: !!config.auth?.password,
                elapsed: elapsed(),
              },
              `Server listening on http://${boundListenTarget.host}:${boundListenTarget.port}`,
            );
          } else {
            logger.info(
              {
                path: boundListenTarget.path,
                authRequired: !!config.auth?.password,
                elapsed: elapsed(),
              },
              `Server listening on ${boundListenTarget.path}`,
            );
          }
          if (config.auth?.password) {
            logger.info("Daemon password authentication enabled");
          }

          wsServer = new VoiceAssistantWebSocketServer(
            httpServer,
            logger,
            serverId,
            agentManager,
            agentStorage,
            downloadTokenStore,
            doyaHome,
            daemonConfigStore,
            mcpBaseUrl,
            { allowedOrigins, hostnames: configuredHostnames },
            config.auth,
            speechService,
            terminalManager,
            {
              finalTimeoutMs: config.dictationFinalTimeoutMs,
            },
            daemonVersion,
            (intent) => {
              try {
                config.onLifecycleIntent?.(intent);
              } catch (error) {
                logger.error({ err: error, intent }, "Failed to handle daemon lifecycle intent");
              }
            },
            projectRegistry,
            workspaceRegistry,
            chatService,
            loopService,
            scheduleService,
            checkoutDiffManager,
            scriptRouteStore,
            scriptRuntimeStore,
            handleBranchChange,
            () => (boundListenTarget?.type === "tcp" ? boundListenTarget.port : null),
            () => (boundListenTarget?.type === "tcp" ? boundListenTarget.host : null),
            (hostname) => scriptHealthMonitor.getHealthForHostname(hostname),
            workspaceGitService,
            github,
            config.pushNotificationSender,
            providerSnapshotManager,
            conversationRecordingStore,
            {
              listen: formatListenTarget(boundListenTarget ?? listenTarget),
              worktreesRoot: config.worktreesRoot,
              relay: {
                enabled: relayEnabled,
                endpoint: relayEndpoint,
                publicEndpoint: relayPublicEndpoint,
                useTls: relayUseTls,
                publicUseTls: relayPublicUseTls,
              },
            },
          );

          if (relayEnabled) {
            const offer = await createConnectionOfferV2({
              serverId,
              daemonPublicKeyB64: daemonKeyPair.publicKeyB64,
              relay: {
                endpoint: relayPublicEndpoint,
                useTls: relayPublicUseTls,
              },
            });

            encodeOfferToFragmentUrl({ offer, appBaseUrl });

            relayTransport?.stop().catch(() => undefined);
            relayTransport = startRelayTransport({
              logger,
              attachSocket: (ws, metadata) => {
                if (!wsServer) {
                  throw new Error("WebSocket server not initialized");
                }
                return wsServer.attachExternalSocket(ws, metadata);
              },
              relayEndpoint,
              relayUseTls,
              serverId,
              daemonKeyPair: daemonKeyPair.keyPair,
            });
          }
        };

        logAndResolve().then(resolve, reject);
      };
      httpServer.once("error", onError);
      httpServer.once("listening", onListening);

      if (listenTarget.type === "tcp") {
        httpServer.listen(listenTarget.port, listenTarget.host);
      } else {
        if (listenTarget.type === "socket" && existsSync(listenTarget.path)) {
          unlinkSync(listenTarget.path);
        }
        httpServer.listen(listenTarget.path);
      }
    });

    // Start speech service after listening so synchronous Sherpa native
    // model loading doesn't block the server from accepting connections.
    speechService.start();
    scriptHealthMonitor.start();
  };

  const stop = async () => {
    scriptHealthMonitor.stop();
    await closeAllAgents(logger, agentManager);
    await agentManager.flush().catch(() => undefined);
    detachAgentStoragePersistence();
    await agentStorage.flush().catch(() => undefined);
    await providerSnapshotManager.shutdown();
    terminalManager.killAll();
    speechService.stop();
    await scheduleService.stop().catch(() => undefined);
    await relayTransport?.stop().catch(() => undefined);
    if (wsServer) {
      await wsServer.close();
    }
    // Force-drop remaining sockets so httpServer.close() resolves promptly.
    // We've already closed wsServer (which sent ws-layer close frames) and
    // stopped every other service, so anything still attached is a TCP
    // socket whose higher-level shutdown hasn't fully released it (e.g.
    // upgraded WS sockets in the closing handshake, or HTTP keep-alive
    // sockets in CLOSE_WAIT). closeIdleConnections() does not catch
    // upgraded sockets, so we use closeAllConnections() here.
    httpServer.closeAllConnections();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    // Clean up socket files
    if (listenTarget.type === "socket" && existsSync(listenTarget.path)) {
      unlinkSync(listenTarget.path);
    }
  };

  return {
    config,
    agentManager,
    agentStorage,
    terminalManager,
    scriptRouteStore,
    scriptRuntimeStore,
    start,
    stop,
    getListenTarget: () => boundListenTarget,
  };
}

async function closeAllAgents(logger: Logger, agentManager: AgentManager): Promise<void> {
  const agents = agentManager.listAgents();
  await Promise.all(
    agents.map(async (agent) => {
      try {
        await agentManager.closeAgent(agent.id);
      } catch (err) {
        logger.error({ err, agentId: agent.id }, "Failed to close agent");
      }
    }),
  );
}

function normalizeOnlyOfficeSelectionCapture(input: unknown): OnlyOfficeSelectionCapture | null {
  if (!isPlainRecord(input)) {
    return null;
  }
  const documentKey = toTrimmedString(input.documentKey);
  const address = toTrimmedString(input.address);
  if (!documentKey || !address) {
    return null;
  }
  return {
    kind: input.kind === "drawing" ? "drawing" : "range",
    documentKey,
    sheetName: toTrimmedString(input.sheetName) || "Sheet1",
    address,
    drawingIndex: toFiniteNumber(input.drawingIndex),
    drawingSelectionState: toTrimmedString(input.drawingSelectionState),
    drawingType: toTrimmedString(input.drawingType),
    text: toTrimmedString(input.text),
    value: toTrimmedString(input.value),
    formula: toTrimmedString(input.formula),
    updatedAt: Date.now(),
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toTrimmedString(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    const serialized = JSON.stringify(value);
    if (!serialized) {
      return undefined;
    }

    const trimmed = serialized.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildWorkspaceAttachmentFileName(fileName: string): string {
  const rawName = path.basename(fileName);
  const safeName = rawName
    .replace(/[<>:"/\\|?*]+/gu, "-")
    .replaceAll(/[\p{Cc}]/gu, "-")
    .replace(/^\.+/u, "")
    .replace(/^-+|-+$/gu, "");
  return `${randomUUID()}-${safeName || "attached-file"}`;
}

function normalizeWorkspaceRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}

async function parseMultipartFormData(req: express.Request): Promise<FormData> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") {
      headers.set(name, value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    }
  }
  const request = new Request("http://doya.local/workspace-attachment-upload", {
    method: "POST",
    headers,
    body: Readable.toWeb(req),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return await request.formData();
}

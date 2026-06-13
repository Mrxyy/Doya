import type {
  AgentSnapshotPayload,
  CreateAgentRequestMessage,
  FetchWorkspacesRequestMessage,
  FetchWorkspacesResponseMessage,
  GetProvidersSnapshotResponseMessage,
  ListAvailableProvidersResponse,
  ListProviderFeaturesRequestMessage,
  ListProviderFeaturesResponseMessage,
  ListProviderModelsResponseMessage,
  ListProviderModesResponseMessage,
  MutableDaemonConfig,
  MutableDaemonConfigPatch,
  ProviderDiagnosticResponseMessage,
  ProjectPlacementPayload,
  RefreshProvidersSnapshotResponseMessage,
  SendAgentMessageRequest,
  SessionOutboundMessage,
  WorkspaceDescriptorPayload,
} from "@getdoya/protocol/messages";
import { DaemonClient } from "./daemon-client.js";
import type {
  FetchAgentTimelineCursor,
  FetchAgentTimelineDirection,
  FetchAgentTimelinePayload,
  FetchAgentTimelineProjection,
} from "./daemon-client.js";

export { DaemonClient };
export type {
  DaemonClientConfig,
  DaemonEvent,
  FetchAgentTimelinePayload,
  WebSocketFactory,
  WebSocketLike,
} from "./daemon-client.js";

export type ConnectionState =
  | { status: "idle" }
  | { status: "connecting"; attempt: number }
  | { status: "connected" }
  | { status: "disconnected"; reason?: string }
  | { status: "disposed" };

export interface DoyaLogger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface DoyaClientConfig {
  url: string;
  clientId?: string;
  appVersion?: string;
  runtimeGeneration?: number | null;
  password?: string;
  authHeader?: string;
  suppressSendErrors?: boolean;
  logger?: DoyaLogger;
  connectTimeoutMs?: number;
  e2ee?: {
    enabled?: boolean;
    daemonPublicKeyB64?: string;
  };
  reconnect?: {
    enabled?: boolean;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };
  runtimeMetricsIntervalMs?: number;
  runtimeMetricsWindowMs?: number;
}

export type DoyaWorkspace = WorkspaceDescriptorPayload;
export type DoyaAgent = AgentSnapshotPayload;
export type DoyaWorkspaceListOptions = Omit<FetchWorkspacesRequestMessage, "type" | "requestId"> & {
  requestId?: string;
};

export interface DoyaWorkspaceListResult {
  requestId: string;
  subscriptionId?: string | null;
  entries: DoyaWorkspace[];
  pageInfo: FetchWorkspacesResponseMessage["payload"]["pageInfo"];
}

export interface DoyaWorkspaceOpenOptions {
  cwd: string;
  requestId?: string;
}

export interface DoyaWorkspaceOpenResult {
  requestId: string;
  workspace: DoyaWorkspaceHandle | null;
  error: string | null;
}

export interface DoyaWorkspaceArchiveResult {
  requestId: string;
  workspaceId: string;
  archivedAt: string | null;
  error: string | null;
}

export type DoyaWorkspaceUpdate = Extract<
  SessionOutboundMessage,
  { type: "workspace_update" }
>["payload"];

export type DoyaWorkspaceUpdateHandler = (update: DoyaWorkspaceUpdate) => void;

/**
 * A handle is a stable typed reference to a daemon resource. Its identity is the
 * daemon id, and `latest()` only returns the most recent snapshot this handle has
 * seen through construction, `refetch()`, or this handle's local subscription.
 */
export interface DoyaWorkspaceHandle {
  readonly id: string;
  latest(): DoyaWorkspace | null;
  /**
   * Fetches a fresh workspace snapshot through the existing workspace list RPC,
   * exact-matches this handle id from the result, and updates `latest()`.
   */
  refetch(options?: { requestId?: string }): Promise<DoyaWorkspace | null>;
  archive(requestId?: string): Promise<DoyaWorkspaceArchiveResult>;
  /**
   * Subscribes to already-emitted daemon workspace_update events for this id.
   * This returns a local unsubscribe function; it does not own app cache state or
   * send a daemon unsubscribe RPC. Call `workspaces.list({ subscribe: {} })` when
   * the daemon should start streaming workspace directory updates.
   */
  subscribe(handler: (update: DoyaWorkspaceUpdate) => void): () => void;
}

export interface DoyaWorkspaceActions {
  list(options?: DoyaWorkspaceListOptions): Promise<DoyaWorkspaceListResult>;
  ref(workspace: string | DoyaWorkspace): DoyaWorkspaceHandle;
  open(
    input: string | DoyaWorkspaceOpenOptions,
    requestId?: string,
  ): Promise<DoyaWorkspaceOpenResult>;
  create(
    input: string | DoyaWorkspaceOpenOptions,
    requestId?: string,
  ): Promise<DoyaWorkspaceOpenResult>;
  archive(
    workspace: string | DoyaWorkspaceHandle,
    requestId?: string,
  ): Promise<DoyaWorkspaceArchiveResult>;
  /**
   * Local event subscription over the low-level driver's workspace_update stream.
   * The returned function only removes this SDK listener.
   */
  subscribe(handler: DoyaWorkspaceUpdateHandler): () => void;
}

type DoyaAgentSessionConfig = CreateAgentRequestMessage["config"];
type DoyaAgentProvider = DoyaAgentSessionConfig["provider"];
type DoyaAgentConfigOverrides = Partial<Omit<DoyaAgentSessionConfig, "provider" | "cwd">>;

export interface DoyaAgentCreateOptions extends DoyaAgentConfigOverrides {
  config?: DoyaAgentSessionConfig;
  provider?: CreateAgentRequestMessage["config"]["provider"];
  cwd?: string;
  workspaceId?: string;
  initialPrompt?: string;
  clientMessageId?: string;
  outputSchema?: Record<string, unknown>;
  images?: CreateAgentRequestMessage["images"];
  attachments?: CreateAgentRequestMessage["attachments"];
  git?: CreateAgentRequestMessage["git"];
  worktreeName?: string;
  requestId?: string;
  labels?: Record<string, string>;
}

export interface DoyaAgentRefetchResult {
  agent: DoyaAgent;
  project: ProjectPlacementPayload | null;
}

export interface DoyaAgentTimelineRefetchOptions {
  direction?: FetchAgentTimelineDirection;
  cursor?: FetchAgentTimelineCursor;
  limit?: number;
  projection?: FetchAgentTimelineProjection;
  requestId?: string;
}

export interface DoyaAgentSendOptions {
  messageId?: string;
  images?: Array<{ data: string; mimeType: string; fileName?: string }>;
  attachments?: SendAgentMessageRequest["attachments"];
}

export type DoyaAgentUpdate = Extract<SessionOutboundMessage, { type: "agent_update" }>["payload"];

export type DoyaAgentStream = Extract<SessionOutboundMessage, { type: "agent_stream" }>["payload"];

export type DoyaAgentUpdateHandler = (update: DoyaAgentUpdate) => void;

export interface DoyaAgentTimelineHandle {
  /**
   * Fetches a fresh timeline page through the existing daemon RPC. If the daemon
   * includes an agent snapshot in the response, the parent handle's `latest()`
   * is updated to that snapshot.
   */
  refetch(options?: DoyaAgentTimelineRefetchOptions): Promise<FetchAgentTimelinePayload>;
  /**
   * Local listener for agent_stream events matching this handle id. It does not
   * retain timeline entries or own application cache state.
   */
  subscribe(handler: (event: DoyaAgentStream) => void): () => void;
}

/**
 * Agent handles follow the same identity/snapshot rule as workspace handles:
 * `id` is stable, while `latest()` is only the newest snapshot observed by this
 * handle through construction, `refetch()`, timeline refetch, archive, or local
 * agent_update subscription.
 */
export interface DoyaAgentHandle {
  readonly id: string;
  readonly timeline: DoyaAgentTimelineHandle;
  latest(): DoyaAgent | null;
  refetch(requestId?: string): Promise<DoyaAgentRefetchResult | null>;
  send(text: string, options?: DoyaAgentSendOptions): Promise<void>;
  archive(): Promise<{ archivedAt: string }>;
  subscribe(handler: (update: DoyaAgentUpdate) => void): () => void;
}

export interface DoyaAgentActions {
  ref(agent: string | DoyaAgent): DoyaAgentHandle;
  create(options: DoyaAgentCreateOptions): Promise<DoyaAgentHandle>;
  /**
   * Local event subscription over the low-level driver's agent_update stream.
   * The returned function only removes this SDK listener.
   */
  subscribe(handler: DoyaAgentUpdateHandler): () => void;
}

export interface DoyaProviderConfig extends DoyaProviderConfigInput {
  provider: DoyaAgentProvider;
}
export type DoyaProviderFeatureValues = Record<string, unknown>;

export interface DoyaProviderConfigInput {
  model?: string;
  modeId?: string;
  thinkingOptionId?: string;
  featureValues?: DoyaProviderFeatureValues;
}

export type DoyaProviderModelsResult = ListProviderModelsResponseMessage["payload"];
export type DoyaProviderModesResult = ListProviderModesResponseMessage["payload"];
export type DoyaProviderFeaturesInput = ListProviderFeaturesRequestMessage["draftConfig"];
export type DoyaProviderFeaturesResult = ListProviderFeaturesResponseMessage["payload"];
export type DoyaProviderAvailabilityResult = ListAvailableProvidersResponse["payload"];
export type DoyaProviderSnapshotResult = GetProvidersSnapshotResponseMessage["payload"];
export type DoyaProviderSnapshotUpdate = Extract<
  SessionOutboundMessage,
  { type: "providers_snapshot_update" }
>["payload"];
export type DoyaProviderRefreshResult = RefreshProvidersSnapshotResponseMessage["payload"];
export type DoyaProviderDiagnosticResult = ProviderDiagnosticResponseMessage["payload"];

export interface DoyaProviderListOptions {
  cwd?: string;
  requestId?: string;
}

export interface DoyaProviderRefreshOptions {
  cwd?: string;
  providers?: DoyaAgentProvider[];
  requestId?: string;
}

export interface DoyaProviderActions {
  codex(input?: DoyaProviderConfigInput): DoyaProviderConfig;
  claude(input?: DoyaProviderConfigInput): DoyaProviderConfig;
  opencode(input?: DoyaProviderConfigInput): DoyaProviderConfig;
  copilot(input?: DoyaProviderConfigInput): DoyaProviderConfig;
  config(provider: DoyaAgentProvider, input?: DoyaProviderConfigInput): DoyaProviderConfig;
  listModels(
    provider: DoyaAgentProvider,
    options?: DoyaProviderListOptions,
  ): Promise<DoyaProviderModelsResult>;
  listModes(
    provider: DoyaAgentProvider,
    options?: DoyaProviderListOptions,
  ): Promise<DoyaProviderModesResult>;
  listFeatures(
    draftConfig: DoyaProviderFeaturesInput,
    options?: { requestId?: string },
  ): Promise<DoyaProviderFeaturesResult>;
  listAvailable(options?: { requestId?: string }): Promise<DoyaProviderAvailabilityResult>;
  snapshot(options?: DoyaProviderListOptions): Promise<DoyaProviderSnapshotResult>;
  refresh(options?: DoyaProviderRefreshOptions): Promise<DoyaProviderRefreshResult>;
  diagnostic(
    provider: DoyaAgentProvider,
    options?: { requestId?: string },
  ): Promise<DoyaProviderDiagnosticResult>;
  subscribe(handler: (update: DoyaProviderSnapshotUpdate) => void): () => void;
}

export interface DoyaConfigActions {
  /**
   * Reads daemon config through the existing config RPC. Provider profiles,
   * custom provider entries, keys/env, custom binaries, and provider enablement
   * are currently config-file-shaped daemon state, so the SDK exposes this raw
   * typed surface instead of pretending there are higher-level provider-settings
   * RPCs.
   */
  get(requestId?: string): Promise<{ requestId: string; config: MutableDaemonConfig }>;
  /**
   * Patches daemon config through the existing config RPC. The daemon validates
   * and persists supported fields; unsupported provider/settings workflows remain
   * daemon gaps until first-class RPCs exist.
   */
  patch(
    config: MutableDaemonConfigPatch,
    requestId?: string,
  ): Promise<{ requestId: string; config: MutableDaemonConfig }>;
}

export interface DoyaClient {
  readonly workspaces: DoyaWorkspaceActions;
  readonly agents: DoyaAgentActions;
  readonly providers: DoyaProviderActions;
  readonly config: DoyaConfigActions;
  connect(): Promise<void>;
  close(): Promise<void>;
  ensureConnected(): void;
  getConnectionState(): ConnectionState;
}

export function createDoyaClient(config: DoyaClientConfig): DoyaClient {
  const daemonClient = new DaemonClient({
    ...config,
    clientId: config.clientId ?? createGeneratedClientId(),
    clientType: "cli",
  });
  const createWorkspaceHandle = createWorkspaceHandleFactory(daemonClient);
  const createAgentHandle = createAgentHandleFactory(daemonClient);

  return {
    workspaces: {
      list: (options) => daemonClient.fetchWorkspaces(options),
      ref: (workspace) => createWorkspaceHandle(workspace),
      open: (input, requestId) =>
        openWorkspace(daemonClient, createWorkspaceHandle, input, requestId),
      create: (input, requestId) =>
        openWorkspace(daemonClient, createWorkspaceHandle, input, requestId),
      archive: (workspace, requestId) =>
        daemonClient.archiveWorkspace(resolveWorkspaceId(workspace), requestId),
      subscribe: (handler) =>
        daemonClient.on("workspace_update", (message) => {
          handler(message.payload);
        }),
    },
    agents: {
      ref: (agent) => createAgentHandle(agent),
      create: async (options) => {
        const agent = await daemonClient.createAgent(options);
        return createAgentHandle(agent);
      },
      subscribe: (handler) =>
        daemonClient.on("agent_update", (message) => {
          handler(message.payload);
        }),
    },
    providers: {
      codex: (input) => providerConfig("codex", input),
      claude: (input) => providerConfig("claude", input),
      opencode: (input) => providerConfig("opencode", input),
      copilot: (input) => providerConfig("copilot", input),
      config: (provider, input) => providerConfig(provider, input),
      listModels: (provider, options) => daemonClient.listProviderModels(provider, options),
      listModes: (provider, options) => daemonClient.listProviderModes(provider, options),
      listFeatures: (draftConfig, options) =>
        daemonClient.listProviderFeatures(draftConfig, options),
      listAvailable: (options) => daemonClient.listAvailableProviders(options),
      snapshot: (options) => daemonClient.getProvidersSnapshot(options),
      refresh: (options) => daemonClient.refreshProvidersSnapshot(options),
      diagnostic: (provider, options) => daemonClient.getProviderDiagnostic(provider, options),
      subscribe: (handler) =>
        daemonClient.on("providers_snapshot_update", (message) => {
          handler(message.payload);
        }),
    },
    config: {
      get: (requestId) => daemonClient.getDaemonConfig(requestId),
      patch: (patch, requestId) => daemonClient.patchDaemonConfig(patch, requestId),
    },
    connect: () => daemonClient.connect(),
    close: () => daemonClient.close(),
    ensureConnected: () => daemonClient.ensureConnected(),
    getConnectionState: () => daemonClient.getConnectionState(),
  };
}

type WorkspaceHandleFactory = (workspace: string | DoyaWorkspace) => DoyaWorkspaceHandle;
type AgentHandleFactory = (agent: string | DoyaAgent) => DoyaAgentHandle;

function createWorkspaceHandleFactory(daemonClient: DaemonClient): WorkspaceHandleFactory {
  return (workspace) => {
    const id = typeof workspace === "string" ? workspace : workspace.id;
    let latest = typeof workspace === "string" ? null : workspace;

    return {
      id,
      latest: () => latest,
      refetch: async (options) => {
        const result = await daemonClient.fetchWorkspaces({
          requestId: options?.requestId,
          filter: { idPrefix: id },
          page: { limit: 25 },
        });
        latest = result.entries.find((entry) => entry.id === id) ?? null;
        return latest;
      },
      archive: async (requestId) => {
        const result = await daemonClient.archiveWorkspace(id, requestId);
        if (latest) {
          latest = { ...latest, archivingAt: result.archivedAt };
        }
        return result;
      },
      subscribe: (handler) =>
        daemonClient.on("workspace_update", (message) => {
          const update = message.payload;
          if (update.kind === "upsert" && update.workspace.id === id) {
            latest = update.workspace;
            handler(update);
          }
          if (update.kind === "remove" && update.id === id) {
            latest = null;
            handler(update);
          }
        }),
    };
  };
}

function createAgentHandleFactory(daemonClient: DaemonClient): AgentHandleFactory {
  return (agent) => {
    const id = typeof agent === "string" ? agent : agent.id;
    let latest = typeof agent === "string" ? null : agent;

    const handle: DoyaAgentHandle = {
      id,
      timeline: {
        refetch: async (options) => {
          const result = await daemonClient.fetchAgentTimeline(id, options);
          if (result.agent) {
            latest = result.agent;
          }
          return result;
        },
        subscribe: (handler) =>
          daemonClient.on("agent_stream", (message) => {
            if (message.payload.agentId === id) {
              handler(message.payload);
            }
          }),
      },
      latest: () => latest,
      refetch: async (requestId) => {
        const result = await daemonClient.fetchAgent(id, requestId);
        latest = result?.agent ?? null;
        return result;
      },
      send: (text, options) => daemonClient.sendAgentMessage(id, text, options),
      archive: async () => {
        const result = await daemonClient.archiveAgent(id);
        if (latest) {
          latest = { ...latest, archivedAt: result.archivedAt };
        }
        return result;
      },
      subscribe: (handler) =>
        daemonClient.on("agent_update", (message) => {
          const update = message.payload;
          if (update.kind === "upsert" && update.agent.id === id) {
            latest = update.agent;
            handler(update);
          }
          if (update.kind === "remove" && update.agentId === id) {
            latest = null;
            handler(update);
          }
        }),
    };

    return handle;
  };
}

async function openWorkspace(
  daemonClient: DaemonClient,
  createWorkspaceHandle: WorkspaceHandleFactory,
  input: string | DoyaWorkspaceOpenOptions,
  requestId?: string,
): Promise<DoyaWorkspaceOpenResult> {
  const options = typeof input === "string" ? { cwd: input, requestId } : input;
  const result = await daemonClient.openProject(options.cwd, options.requestId);
  return {
    ...result,
    workspace: result.workspace ? createWorkspaceHandle(result.workspace) : null,
  };
}

function resolveWorkspaceId(workspace: string | DoyaWorkspaceHandle): string {
  return typeof workspace === "string" ? workspace : workspace.id;
}

function providerConfig(
  provider: DoyaAgentProvider,
  input: DoyaProviderConfigInput = {},
): DoyaProviderConfig {
  return {
    provider,
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.modeId !== undefined ? { modeId: input.modeId } : {}),
    ...(input.thinkingOptionId !== undefined ? { thinkingOptionId: input.thinkingOptionId } : {}),
    ...(input.featureValues !== undefined ? { featureValues: input.featureValues } : {}),
  };
}

function createGeneratedClientId(): string {
  const randomId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `doya-sdk-${randomId}`;
}

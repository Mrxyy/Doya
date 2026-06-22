import type { DaemonClient } from "@getdoya/client/internal/daemon-client";
import type { AccountBootstrapSession } from "@/account/account-api";
import {
  allocateControlSessionWorkDir,
  appendControlSessionMessage,
  ensureControlUserDaemonWorkspace,
  getControlAgentBinding,
  getControlSession,
  listControlSessionMessages,
  registerControlNode,
  upsertControlAgentBinding,
  type ControlSessionMessageRecord,
  type ControlSessionRecord,
} from "@/control/control-api";
import { buildControlAgentLabels } from "@/control/control-agent-labels";
import { resolveControlRuntimeDirectEndpoint } from "@/control/control-runtime-endpoint";
import { getHostRuntimeStore, type HostMutations } from "@/runtime/host-runtime";
import { buildWorkspaceDraftAgentConfig } from "@/screens/workspace/workspace-draft-agent-config";
import { normalizeWorkspaceDescriptor } from "@/stores/session-store";
import type { HostProfile } from "@/types/host-connection";
import { normalizeHostPort } from "@/utils/daemon-endpoints";

const CONTROL_AGENT_BINDING_KIND = "control_agent_binding";
const NODE_REGISTER_CACHE_TTL_MS = 30_000;

const nodeRegisterCache = new Map<string, number>();
const nodeRegisterInflight = new Map<string, Promise<{ id: string; endpoint: string } | null>>();

interface RepairAgentConfig {
  provider: string;
  modeId?: string;
  model?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
}

interface RepairBootstrapMessage {
  prompt: string;
  agentConfig: RepairAgentConfig;
}

interface AgentBindingRef {
  nodeId: string;
  agentId: string;
}

export interface RestoreControlSessionToAgentInput {
  accountSession: AccountBootstrapSession;
  sessionId: string;
  hosts: HostProfile[];
  upsertDirectConnection: HostMutations["upsertDirectConnection"];
}

export interface RestoredControlSessionAgent {
  nodeId: string;
  agentId: string;
}

export async function restoreControlSessionToAgent(
  input: RestoreControlSessionToAgentInput,
): Promise<RestoredControlSessionAgent> {
  const [session, activeBinding] = await Promise.all([
    getControlSession({
      accountSession: input.accountSession,
      sessionId: input.sessionId,
    }),
    getControlAgentBinding({
      accountSession: input.accountSession,
      sessionId: input.sessionId,
    }),
  ]);
  let binding: AgentBindingRef | null = activeBinding.binding ?? null;
  let messages: ControlSessionMessageRecord[] | null = null;
  if (!binding) {
    messages = await listControlSessionMessages({
      accountSession: input.accountSession,
      sessionId: input.sessionId,
    });
    binding = findLegacyControlAgentBinding({
      messages,
    });
  }
  const node =
    activeBinding.node ?? (binding ? await findRegisteredNode(input, binding.nodeId) : null);
  if (!binding || !node) {
    return await repairMissingControlAgentBinding({
      ...input,
      session,
      messages:
        messages ??
        (await listControlSessionMessages({
          accountSession: input.accountSession,
          sessionId: input.sessionId,
        })),
    });
  }
  const client = await ensureRuntimeClient({
    nodeId: node.id,
    endpoint: node.endpoint,
    upsertDirectConnection: input.upsertDirectConnection,
  });
  if (!(await hasDaemonAgent({ client, agentId: binding.agentId }))) {
    return await repairMissingControlAgentBinding({
      ...input,
      session,
      messages:
        messages ??
        (await listControlSessionMessages({
          accountSession: input.accountSession,
          sessionId: input.sessionId,
        })),
    });
  }
  return { nodeId: node.id, agentId: binding.agentId };
}

async function repairMissingControlAgentBinding(
  input: RestoreControlSessionToAgentInput & {
    session: ControlSessionRecord;
    messages: ControlSessionMessageRecord[];
  },
): Promise<RestoredControlSessionAgent> {
  const bootstrap = findRepairBootstrapMessage(input.messages);
  if (!bootstrap) {
    throw new Error("No daemon agent is bound to this session");
  }
  const node = await findRepairNode(input);
  if (!node) {
    throw new Error("Runtime daemon is not connected");
  }
  await ensureControlUserDaemonWorkspace({
    accountSession: input.accountSession,
    nodeId: node.id,
  });
  const client = await ensureRuntimeClient({
    nodeId: node.id,
    endpoint: node.endpoint,
    upsertDirectConnection: input.upsertDirectConnection,
  });
  const sessionWorkDir = await allocateControlSessionWorkDir({
    accountSession: input.accountSession,
    sessionId: input.sessionId,
    nodeId: node.id,
    runtimeId: `rt_${input.sessionId}`,
    providerId: bootstrap.agentConfig.provider,
    modelId: bootstrap.agentConfig.model ?? null,
    selectionReason: "repair_missing_agent_binding",
  });
  const openPayload = await client.openProject(sessionWorkDir.runtime.workspaceDir);
  if (openPayload.error || !openPayload.workspace) {
    throw new Error(openPayload.error ?? "Unable to create runtime workspace");
  }
  const workspace = normalizeWorkspaceDescriptor(openPayload.workspace);
  const agent = await client.createAgent({
    config: buildWorkspaceDraftAgentConfig({
      provider: bootstrap.agentConfig.provider,
      cwd: workspace.workspaceDirectory,
      title: input.session.title,
      modeId: bootstrap.agentConfig.modeId,
      model: bootstrap.agentConfig.model,
      thinkingOptionId: bootstrap.agentConfig.thinkingOptionId,
      featureValues: bootstrap.agentConfig.featureValues,
    }),
    workspaceId: workspace.id,
    ...(bootstrap.prompt ? { initialPrompt: bootstrap.prompt } : {}),
    labels: buildControlAgentLabels({
      sessionId: input.sessionId,
      nodeId: node.id,
      runtimeId: sessionWorkDir.runtime.runtimeId,
    }),
  });
  await upsertControlAgentBinding({
    accountSession: input.accountSession,
    sessionId: input.sessionId,
    nodeId: node.id,
    agentId: agent.id,
    userWorkspaceId: sessionWorkDir.userWorkspace.id,
    workspaceId: workspace.id,
    cwd: workspace.workspaceDirectory,
  });
  await appendControlSessionMessage({
    accountSession: input.accountSession,
    sessionId: input.sessionId,
    role: "system",
    externalId: `agent:${agent.id}:binding`,
    content: {
      kind: CONTROL_AGENT_BINDING_KIND,
      nodeId: node.id,
      agentId: agent.id,
      workspaceId: workspace.id,
      workspaceDir: workspace.workspaceDirectory,
    },
  });
  return { nodeId: node.id, agentId: agent.id };
}

function findRepairBootstrapMessage(
  messages: ControlSessionMessageRecord[],
): RepairBootstrapMessage | null {
  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }
    const content = message.content;
    if (!content || typeof content !== "object" || Array.isArray(content)) {
      continue;
    }
    const record = content as Record<string, unknown>;
    const agentConfig = parseRepairAgentConfig(record.agentConfig);
    const text = typeof record.text === "string" ? record.text : "";
    if (agentConfig) {
      return { prompt: text, agentConfig };
    }
  }
  return null;
}

function parseRepairAgentConfig(value: unknown): RepairAgentConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const provider = typeof record.provider === "string" ? record.provider.trim() : "";
  if (!provider) {
    return null;
  }
  const featureValues =
    record.featureValues &&
    typeof record.featureValues === "object" &&
    !Array.isArray(record.featureValues)
      ? (record.featureValues as Record<string, unknown>)
      : undefined;
  return {
    provider,
    modeId: normalizeOptionalString(record.modeId),
    model: normalizeOptionalString(record.model),
    thinkingOptionId: normalizeOptionalString(record.thinkingOptionId),
    featureValues,
  };
}

async function findRepairNode(
  input: RestoreControlSessionToAgentInput,
): Promise<{ id: string; endpoint: string } | null> {
  const store = getHostRuntimeStore();
  for (const host of input.hosts) {
    const snapshot = store.getSnapshot(host.serverId);
    const endpoint = resolveHostEndpoint({ host, snapshotEndpoint: snapshotEndpoint(snapshot) });
    if (!endpoint) {
      continue;
    }
    const node = await registerBoundDirectNode({
      accountSession: input.accountSession,
      host,
      nodeId: host.serverId,
      endpoint,
      status: snapshot?.connectionStatus === "online" ? "online" : "offline",
    });
    if (node) {
      return node;
    }
  }
  return null;
}

function snapshotEndpoint(
  snapshot: {
    activeConnection?: { type: string; endpoint?: string } | null;
  } | null,
): string | null {
  return snapshot?.activeConnection?.type === "directTcp" &&
    typeof snapshot.activeConnection.endpoint === "string"
    ? normalizeHostPort(snapshot.activeConnection.endpoint)
    : null;
}

function resolveHostEndpoint(input: {
  host: HostProfile;
  snapshotEndpoint: string | null;
}): string | null {
  if (input.snapshotEndpoint) {
    return input.snapshotEndpoint;
  }
  const connection = input.host.connections.find((entry) => entry.type === "directTcp");
  return connection?.type === "directTcp" ? normalizeHostPort(connection.endpoint) : null;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function findDirectHostRuntimeAuthToken(input: {
  host: HostProfile;
  endpoint: string;
}): string | null {
  const normalizedEndpoint = normalizeHostPort(input.endpoint);
  const connection = input.host.connections.find(
    (entry) =>
      entry.type === "directTcp" && normalizeHostPort(entry.endpoint) === normalizedEndpoint,
  );
  return connection?.type === "directTcp" ? (connection.password ?? null) : null;
}

async function findRegisteredNode(
  input: RestoreControlSessionToAgentInput,
  nodeId: string,
): Promise<{ id: string; endpoint: string } | null> {
  const store = getHostRuntimeStore();
  const host = input.hosts.find((entry) => entry.serverId === nodeId);
  const snapshot = store.getSnapshot(nodeId);
  const endpoint =
    snapshot?.activeConnection?.type === "directTcp"
      ? normalizeHostPort(snapshot.activeConnection.endpoint)
      : null;
  if (!host || !endpoint) {
    return null;
  }
  const cacheKey = `${input.accountSession.apiBaseUrl}:${input.accountSession.user.userId}:${nodeId}:${endpoint}`;
  const cachedUntil = nodeRegisterCache.get(cacheKey) ?? 0;
  if (cachedUntil > Date.now()) {
    return { id: nodeId, endpoint };
  }
  const inflight = nodeRegisterInflight.get(cacheKey);
  if (inflight) {
    return await inflight;
  }
  const request = registerBoundDirectNode({
    accountSession: input.accountSession,
    host,
    nodeId,
    endpoint,
    status: snapshot?.connectionStatus === "online" ? "online" : "offline",
  }).finally(() => {
    nodeRegisterInflight.delete(cacheKey);
  });
  nodeRegisterInflight.set(cacheKey, request);
  return await request;
}

async function registerBoundDirectNode(input: {
  accountSession: AccountBootstrapSession;
  host: HostProfile;
  nodeId: string;
  endpoint: string;
  status: "online" | "offline";
}): Promise<{ id: string; endpoint: string } | null> {
  const node = await registerControlNode({
    accountSession: input.accountSession,
    nodeId: input.nodeId,
    endpoint: input.endpoint,
    runtimeAuthToken: findDirectHostRuntimeAuthToken({
      host: input.host,
      endpoint: input.endpoint,
    }),
    status: input.status,
  });
  nodeRegisterCache.set(
    `${input.accountSession.apiBaseUrl}:${input.accountSession.user.userId}:${input.nodeId}:${input.endpoint}`,
    Date.now() + NODE_REGISTER_CACHE_TTL_MS,
  );
  return { id: node.id, endpoint: node.endpoint };
}

async function ensureRuntimeClient(input: {
  nodeId: string;
  endpoint: string;
  upsertDirectConnection: HostMutations["upsertDirectConnection"];
}): Promise<DaemonClient> {
  const store = getHostRuntimeStore();
  const existing = store.getSnapshot(input.nodeId);
  if (existing?.connectionStatus === "online" && existing.client) {
    return existing.client;
  }
  const directEndpoint = resolveControlRuntimeDirectEndpoint(input.endpoint);
  await input.upsertDirectConnection({
    serverId: input.nodeId,
    endpoint: directEndpoint.endpoint,
    useTls: directEndpoint.useTls,
    label: input.nodeId,
  });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const snapshot = store.getSnapshot(input.nodeId);
    if (snapshot?.connectionStatus === "online" && snapshot.client) {
      return snapshot.client;
    }
    await delay(150);
  }
  throw new Error("Runtime daemon is not connected");
}

function findLegacyControlAgentBinding(input: {
  messages: ControlSessionMessageRecord[];
}): { nodeId: string; agentId: string } | null {
  for (const message of input.messages) {
    const content = message.content;
    if (!content || typeof content !== "object") {
      continue;
    }
    const record = content as {
      kind?: unknown;
      runtimeId?: unknown;
      nodeId?: unknown;
      agentId?: unknown;
    };
    if (
      record.kind === CONTROL_AGENT_BINDING_KIND &&
      typeof record.nodeId === "string" &&
      typeof record.agentId === "string"
    ) {
      return { nodeId: record.nodeId, agentId: record.agentId };
    }
  }
  return null;
}

async function hasDaemonAgent(input: { client: DaemonClient; agentId: string }): Promise<boolean> {
  try {
    return Boolean(await input.client.fetchAgent(input.agentId));
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

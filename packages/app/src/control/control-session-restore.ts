import type { DaemonClient } from "@getdoya/client/internal/daemon-client";
import type { AccountBootstrapSession } from "@/account/account-api";
import {
  getControlAgentBinding,
  getControlSession,
  listControlSessionMessages,
  registerControlNode,
  type ControlSessionMessageRecord,
} from "@/control/control-api";
import { getHostRuntimeStore, type HostMutations } from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";
import { normalizeHostPort } from "@/utils/daemon-endpoints";

const CONTROL_AGENT_BINDING_KIND = "control_agent_binding";
const NODE_REGISTER_CACHE_TTL_MS = 30_000;

const nodeRegisterCache = new Map<string, number>();
const nodeRegisterInflight = new Map<string, Promise<{ id: string; endpoint: string } | null>>();

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
  const [, activeBinding] = await Promise.all([
    getControlSession({
      accountSession: input.accountSession,
      sessionId: input.sessionId,
    }),
    getControlAgentBinding({
      accountSession: input.accountSession,
      sessionId: input.sessionId,
    }),
  ]);
  let binding = activeBinding.binding ?? null;
  if (!binding) {
    const messages = await listControlSessionMessages({
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
    throw new Error("No daemon agent is bound to this session");
  }
  const client = await ensureRuntimeClient({
    nodeId: node.id,
    endpoint: node.endpoint,
    upsertDirectConnection: input.upsertDirectConnection,
  });
  if (!(await hasDaemonAgent({ client, agentId: binding.agentId }))) {
    throw new Error("Bound daemon agent was not found");
  }
  return { nodeId: node.id, agentId: binding.agentId };
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
  await input.upsertDirectConnection({
    serverId: input.nodeId,
    endpoint: endpointToHostPort(input.endpoint),
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

function endpointToHostPort(endpoint: string): string {
  try {
    const parsed = new URL(endpoint.includes("://") ? endpoint : `http://${endpoint}`);
    return normalizeHostPort(parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname);
  } catch {
    return normalizeHostPort(endpoint);
  }
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

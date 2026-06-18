import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AccountSession,
  ArtifactRecord,
  ControlSettingsRecord,
  DaemonNodeRecord,
  FileSnapshotFileRecord,
  FileSnapshotRecord,
  MessageRole,
  NodeStatus,
  RuntimeAllocationRecord,
  RuntimeStatus,
  SessionAgentBindingRecord,
  SessionAgentBindingStatus,
  SessionMessageRecord,
  SessionRecord,
  SessionStatus,
  UserDaemonWorkspaceRecord,
  UserRecord,
  WorkingContext,
} from "./domain.js";
import { createAccessToken, createId } from "./shared/ids.js";
import { type Clock, systemClock } from "./shared/time.js";

interface StoredUserRecord extends UserRecord {
  accessToken: string;
}

interface ControlSnapshot {
  settings: ControlSettingsRecord;
  users: StoredUserRecord[];
  sessions: SessionRecord[];
  sessionMessages: SessionMessageRecord[];
  artifacts: ArtifactRecord[];
  fileSnapshots: FileSnapshotRecord[];
  daemonNodes: DaemonNodeRecord[];
  userDaemonWorkspaces: UserDaemonWorkspaceRecord[];
  runtimeAllocations: RuntimeAllocationRecord[];
  agentBindings: SessionAgentBindingRecord[];
}

const EMPTY_SNAPSHOT: ControlSnapshot = {
  settings: { defaultDaemonNodeId: null },
  users: [],
  sessions: [],
  sessionMessages: [],
  artifacts: [],
  fileSnapshots: [],
  daemonNodes: [],
  userDaemonWorkspaces: [],
  runtimeAllocations: [],
  agentBindings: [],
};

export class NotFoundError extends Error {}

export interface AdminDaemonNodeSummary {
  node: Omit<DaemonNodeRecord, "runtimeAuthToken">;
  isDefault: boolean;
  userWorkspaceCount: number;
  runtimeCounts: Record<RuntimeStatus, number>;
  activeSessionCount: number;
  agentBindingCounts: Record<SessionAgentBindingStatus, number>;
  userWorkspaces: AdminUserDaemonWorkspaceSummary[];
}

export interface AdminControlOverview {
  settings: ControlSettingsRecord;
  daemonNodes: AdminDaemonNodeSummary[];
  totals: {
    daemonCount: number;
    userWorkspaceCount: number;
    runtimeCounts: Record<RuntimeStatus, number>;
    activeSessionCount: number;
    agentBindingCounts: Record<SessionAgentBindingStatus, number>;
  };
}

export interface AdminUserDaemonWorkspaceSummary {
  workspace: UserDaemonWorkspaceRecord;
  user: UserRecord | null;
  sessions: AdminSessionSummary[];
}

export interface AdminSessionSummary {
  session: SessionRecord;
  runtimeAllocations: RuntimeAllocationRecord[];
  agentBindings: SessionAgentBindingRecord[];
}

export interface AdminSessionCleanupTarget {
  session: SessionRecord;
  user: UserRecord | null;
  runtimeAllocations: RuntimeAllocationRecord[];
  agentBindings: SessionAgentBindingRecord[];
}

export interface AdminSessionCleanupResult {
  deletedSessionCount: number;
  stoppedRuntimeCount: number;
  archivedBindingCount: number;
}

export class ControlStore {
  private loaded = false;
  private snapshot: ControlSnapshot = { ...EMPTY_SNAPSHOT };
  private persistQueue: Promise<void> = Promise.resolve();
  private readonly filePath: string;
  private readonly now: Clock;

  constructor(input: { filePath: string; now?: Clock }) {
    this.filePath = input.filePath;
    this.now = input.now ?? systemClock;
  }

  async registerOrLogin(input: { email: string; phone?: string | null }): Promise<AccountSession> {
    await this.load();
    const email = normalizeEmail(input.email);
    if (!email) {
      throw new Error("Email is required");
    }
    const existing = this.snapshot.users.find(
      (user) => user.email === email && user.disabledAt === null,
    );
    if (existing) {
      return this.rotateAccessToken(existing);
    }
    const user: StoredUserRecord = {
      id: createId("usr"),
      email,
      phone: input.phone ?? null,
      accessToken: createAccessToken(),
      createdAt: this.timestamp(),
      disabledAt: null,
    };
    this.snapshot.users = [...this.snapshot.users, user];
    await this.enqueuePersist();
    return { user: stripUserToken(user), accessToken: user.accessToken };
  }

  async login(input: { email: string }): Promise<AccountSession> {
    await this.load();
    const email = normalizeEmail(input.email);
    const user = this.snapshot.users.find(
      (entry) => entry.email === email && entry.disabledAt === null,
    );
    if (!user) {
      throw new NotFoundError("User not found");
    }
    return this.rotateAccessToken(user);
  }

  async getUserByToken(input: { userId: string; accessToken: string }): Promise<UserRecord> {
    return stripUserToken(await this.requireUser(input));
  }

  async listSessions(input: { userId: string; limit?: number }): Promise<SessionRecord[]> {
    await this.load();
    const sessions = this.snapshot.sessions
      .filter((session) => session.userId === input.userId && session.deletedAt === null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return typeof input.limit === "number" ? sessions.slice(0, input.limit) : sessions;
  }

  async createSession(input: {
    userId: string;
    title: string;
    workingContext: WorkingContext;
    status?: SessionStatus;
  }): Promise<SessionRecord> {
    await this.load();
    this.requireExistingUser(input.userId);
    const timestamp = this.timestamp();
    const session: SessionRecord = {
      id: createId("ses"),
      userId: input.userId,
      title: input.title.trim() || "New session",
      status: input.status ?? "idle",
      workingContext: input.workingContext,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
      workDirDeletedAt: null,
    };
    this.snapshot.sessions = [...this.snapshot.sessions, session];
    await this.enqueuePersist();
    return session;
  }

  async getSession(input: { sessionId: string; userId?: string }): Promise<SessionRecord> {
    await this.load();
    const session = this.snapshot.sessions.find(
      (entry) =>
        entry.id === input.sessionId &&
        entry.deletedAt === null &&
        (!input.userId || entry.userId === input.userId),
    );
    if (!session) {
      throw new NotFoundError("Session not found");
    }
    return session;
  }

  async updateSession(input: {
    sessionId: string;
    userId: string;
    title?: string;
    status?: SessionStatus;
  }): Promise<SessionRecord> {
    const session = await this.getSession({ sessionId: input.sessionId, userId: input.userId });
    const nextSession: SessionRecord = {
      ...session,
      title: input.title?.trim() || session.title,
      status: input.status ?? session.status,
      updatedAt: this.timestamp(),
    };
    this.snapshot.sessions = upsertById(this.snapshot.sessions, nextSession, (entry) => entry.id);
    await this.enqueuePersist();
    return nextSession;
  }

  async deleteSession(input: { sessionId: string; userId: string }): Promise<void> {
    const session = await this.getSession(input);
    this.snapshot.sessions = upsertById(
      this.snapshot.sessions,
      { ...session, deletedAt: this.timestamp(), updatedAt: this.timestamp() },
      (entry) => entry.id,
    );
    await this.enqueuePersist();
  }

  async listMessages(input: {
    sessionId: string;
    userId: string;
  }): Promise<SessionMessageRecord[]> {
    await this.getSession({ sessionId: input.sessionId, userId: input.userId });
    return this.snapshot.sessionMessages
      .filter((message) => message.sessionId === input.sessionId)
      .sort((left, right) => left.sequence - right.sequence);
  }

  async appendMessage(input: {
    sessionId: string;
    userId: string;
    role: MessageRole;
    externalId?: string | null;
    content: unknown;
  }): Promise<SessionMessageRecord> {
    await this.getSession({ sessionId: input.sessionId, userId: input.userId });
    const existing = input.externalId
      ? this.snapshot.sessionMessages.find(
          (message) =>
            message.sessionId === input.sessionId && message.externalId === input.externalId,
        )
      : null;
    if (existing) {
      const nextMessage = { ...existing, content: input.content };
      this.snapshot.sessionMessages = upsertById(
        this.snapshot.sessionMessages,
        nextMessage,
        (entry) => entry.id,
      );
      await this.enqueuePersist();
      return nextMessage;
    }
    const message: SessionMessageRecord = {
      id: createId("msg"),
      sessionId: input.sessionId,
      role: input.role,
      externalId: input.externalId ?? null,
      content: input.content,
      sequence: this.nextMessageSequence(input.sessionId),
      createdAt: this.timestamp(),
    };
    this.snapshot.sessionMessages = [...this.snapshot.sessionMessages, message];
    await this.touchSession(input.sessionId);
    await this.enqueuePersist();
    return message;
  }

  async listArtifacts(input: { sessionId: string; userId: string }): Promise<ArtifactRecord[]> {
    await this.getSession({ sessionId: input.sessionId, userId: input.userId });
    return this.snapshot.artifacts
      .filter((artifact) => artifact.sessionId === input.sessionId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async createArtifact(input: {
    sessionId: string;
    userId: string;
    type: string;
    name: string;
    uri: string;
    externalId?: string | null;
    metadata?: unknown;
  }): Promise<ArtifactRecord> {
    await this.getSession({ sessionId: input.sessionId, userId: input.userId });
    const existing = input.externalId
      ? this.snapshot.artifacts.find(
          (artifact) =>
            artifact.sessionId === input.sessionId && artifact.externalId === input.externalId,
        )
      : null;
    if (existing) {
      const nextArtifact = {
        ...existing,
        type: input.type,
        name: input.name,
        uri: input.uri,
        metadata: input.metadata ?? null,
      };
      this.snapshot.artifacts = upsertById(
        this.snapshot.artifacts,
        nextArtifact,
        (entry) => entry.id,
      );
      await this.touchSession(input.sessionId);
      await this.enqueuePersist();
      return nextArtifact;
    }
    const artifact: ArtifactRecord = {
      id: createId("art"),
      sessionId: input.sessionId,
      type: input.type,
      name: input.name,
      uri: input.uri,
      externalId: input.externalId ?? null,
      metadata: input.metadata ?? null,
      createdAt: this.timestamp(),
    };
    this.snapshot.artifacts = [...this.snapshot.artifacts, artifact];
    await this.touchSession(input.sessionId);
    await this.enqueuePersist();
    return artifact;
  }

  async createFileSnapshot(input: {
    userId: string;
    files: FileSnapshotFileRecord[];
  }): Promise<FileSnapshotRecord> {
    await this.load();
    this.requireExistingUser(input.userId);
    if (input.files.length === 0) {
      throw new Error("At least one file is required");
    }
    const snapshot: FileSnapshotRecord = {
      id: createId("snap"),
      userId: input.userId,
      files: input.files.map((file) => ({
        path: file.path,
        contentBase64: file.contentBase64,
        mode: file.mode ?? null,
      })),
      createdAt: this.timestamp(),
    };
    this.snapshot.fileSnapshots = [...this.snapshot.fileSnapshots, snapshot];
    await this.enqueuePersist();
    return snapshot;
  }

  async getFileSnapshot(input: {
    snapshotId: string;
    userId: string;
  }): Promise<FileSnapshotRecord> {
    await this.load();
    const snapshot = this.snapshot.fileSnapshots.find(
      (entry) => entry.id === input.snapshotId && entry.userId === input.userId,
    );
    if (!snapshot) {
      throw new NotFoundError("File snapshot not found");
    }
    return snapshot;
  }

  async registerNode(input: {
    nodeId?: string;
    endpoint: string;
    doyaHome?: string | null;
    capabilities?: unknown;
    status?: NodeStatus;
    runtimeAuthToken?: string | null;
  }): Promise<DaemonNodeRecord> {
    await this.load();
    const nodeId = input.nodeId?.trim();
    const runtimeAuthToken = input.runtimeAuthToken?.trim() || null;
    const existing = this.snapshot.daemonNodes.find(
      (node) => (nodeId && node.id === nodeId) || node.endpoint === input.endpoint,
    );
    const timestamp = this.timestamp();
    const node: DaemonNodeRecord = {
      id: nodeId || existing?.id || createId("node"),
      endpoint: input.endpoint,
      status: input.status ?? "online",
      capabilities: input.capabilities ?? null,
      runtimeAuthToken,
      doyaHome: input.doyaHome?.trim() || existing?.doyaHome || null,
      lastHeartbeatAt: timestamp,
      createdAt: existing?.createdAt ?? timestamp,
    };
    this.snapshot.daemonNodes = upsertById(this.snapshot.daemonNodes, node, (entry) => entry.id);
    await this.enqueuePersist();
    return node;
  }

  async listNodes(): Promise<DaemonNodeRecord[]> {
    await this.load();
    return [...this.snapshot.daemonNodes];
  }

  async getAdminOverview(): Promise<AdminControlOverview> {
    await this.load();
    const runtimeCounts = createRuntimeStatusCounts();
    const agentBindingCounts = createAgentBindingStatusCounts();
    for (const allocation of this.snapshot.runtimeAllocations) {
      runtimeCounts[allocation.status] += 1;
    }
    for (const binding of this.snapshot.agentBindings) {
      agentBindingCounts[binding.status] += 1;
    }
    const activeSessionIds = new Set(
      this.snapshot.sessions
        .filter((session) => session.deletedAt === null)
        .map((session) => session.id),
    );
    return {
      settings: this.snapshot.settings,
      daemonNodes: this.snapshot.daemonNodes
        .map((node) => {
          const nodeRuntimeCounts = createRuntimeStatusCounts();
          for (const allocation of this.snapshot.runtimeAllocations) {
            if (allocation.nodeId === node.id) {
              nodeRuntimeCounts[allocation.status] += 1;
            }
          }
          const nodeAgentBindingCounts = createAgentBindingStatusCounts();
          for (const binding of this.snapshot.agentBindings) {
            if (binding.nodeId === node.id) {
              nodeAgentBindingCounts[binding.status] += 1;
            }
          }
          const nodeActiveSessionIds = new Set(
            this.snapshot.runtimeAllocations
              .filter(
                (allocation) =>
                  allocation.nodeId === node.id && activeSessionIds.has(allocation.sessionId),
              )
              .map((allocation) => allocation.sessionId),
          );
          const userWorkspaces = this.snapshot.userDaemonWorkspaces
            .filter((workspace) => workspace.nodeId === node.id)
            .map((workspace) => {
              const user = this.snapshot.users.find((entry) => entry.id === workspace.userId);
              return {
                workspace,
                user: user ? stripUserToken(user) : null,
                sessions: this.getAdminSessionSummariesForWorkspace({
                  nodeId: node.id,
                  userId: workspace.userId,
                  userWorkspaceId: workspace.id,
                }),
              };
            })
            .sort((left, right) =>
              right.workspace.updatedAt.localeCompare(left.workspace.updatedAt),
            );
          return {
            node: stripNodeToken(node),
            isDefault: this.snapshot.settings.defaultDaemonNodeId === node.id,
            userWorkspaceCount: userWorkspaces.length,
            runtimeCounts: nodeRuntimeCounts,
            activeSessionCount: nodeActiveSessionIds.size,
            agentBindingCounts: nodeAgentBindingCounts,
            userWorkspaces,
          };
        })
        .sort((left, right) => {
          if (left.isDefault !== right.isDefault) {
            return left.isDefault ? -1 : 1;
          }
          return right.node.lastHeartbeatAt.localeCompare(left.node.lastHeartbeatAt);
        }),
      totals: {
        daemonCount: this.snapshot.daemonNodes.length,
        userWorkspaceCount: this.snapshot.userDaemonWorkspaces.length,
        runtimeCounts,
        activeSessionCount: activeSessionIds.size,
        agentBindingCounts,
      },
    };
  }

  async setDefaultDaemonNode(nodeId: string | null): Promise<ControlSettingsRecord> {
    await this.load();
    const normalizedNodeId = nodeId?.trim() || null;
    if (normalizedNodeId) {
      await this.getNode(normalizedNodeId);
    }
    this.snapshot.settings = {
      ...this.snapshot.settings,
      defaultDaemonNodeId: normalizedNodeId,
    };
    await this.enqueuePersist();
    return this.snapshot.settings;
  }

  async updateNode(input: { nodeId: string; status?: NodeStatus }): Promise<DaemonNodeRecord> {
    const node = await this.getNode(input.nodeId);
    const nextNode: DaemonNodeRecord = {
      ...node,
      status: input.status ?? node.status,
      lastHeartbeatAt: this.timestamp(),
    };
    this.snapshot.daemonNodes = upsertById(
      this.snapshot.daemonNodes,
      nextNode,
      (entry) => entry.id,
    );
    await this.enqueuePersist();
    return nextNode;
  }

  async removeNode(nodeId: string): Promise<void> {
    await this.load();
    await this.getNode(nodeId);
    this.snapshot.daemonNodes = this.snapshot.daemonNodes.filter((node) => node.id !== nodeId);
    if (this.snapshot.settings.defaultDaemonNodeId === nodeId) {
      this.snapshot.settings = {
        ...this.snapshot.settings,
        defaultDaemonNodeId: null,
      };
    }
    await this.enqueuePersist();
  }

  async getAdminSessionCleanupTargets(input: {
    nodeId: string;
    sessionIds: string[];
  }): Promise<AdminSessionCleanupTarget[]> {
    await this.load();
    const requestedSessionIds = new Set(input.sessionIds);
    return this.snapshot.sessions
      .filter((session) => requestedSessionIds.has(session.id))
      .map((session) => {
        const runtimeAllocations = this.snapshot.runtimeAllocations.filter(
          (allocation) => allocation.nodeId === input.nodeId && allocation.sessionId === session.id,
        );
        const agentBindings = this.snapshot.agentBindings.filter(
          (binding) => binding.nodeId === input.nodeId && binding.sessionId === session.id,
        );
        if (runtimeAllocations.length === 0 && agentBindings.length === 0) {
          return null;
        }
        const user = this.snapshot.users.find((entry) => entry.id === session.userId);
        return {
          session,
          user: user ? stripUserToken(user) : null,
          runtimeAllocations,
          agentBindings,
        };
      })
      .filter((target): target is AdminSessionCleanupTarget => target !== null);
  }

  async cleanupAdminSessions(input: {
    nodeId: string;
    sessionIds: string[];
    deleteSessions: boolean;
    workDirDeletedSessionIds?: string[];
  }): Promise<AdminSessionCleanupResult> {
    await this.load();
    const requestedSessionIds = new Set(input.sessionIds);
    const workDirDeletedSessionIds = new Set(input.workDirDeletedSessionIds ?? []);
    const timestamp = this.timestamp();
    let deletedSessionCount = 0;
    let stoppedRuntimeCount = 0;
    let archivedBindingCount = 0;

    this.snapshot.sessions = this.snapshot.sessions.map((session) => {
      if (!requestedSessionIds.has(session.id)) {
        return session;
      }
      const nextSession = { ...session };
      if (input.deleteSessions && !session.deletedAt) {
        deletedSessionCount += 1;
        nextSession.deletedAt = timestamp;
        nextSession.updatedAt = timestamp;
      }
      if (workDirDeletedSessionIds.has(session.id)) {
        nextSession.workDirDeletedAt = timestamp;
        nextSession.updatedAt = timestamp;
      }
      if (
        nextSession.deletedAt === session.deletedAt &&
        nextSession.workDirDeletedAt === session.workDirDeletedAt
      ) {
        return session;
      }
      return {
        ...nextSession,
      };
    });
    this.snapshot.runtimeAllocations = this.snapshot.runtimeAllocations.map((allocation) => {
      if (
        allocation.nodeId !== input.nodeId ||
        !requestedSessionIds.has(allocation.sessionId) ||
        allocation.status === "stopped"
      ) {
        return allocation;
      }
      stoppedRuntimeCount += 1;
      return {
        ...allocation,
        status: "stopped",
        releasedAt: allocation.releasedAt ?? timestamp,
        lastHeartbeatAt: timestamp,
      };
    });
    this.snapshot.agentBindings = this.snapshot.agentBindings.map((binding) => {
      if (
        binding.nodeId !== input.nodeId ||
        !requestedSessionIds.has(binding.sessionId) ||
        binding.status === "archived"
      ) {
        return binding;
      }
      archivedBindingCount += 1;
      return {
        ...binding,
        status: "archived",
        updatedAt: timestamp,
      };
    });
    await this.enqueuePersist();
    return {
      deletedSessionCount,
      stoppedRuntimeCount,
      archivedBindingCount,
    };
  }

  async getNode(nodeId: string): Promise<DaemonNodeRecord> {
    await this.load();
    const node = this.snapshot.daemonNodes.find((entry) => entry.id === nodeId);
    if (!node) {
      throw new NotFoundError("Daemon node not found");
    }
    return node;
  }

  async getUserDaemonWorkspace(input: {
    userId: string;
    nodeId: string;
  }): Promise<UserDaemonWorkspaceRecord | null> {
    await this.load();
    return (
      this.snapshot.userDaemonWorkspaces.find(
        (workspace) =>
          workspace.userId === input.userId &&
          workspace.nodeId === input.nodeId &&
          workspace.status === "active",
      ) ?? null
    );
  }

  async upsertUserDaemonWorkspace(input: {
    userId: string;
    nodeId: string;
    workspaceDir: string;
    status?: "active" | "lost";
  }): Promise<UserDaemonWorkspaceRecord> {
    await this.load();
    this.requireExistingUser(input.userId);
    const timestamp = this.timestamp();
    const existing = this.snapshot.userDaemonWorkspaces.find(
      (workspace) => workspace.userId === input.userId && workspace.nodeId === input.nodeId,
    );
    const workspace: UserDaemonWorkspaceRecord = {
      id: existing?.id ?? createId("udw"),
      userId: input.userId,
      nodeId: input.nodeId,
      workspaceDir: input.workspaceDir,
      status: input.status ?? existing?.status ?? "active",
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    this.snapshot.userDaemonWorkspaces = upsertById(
      this.snapshot.userDaemonWorkspaces,
      workspace,
      (entry) => entry.id,
    );
    await this.enqueuePersist();
    return workspace;
  }

  async upsertAgentBinding(input: {
    sessionId: string;
    userId: string;
    nodeId: string;
    agentId: string;
    userWorkspaceId?: string | null;
    workspaceId?: string | null;
    cwd?: string | null;
    status?: SessionAgentBindingStatus;
  }): Promise<SessionAgentBindingRecord> {
    await this.getSession({ sessionId: input.sessionId, userId: input.userId });
    const timestamp = this.timestamp();
    const existing = this.snapshot.agentBindings.find(
      (binding) => binding.sessionId === input.sessionId && binding.agentId === input.agentId,
    );
    const binding: SessionAgentBindingRecord = {
      id: existing?.id ?? createId("agb"),
      sessionId: input.sessionId,
      nodeId: input.nodeId,
      agentId: input.agentId,
      userWorkspaceId: input.userWorkspaceId ?? existing?.userWorkspaceId ?? null,
      workspaceId: input.workspaceId ?? existing?.workspaceId ?? null,
      cwd: input.cwd ?? existing?.cwd ?? null,
      status: input.status ?? existing?.status ?? "active",
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    this.snapshot.agentBindings = upsertById(
      this.snapshot.agentBindings,
      binding,
      (entry) => entry.id,
    );
    await this.updateSession({
      sessionId: input.sessionId,
      userId: input.userId,
      status: "running",
    });
    await this.enqueuePersist();
    return binding;
  }

  async getActiveAgentBinding(input: {
    sessionId: string;
    userId: string;
  }): Promise<SessionAgentBindingRecord | null> {
    await this.getSession({ sessionId: input.sessionId, userId: input.userId });
    return (
      this.snapshot.agentBindings
        .filter((binding) => binding.sessionId === input.sessionId && binding.status === "active")
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
    );
  }

  async createRuntimeAllocation(input: {
    sessionId: string;
    userId: string;
    nodeId: string;
    runtimeId: string;
    providerId?: string | null;
    modelId?: string | null;
    selectionReason?: string | null;
    userWorkspaceId?: string | null;
    workspaceDir: string;
    status?: RuntimeStatus;
  }): Promise<RuntimeAllocationRecord> {
    await this.getSession({ sessionId: input.sessionId, userId: input.userId });
    const timestamp = this.timestamp();
    const allocation: RuntimeAllocationRecord = {
      id: createId("rta"),
      sessionId: input.sessionId,
      nodeId: input.nodeId,
      runtimeId: input.runtimeId,
      providerId: normalizeOptionalString(input.providerId),
      modelId: normalizeOptionalString(input.modelId),
      selectionReason: normalizeOptionalString(input.selectionReason),
      userWorkspaceId: input.userWorkspaceId ?? null,
      workspaceDir: input.workspaceDir,
      status: input.status ?? "starting",
      leasedAt: timestamp,
      releasedAt: null,
      lastHeartbeatAt: timestamp,
    };
    this.snapshot.runtimeAllocations = [...this.snapshot.runtimeAllocations, allocation];
    await this.enqueuePersist();
    return allocation;
  }

  async getActiveRuntime(input: {
    sessionId: string;
    userId: string;
  }): Promise<RuntimeAllocationRecord | null> {
    await this.getSession({ sessionId: input.sessionId, userId: input.userId });
    const activeStatuses = new Set<RuntimeStatus>(["starting", "running"]);
    return (
      this.snapshot.runtimeAllocations
        .filter(
          (allocation) =>
            allocation.sessionId === input.sessionId && activeStatuses.has(allocation.status),
        )
        .sort((left, right) => right.leasedAt.localeCompare(left.leasedAt))[0] ?? null
    );
  }

  async getRuntimeAllocationByRuntimeId(input: {
    sessionId: string;
    runtimeId: string;
    nodeId: string;
  }): Promise<RuntimeAllocationRecord> {
    await this.load();
    const allocation = this.snapshot.runtimeAllocations.find(
      (entry) =>
        entry.sessionId === input.sessionId &&
        entry.runtimeId === input.runtimeId &&
        entry.nodeId === input.nodeId,
    );
    if (!allocation) {
      throw new NotFoundError("Runtime allocation not found");
    }
    return allocation;
  }

  async updateRuntimeAllocationStatus(input: {
    allocationId: string;
    status: RuntimeStatus;
  }): Promise<RuntimeAllocationRecord> {
    await this.load();
    const allocation = this.snapshot.runtimeAllocations.find(
      (entry) => entry.id === input.allocationId,
    );
    if (!allocation) {
      throw new NotFoundError("Runtime allocation not found");
    }
    const timestamp = this.timestamp();
    const nextAllocation: RuntimeAllocationRecord = {
      ...allocation,
      status: input.status,
      lastHeartbeatAt: timestamp,
      releasedAt:
        input.status === "stopped" || input.status === "lost"
          ? (allocation.releasedAt ?? timestamp)
          : allocation.releasedAt,
    };
    this.snapshot.runtimeAllocations = upsertById(
      this.snapshot.runtimeAllocations,
      nextAllocation,
      (entry) => entry.id,
    );
    await this.enqueuePersist();
    return nextAllocation;
  }

  async touchRuntimeAllocation(input: { allocationId: string }): Promise<RuntimeAllocationRecord> {
    await this.load();
    const allocation = this.snapshot.runtimeAllocations.find(
      (entry) => entry.id === input.allocationId,
    );
    if (!allocation) {
      throw new NotFoundError("Runtime allocation not found");
    }
    const nextAllocation: RuntimeAllocationRecord = {
      ...allocation,
      lastHeartbeatAt: this.timestamp(),
    };
    this.snapshot.runtimeAllocations = upsertById(
      this.snapshot.runtimeAllocations,
      nextAllocation,
      (entry) => entry.id,
    );
    await this.enqueuePersist();
    return nextAllocation;
  }

  private async rotateAccessToken(user: StoredUserRecord): Promise<AccountSession> {
    const nextUser = { ...user, accessToken: createAccessToken() };
    this.snapshot.users = upsertById(this.snapshot.users, nextUser, (entry) => entry.id);
    await this.enqueuePersist();
    return { user: stripUserToken(nextUser), accessToken: nextUser.accessToken };
  }

  private async requireUser(input: {
    userId: string;
    accessToken: string;
  }): Promise<StoredUserRecord> {
    await this.load();
    const user = this.snapshot.users.find(
      (entry) => entry.id === input.userId && entry.disabledAt === null,
    );
    if (!user) {
      throw new NotFoundError("User not found");
    }
    if (user.accessToken !== input.accessToken) {
      throw new Error("Invalid access token");
    }
    return user;
  }

  private requireExistingUser(userId: string): void {
    if (!this.snapshot.users.some((user) => user.id === userId && user.disabledAt === null)) {
      throw new NotFoundError("User not found");
    }
  }

  private nextMessageSequence(sessionId: string): number {
    return (
      this.snapshot.sessionMessages.reduce(
        (max, message) => (message.sessionId === sessionId ? Math.max(max, message.sequence) : max),
        0,
      ) + 1
    );
  }

  private async touchSession(sessionId: string): Promise<void> {
    const session = this.snapshot.sessions.find((entry) => entry.id === sessionId);
    if (!session) {
      return;
    }
    this.snapshot.sessions = upsertById(
      this.snapshot.sessions,
      { ...session, updatedAt: this.timestamp() },
      (entry) => entry.id,
    );
  }

  private async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    try {
      this.snapshot = normalizeSnapshot(JSON.parse(await readFile(this.filePath, "utf8")));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
      this.snapshot = { ...EMPTY_SNAPSHOT };
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, JSON.stringify(this.snapshot, null, 2), "utf8");
    await rename(tempPath, this.filePath);
  }

  private async enqueuePersist(): Promise<void> {
    const nextPersist = this.persistQueue.then(() => this.persist());
    this.persistQueue = nextPersist.catch(() => undefined);
    await nextPersist;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private getAdminSessionSummariesForWorkspace(input: {
    nodeId: string;
    userId: string;
    userWorkspaceId: string;
  }): AdminSessionSummary[] {
    return this.snapshot.sessions
      .filter((session) => {
        if (session.workDirDeletedAt) {
          return false;
        }
        if (session.userId !== input.userId) {
          return false;
        }
        return (
          this.snapshot.runtimeAllocations.some(
            (allocation) =>
              allocation.nodeId === input.nodeId &&
              allocation.sessionId === session.id &&
              allocation.userWorkspaceId === input.userWorkspaceId,
          ) ||
          this.snapshot.agentBindings.some(
            (binding) =>
              binding.nodeId === input.nodeId &&
              binding.sessionId === session.id &&
              binding.userWorkspaceId === input.userWorkspaceId,
          )
        );
      })
      .map((session) => ({
        session,
        runtimeAllocations: this.snapshot.runtimeAllocations.filter(
          (allocation) => allocation.nodeId === input.nodeId && allocation.sessionId === session.id,
        ),
        agentBindings: this.snapshot.agentBindings.filter(
          (binding) => binding.nodeId === input.nodeId && binding.sessionId === session.id,
        ),
      }))
      .sort((left, right) => right.session.updatedAt.localeCompare(left.session.updatedAt));
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stripUserToken(user: StoredUserRecord): UserRecord {
  const { accessToken: _accessToken, ...record } = user;
  return record;
}

function stripNodeToken(node: DaemonNodeRecord): Omit<DaemonNodeRecord, "runtimeAuthToken"> {
  const { runtimeAuthToken: _runtimeAuthToken, ...record } = node;
  return record;
}

function normalizeSnapshot(value: unknown): ControlSnapshot {
  if (!value || typeof value !== "object") {
    return { ...EMPTY_SNAPSHOT };
  }
  const record = value as Partial<ControlSnapshot>;
  const daemonNodes = Array.isArray(record.daemonNodes)
    ? record.daemonNodes.map((node) => ({
        ...node,
        doyaHome: typeof node.doyaHome === "string" && node.doyaHome.trim() ? node.doyaHome : null,
        runtimeAuthToken:
          typeof node.runtimeAuthToken === "string" && node.runtimeAuthToken.trim()
            ? node.runtimeAuthToken
            : null,
      }))
    : [];
  const defaultDaemonNodeId =
    typeof record.settings?.defaultDaemonNodeId === "string" &&
    daemonNodes.some((node) => node.id === record.settings?.defaultDaemonNodeId)
      ? record.settings.defaultDaemonNodeId
      : null;
  return {
    settings: {
      defaultDaemonNodeId,
    },
    users: Array.isArray(record.users) ? record.users : [],
    sessions: Array.isArray(record.sessions)
      ? record.sessions.map((session) => ({
          ...session,
          workDirDeletedAt:
            typeof session.workDirDeletedAt === "string" ? session.workDirDeletedAt : null,
        }))
      : [],
    sessionMessages: Array.isArray(record.sessionMessages) ? record.sessionMessages : [],
    artifacts: Array.isArray(record.artifacts) ? record.artifacts : [],
    fileSnapshots: Array.isArray(record.fileSnapshots) ? record.fileSnapshots : [],
    daemonNodes,
    userDaemonWorkspaces: Array.isArray(record.userDaemonWorkspaces)
      ? record.userDaemonWorkspaces.map((workspace) => ({
          ...workspace,
          status: workspace.status === "lost" ? "lost" : "active",
        }))
      : [],
    runtimeAllocations: Array.isArray(record.runtimeAllocations)
      ? record.runtimeAllocations.map((allocation) => ({
          ...allocation,
          providerId: normalizeOptionalString(allocation.providerId),
          modelId: normalizeOptionalString(allocation.modelId),
          selectionReason: normalizeOptionalString(allocation.selectionReason),
          userWorkspaceId:
            typeof allocation.userWorkspaceId === "string" ? allocation.userWorkspaceId : null,
        }))
      : [],
    agentBindings: Array.isArray(record.agentBindings)
      ? record.agentBindings.map((binding) =>
          Object.assign({}, binding, {
            userWorkspaceId:
              typeof binding.userWorkspaceId === "string" ? binding.userWorkspaceId : null,
          }),
        )
      : [],
  };
}

function createRuntimeStatusCounts(): Record<RuntimeStatus, number> {
  return {
    starting: 0,
    running: 0,
    stopped: 0,
    lost: 0,
  };
}

function createAgentBindingStatusCounts(): Record<SessionAgentBindingStatus, number> {
  return {
    active: 0,
    lost: 0,
    archived: 0,
  };
}

function upsertById<TRecord>(
  records: TRecord[],
  record: TRecord,
  getId: (record: TRecord) => string,
): TRecord[] {
  return [...records.filter((existing) => getId(existing) !== getId(record)), record];
}

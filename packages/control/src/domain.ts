export type SessionStatus = "idle" | "running" | "needs_input" | "done" | "error";
export type RuntimeStatus = "starting" | "running" | "stopped" | "lost";
export type NodeStatus = "online" | "offline" | "draining";
export type MessageRole = "user" | "assistant" | "system" | "tool";

export type WorkingContext =
  | { type: "git"; repoUrl: string; branch?: string; baseCommit?: string }
  | { type: "uploaded_files"; snapshotId: string }
  | { type: "generated_workspace"; snapshotId?: string };

export interface UserRecord {
  id: string;
  email: string;
  phone: string | null;
  createdAt: string;
  disabledAt: string | null;
}

export interface AccountSession {
  user: UserRecord;
  accessToken: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  title: string;
  status: SessionStatus;
  workingContext: WorkingContext;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  workDirDeletedAt: string | null;
}

export interface SessionMessageRecord {
  id: string;
  sessionId: string;
  role: MessageRole;
  externalId: string | null;
  content: unknown;
  sequence: number;
  createdAt: string;
}

export interface ArtifactRecord {
  id: string;
  sessionId: string;
  type: string;
  name: string;
  uri: string;
  externalId: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface FileSnapshotFileRecord {
  path: string;
  contentBase64: string;
  mode: number | null;
}

export interface FileSnapshotRecord {
  id: string;
  userId: string;
  files: FileSnapshotFileRecord[];
  createdAt: string;
}

export interface DaemonNodeRecord {
  id: string;
  endpoint: string;
  status: NodeStatus;
  capabilities: unknown;
  runtimeAuthToken: string | null;
  doyaHome: string | null;
  lastHeartbeatAt: string;
  createdAt: string;
}

export interface ControlSettingsRecord {
  defaultDaemonNodeId: string | null;
}

export interface UserDaemonWorkspaceRecord {
  id: string;
  userId: string;
  nodeId: string;
  workspaceDir: string;
  status: "active" | "lost";
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeAllocationRecord {
  id: string;
  runtimeId: string;
  sessionId: string;
  nodeId: string;
  providerId: string | null;
  modelId: string | null;
  selectionReason: string | null;
  userWorkspaceId: string | null;
  workspaceDir: string;
  status: RuntimeStatus;
  leasedAt: string;
  releasedAt: string | null;
  lastHeartbeatAt: string;
}

export type SessionAgentBindingStatus = "active" | "lost" | "archived";

export interface SessionAgentBindingRecord {
  id: string;
  sessionId: string;
  nodeId: string;
  agentId: string;
  userWorkspaceId: string | null;
  workspaceId: string | null;
  cwd: string | null;
  status: SessionAgentBindingStatus;
  createdAt: string;
  updatedAt: string;
}

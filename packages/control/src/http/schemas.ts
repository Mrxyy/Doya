import { z } from "zod";

export const workingContextSchema = z.discriminatedUnion("type", [
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

export const registerBodySchema = z.object({
  email: z.string().min(1),
  phone: z.string().optional().nullable(),
});

export const loginBodySchema = z.object({
  email: z.string().min(1),
});

export const createSessionBodySchema = z.object({
  title: z.string().min(1),
  workingContext: workingContextSchema,
});

export const updateSessionBodySchema = z.object({
  title: z.string().optional(),
  status: z.enum(["idle", "running", "needs_input", "done", "error"]).optional(),
});

export const appendMessageBodySchema = z.object({
  role: z.enum(["user", "assistant", "system", "tool"]),
  externalId: z.string().optional().nullable(),
  content: z.unknown(),
});

export const runtimeSyncEventBodySchema = z.object({
  sessionId: z.string().min(1),
  runtimeId: z.string().min(1),
  nodeId: z.string().min(1),
  agentId: z.string().min(1),
  event: z.unknown(),
});

export const runtimeSyncArtifactBodySchema = z.object({
  sessionId: z.string().min(1),
  runtimeId: z.string().min(1),
  nodeId: z.string().min(1),
  agentId: z.string().min(1),
  artifact: z.object({
    type: z.string().min(1),
    name: z.string().min(1),
    uri: z.string().min(1),
    externalId: z.string().optional().nullable(),
    metadata: z.unknown().optional(),
  }),
});

export const createArtifactBodySchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1),
  uri: z.string().min(1),
  externalId: z.string().optional().nullable(),
  metadata: z.unknown().optional(),
});

export const createFileSnapshotBodySchema = z.object({
  files: z.array(
    z.object({
      path: z.string().min(1),
      contentBase64: z.string().min(1),
      mode: z.number().int().nonnegative().optional().nullable(),
    }),
  ),
});

export const registerNodeBodySchema = z.object({
  nodeId: z.string().min(1).optional(),
  endpoint: z.string().min(1),
  doyaHome: z.string().optional().nullable(),
  capabilities: z.unknown().optional(),
  runtimeAuthToken: z.string().optional().nullable(),
  status: z.enum(["online", "offline", "draining"]).optional(),
});

export const setDefaultDaemonBodySchema = z.object({
  nodeId: z.string().min(1).nullable(),
});

export const updateDaemonNodeBodySchema = z.object({
  status: z.enum(["online", "offline", "draining"]).optional(),
});

export const daemonConfigPatchBodySchema = z
  .object({
    mcp: z
      .object({
        injectIntoAgents: z.boolean().optional(),
      })
      .optional(),
    appendSystemPrompt: z.string().optional(),
  })
  .passthrough();

export const cleanupDaemonSessionsBodySchema = z.object({
  sessionIds: z.array(z.string().min(1)).min(1),
  deleteSessions: z.boolean().optional(),
  deleteWorkDirs: z.boolean().optional(),
});

export const upsertAgentBindingBodySchema = z.object({
  nodeId: z.string().min(1),
  agentId: z.string().min(1),
  userWorkspaceId: z.string().optional().nullable(),
  workspaceId: z.string().optional().nullable(),
  cwd: z.string().optional().nullable(),
  status: z.enum(["active", "lost", "archived"]).optional(),
});

export const upsertUserDaemonWorkspaceBodySchema = z.object({
  workspaceDir: z.string().min(1),
  status: z.enum(["active", "lost"]).optional(),
});

export const allocateSessionWorkDirBodySchema = z.object({
  nodeId: z.string().min(1),
  runtimeId: z.string().min(1).optional(),
  providerId: z.string().min(1).optional().nullable(),
  modelId: z.string().min(1).optional().nullable(),
  selectionReason: z.string().min(1).optional().nullable(),
});

export const createRuntimeAllocationBodySchema = z.object({
  nodeId: z.string().min(1),
  runtimeId: z.string().min(1),
  providerId: z.string().min(1).optional().nullable(),
  modelId: z.string().min(1).optional().nullable(),
  selectionReason: z.string().min(1).optional().nullable(),
  userWorkspaceId: z.string().optional().nullable(),
  workspaceDir: z.string().min(1),
  status: z.enum(["starting", "running", "stopped", "lost"]).optional(),
});

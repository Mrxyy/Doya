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

export const selectRuntimeNodeBodySchema = z.object({
  providerId: z.string().min(1).optional().nullable(),
  modelId: z.string().min(1).optional().nullable(),
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

export const usageTokensBodySchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  cacheCreationTokens: z.number().int().nonnegative().optional(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cachedInputTokens: z.number().int().nonnegative().optional(),
  reasoningTokens: z.number().int().nonnegative().optional(),
  contextWindowUsedTokens: z.number().int().nonnegative().optional().nullable(),
  contextWindowMaxTokens: z.number().int().nonnegative().optional().nullable(),
});

export const recordUsageTurnBodySchema = z.object({
  sessionId: z.string().min(1),
  runtimeId: z.string().min(1),
  nodeId: z.string().min(1).optional().nullable(),
  agentId: z.string().min(1),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  turnId: z.string().min(1),
  requestId: z.string().min(1).optional(),
  requestFingerprint: z.string().min(1).optional(),
  tokens: usageTokensBodySchema,
});

export const billingPreflightBodySchema = z.object({
  providerId: z.string().min(1).optional().nullable(),
  modelId: z.string().min(1).optional().nullable(),
});

export const bindReferralBodySchema = z.object({
  code: z.string().min(1),
  clientId: z.string().optional().nullable(),
});

export const createPaymentOrderBodySchema = z.object({
  planId: z.literal("pro"),
  billingPeriod: z.enum(["monthly", "yearly"]),
  providerType: z.enum(["alipay", "wxpay"]),
});

export const upsertModelPricingBodySchema = z.object({
  id: z.string().min(1).optional(),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  displayName: z.string().min(1),
  inputPriceUsdPerToken: z.number().nonnegative(),
  outputPriceUsdPerToken: z.number().nonnegative(),
  cacheCreationPriceUsdPerToken: z.number().nonnegative(),
  cacheReadPriceUsdPerToken: z.number().nonnegative(),
  supportsUsageAccounting: z.boolean().optional(),
  enabled: z.boolean().optional(),
  source: z.enum(["manual", "fallback", "provider_reported"]).optional(),
});

export const adminBillingQuerySchema = z.object({
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  planId: z.string().optional(),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
});

export const updateBillingSettingsBodySchema = z.object({
  usdToCnyRate: z.number().positive().optional(),
  tokenMarkupMultiplier: z.number().positive().optional(),
  freeMonthlyGrantCny: z.number().nonnegative().optional(),
  proMonthlyGrantCny: z.number().nonnegative().optional(),
  referralInviteeBonusCny: z.number().nonnegative().optional(),
  referralInviterRewardCny: z.number().nonnegative().optional(),
  referralMonthlyRewardLimit: z.number().int().nonnegative().optional(),
  referralDailyRewardLimit: z.number().int().nonnegative().optional(),
  referralRewardExpiresDays: z.number().int().positive().optional(),
});

export const adminAdjustmentBodySchema = z.object({
  userId: z.string().min(1),
  amountCny: z.number(),
  note: z.string().optional().nullable(),
});

export const updateBillingPlanBodySchema = z.object({
  userId: z.string().min(1),
  planId: z.enum(["free", "pro"]),
});

export const updateBillingPlanDefinitionBodySchema = z.object({
  planId: z.enum(["free", "pro"]),
  priceCny: z.number().nonnegative(),
  monthlyGrantCny: z.number().nonnegative(),
  workspaceBytesLimit: z.number().int().nonnegative(),
  singleUploadBytesLimit: z.number().int().nonnegative(),
  enabled: z.boolean(),
});

export const updateStorageQuotaBodySchema = z.object({
  userId: z.string().min(1),
  uploadedBytesUsed: z.number().int().nonnegative().optional(),
  generatedBytesUsed: z.number().int().nonnegative().optional(),
  temporaryWorkspaceBytesLimit: z.number().int().nonnegative().optional().nullable(),
  lastScannedAt: z.string().optional().nullable(),
});

export const updateReferralBodySchema = z.object({
  status: z.enum(["created", "registered", "qualified", "rewarded", "rejected"]),
  rejectReason: z.string().optional().nullable(),
});

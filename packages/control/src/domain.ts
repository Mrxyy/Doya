export type SessionStatus = "idle" | "running" | "needs_input" | "done" | "error";
export type RuntimeStatus = "starting" | "running" | "stopped" | "lost";
export type NodeStatus = "online" | "offline" | "draining";
export type MessageRole = "user" | "assistant" | "system" | "tool";
export type PlanId = "free" | "pro";
export type BillingStatus =
  | "free"
  | "active"
  | "usage_exhausted"
  | "storage_exceeded"
  | "past_due"
  | "disabled";
export type BillingMode = "token";
export type ModelPricingSource = "manual" | "fallback" | "provider_reported";
export type UsageLogStatus = "charged";
export type CreditLedgerKind =
  | "monthly_grant"
  | "top_up"
  | "usage_charge"
  | "referral_inviter_reward"
  | "referral_invitee_bonus"
  | "plan_quota_adjustment"
  | "admin_adjustment";
export type ReferralStatus = "created" | "registered" | "qualified" | "rewarded" | "rejected";
export type PaymentOrderStatus = "pending" | "paid" | "failed";
export type PaymentProviderType = "alipay" | "wxpay";
export type BillingPeriod = "monthly" | "yearly";

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
  publicEndpoint: string | null;
  status: NodeStatus;
  capabilities: unknown;
  runtimeAuthToken: string | null;
  doyaHome: string | null;
  lastHeartbeatAt: string;
  createdAt: string;
}

export type ControlSettingsRecord = Record<string, never>;

export interface BillingSettingsRecord {
  displayCurrency: "CNY";
  usdToCnyRate: number;
  tokenMarkupMultiplier: number;
  freeMonthlyGrantCny: number;
  proMonthlyGrantCny: number;
  referralInviteeBonusCny: number;
  referralInviterRewardCny: number;
  referralMonthlyRewardLimit: number;
  referralDailyRewardLimit: number;
  referralRewardExpiresDays: number;
  updatedAt: string | null;
}

export interface PlanRecord {
  id: PlanId;
  name: string;
  priceCny: number;
  monthlyGrantCny: number;
  workspaceBytesLimit: number;
  singleUploadBytesLimit: number;
  enabled: boolean;
}

export interface PaymentOrderRecord {
  id: string;
  userId: string;
  planId: PlanId;
  billingPeriod: BillingPeriod;
  providerType: PaymentProviderType;
  outTradeNo: string;
  providerTradeNo: string | null;
  amountCny: number;
  status: PaymentOrderStatus;
  paymentUrl: string | null;
  qrcode: string | null;
  urlscheme: string | null;
  rawGatewayResponse: unknown;
  rawNotifyPayload: unknown;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
}

export interface ModelPricingRecord {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  billingMode: BillingMode;
  inputPriceUsdPerToken: number;
  outputPriceUsdPerToken: number;
  cacheCreationPriceUsdPerToken: number;
  cacheReadPriceUsdPerToken: number;
  supportsUsageAccounting: boolean;
  enabled: boolean;
  source: ModelPricingSource;
  createdAt: string;
  updatedAt: string;
}

export interface ModelPricingSnapshot {
  pricingId: string;
  providerId: string;
  modelId: string;
  displayName: string;
  billingMode: BillingMode;
  inputPriceUsdPerToken: number;
  outputPriceUsdPerToken: number;
  cacheCreationPriceUsdPerToken: number;
  cacheReadPriceUsdPerToken: number;
  supportsUsageAccounting: boolean;
  source: ModelPricingSource;
}

export interface BillingAccountRecord {
  id: string;
  userId: string;
  planId: PlanId;
  status: BillingStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  balanceCachedCny: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreditLedgerEntryRecord {
  id: string;
  userId: string;
  accountId: string;
  kind: CreditLedgerKind;
  amountCny: number;
  expiresAt: string | null;
  usageLogId: string | null;
  referralId: string | null;
  note: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface UsageLogRecord {
  id: string;
  userId: string;
  sessionId: string;
  runtimeId: string;
  nodeId: string | null;
  agentId: string;
  providerId: string;
  modelId: string;
  turnId: string;
  requestId: string;
  requestFingerprint: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  contextWindowUsedTokens: number | null;
  contextWindowMaxTokens: number | null;
  inputCostUsd: number;
  outputCostUsd: number;
  cacheCreationCostUsd: number;
  cacheReadCostUsd: number;
  baseCostUsd: number;
  markedCostUsd: number;
  actualCostCny: number;
  usdToCnyRate: number;
  tokenMarkupMultiplier: number;
  pricingSnapshot: ModelPricingSnapshot;
  status: UsageLogStatus;
  createdAt: string;
}

export interface StorageQuotaRecord {
  id: string;
  userId: string;
  uploadedBytesUsed: number;
  generatedBytesUsed: number;
  workspaceBytesUsed: number;
  workspaceBytesLimit: number;
  singleUploadBytesLimit: number;
  temporaryWorkspaceBytesLimit: number | null;
  lastScannedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReferralRecord {
  id: string;
  inviterUserId: string;
  inviteeUserId: string | null;
  code: string;
  status: ReferralStatus;
  rejectReason: string | null;
  sourceFingerprint: string | null;
  qualifiedAt: string | null;
  rewardedAt: string | null;
  inviteeBonusLedgerId: string | null;
  inviterRewardLedgerId: string | null;
  createdAt: string;
  updatedAt: string;
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

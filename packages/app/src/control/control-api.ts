import type { AccountBootstrapSession } from "@/account/account-api";
import { isDev, isWeb } from "@/constants/platform";
import { translateNow } from "@/i18n/i18n";
import { useBillingUpgradeModalStore } from "@/stores/billing-upgrade-modal-store";
import { getBillingUpgradeReason, translateBillingError } from "@/utils/billing-errors";
import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@getdoya/protocol/messages";

export type SessionStatus = "idle" | "running" | "needs_input" | "done" | "error";
export type RuntimeStatus = "starting" | "running" | "stopped" | "lost";
export type MessageRole = "user" | "assistant" | "system" | "tool";

export type WorkingContext =
  | { type: "git"; repoUrl: string; branch?: string; baseCommit?: string }
  | { type: "uploaded_files"; snapshotId: string }
  | { type: "generated_workspace"; snapshotId?: string };

export interface ControlUserRecord {
  id: string;
  email: string;
  phone: string | null;
  createdAt: string;
  disabledAt: string | null;
}

export interface ControlAccountSession {
  user: ControlUserRecord;
  accessToken: string;
}

export interface ControlManagedCodexConfig {
  enabled: boolean;
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
}

export type ControlRuntimeNodePreference =
  | { mode: "cloud"; nodeId: null }
  | { mode: "fixed"; nodeId: string };

export interface ControlSessionRecord {
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

export interface ControlSessionMessageRecord {
  id: string;
  sessionId: string;
  role: MessageRole;
  externalId: string | null;
  content: unknown;
  sequence: number;
  createdAt: string;
}

export interface ControlArtifactRecord {
  id: string;
  sessionId: string;
  type: string;
  name: string;
  uri: string;
  externalId: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface ControlRuntimeAllocationRecord {
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

export type ControlAgentBindingStatus = "active" | "lost" | "archived";

export interface ControlAgentBindingRecord {
  id: string;
  sessionId: string;
  nodeId: string;
  agentId: string;
  userWorkspaceId: string | null;
  workspaceId: string | null;
  cwd: string | null;
  status: ControlAgentBindingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ControlUserDaemonWorkspaceRecord {
  id: string;
  userId: string;
  nodeId: string;
  workspaceDir: string;
  status: "active" | "lost";
  createdAt: string;
  updatedAt: string;
}

export interface ControlFileSnapshotFileRecord {
  path: string;
  contentBase64: string;
  mode: number | null;
}

export interface ControlFileSnapshotRecord {
  id: string;
  userId: string;
  files: ControlFileSnapshotFileRecord[];
  createdAt: string;
}

export interface ControlDaemonNodeRecord {
  id: string;
  ownerUserId: string | null;
  endpoint: string;
  publicEndpoint: string | null;
  status: "online" | "offline" | "draining";
  capabilities: unknown;
  doyaHome: string | null;
  lastHeartbeatAt: string;
  createdAt: string;
}

export interface ControlSchedulerDaemonNodeRecord {
  id: string;
  endpoint: string;
  status: ControlDaemonNodeRecord["status"];
  lastHeartbeatAt: string;
}

export interface ControlRuntimeNodeOptions {
  preference: ControlRuntimeNodePreference;
  nodes: ControlSchedulerDaemonNodeRecord[];
}

export type ControlSettingsRecord = Record<string, never>;

export type ControlPlanId = "free" | "pro";
export type ControlBillingPeriod = "monthly" | "yearly";
export type ControlPaymentProviderType = "alipay" | "wxpay";
export type ControlBillingStatus =
  | "free"
  | "active"
  | "usage_exhausted"
  | "storage_exceeded"
  | "past_due"
  | "disabled";
export type ControlLedgerKind =
  | "monthly_grant"
  | "top_up"
  | "usage_charge"
  | "referral_inviter_reward"
  | "referral_invitee_bonus"
  | "plan_quota_adjustment"
  | "admin_adjustment";
export type ControlReferralStatus =
  | "created"
  | "registered"
  | "qualified"
  | "rewarded"
  | "rejected";

export interface ControlBillingSettingsRecord {
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

export interface ControlPlanRecord {
  id: ControlPlanId;
  name: string;
  priceCny: number;
  monthlyGrantCny: number;
  workspaceBytesLimit: number;
  singleUploadBytesLimit: number;
  enabled: boolean;
}

export interface ControlPaymentOrderRecord {
  id: string;
  userId: string;
  planId: ControlPlanId;
  billingPeriod: ControlBillingPeriod;
  providerType: ControlPaymentProviderType;
  outTradeNo: string;
  providerTradeNo: string | null;
  amountCny: number;
  status: "pending" | "paid" | "failed";
  paymentUrl: string | null;
  qrcode: string | null;
  urlscheme: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
}

export interface ControlModelPricingRecord {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  billingMode: "token";
  inputPriceUsdPerToken: number;
  outputPriceUsdPerToken: number;
  cacheCreationPriceUsdPerToken: number;
  cacheReadPriceUsdPerToken: number;
  supportsUsageAccounting: boolean;
  enabled: boolean;
  source: "manual" | "fallback" | "provider_reported";
  createdAt: string;
  updatedAt: string;
}

export interface ControlModelPricingSnapshot {
  pricingId: string;
  providerId: string;
  modelId: string;
  displayName: string;
  billingMode: "token";
  inputPriceUsdPerToken: number;
  outputPriceUsdPerToken: number;
  cacheCreationPriceUsdPerToken: number;
  cacheReadPriceUsdPerToken: number;
  supportsUsageAccounting: boolean;
  source: "manual" | "fallback" | "provider_reported";
}

export interface ControlBillingAccountRecord {
  id: string;
  userId: string;
  planId: ControlPlanId;
  status: ControlBillingStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  balanceCachedCny: number;
  createdAt: string;
  updatedAt: string;
}

export interface ControlLedgerEntryRecord {
  id: string;
  userId: string;
  accountId: string;
  kind: ControlLedgerKind;
  amountCny: number;
  expiresAt: string | null;
  usageLogId: string | null;
  referralId: string | null;
  note: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface ControlUsageLogRecord {
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
  pricingSnapshot: ControlModelPricingSnapshot;
  status: "charged";
  createdAt: string;
}

export interface ControlStorageQuotaRecord {
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

export interface ControlReferralRecord {
  id: string;
  inviterUserId: string;
  inviteeUserId: string | null;
  code: string;
  status: ControlReferralStatus;
  rejectReason: string | null;
  sourceFingerprint: string | null;
  qualifiedAt: string | null;
  rewardedAt: string | null;
  inviteeBonusLedgerId: string | null;
  inviterRewardLedgerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ControlUsageAggregation {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  baseCostUsd: number;
  markedCostUsd: number;
  actualCostCny: number;
  averageCostCny: number;
}

export interface ControlAdminBillingState {
  overview: {
    settings: ControlBillingSettingsRecord;
    totals: {
      totalRmbCost: number;
      totalUsdCost: number;
      totalTokens: number;
      monthUsageChargeCny: number;
      activePaidUserCount: number;
      exhaustedUserCount: number;
      storageExceededUserCount: number;
      referralRewardTotalCny: number;
    };
  };
  plans: ControlPlanRecord[];
  pricing: ControlModelPricingRecord[];
  users: Array<{
    user: ControlUserRecord;
    account: ControlBillingAccountRecord;
    balanceCny: number;
    storageQuota: ControlStorageQuotaRecord;
  }>;
  usageLogs: ControlUsageLogRecord[];
  ledger: ControlLedgerEntryRecord[];
  storageQuotas: ControlStorageQuotaRecord[];
  referrals: ControlReferralRecord[];
  usage: ControlUsageAggregation;
  usageFilters: ControlUsageFilters;
}

export interface ControlUsageFilters {
  userId?: string;
  sessionId?: string;
  providerId?: string;
  modelId?: string;
  planId?: string;
  startAt?: string;
  endAt?: string;
}

export interface ControlBillingSummary {
  account: ControlBillingAccountRecord;
  plan: ControlPlanRecord;
  plans: ControlPlanRecord[];
  balanceCny: number;
  storageQuota: ControlStorageQuotaRecord;
  ledger: ControlLedgerEntryRecord[];
  usage: ControlUsageAggregation;
  recentUsageLogs: ControlUsageLogRecord[];
  referrals: ControlReferralRecord[];
  referralCode: string;
  referralStats: {
    registeredCount: number;
    qualifiedCount: number;
    rewardedCount: number;
    rewardTotalCny: number;
    monthlyRemainingRewardCount: number;
  };
}

export interface ControlBillingPreflightResult {
  ok: true;
  account: ControlBillingAccountRecord;
  storageQuota: ControlStorageQuotaRecord;
  pricing?: ControlModelPricingRecord;
  balanceCny: number;
}

export interface ControlDaemonNodeSummary {
  node: ControlDaemonNodeRecord;
  userWorkspaceCount: number;
  runtimeCounts: Record<RuntimeStatus, number>;
  activeSessionCount: number;
  agentBindingCounts: Record<ControlAgentBindingStatus, number>;
  load: ControlDaemonLoadResult | ControlDaemonLoadUnavailable;
  userWorkspaces: ControlUserDaemonWorkspaceSummary[];
}

export interface ControlAdminOverview {
  settings: ControlSettingsRecord;
  daemonNodes: ControlDaemonNodeSummary[];
  totals: {
    daemonCount: number;
    userWorkspaceCount: number;
    runtimeCounts: Record<RuntimeStatus, number>;
    activeSessionCount: number;
    agentBindingCounts: Record<ControlAgentBindingStatus, number>;
  };
}

export interface ControlDaemonLoadResult {
  status: "ok";
  nodeId: string;
  sampledAt: string;
  cpu: {
    loadAverage: number[];
  };
  memory: ControlUsageStats;
  disk: ControlUsageStats | null;
  uptimeSeconds: number;
}

export interface ControlDaemonLoadUnavailable {
  status: "unavailable";
  error: string;
}

export interface ControlUsageStats {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedRatio: number;
}

export interface ControlUserDaemonWorkspaceSummary {
  workspace: ControlUserDaemonWorkspaceRecord;
  user: ControlUserRecord | null;
  sessions: ControlAdminSessionSummary[];
}

export interface ControlAdminSessionSummary {
  session: ControlSessionRecord;
  runtimeAllocations: ControlRuntimeAllocationRecord[];
  agentBindings: ControlAgentBindingRecord[];
}

export interface ControlDaemonSessionCleanupResult {
  requestedSessionCount: number;
  matchedSessionCount: number;
  deletedSessionCount: number;
  stoppedRuntimeCount: number;
  archivedBindingCount: number;
  workDirCleanup: {
    deleted: Array<{ sessionId: string; workDir: string; deleted: boolean }>;
    failed: Array<{ sessionId: string; error: string }>;
  };
}

export interface ControlDaemonRestartResult {
  status: "restart_requested";
  nodeId: string;
  requestId: string;
  reason: string;
}

export type ControlDaemonConfig = MutableDaemonConfig;
export type ControlDaemonConfigPatch = MutableDaemonConfigPatch;

export interface ControlRuntimeLease {
  runtime: ControlRuntimeAllocationRecord;
  node: ControlDaemonNodeRecord;
}

export interface ControlAgentBindingResponse {
  binding: ControlAgentBindingRecord | null;
  node: ControlDaemonNodeRecord | null;
}

export interface ControlErrorPayload {
  error?: string;
}

export type ControlApiErrorCode =
  | "control_unconfigured"
  | "network"
  | "unauthorized"
  | "forbidden"
  | "conflict"
  | "invalid_response"
  | "request_failed";

export class ControlApiError extends Error {
  readonly code: ControlApiErrorCode;
  readonly status: number | null;
  readonly rawMessage: string | null;

  constructor(input: {
    code: ControlApiErrorCode;
    message: string;
    status?: number | null;
    rawMessage?: string | null;
  }) {
    super(input.message);
    this.name = "ControlApiError";
    this.code = input.code;
    this.status = input.status ?? null;
    this.rawMessage = input.rawMessage ?? null;
  }
}

type ControlAuthExpiredHandler = () => void | Promise<void>;

let controlAuthExpiredHandler: ControlAuthExpiredHandler | null = null;

export function setControlAuthExpiredHandler(handler: ControlAuthExpiredHandler | null): void {
  controlAuthExpiredHandler = handler;
}

export function controlApiBaseUrl(): string | null {
  const explicit = process.env.EXPO_PUBLIC_CONTROL_API_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  const webHost = getCurrentWebHost();
  if (webHost) {
    if (webHost.protocol === "https:") {
      return `${webHost.origin}/control-api`;
    }
    return `${webHost.protocol}//${webHost.hostname}:6777`;
  }
  return isDev ? "http://localhost:6777" : null;
}

function getCurrentWebHost(): {
  origin: string;
  protocol: "http:" | "https:";
  hostname: string;
} | null {
  if (!isWeb) {
    return null;
  }
  const location = globalThis.location;
  if (!location.hostname || (location.protocol !== "http:" && location.protocol !== "https:")) {
    return null;
  }
  return { origin: location.origin, protocol: location.protocol, hostname: location.hostname };
}

export function isControlApiConfigured(): boolean {
  return Boolean(controlApiBaseUrl());
}

export function mapControlAccountSession(input: ControlAccountSession): AccountBootstrapSession {
  return {
    user: {
      userId: input.user.id,
      email: input.user.email,
      phone: input.user.phone,
    },
    workspace: {
      workspaceId: `control:${input.user.id}`,
      displayName: "Doya",
      runtime: null,
    },
    projects: [],
    accessToken: input.accessToken,
    apiBaseUrl: controlApiBaseUrl() ?? "",
  };
}

export async function registerControlAccount(input: {
  email: string;
  phone?: string | null;
}): Promise<AccountBootstrapSession> {
  const payload = await postControlApi<ControlAccountSession>("/api/account/register", input);
  return mapControlAccountSession(payload);
}

export async function loginControlAccount(input: {
  email: string;
}): Promise<AccountBootstrapSession> {
  const payload = await postControlApi<ControlAccountSession>("/api/account/login", input);
  return mapControlAccountSession(payload);
}

export async function sendControlAccountSmsCode(input: { phone: string }): Promise<void> {
  await postControlApi<{ ok: boolean }>("/api/account/sms/send", input);
}

export async function loginControlAccountWithSms(input: {
  phone: string;
  code: string;
  displayName: string;
}): Promise<AccountBootstrapSession> {
  const payload = await postControlApi<ControlAccountSession>("/api/account/sms/login", input);
  return mapControlAccountSession(payload);
}

export async function refreshControlAccountSession(
  session: AccountBootstrapSession,
): Promise<AccountBootstrapSession> {
  const payload = await getControlApi<ControlAccountSession>("/api/account/session", session);
  return mapControlAccountSession(payload);
}

export async function listControlSessions(input: {
  accountSession: AccountBootstrapSession;
  limit?: number;
}): Promise<ControlSessionRecord[]> {
  const search = input.limit ? `?limit=${encodeURIComponent(String(input.limit))}` : "";
  const payload = await getControlApi<{ sessions: ControlSessionRecord[] }>(
    `/api/sessions${search}`,
    input.accountSession,
  );
  return payload.sessions;
}

export async function createControlSession(input: {
  accountSession: AccountBootstrapSession;
  title: string;
  workingContext: WorkingContext;
}): Promise<ControlSessionRecord> {
  const payload = await postControlApi<{ session: ControlSessionRecord }>(
    "/api/sessions",
    {
      title: input.title,
      workingContext: input.workingContext,
    },
    input.accountSession,
  );
  return payload.session;
}

export async function preflightControlBilling(input: {
  accountSession: AccountBootstrapSession;
  providerId?: string | null;
  modelId?: string | null;
}): Promise<ControlBillingPreflightResult> {
  return await postControlApi<ControlBillingPreflightResult>(
    "/api/billing/preflight",
    {
      providerId: input.providerId || undefined,
      modelId: input.modelId || undefined,
    },
    input.accountSession,
  );
}

export async function getControlSession(input: {
  accountSession: AccountBootstrapSession;
  sessionId: string;
}): Promise<ControlSessionRecord> {
  const payload = await getControlApi<{ session: ControlSessionRecord }>(
    `/api/sessions/${encodeURIComponent(input.sessionId)}`,
    input.accountSession,
  );
  return payload.session;
}

export async function updateControlSession(input: {
  accountSession: AccountBootstrapSession;
  sessionId: string;
  title?: string;
  status?: SessionStatus;
}): Promise<ControlSessionRecord> {
  const body: { title?: string; status?: SessionStatus } = {};
  if (input.title !== undefined) {
    body.title = input.title;
  }
  if (input.status !== undefined) {
    body.status = input.status;
  }
  const payload = await patchControlApi<{ session: ControlSessionRecord }>(
    `/api/sessions/${encodeURIComponent(input.sessionId)}`,
    body,
    input.accountSession,
  );
  return payload.session;
}

export async function deleteControlSession(input: {
  accountSession: AccountBootstrapSession;
  sessionId: string;
}): Promise<void> {
  await deleteControlApi(
    `/api/sessions/${encodeURIComponent(input.sessionId)}`,
    input.accountSession,
  );
}

export async function listControlSessionMessages(input: {
  accountSession: AccountBootstrapSession;
  sessionId: string;
}): Promise<ControlSessionMessageRecord[]> {
  const payload = await getControlApi<{ messages: ControlSessionMessageRecord[] }>(
    `/api/sessions/${encodeURIComponent(input.sessionId)}/messages`,
    input.accountSession,
  );
  return payload.messages;
}

export async function listControlSessionArtifacts(input: {
  accountSession: AccountBootstrapSession;
  sessionId: string;
}): Promise<ControlArtifactRecord[]> {
  const payload = await getControlApi<{ artifacts: ControlArtifactRecord[] }>(
    `/api/sessions/${encodeURIComponent(input.sessionId)}/artifacts`,
    input.accountSession,
  );
  return payload.artifacts;
}

export async function appendControlSessionMessage(input: {
  accountSession: AccountBootstrapSession;
  sessionId: string;
  role: MessageRole;
  externalId?: string | null;
  content: unknown;
}): Promise<ControlSessionMessageRecord> {
  const payload = await postControlApi<{ message: ControlSessionMessageRecord }>(
    `/api/sessions/${encodeURIComponent(input.sessionId)}/messages`,
    {
      role: input.role,
      externalId: input.externalId,
      content: input.content,
    },
    input.accountSession,
  );
  return payload.message;
}

export async function createControlSessionArtifact(input: {
  accountSession: AccountBootstrapSession;
  sessionId: string;
  type: string;
  name: string;
  uri: string;
  externalId?: string | null;
  metadata?: unknown;
}): Promise<ControlArtifactRecord> {
  const payload = await postControlApi<{ artifact: ControlArtifactRecord }>(
    `/api/sessions/${encodeURIComponent(input.sessionId)}/artifacts`,
    {
      type: input.type,
      name: input.name,
      uri: input.uri,
      externalId: input.externalId,
      metadata: input.metadata,
    },
    input.accountSession,
  );
  return payload.artifact;
}

export async function createControlFileSnapshot(input: {
  accountSession: AccountBootstrapSession;
  files: Array<{
    path: string;
    contentBase64: string;
    mode?: number | null;
  }>;
}): Promise<ControlFileSnapshotRecord> {
  const payload = await postControlApi<{ snapshot: ControlFileSnapshotRecord }>(
    "/api/file-snapshots",
    {
      files: input.files,
    },
    input.accountSession,
  );
  return payload.snapshot;
}

export async function getControlFileSnapshot(input: {
  accountSession: AccountBootstrapSession;
  snapshotId: string;
}): Promise<ControlFileSnapshotRecord> {
  const payload = await getControlApi<{ snapshot: ControlFileSnapshotRecord }>(
    `/api/file-snapshots/${encodeURIComponent(input.snapshotId)}`,
    input.accountSession,
  );
  return payload.snapshot;
}

export async function registerControlNode(input: {
  accountSession: AccountBootstrapSession;
  nodeId?: string;
  endpoint: string;
  capabilities?: unknown;
  runtimeAuthToken?: string | null;
  status?: ControlDaemonNodeRecord["status"];
  doyaHome?: string | null;
}): Promise<ControlDaemonNodeRecord> {
  const payload = await postControlApi<{ node: ControlDaemonNodeRecord }>(
    "/api/nodes/register",
    {
      nodeId: input.nodeId,
      endpoint: input.endpoint,
      capabilities: input.capabilities,
      runtimeAuthToken: input.runtimeAuthToken,
      status: input.status,
      doyaHome: input.doyaHome,
    },
    input.accountSession,
  );
  return payload.node;
}

export async function getControlAdminOverview(input: {
  accountSession?: AccountBootstrapSession | null;
}): Promise<ControlAdminOverview> {
  return await getControlApi<ControlAdminOverview>(
    "/api/admin/daemon-overview",
    input.accountSession ?? undefined,
  );
}

export async function selectControlRuntimeNode(input: {
  accountSession?: AccountBootstrapSession | null;
  nodeId?: string | null;
  providerId?: string | null;
  modelId?: string | null;
}): Promise<{ node: ControlSchedulerDaemonNodeRecord; selectionReason: string }> {
  return await postControlApi<{ node: ControlSchedulerDaemonNodeRecord; selectionReason: string }>(
    "/api/scheduler/runtime-node",
    {
      nodeId: input.nodeId,
      providerId: input.providerId,
      modelId: input.modelId,
    },
    input.accountSession ?? undefined,
  );
}

export async function getControlRuntimeNodePreference(input: {
  accountSession: AccountBootstrapSession;
}): Promise<ControlRuntimeNodePreference> {
  const payload = await getControlApi<{ preference: ControlRuntimeNodePreference }>(
    "/api/scheduler/runtime-node-preference",
    input.accountSession,
  );
  return payload.preference;
}

export async function getControlRuntimeNodeOptions(input: {
  accountSession: AccountBootstrapSession;
}): Promise<ControlRuntimeNodeOptions> {
  return await getControlApi<ControlRuntimeNodeOptions>(
    "/api/scheduler/runtime-node-options",
    input.accountSession,
  );
}

export async function updateControlRuntimeNodePreference(input: {
  accountSession: AccountBootstrapSession;
  preference: { mode: "cloud" } | { mode: "fixed"; nodeId: string };
}): Promise<ControlRuntimeNodePreference> {
  const payload = await patchControlApi<{ preference: ControlRuntimeNodePreference }>(
    "/api/scheduler/runtime-node-preference",
    input.preference,
    input.accountSession,
  );
  return payload.preference;
}

export async function updateControlDaemonNode(input: {
  accountSession: AccountBootstrapSession;
  nodeId: string;
  status: ControlDaemonNodeRecord["status"];
}): Promise<ControlDaemonNodeRecord> {
  const payload = await patchControlApi<{ node: ControlDaemonNodeRecord }>(
    `/api/admin/nodes/${encodeURIComponent(input.nodeId)}`,
    { status: input.status },
    input.accountSession,
  );
  return payload.node;
}

export async function removeControlDaemonNode(input: {
  accountSession: AccountBootstrapSession;
  nodeId: string;
}): Promise<void> {
  await deleteControlApi(
    `/api/admin/nodes/${encodeURIComponent(input.nodeId)}`,
    input.accountSession,
  );
}

export async function restartControlDaemonNode(input: {
  accountSession: AccountBootstrapSession;
  nodeId: string;
}): Promise<ControlDaemonRestartResult> {
  const payload = await postControlApi<{ restart: ControlDaemonRestartResult }>(
    `/api/admin/nodes/${encodeURIComponent(input.nodeId)}/restart`,
    {},
    input.accountSession,
  );
  return payload.restart;
}

export async function getControlDaemonConfig(input: {
  accountSession: AccountBootstrapSession;
  nodeId: string;
}): Promise<ControlDaemonConfig> {
  const payload = await getControlApi<{ config: ControlDaemonConfig }>(
    `/api/admin/nodes/${encodeURIComponent(input.nodeId)}/config`,
    input.accountSession,
  );
  return payload.config;
}

export async function patchControlDaemonConfig(input: {
  accountSession: AccountBootstrapSession;
  nodeId: string;
  patch: ControlDaemonConfigPatch;
}): Promise<ControlDaemonConfig> {
  const payload = await patchControlApi<{ config: ControlDaemonConfig }>(
    `/api/admin/nodes/${encodeURIComponent(input.nodeId)}/config`,
    input.patch,
    input.accountSession,
  );
  return payload.config;
}

export async function cleanupControlDaemonSessions(input: {
  accountSession: AccountBootstrapSession;
  nodeId: string;
  sessionIds: string[];
  deleteSessions: boolean;
  deleteWorkDirs: boolean;
}): Promise<ControlDaemonSessionCleanupResult> {
  const payload = await postControlApi<{ cleanup: ControlDaemonSessionCleanupResult }>(
    `/api/admin/nodes/${encodeURIComponent(input.nodeId)}/cleanup-sessions`,
    {
      sessionIds: input.sessionIds,
      deleteSessions: input.deleteSessions,
      deleteWorkDirs: input.deleteWorkDirs,
    },
    input.accountSession,
  );
  return payload.cleanup;
}

export async function getActiveControlRuntime(input: {
  accountSession: AccountBootstrapSession;
  sessionId: string;
}): Promise<ControlRuntimeAllocationRecord | null> {
  const payload = await getControlApi<{ runtime: ControlRuntimeAllocationRecord | null }>(
    `/api/sessions/${encodeURIComponent(input.sessionId)}/runtimes/active`,
    input.accountSession,
  );
  return payload.runtime;
}

export async function createControlRuntimeAllocation(input: {
  accountSession: AccountBootstrapSession;
  sessionId: string;
  nodeId: string;
  runtimeId: string;
  providerId?: string | null;
  modelId?: string | null;
  selectionReason?: string | null;
  userWorkspaceId?: string | null;
  workspaceDir: string;
  status?: RuntimeStatus;
}): Promise<ControlRuntimeAllocationRecord> {
  const payload = await postControlApi<{ runtime: ControlRuntimeAllocationRecord }>(
    `/api/sessions/${encodeURIComponent(input.sessionId)}/runtimes`,
    {
      nodeId: input.nodeId,
      runtimeId: input.runtimeId,
      providerId: input.providerId,
      modelId: input.modelId,
      selectionReason: input.selectionReason,
      userWorkspaceId: input.userWorkspaceId,
      workspaceDir: input.workspaceDir,
      status: input.status,
    },
    input.accountSession,
  );
  return payload.runtime;
}

export async function allocateControlSessionWorkDir(input: {
  accountSession: AccountBootstrapSession;
  sessionId: string;
  nodeId: string;
  runtimeId?: string;
  providerId?: string | null;
  modelId?: string | null;
  selectionReason?: string | null;
}): Promise<{
  runtime: ControlRuntimeAllocationRecord;
  userWorkspace: ControlUserDaemonWorkspaceRecord;
}> {
  return await postControlApi<{
    runtime: ControlRuntimeAllocationRecord;
    userWorkspace: ControlUserDaemonWorkspaceRecord;
  }>(
    `/api/sessions/${encodeURIComponent(input.sessionId)}/workdir`,
    {
      nodeId: input.nodeId,
      runtimeId: input.runtimeId,
      providerId: input.providerId,
      modelId: input.modelId,
      selectionReason: input.selectionReason,
    },
    input.accountSession,
  );
}

export async function getControlUserDaemonWorkspace(input: {
  accountSession: AccountBootstrapSession;
  nodeId: string;
}): Promise<ControlUserDaemonWorkspaceRecord | null> {
  const payload = await getControlApi<{ workspace: ControlUserDaemonWorkspaceRecord | null }>(
    `/api/nodes/${encodeURIComponent(input.nodeId)}/user-workspace`,
    input.accountSession,
  );
  return payload.workspace;
}

export async function ensureControlUserDaemonWorkspace(input: {
  accountSession: AccountBootstrapSession;
  nodeId: string;
}): Promise<ControlUserDaemonWorkspaceRecord> {
  const payload = await postControlApi<{ workspace: ControlUserDaemonWorkspaceRecord }>(
    `/api/nodes/${encodeURIComponent(input.nodeId)}/user-workspace/ensure`,
    {},
    input.accountSession,
  );
  return payload.workspace;
}

export async function upsertControlUserDaemonWorkspace(input: {
  accountSession: AccountBootstrapSession;
  nodeId: string;
  workspaceDir: string;
  status?: ControlUserDaemonWorkspaceRecord["status"];
}): Promise<ControlUserDaemonWorkspaceRecord> {
  const payload = await postControlApi<{ workspace: ControlUserDaemonWorkspaceRecord }>(
    `/api/nodes/${encodeURIComponent(input.nodeId)}/user-workspace`,
    {
      workspaceDir: input.workspaceDir,
      status: input.status,
    },
    input.accountSession,
  );
  return payload.workspace;
}

export async function getControlAgentBinding(input: {
  accountSession: AccountBootstrapSession;
  sessionId: string;
}): Promise<ControlAgentBindingResponse> {
  return await getControlApi<ControlAgentBindingResponse>(
    `/api/sessions/${encodeURIComponent(input.sessionId)}/agent-binding`,
    input.accountSession,
  );
}

export async function upsertControlAgentBinding(input: {
  accountSession: AccountBootstrapSession;
  sessionId: string;
  nodeId: string;
  agentId: string;
  userWorkspaceId?: string | null;
  workspaceId?: string | null;
  cwd?: string | null;
  status?: ControlAgentBindingStatus;
}): Promise<ControlAgentBindingResponse> {
  return await postControlApi<ControlAgentBindingResponse>(
    `/api/sessions/${encodeURIComponent(input.sessionId)}/agent-binding`,
    {
      nodeId: input.nodeId,
      agentId: input.agentId,
      userWorkspaceId: input.userWorkspaceId,
      workspaceId: input.workspaceId,
      cwd: input.cwd,
      status: input.status,
    },
    input.accountSession,
  );
}

export async function getControlAdminBillingState(input: {
  accountSession: AccountBootstrapSession;
  filters?: ControlUsageFilters;
}): Promise<ControlAdminBillingState> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(input.filters ?? {})) {
    if (typeof value === "string" && value.trim()) {
      search.set(key, value.trim());
    }
  }
  const query = search.toString();
  return await getControlApi<ControlAdminBillingState>(
    query ? `/api/admin/billing?${query}` : "/api/admin/billing",
    input.accountSession,
  );
}

export async function getControlBillingSummary(input: {
  accountSession: AccountBootstrapSession;
}): Promise<ControlBillingSummary> {
  return await getControlApi<ControlBillingSummary>("/api/billing/summary", input.accountSession);
}

export async function getControlBillingPricing(input: {
  accountSession: AccountBootstrapSession;
}): Promise<ControlModelPricingRecord[]> {
  const payload = await getControlApi<{ pricing: ControlModelPricingRecord[] }>(
    "/api/billing/pricing",
    input.accountSession,
  );
  return payload.pricing;
}

export async function getControlManagedCodexConfig(input: {
  accountSession: AccountBootstrapSession;
}): Promise<ControlManagedCodexConfig> {
  const payload = await getControlApi<{ codex: ControlManagedCodexConfig }>(
    "/api/providers/managed-codex",
    input.accountSession,
  );
  return payload.codex;
}

export async function createControlBillingPayment(input: {
  accountSession: AccountBootstrapSession;
  planId: "pro";
  billingPeriod: ControlBillingPeriod;
  providerType: ControlPaymentProviderType;
}): Promise<ControlPaymentOrderRecord> {
  const payload = await postControlApi<{ order: ControlPaymentOrderRecord }>(
    "/api/billing/payments",
    {
      planId: input.planId,
      billingPeriod: input.billingPeriod,
      providerType: input.providerType,
    },
    input.accountSession,
  );
  return payload.order;
}

export async function bindControlReferralCode(input: {
  accountSession: AccountBootstrapSession;
  code: string;
  clientId?: string | null;
}): Promise<ControlReferralRecord> {
  const payload = await postControlApi<{ referral: ControlReferralRecord }>(
    "/api/billing/referrals/bind",
    { code: input.code, clientId: input.clientId },
    input.accountSession,
  );
  return payload.referral;
}

export async function upsertControlModelPricing(input: {
  accountSession: AccountBootstrapSession;
  pricing: {
    id?: string;
    providerId: string;
    modelId: string;
    displayName: string;
    inputPriceUsdPerToken: number;
    outputPriceUsdPerToken: number;
    cacheCreationPriceUsdPerToken: number;
    cacheReadPriceUsdPerToken: number;
    supportsUsageAccounting?: boolean;
    enabled?: boolean;
    source?: ControlModelPricingRecord["source"];
  };
}): Promise<ControlModelPricingRecord> {
  const payload = await postControlApi<{ pricing: ControlModelPricingRecord }>(
    "/api/admin/billing/pricing",
    input.pricing,
    input.accountSession,
  );
  return payload.pricing;
}

export async function rescanControlBillingStorage(input: {
  accountSession: AccountBootstrapSession;
}): Promise<ControlStorageQuotaRecord> {
  const payload = await postControlApi<{ storageQuota: ControlStorageQuotaRecord }>(
    "/api/billing/storage/rescan",
    {},
    input.accountSession,
  );
  return payload.storageQuota;
}

export async function rescanControlAdminBillingStorage(input: {
  accountSession: AccountBootstrapSession;
  userId: string;
}): Promise<ControlStorageQuotaRecord> {
  const payload = await postControlApi<{ storageQuota: ControlStorageQuotaRecord }>(
    "/api/admin/billing/storage/rescan",
    { userId: input.userId },
    input.accountSession,
  );
  return payload.storageQuota;
}

export async function updateControlBillingSettings(input: {
  accountSession: AccountBootstrapSession;
  settings: Partial<
    Pick<
      ControlBillingSettingsRecord,
      | "usdToCnyRate"
      | "tokenMarkupMultiplier"
      | "freeMonthlyGrantCny"
      | "proMonthlyGrantCny"
      | "referralInviteeBonusCny"
      | "referralInviterRewardCny"
      | "referralMonthlyRewardLimit"
      | "referralDailyRewardLimit"
      | "referralRewardExpiresDays"
    >
  >;
}): Promise<ControlBillingSettingsRecord> {
  const payload = await patchControlApi<{ settings: ControlBillingSettingsRecord }>(
    "/api/admin/billing/settings",
    input.settings,
    input.accountSession,
  );
  return payload.settings;
}

export async function updateControlBillingPlanDefinition(input: {
  accountSession: AccountBootstrapSession;
  plan: Pick<
    ControlPlanRecord,
    | "id"
    | "priceCny"
    | "monthlyGrantCny"
    | "workspaceBytesLimit"
    | "singleUploadBytesLimit"
    | "enabled"
  >;
}): Promise<ControlPlanRecord> {
  const payload = await patchControlApi<{ plan: ControlPlanRecord }>(
    "/api/admin/billing/plans",
    {
      planId: input.plan.id,
      priceCny: input.plan.priceCny,
      monthlyGrantCny: input.plan.monthlyGrantCny,
      workspaceBytesLimit: input.plan.workspaceBytesLimit,
      singleUploadBytesLimit: input.plan.singleUploadBytesLimit,
      enabled: input.plan.enabled,
    },
    input.accountSession,
  );
  return payload.plan;
}

export async function createControlAdminAdjustment(input: {
  accountSession: AccountBootstrapSession;
  userId: string;
  amountCny: number;
  note?: string | null;
}): Promise<{ ledgerEntry: ControlLedgerEntryRecord; balanceCny: number }> {
  return await postControlApi<{ ledgerEntry: ControlLedgerEntryRecord; balanceCny: number }>(
    "/api/admin/billing/adjustments",
    {
      userId: input.userId,
      amountCny: input.amountCny,
      note: input.note,
    },
    input.accountSession,
  );
}

export async function createControlAdminTopUp(input: {
  accountSession: AccountBootstrapSession;
  userId: string;
  amountCny: number;
  note?: string | null;
}): Promise<{ ledgerEntry: ControlLedgerEntryRecord; balanceCny: number }> {
  return await postControlApi<{ ledgerEntry: ControlLedgerEntryRecord; balanceCny: number }>(
    "/api/admin/billing/top-ups",
    {
      userId: input.userId,
      amountCny: input.amountCny,
      note: input.note,
    },
    input.accountSession,
  );
}

export async function updateControlBillingPlan(input: {
  accountSession: AccountBootstrapSession;
  userId: string;
  planId: ControlPlanId;
}): Promise<{
  account: ControlBillingAccountRecord;
  ledgerEntry: ControlLedgerEntryRecord | null;
  balanceCny: number;
}> {
  return await patchControlApi<{
    account: ControlBillingAccountRecord;
    ledgerEntry: ControlLedgerEntryRecord | null;
    balanceCny: number;
  }>(
    "/api/admin/billing/users/plan",
    { userId: input.userId, planId: input.planId },
    input.accountSession,
  );
}

export async function updateControlStorageQuota(input: {
  accountSession: AccountBootstrapSession;
  userId: string;
  uploadedBytesUsed?: number;
  generatedBytesUsed?: number;
  temporaryWorkspaceBytesLimit?: number | null;
}): Promise<ControlStorageQuotaRecord> {
  const payload = await patchControlApi<{ storageQuota: ControlStorageQuotaRecord }>(
    "/api/admin/billing/storage",
    {
      userId: input.userId,
      uploadedBytesUsed: input.uploadedBytesUsed,
      generatedBytesUsed: input.generatedBytesUsed,
      temporaryWorkspaceBytesLimit: input.temporaryWorkspaceBytesLimit,
    },
    input.accountSession,
  );
  return payload.storageQuota;
}

export async function updateControlReferral(input: {
  accountSession: AccountBootstrapSession;
  referralId: string;
  status: ControlReferralStatus;
  rejectReason?: string | null;
}): Promise<ControlReferralRecord> {
  const payload = await patchControlApi<{ referral: ControlReferralRecord }>(
    `/api/admin/billing/referrals/${encodeURIComponent(input.referralId)}`,
    {
      status: input.status,
      rejectReason: input.rejectReason,
    },
    input.accountSession,
  );
  return payload.referral;
}

async function getControlApi<T extends object>(
  path: string,
  accountSession?: AccountBootstrapSession,
): Promise<T> {
  return requestControlApi<T>(path, {
    method: "GET",
    accountSession,
  });
}

async function postControlApi<T extends object>(
  path: string,
  input: unknown,
  accountSession?: AccountBootstrapSession,
): Promise<T> {
  return requestControlApi<T>(path, {
    method: "POST",
    body: input,
    accountSession,
  });
}

async function patchControlApi<T extends object>(
  path: string,
  input: unknown,
  accountSession: AccountBootstrapSession,
): Promise<T> {
  return requestControlApi<T>(path, {
    method: "PATCH",
    body: input,
    accountSession,
  });
}

async function deleteControlApi(
  path: string,
  accountSession: AccountBootstrapSession,
): Promise<void> {
  await requestControlApi<Record<string, never>>(path, {
    method: "DELETE",
    accountSession,
  });
}

interface RequestControlApiOptions {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  accountSession?: AccountBootstrapSession;
}

async function requestControlApi<T extends object>(
  path: string,
  options: RequestControlApiOptions,
): Promise<T> {
  const baseUrl = controlApiBaseUrl();
  if (!baseUrl) {
    throw new ControlApiError({
      code: "control_unconfigured",
      message: translateNow("control.error.unconfigured"),
    });
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: {
        "Content-Type": "application/json",
        ...(options.accountSession
          ? {
              Authorization: `Bearer ${options.accountSession.accessToken}`,
              "X-Doya-User-Id": options.accountSession.user.userId,
            }
          : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new ControlApiError({
      code: "network",
      message: translateNow("control.error.connectControl"),
    });
  }

  if (response.status === 204) {
    if (!response.ok) {
      await throwControlResponseError({
        response,
        payload: null,
        accountSession: options.accountSession,
      });
    }
    return {} as T;
  }

  let payload: T | ControlErrorPayload;
  try {
    payload = (await response.json()) as T | ControlErrorPayload;
  } catch {
    if (!response.ok) {
      await throwControlResponseError({
        response,
        payload: null,
        accountSession: options.accountSession,
      });
    }
    throw new ControlApiError({
      code: "invalid_response",
      status: response.status,
      message: translateNow("control.error.invalidResponse"),
    });
  }

  if (!response.ok) {
    await throwControlResponseError({
      response,
      payload,
      accountSession: options.accountSession,
    });
  }
  return payload as T;
}

async function throwControlResponseError(input: {
  response: Response;
  payload: ControlErrorPayload | null;
  accountSession?: AccountBootstrapSession;
}): Promise<never> {
  const rawMessage = input.payload?.error?.trim() || null;
  if (rawMessage) {
    const billingReason = getBillingUpgradeReason(rawMessage);
    if (billingReason) {
      useBillingUpgradeModalStore.getState().open(billingReason);
    }
  }
  if (input.response.status === 401 && input.accountSession) {
    try {
      await controlAuthExpiredHandler?.();
    } catch {
      // Keep the original API failure as the user-facing error.
    }
  }
  throw new ControlApiError({
    code: resolveControlApiErrorCode(input.response.status),
    status: input.response.status,
    rawMessage,
    message: resolveControlApiErrorMessage({
      status: input.response.status,
      rawMessage,
    }),
  });
}

function resolveControlApiErrorCode(status: number): ControlApiErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 409) return "conflict";
  return "request_failed";
}

function resolveControlApiErrorMessage(input: {
  status: number;
  rawMessage: string | null;
}): string {
  if (input.status === 401) return translateNow("control.error.unauthorized");
  if (input.status === 403) return translateNow("control.error.forbidden");
  if (input.rawMessage) {
    return translateBillingError(input.rawMessage) ?? input.rawMessage;
  }
  if (input.status === 409) return translateNow("control.error.conflict");
  return translateNow("control.error.requestFailed", { status: input.status });
}

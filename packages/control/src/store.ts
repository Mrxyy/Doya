import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AccountSession,
  ArtifactRecord,
  BillingAccountRecord,
  BillingSettingsRecord,
  BillingStatus,
  CreditLedgerEntryRecord,
  CreditLedgerKind,
  ControlSettingsRecord,
  DaemonNodeRecord,
  FileSnapshotFileRecord,
  FileSnapshotRecord,
  MessageRole,
  ModelPricingRecord,
  NodeStatus,
  PaymentOrderRecord,
  PaymentProviderType,
  PlanId,
  PlanRecord,
  ReferralRecord,
  RuntimeAllocationRecord,
  RuntimeStatus,
  SessionAgentBindingRecord,
  SessionAgentBindingStatus,
  SessionMessageRecord,
  SessionRecord,
  SessionStatus,
  StorageQuotaRecord,
  UsageLogRecord,
  UserDaemonWorkspaceRecord,
  UserRecord,
  WorkingContext,
} from "./domain.js";
import {
  aggregateUsageLogs,
  buildUsageRequestFingerprint,
  calculateUsageCost,
  createPricingSnapshot,
  DEFAULT_BILLING_SETTINGS,
  DEFAULT_MODEL_PRICING,
  DEFAULT_PLANS,
  MIN_PAYMENT_AMOUNT_CNY,
  getPlan,
  normalizeUsageTokens,
  resolveModelPricing,
  type UsageAggregation,
  type UsageAggregationFilters,
  type UsageTokenInput,
} from "./billing.js";
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
  billingSettings: BillingSettingsRecord;
  plans: PlanRecord[];
  modelPricing: ModelPricingRecord[];
  billingAccounts: BillingAccountRecord[];
  creditLedger: CreditLedgerEntryRecord[];
  usageLogs: UsageLogRecord[];
  storageQuotas: StorageQuotaRecord[];
  referrals: ReferralRecord[];
  paymentOrders: PaymentOrderRecord[];
}

const EMPTY_SNAPSHOT: ControlSnapshot = {
  settings: {},
  users: [],
  sessions: [],
  sessionMessages: [],
  artifacts: [],
  fileSnapshots: [],
  daemonNodes: [],
  userDaemonWorkspaces: [],
  runtimeAllocations: [],
  agentBindings: [],
  billingSettings: DEFAULT_BILLING_SETTINGS,
  plans: DEFAULT_PLANS,
  modelPricing: [],
  billingAccounts: [],
  creditLedger: [],
  usageLogs: [],
  storageQuotas: [],
  referrals: [],
  paymentOrders: [],
};

export class NotFoundError extends Error {}
export class BillingPreflightError extends Error {}
export class UsageBillingConflictError extends Error {}
export class PricingUnavailableError extends Error {}
export class StorageQuotaExceededError extends Error {}
export class ReferralConflictError extends Error {}
export class NodeSchedulingUnavailableError extends Error {}

export interface BillingPreflightResult {
  ok: true;
  account: BillingAccountRecord;
  storageQuota: StorageQuotaRecord;
  pricing?: ModelPricingRecord;
  balanceCny: number;
}

export interface RecordUsageTurnInput {
  userId: string;
  sessionId: string;
  runtimeId: string;
  nodeId?: string | null;
  agentId: string;
  providerId: string;
  modelId: string;
  turnId: string;
  requestId?: string;
  requestFingerprint?: string;
  tokens: UsageTokenInput;
}

export interface RecordUsageTurnResult {
  applied: boolean;
  usageLog: UsageLogRecord;
  ledgerEntry: CreditLedgerEntryRecord | null;
  balanceCny: number;
}

export interface AdminBillingOverview {
  settings: BillingSettingsRecord;
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
}

export interface AdminBillingState {
  overview: AdminBillingOverview;
  plans: PlanRecord[];
  pricing: ModelPricingRecord[];
  users: Array<{
    user: UserRecord;
    account: BillingAccountRecord;
    balanceCny: number;
    storageQuota: StorageQuotaRecord;
  }>;
  usageLogs: UsageLogRecord[];
  ledger: CreditLedgerEntryRecord[];
  storageQuotas: StorageQuotaRecord[];
  referrals: ReferralRecord[];
  usage: UsageAggregation;
  usageFilters: UsageAggregationFilters;
}

export interface AdminDaemonNodeSummary {
  node: Omit<DaemonNodeRecord, "runtimeAuthToken">;
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
    this.ensureBillingAccountForUser(user.id);
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

  async getBillingAccount(input: { userId: string }): Promise<BillingAccountRecord> {
    await this.load();
    this.requireExistingUser(input.userId);
    return this.ensureBillingAccountForUser(input.userId);
  }

  async getBillingSummary(input: { userId: string }): Promise<{
    account: BillingAccountRecord;
    plan: PlanRecord;
    plans: PlanRecord[];
    balanceCny: number;
    storageQuota: StorageQuotaRecord;
    ledger: CreditLedgerEntryRecord[];
    usage: UsageAggregation;
    recentUsageLogs: UsageLogRecord[];
    referrals: ReferralRecord[];
    referralCode: string;
    referralStats: {
      registeredCount: number;
      qualifiedCount: number;
      rewardedCount: number;
      rewardTotalCny: number;
      monthlyRemainingRewardCount: number;
    };
  }> {
    await this.load();
    const account = this.ensureBillingAccountForUser(input.userId);
    const plan = getPlan(this.snapshot.plans, account.planId);
    const balanceCny = this.calculateUserBalanceCny(input.userId);
    const storageQuota = this.ensureStorageQuotaForUser(input.userId);
    return {
      account: { ...account, balanceCachedCny: balanceCny },
      plan,
      plans: this.snapshot.plans,
      balanceCny,
      storageQuota,
      ledger: this.snapshot.creditLedger
        .filter((entry) => entry.userId === input.userId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      usage: this.aggregateUsage({ userId: input.userId }),
      recentUsageLogs: this.snapshot.usageLogs
        .filter((log) => log.userId === input.userId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 50),
      referrals: this.snapshot.referrals
        .filter(
          (referral) =>
            referral.inviterUserId === input.userId || referral.inviteeUserId === input.userId,
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      referralCode: buildReferralCode(input.userId),
      referralStats: this.getReferralStats(input.userId),
    };
  }

  async preflightBilling(input: {
    userId: string;
    providerId?: string | null;
    modelId?: string | null;
  }): Promise<BillingPreflightResult> {
    await this.load();
    this.requireExistingUser(input.userId);
    const account = this.ensureBillingAccountForUser(input.userId);
    if (account.status === "disabled" || account.status === "past_due") {
      throw new BillingPreflightError("Billing account is not active.");
    }
    const balanceCny = this.calculateUserBalanceCny(input.userId);
    if (balanceCny <= 0) {
      this.updateBillingAccountStatus(input.userId, "usage_exhausted");
      throw new BillingPreflightError("AI usage balance is exhausted.");
    }
    const storageQuota = this.ensureStorageQuotaForUser(input.userId);
    if (storageQuota.workspaceBytesUsed > storageQuota.workspaceBytesLimit) {
      this.updateBillingAccountStatus(input.userId, "storage_exceeded");
      throw new BillingPreflightError("Workspace storage limit is exceeded.");
    }
    if (!input.providerId || !input.modelId) {
      return { ok: true, account, storageQuota, balanceCny };
    }
    const pricing = resolveModelPricing({
      pricing: this.snapshot.modelPricing,
      providerId: input.providerId,
      modelId: input.modelId,
    });
    if (!pricing) {
      throw new PricingUnavailableError("Enabled model pricing is required before billing.");
    }
    if (!pricing.supportsUsageAccounting) {
      throw new BillingPreflightError("Provider/model does not support real usage accounting.");
    }
    return { ok: true, account, storageQuota, pricing, balanceCny };
  }

  async recordUsageTurn(input: RecordUsageTurnInput): Promise<RecordUsageTurnResult> {
    await this.load();
    this.requireExistingUser(input.userId);
    await this.getSession({ sessionId: input.sessionId, userId: input.userId });
    const requestId =
      input.requestId?.trim() || `${input.runtimeId}:${input.agentId}:${input.turnId}`;
    const existing = this.snapshot.usageLogs.find((log) => log.requestId === requestId);
    const providedFingerprint = input.requestFingerprint?.trim();
    if (existing && providedFingerprint) {
      if (existing.requestFingerprint !== providedFingerprint) {
        throw new UsageBillingConflictError("Usage billing request fingerprint conflict.");
      }
      return {
        applied: false,
        usageLog: existing,
        ledgerEntry: null,
        balanceCny: this.calculateUserBalanceCny(input.userId),
      };
    }
    const pricing = resolveModelPricing({
      pricing: this.snapshot.modelPricing,
      providerId: input.providerId,
      modelId: input.modelId,
    });
    if (!pricing) {
      throw new PricingUnavailableError("Enabled model pricing is required before billing.");
    }
    if (!pricing.supportsUsageAccounting) {
      throw new BillingPreflightError("Provider/model does not support real usage accounting.");
    }
    const pricingSnapshot = createPricingSnapshot(pricing);
    const tokens = normalizeUsageTokens(input.tokens);
    const cost = calculateUsageCost({
      tokens,
      pricing: pricingSnapshot,
      settings: this.snapshot.billingSettings,
    });
    const requestFingerprint =
      providedFingerprint ||
      buildUsageRequestFingerprint({
        userId: input.userId,
        sessionId: input.sessionId,
        runtimeId: input.runtimeId,
        agentId: input.agentId,
        providerId: input.providerId,
        modelId: input.modelId,
        turnId: input.turnId,
        tokens,
        cost,
        pricingSnapshot,
      });
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new UsageBillingConflictError("Usage billing request fingerprint conflict.");
      }
      return {
        applied: false,
        usageLog: existing,
        ledgerEntry: null,
        balanceCny: this.calculateUserBalanceCny(input.userId),
      };
    }
    const timestamp = this.timestamp();
    const usageLog: UsageLogRecord = {
      id: createId("ulg"),
      userId: input.userId,
      sessionId: input.sessionId,
      runtimeId: input.runtimeId,
      nodeId: input.nodeId ?? null,
      agentId: input.agentId,
      providerId: input.providerId,
      modelId: input.modelId,
      turnId: input.turnId,
      requestId,
      requestFingerprint,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      cacheCreationTokens: tokens.cacheCreationTokens,
      cacheReadTokens: tokens.cacheReadTokens,
      reasoningTokens: tokens.reasoningTokens,
      contextWindowUsedTokens: tokens.contextWindowUsedTokens,
      contextWindowMaxTokens: tokens.contextWindowMaxTokens,
      ...cost,
      usdToCnyRate: this.snapshot.billingSettings.usdToCnyRate,
      tokenMarkupMultiplier: this.snapshot.billingSettings.tokenMarkupMultiplier,
      pricingSnapshot,
      status: "charged",
      createdAt: timestamp,
    };
    this.snapshot.usageLogs = [...this.snapshot.usageLogs, usageLog];
    const account = this.ensureBillingAccountForUser(input.userId);
    const ledgerEntry: CreditLedgerEntryRecord = {
      id: createId("led"),
      userId: input.userId,
      accountId: account.id,
      kind: "usage_charge",
      amountCny: -usageLog.actualCostCny,
      expiresAt: null,
      usageLogId: usageLog.id,
      referralId: null,
      note: null,
      metadata: {
        requestId,
        providerId: input.providerId,
        modelId: input.modelId,
      },
      createdAt: timestamp,
    };
    this.snapshot.creditLedger = [...this.snapshot.creditLedger, ledgerEntry];
    const balanceCny = this.refreshBillingBalance(input.userId);
    if (balanceCny <= 0) {
      this.updateBillingAccountStatus(input.userId, "usage_exhausted");
    }
    this.qualifyReferralForUser(input.userId);
    await this.enqueuePersist();
    return { applied: true, usageLog, ledgerEntry, balanceCny };
  }

  async upsertModelPricing(input: {
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
    source?: ModelPricingRecord["source"];
  }): Promise<ModelPricingRecord> {
    await this.load();
    const timestamp = this.timestamp();
    const existing = input.id
      ? this.snapshot.modelPricing.find((entry) => entry.id === input.id)
      : this.snapshot.modelPricing.find(
          (entry) => entry.providerId === input.providerId && entry.modelId === input.modelId,
        );
    const pricing: ModelPricingRecord = {
      id: existing?.id ?? createId("mpr"),
      providerId: input.providerId,
      modelId: input.modelId,
      displayName: input.displayName,
      billingMode: "token",
      inputPriceUsdPerToken: input.inputPriceUsdPerToken,
      outputPriceUsdPerToken: input.outputPriceUsdPerToken,
      cacheCreationPriceUsdPerToken: input.cacheCreationPriceUsdPerToken,
      cacheReadPriceUsdPerToken: input.cacheReadPriceUsdPerToken,
      supportsUsageAccounting:
        input.supportsUsageAccounting ?? existing?.supportsUsageAccounting ?? true,
      enabled: input.enabled ?? existing?.enabled ?? true,
      source: input.source ?? existing?.source ?? "manual",
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    this.snapshot.modelPricing = upsertById(
      this.snapshot.modelPricing,
      pricing,
      (entry) => entry.id,
    );
    await this.enqueuePersist();
    return pricing;
  }

  async listModelPricing(): Promise<ModelPricingRecord[]> {
    await this.load();
    this.snapshot.modelPricing = mergeDefaultModelPricing(this.snapshot.modelPricing);
    return [...this.snapshot.modelPricing].sort((left, right) =>
      `${left.providerId}:${left.modelId}`.localeCompare(`${right.providerId}:${right.modelId}`),
    );
  }

  async getAdminBillingOverview(): Promise<AdminBillingOverview> {
    await this.load();
    const monthStart = startOfUtcMonth(this.now()).toISOString();
    const usage = this.aggregateUsage({});
    const monthUsageChargeCny = this.snapshot.creditLedger
      .filter((entry) => entry.kind === "usage_charge" && entry.createdAt >= monthStart)
      .reduce((total, entry) => total + Math.abs(entry.amountCny), 0);
    return {
      settings: this.snapshot.billingSettings,
      totals: {
        totalRmbCost: usage.actualCostCny,
        totalUsdCost: usage.baseCostUsd,
        totalTokens: usage.totalTokens,
        monthUsageChargeCny,
        activePaidUserCount: this.snapshot.billingAccounts.filter(
          (account) => account.planId === "pro" && account.status === "active",
        ).length,
        exhaustedUserCount: this.snapshot.billingAccounts.filter(
          (account) => account.status === "usage_exhausted",
        ).length,
        storageExceededUserCount: this.snapshot.billingAccounts.filter(
          (account) => account.status === "storage_exceeded",
        ).length,
        referralRewardTotalCny: this.snapshot.creditLedger
          .filter(
            (entry) =>
              entry.kind === "referral_inviter_reward" || entry.kind === "referral_invitee_bonus",
          )
          .reduce((total, entry) => total + entry.amountCny, 0),
      },
    };
  }

  async getAdminBillingState(filters: UsageAggregationFilters = {}): Promise<AdminBillingState> {
    await this.load();
    const overview = await this.getAdminBillingOverview();
    const users = this.snapshot.users.map((user) => {
      const publicUser = stripUserToken(user);
      const account = this.ensureBillingAccountForUser(user.id);
      const balanceCny = this.refreshBillingBalance(user.id);
      return {
        user: publicUser,
        account: { ...account, balanceCachedCny: balanceCny },
        balanceCny,
        storageQuota: this.ensureStorageQuotaForUser(user.id),
      };
    });
    return {
      overview,
      plans: this.snapshot.plans,
      pricing: await this.listModelPricing(),
      users,
      usageLogs: this.getUsageLogs(filters),
      ledger: [...this.snapshot.creditLedger].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      ),
      storageQuotas: [...this.snapshot.storageQuotas].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      ),
      referrals: [...this.snapshot.referrals].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      ),
      usage: this.aggregateUsage(filters),
      usageFilters: filters,
    };
  }

  async updateBillingSettings(
    patch: Partial<
      Pick<
        BillingSettingsRecord,
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
    >,
  ): Promise<BillingSettingsRecord> {
    await this.load();
    this.snapshot.billingSettings = normalizeBillingSettings({
      ...this.snapshot.billingSettings,
      ...patch,
      updatedAt: this.timestamp(),
    });
    await this.enqueuePersist();
    return this.snapshot.billingSettings;
  }

  async updateBillingPlanDefinition(input: {
    planId: PlanId;
    priceCny: number;
    monthlyGrantCny: number;
    workspaceBytesLimit: number;
    singleUploadBytesLimit: number;
    enabled: boolean;
  }): Promise<PlanRecord> {
    await this.load();
    const currentPlan = getPlan(this.snapshot.plans, input.planId);
    const plan: PlanRecord = {
      ...currentPlan,
      priceCny: input.priceCny,
      monthlyGrantCny: input.monthlyGrantCny,
      workspaceBytesLimit: input.workspaceBytesLimit,
      singleUploadBytesLimit: input.singleUploadBytesLimit,
      enabled: input.enabled,
    };
    const timestamp = this.timestamp();
    this.snapshot.plans = upsertById(this.snapshot.plans, plan, (entry) => entry.id);
    this.snapshot.billingSettings = normalizeBillingSettings({
      ...this.snapshot.billingSettings,
      freeMonthlyGrantCny:
        plan.id === "free"
          ? plan.monthlyGrantCny
          : this.snapshot.billingSettings.freeMonthlyGrantCny,
      proMonthlyGrantCny:
        plan.id === "pro" ? plan.monthlyGrantCny : this.snapshot.billingSettings.proMonthlyGrantCny,
      updatedAt: timestamp,
    });
    for (const account of this.snapshot.billingAccounts) {
      if (account.planId !== plan.id) {
        continue;
      }
      const quota = this.ensureStorageQuotaForUser(account.userId);
      const workspaceBytesLimit = quota.temporaryWorkspaceBytesLimit ?? plan.workspaceBytesLimit;
      this.snapshot.storageQuotas = upsertById(
        this.snapshot.storageQuotas,
        {
          ...quota,
          workspaceBytesLimit,
          singleUploadBytesLimit: plan.singleUploadBytesLimit,
          updatedAt: timestamp,
        },
        (entry) => entry.id,
      );
      const workspaceBytesUsed = quota.uploadedBytesUsed + quota.generatedBytesUsed;
      if (workspaceBytesUsed > workspaceBytesLimit) {
        this.updateBillingAccountStatus(account.userId, "storage_exceeded");
      } else if (account.status === "storage_exceeded") {
        this.updateBillingAccountStatus(
          account.userId,
          account.planId === "pro" ? "active" : "free",
        );
      }
    }
    await this.enqueuePersist();
    return plan;
  }

  async createAdminAdjustment(input: {
    userId: string;
    amountCny: number;
    note?: string | null;
  }): Promise<{ ledgerEntry: CreditLedgerEntryRecord; balanceCny: number }> {
    return await this.createManualCreditLedgerEntry({ ...input, kind: "admin_adjustment" });
  }

  async createAdminTopUp(input: {
    userId: string;
    amountCny: number;
    note?: string | null;
  }): Promise<{ ledgerEntry: CreditLedgerEntryRecord; balanceCny: number }> {
    return await this.createManualCreditLedgerEntry({ ...input, kind: "top_up" });
  }

  private async createManualCreditLedgerEntry(input: {
    userId: string;
    amountCny: number;
    kind: Extract<CreditLedgerKind, "admin_adjustment" | "top_up">;
    note?: string | null;
  }): Promise<{ ledgerEntry: CreditLedgerEntryRecord; balanceCny: number }> {
    await this.load();
    this.requireExistingUser(input.userId);
    const account = this.ensureBillingAccountForUser(input.userId);
    const ledgerEntry: CreditLedgerEntryRecord = {
      id: createId("led"),
      userId: input.userId,
      accountId: account.id,
      kind: input.kind,
      amountCny: input.amountCny,
      expiresAt: null,
      usageLogId: null,
      referralId: null,
      note: input.note?.trim() || null,
      metadata: null,
      createdAt: this.timestamp(),
    };
    this.snapshot.creditLedger = [...this.snapshot.creditLedger, ledgerEntry];
    const balanceCny = this.refreshBillingBalance(input.userId);
    if (balanceCny > 0 && account.status === "usage_exhausted") {
      this.updateBillingAccountStatus(input.userId, account.planId === "pro" ? "active" : "free");
    }
    await this.enqueuePersist();
    return { ledgerEntry, balanceCny };
  }

  async updateBillingAccountPlan(input: {
    userId: string;
    planId: PlanId;
    grantMonthlyAllowance?: boolean;
  }): Promise<{
    account: BillingAccountRecord;
    ledgerEntry: CreditLedgerEntryRecord | null;
    balanceCny: number;
  }> {
    await this.load();
    this.requireExistingUser(input.userId);
    const current = this.ensureBillingAccountForUser(input.userId);
    const plan = getPlan(this.snapshot.plans, input.planId);
    const timestamp = this.timestamp();
    const account: BillingAccountRecord = {
      ...current,
      planId: plan.id,
      status: plan.id === "pro" ? "active" : "free",
      currentPeriodStart: startOfUtcMonth(this.now()).toISOString(),
      currentPeriodEnd: startOfNextUtcMonth(this.now()).toISOString(),
      updatedAt: timestamp,
    };
    this.snapshot.billingAccounts = upsertById(
      this.snapshot.billingAccounts,
      account,
      (entry) => entry.id,
    );
    const ledgerEntry = input.grantMonthlyAllowance
      ? this.createMonthlyGrantLedgerEntry({
          userId: input.userId,
          accountId: account.id,
          plan,
          timestamp,
          expiresAt: account.currentPeriodEnd,
        })
      : null;
    if (ledgerEntry) {
      this.snapshot.creditLedger = [...this.snapshot.creditLedger, ledgerEntry];
    }
    const planQuotaAdjustment = input.grantMonthlyAllowance
      ? null
      : createPlanQuotaAdjustmentLedgerEntry({
          userId: input.userId,
          accountId: account.id,
          amountCny: plan.monthlyGrantCny - this.calculateUserBalanceCny(input.userId),
          timestamp,
        });
    if (planQuotaAdjustment) {
      this.snapshot.creditLedger = [...this.snapshot.creditLedger, planQuotaAdjustment];
    }
    const storageQuota = this.ensureStorageQuotaForUser(input.userId);
    this.snapshot.storageQuotas = upsertById(
      this.snapshot.storageQuotas,
      {
        ...storageQuota,
        workspaceBytesLimit: storageQuota.temporaryWorkspaceBytesLimit ?? plan.workspaceBytesLimit,
        singleUploadBytesLimit: plan.singleUploadBytesLimit,
        updatedAt: timestamp,
      },
      (entry) => entry.id,
    );
    const balanceCny = this.refreshBillingBalance(input.userId);
    await this.enqueuePersist();
    return {
      account: { ...account, balanceCachedCny: balanceCny },
      ledgerEntry: ledgerEntry ?? planQuotaAdjustment,
      balanceCny,
    };
  }

  async createPaymentOrder(input: {
    userId: string;
    planId: PlanId;
    billingPeriod: "monthly" | "yearly";
    providerType: PaymentProviderType;
  }): Promise<PaymentOrderRecord> {
    await this.load();
    this.requireExistingUser(input.userId);
    const plan = getPlan(this.snapshot.plans, input.planId);
    const planAmountCny = input.billingPeriod === "yearly" ? plan.priceCny * 10 : plan.priceCny;
    const amountCny = Math.max(planAmountCny, MIN_PAYMENT_AMOUNT_CNY);
    if (amountCny <= 0) {
      throw new BillingPreflightError("Paid order amount must be greater than zero.");
    }
    const timestamp = this.timestamp();
    const order: PaymentOrderRecord = {
      id: createId("pay"),
      userId: input.userId,
      planId: plan.id,
      billingPeriod: input.billingPeriod,
      providerType: input.providerType,
      outTradeNo: `doya_${Date.now()}_${createId("ord")}`,
      providerTradeNo: null,
      amountCny,
      status: "pending",
      paymentUrl: null,
      qrcode: null,
      urlscheme: null,
      rawGatewayResponse: null,
      rawNotifyPayload: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      paidAt: null,
    };
    this.snapshot.paymentOrders = [...this.snapshot.paymentOrders, order];
    await this.enqueuePersist();
    return order;
  }

  async updatePaymentOrderGatewayResult(input: {
    orderId: string;
    providerTradeNo?: string | null;
    paymentUrl?: string | null;
    qrcode?: string | null;
    urlscheme?: string | null;
    rawGatewayResponse?: unknown;
  }): Promise<PaymentOrderRecord> {
    await this.load();
    const order = this.snapshot.paymentOrders.find((entry) => entry.id === input.orderId);
    if (!order) {
      throw new NotFoundError("Payment order not found");
    }
    const next: PaymentOrderRecord = {
      ...order,
      providerTradeNo: input.providerTradeNo ?? order.providerTradeNo,
      paymentUrl: input.paymentUrl ?? order.paymentUrl,
      qrcode: input.qrcode ?? order.qrcode,
      urlscheme: input.urlscheme ?? order.urlscheme,
      rawGatewayResponse: input.rawGatewayResponse ?? order.rawGatewayResponse,
      updatedAt: this.timestamp(),
    };
    this.snapshot.paymentOrders = upsertById(
      this.snapshot.paymentOrders,
      next,
      (entry) => entry.id,
    );
    await this.enqueuePersist();
    return next;
  }

  async confirmPaidPaymentOrder(input: {
    outTradeNo: string;
    providerTradeNo: string;
    providerType: PaymentProviderType;
    amountCny: number;
    rawNotifyPayload: unknown;
  }): Promise<{ order: PaymentOrderRecord }> {
    await this.load();
    const order = this.snapshot.paymentOrders.find(
      (entry) => entry.outTradeNo === input.outTradeNo,
    );
    if (!order) {
      throw new NotFoundError("Payment order not found");
    }
    if (order.providerType !== input.providerType) {
      throw new BillingPreflightError("Payment provider does not match the order.");
    }
    if (Math.abs(order.amountCny - input.amountCny) > 0.001) {
      throw new BillingPreflightError("Payment amount does not match the order.");
    }
    if (order.status === "paid") {
      return { order };
    }
    const paidOrder: PaymentOrderRecord = {
      ...order,
      status: "paid",
      providerTradeNo: input.providerTradeNo,
      rawNotifyPayload: input.rawNotifyPayload,
      paidAt: order.paidAt ?? this.timestamp(),
      updatedAt: this.timestamp(),
    };
    this.snapshot.paymentOrders = upsertById(
      this.snapshot.paymentOrders,
      paidOrder,
      (entry) => entry.id,
    );
    await this.enqueuePersist();
    await this.updateBillingAccountPlan({
      userId: paidOrder.userId,
      planId: paidOrder.planId,
      grantMonthlyAllowance: true,
    });
    return { order: paidOrder };
  }

  async updateStorageQuota(input: {
    userId: string;
    uploadedBytesUsed?: number;
    generatedBytesUsed?: number;
    temporaryWorkspaceBytesLimit?: number | null;
    lastScannedAt?: string | null;
  }): Promise<StorageQuotaRecord> {
    await this.load();
    this.requireExistingUser(input.userId);
    const current = this.ensureStorageQuotaForUser(input.userId);
    const uploadedBytesUsed = input.uploadedBytesUsed ?? current.uploadedBytesUsed;
    const generatedBytesUsed = input.generatedBytesUsed ?? current.generatedBytesUsed;
    const next: StorageQuotaRecord = {
      ...current,
      uploadedBytesUsed,
      generatedBytesUsed,
      workspaceBytesUsed: uploadedBytesUsed + generatedBytesUsed,
      workspaceBytesLimit: input.temporaryWorkspaceBytesLimit ?? current.workspaceBytesLimit,
      temporaryWorkspaceBytesLimit:
        input.temporaryWorkspaceBytesLimit === undefined
          ? current.temporaryWorkspaceBytesLimit
          : input.temporaryWorkspaceBytesLimit,
      lastScannedAt: input.lastScannedAt === undefined ? this.timestamp() : input.lastScannedAt,
      updatedAt: this.timestamp(),
    };
    this.snapshot.storageQuotas = upsertById(
      this.snapshot.storageQuotas,
      next,
      (entry) => entry.id,
    );
    if (next.workspaceBytesUsed > next.workspaceBytesLimit) {
      this.updateBillingAccountStatus(input.userId, "storage_exceeded");
    }
    await this.enqueuePersist();
    return next;
  }

  async updateReferral(input: {
    referralId: string;
    status: ReferralRecord["status"];
    rejectReason?: string | null;
  }): Promise<ReferralRecord> {
    await this.load();
    const referral = this.snapshot.referrals.find((entry) => entry.id === input.referralId);
    if (!referral) {
      throw new NotFoundError("Referral not found");
    }
    const timestamp = this.timestamp();
    let next: ReferralRecord = {
      ...referral,
      status: input.status,
      rejectReason: input.rejectReason?.trim() || null,
      qualifiedAt:
        input.status === "qualified" ? (referral.qualifiedAt ?? timestamp) : referral.qualifiedAt,
      rewardedAt:
        input.status === "rewarded" ? (referral.rewardedAt ?? timestamp) : referral.rewardedAt,
      updatedAt: timestamp,
    };
    if (input.status === "rewarded" && !referral.inviterRewardLedgerId) {
      const inviterAccount = this.ensureBillingAccountForUser(referral.inviterUserId);
      const reward: CreditLedgerEntryRecord = {
        id: createId("led"),
        userId: referral.inviterUserId,
        accountId: inviterAccount.id,
        kind: "referral_inviter_reward",
        amountCny: this.snapshot.billingSettings.referralInviterRewardCny,
        expiresAt: addUtcDays(this.now(), this.snapshot.billingSettings.referralRewardExpiresDays),
        usageLogId: null,
        referralId: referral.id,
        note: "Manual referral reward",
        metadata: { inviteeUserId: referral.inviteeUserId, manual: true },
        createdAt: timestamp,
      };
      this.snapshot.creditLedger = [...this.snapshot.creditLedger, reward];
      next = {
        ...next,
        rewardedAt: timestamp,
        inviterRewardLedgerId: reward.id,
      };
      this.refreshBillingBalance(referral.inviterUserId);
    }
    this.snapshot.referrals = upsertById(this.snapshot.referrals, next, (entry) => entry.id);
    await this.enqueuePersist();
    return next;
  }

  async bindReferralCode(input: {
    inviteeUserId: string;
    code: string;
    sourceFingerprint?: string | null;
  }): Promise<ReferralRecord> {
    await this.load();
    this.requireExistingUser(input.inviteeUserId);
    const normalizedCode = normalizeReferralCode(input.code);
    const inviter = this.snapshot.users.find(
      (user) => buildReferralCode(user.id) === normalizedCode,
    );
    if (!inviter) {
      throw new NotFoundError("Referral code not found");
    }
    if (inviter.id === input.inviteeUserId) {
      throw new ReferralConflictError("Users cannot use their own referral code.");
    }
    const existing = this.snapshot.referrals.find(
      (referral) => referral.inviteeUserId === input.inviteeUserId,
    );
    if (existing) {
      if (existing.code !== normalizedCode || existing.inviterUserId !== inviter.id) {
        throw new ReferralConflictError("User already has a referral binding.");
      }
      return existing;
    }
    const timestamp = this.timestamp();
    const sourceFingerprint = normalizeOptionalString(input.sourceFingerprint);
    const isSuspicious = sourceFingerprint
      ? this.countRecentReferralBindingsForSource(sourceFingerprint, timestamp) >= 5
      : false;
    const referral: ReferralRecord = {
      id: createId("ref"),
      inviterUserId: inviter.id,
      inviteeUserId: input.inviteeUserId,
      code: normalizedCode,
      status: isSuspicious ? "rejected" : "registered",
      rejectReason: isSuspicious ? "High-frequency referral source" : null,
      sourceFingerprint,
      qualifiedAt: null,
      rewardedAt: null,
      inviteeBonusLedgerId: null,
      inviterRewardLedgerId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const inviteeAccount = this.ensureBillingAccountForUser(input.inviteeUserId);
    let nextReferral = referral;
    if (!isSuspicious && this.snapshot.billingSettings.referralInviteeBonusCny > 0) {
      const inviteeBonus: CreditLedgerEntryRecord = {
        id: createId("led"),
        userId: input.inviteeUserId,
        accountId: inviteeAccount.id,
        kind: "referral_invitee_bonus",
        amountCny: this.snapshot.billingSettings.referralInviteeBonusCny,
        expiresAt: null,
        usageLogId: null,
        referralId: referral.id,
        note: null,
        metadata: { inviterUserId: inviter.id },
        createdAt: timestamp,
      };
      this.snapshot.creditLedger = [...this.snapshot.creditLedger, inviteeBonus];
      nextReferral = { ...referral, inviteeBonusLedgerId: inviteeBonus.id };
      this.refreshBillingBalance(input.inviteeUserId);
    }
    this.snapshot.referrals = [...this.snapshot.referrals, nextReferral];
    await this.enqueuePersist();
    return nextReferral;
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
    this.preflightSessionCreation(input.userId);
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
    this.qualifyReferralForUser(input.userId);
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
      const storageDelta =
        generatedArtifactByteLength(input.metadata) -
        generatedArtifactByteLength(existing.metadata);
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
      this.addGeneratedStorageUsage(input.userId, storageDelta);
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
    this.addGeneratedStorageUsage(input.userId, generatedArtifactByteLength(input.metadata));
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
    const quota = this.ensureStorageQuotaForUser(input.userId);
    const uploadedBytes = input.files.reduce((total, file) => {
      const fileBytes = decodedBase64ByteLength(file.contentBase64);
      if (fileBytes > quota.singleUploadBytesLimit) {
        throw new StorageQuotaExceededError("Uploaded file exceeds the single file limit.");
      }
      return total + fileBytes;
    }, 0);
    if (quota.workspaceBytesUsed + uploadedBytes > quota.workspaceBytesLimit) {
      this.updateBillingAccountStatus(input.userId, "storage_exceeded");
      throw new StorageQuotaExceededError("Workspace storage limit is exceeded.");
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
    const nextQuota: StorageQuotaRecord = {
      ...quota,
      uploadedBytesUsed: quota.uploadedBytesUsed + uploadedBytes,
      workspaceBytesUsed: quota.workspaceBytesUsed + uploadedBytes,
      lastScannedAt: this.timestamp(),
      updatedAt: this.timestamp(),
    };
    this.snapshot.storageQuotas = upsertById(
      this.snapshot.storageQuotas,
      nextQuota,
      (entry) => entry.id,
    );
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
      status: existing?.status ?? input.status ?? "online",
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
            userWorkspaceCount: userWorkspaces.length,
            runtimeCounts: nodeRuntimeCounts,
            activeSessionCount: nodeActiveSessionIds.size,
            agentBindingCounts: nodeAgentBindingCounts,
            userWorkspaces,
          };
        })
        .sort((left, right) => right.node.lastHeartbeatAt.localeCompare(left.node.lastHeartbeatAt)),
      totals: {
        daemonCount: this.snapshot.daemonNodes.length,
        userWorkspaceCount: this.snapshot.userDaemonWorkspaces.length,
        runtimeCounts,
        activeSessionCount: activeSessionIds.size,
        agentBindingCounts,
      },
    };
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

  async getSchedulableNode(nodeId: string): Promise<DaemonNodeRecord> {
    const node = await this.getNode(nodeId);
    if (node.status !== "online") {
      throw new NodeSchedulingUnavailableError(
        `Daemon node ${node.id} is ${node.status} and cannot accept new runtimes`,
      );
    }
    return node;
  }

  async selectRuntimeNode(_input: {
    providerId?: string | null;
    modelId?: string | null;
  }): Promise<{ node: DaemonNodeRecord; selectionReason: string }> {
    await this.load();
    const activeStatuses = new Set<RuntimeStatus>(["starting", "running"]);
    const candidates = this.snapshot.daemonNodes
      .filter((node) => node.status === "online")
      .map((node) => {
        const activeRuntimeCount = this.snapshot.runtimeAllocations.filter(
          (allocation) => allocation.nodeId === node.id && activeStatuses.has(allocation.status),
        ).length;
        return { node, activeRuntimeCount };
      })
      .sort((left, right) => {
        if (left.activeRuntimeCount !== right.activeRuntimeCount) {
          return left.activeRuntimeCount - right.activeRuntimeCount;
        }
        return right.node.lastHeartbeatAt.localeCompare(left.node.lastHeartbeatAt);
      });
    const selected = candidates[0];
    if (!selected) {
      throw new NodeSchedulingUnavailableError("No online daemon nodes can accept new runtimes");
    }
    return { node: selected.node, selectionReason: "least_active_online" };
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

  async listUserDaemonWorkspaces(input: { userId: string }): Promise<UserDaemonWorkspaceRecord[]> {
    await this.load();
    this.requireExistingUser(input.userId);
    return this.snapshot.userDaemonWorkspaces
      .filter((workspace) => workspace.userId === input.userId && workspace.status === "active")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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

  private ensureBillingAccountForUser(userId: string): BillingAccountRecord {
    const existing = this.snapshot.billingAccounts.find((account) => account.userId === userId);
    if (existing) {
      if (existing.currentPeriodEnd <= this.timestamp()) {
        return this.rolloverBillingAccountPeriod(existing);
      }
      return existing;
    }
    const timestamp = this.timestamp();
    const plan = getPlan(this.snapshot.plans, "free");
    const account: BillingAccountRecord = {
      id: createId("bac"),
      userId,
      planId: "free",
      status: "free",
      currentPeriodStart: startOfUtcMonth(this.now()).toISOString(),
      currentPeriodEnd: startOfNextUtcMonth(this.now()).toISOString(),
      balanceCachedCny: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.snapshot.billingAccounts = [...this.snapshot.billingAccounts, account];
    this.snapshot.creditLedger = [
      ...this.snapshot.creditLedger,
      this.createMonthlyGrantLedgerEntry({
        userId,
        accountId: account.id,
        plan,
        timestamp,
        expiresAt: account.currentPeriodEnd,
      }),
    ];
    const balanceCny = this.refreshBillingBalance(userId);
    return { ...account, balanceCachedCny: balanceCny };
  }

  private rolloverBillingAccountPeriod(account: BillingAccountRecord): BillingAccountRecord {
    const timestamp = this.timestamp();
    const plan = getPlan(this.snapshot.plans, account.planId);
    const nextAccount: BillingAccountRecord = {
      ...account,
      status:
        account.status === "disabled" || account.status === "past_due"
          ? account.status
          : plan.id === "pro"
            ? "active"
            : "free",
      currentPeriodStart: startOfUtcMonth(this.now()).toISOString(),
      currentPeriodEnd: startOfNextUtcMonth(this.now()).toISOString(),
      updatedAt: timestamp,
    };
    this.snapshot.billingAccounts = upsertById(
      this.snapshot.billingAccounts,
      nextAccount,
      (entry) => entry.id,
    );
    const hasGrantForPeriod = this.snapshot.creditLedger.some(
      (entry) =>
        entry.userId === account.userId &&
        entry.kind === "monthly_grant" &&
        entry.metadata &&
        typeof entry.metadata === "object" &&
        "periodStart" in entry.metadata &&
        entry.metadata.periodStart === nextAccount.currentPeriodStart,
    );
    if (!hasGrantForPeriod) {
      this.snapshot.creditLedger = [
        ...this.snapshot.creditLedger,
        this.createMonthlyGrantLedgerEntry({
          userId: account.userId,
          accountId: account.id,
          plan,
          timestamp,
          expiresAt: nextAccount.currentPeriodEnd,
        }),
      ];
    }
    const balanceCny = this.refreshBillingBalance(account.userId);
    return { ...nextAccount, balanceCachedCny: balanceCny };
  }

  private createMonthlyGrantLedgerEntry(input: {
    userId: string;
    accountId: string;
    plan: PlanRecord;
    timestamp: string;
    expiresAt: string;
  }): CreditLedgerEntryRecord {
    return {
      id: createId("led"),
      userId: input.userId,
      accountId: input.accountId,
      kind: "monthly_grant",
      amountCny: input.plan.monthlyGrantCny,
      expiresAt: input.expiresAt,
      usageLogId: null,
      referralId: null,
      note: null,
      metadata: { planId: input.plan.id, periodStart: startOfUtcMonth(this.now()).toISOString() },
      createdAt: input.timestamp,
    };
  }

  private ensureStorageQuotaForUser(userId: string): StorageQuotaRecord {
    const existing = this.snapshot.storageQuotas.find((quota) => quota.userId === userId);
    if (existing) {
      return existing;
    }
    const account = this.ensureBillingAccountForUser(userId);
    const plan = getPlan(this.snapshot.plans, account.planId);
    const timestamp = this.timestamp();
    const quota: StorageQuotaRecord = {
      id: createId("stq"),
      userId,
      uploadedBytesUsed: 0,
      generatedBytesUsed: 0,
      workspaceBytesUsed: 0,
      workspaceBytesLimit: plan.workspaceBytesLimit,
      singleUploadBytesLimit: plan.singleUploadBytesLimit,
      temporaryWorkspaceBytesLimit: null,
      lastScannedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.snapshot.storageQuotas = [...this.snapshot.storageQuotas, quota];
    return quota;
  }

  private calculateUserBalanceCny(userId: string): number {
    const timestamp = this.timestamp();
    return this.snapshot.creditLedger
      .filter((entry) => entry.userId === userId)
      .filter(
        (entry) => !entry.expiresAt || entry.expiresAt > timestamp || entry.kind === "usage_charge",
      )
      .reduce((total, entry) => total + entry.amountCny, 0);
  }

  private refreshBillingBalance(userId: string): number {
    const balanceCny = this.calculateUserBalanceCny(userId);
    const account = this.snapshot.billingAccounts.find((entry) => entry.userId === userId);
    if (account) {
      this.snapshot.billingAccounts = upsertById(
        this.snapshot.billingAccounts,
        { ...account, balanceCachedCny: balanceCny, updatedAt: this.timestamp() },
        (entry) => entry.id,
      );
    }
    return balanceCny;
  }

  private updateBillingAccountStatus(userId: string, status: BillingStatus): void {
    const account = this.snapshot.billingAccounts.find((entry) => entry.userId === userId);
    if (!account || account.status === status) {
      return;
    }
    this.snapshot.billingAccounts = upsertById(
      this.snapshot.billingAccounts,
      { ...account, status, updatedAt: this.timestamp() },
      (entry) => entry.id,
    );
  }

  private preflightSessionCreation(userId: string): void {
    const account = this.ensureBillingAccountForUser(userId);
    if (account.status === "disabled" || account.status === "past_due") {
      throw new BillingPreflightError("Billing account is not active.");
    }
    const balanceCny = this.calculateUserBalanceCny(userId);
    if (balanceCny <= 0) {
      this.updateBillingAccountStatus(userId, "usage_exhausted");
      throw new BillingPreflightError("AI usage balance is exhausted.");
    }
    const storageQuota = this.ensureStorageQuotaForUser(userId);
    if (storageQuota.workspaceBytesUsed > storageQuota.workspaceBytesLimit) {
      this.updateBillingAccountStatus(userId, "storage_exceeded");
      throw new BillingPreflightError("Workspace storage limit is exceeded.");
    }
  }

  private aggregateUsage(filters: UsageAggregationFilters): UsageAggregation {
    return aggregateUsageLogs({
      usageLogs: this.snapshot.usageLogs,
      userPlanIds: new Map(
        this.snapshot.billingAccounts.map((account) => [account.userId, account.planId]),
      ),
      filters,
    });
  }

  private getUsageLogs(filters: UsageAggregationFilters): UsageLogRecord[] {
    return this.snapshot.usageLogs
      .filter(
        (log) =>
          aggregateUsageLogs({
            usageLogs: [log],
            userPlanIds: new Map(
              this.snapshot.billingAccounts.map((account) => [account.userId, account.planId]),
            ),
            filters,
          }).requestCount > 0,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  private getReferralStats(userId: string): {
    registeredCount: number;
    qualifiedCount: number;
    rewardedCount: number;
    rewardTotalCny: number;
    monthlyRemainingRewardCount: number;
  } {
    const inviterReferrals = this.snapshot.referrals.filter(
      (referral) => referral.inviterUserId === userId,
    );
    const monthStart = startOfUtcMonth(this.now()).toISOString();
    const monthlyRewardCount = this.snapshot.creditLedger.filter(
      (entry) =>
        entry.userId === userId &&
        entry.kind === "referral_inviter_reward" &&
        entry.createdAt >= monthStart,
    ).length;
    return {
      registeredCount: inviterReferrals.filter((referral) => referral.inviteeUserId).length,
      qualifiedCount: inviterReferrals.filter(
        (referral) => referral.status === "qualified" || referral.status === "rewarded",
      ).length,
      rewardedCount: inviterReferrals.filter((referral) => referral.status === "rewarded").length,
      rewardTotalCny: this.snapshot.creditLedger
        .filter((entry) => entry.userId === userId && entry.kind === "referral_inviter_reward")
        .reduce((total, entry) => total + entry.amountCny, 0),
      monthlyRemainingRewardCount: Math.max(
        0,
        this.snapshot.billingSettings.referralMonthlyRewardLimit - monthlyRewardCount,
      ),
    };
  }

  private countRecentReferralBindingsForSource(
    sourceFingerprint: string,
    timestamp: string,
  ): number {
    const dayStart = startOfUtcDay(new Date(timestamp)).toISOString();
    return this.snapshot.referrals.filter(
      (referral) =>
        referral.sourceFingerprint === sourceFingerprint && referral.createdAt >= dayStart,
    ).length;
  }

  private addGeneratedStorageUsage(userId: string, generatedBytesDelta: number): void {
    if (generatedBytesDelta === 0) {
      return;
    }
    const quota = this.ensureStorageQuotaForUser(userId);
    const generatedBytesUsed = Math.max(0, quota.generatedBytesUsed + generatedBytesDelta);
    const nextQuota: StorageQuotaRecord = {
      ...quota,
      generatedBytesUsed,
      workspaceBytesUsed: quota.uploadedBytesUsed + generatedBytesUsed,
      lastScannedAt: this.timestamp(),
      updatedAt: this.timestamp(),
    };
    this.snapshot.storageQuotas = upsertById(
      this.snapshot.storageQuotas,
      nextQuota,
      (entry) => entry.id,
    );
    if (nextQuota.workspaceBytesUsed > nextQuota.workspaceBytesLimit) {
      this.updateBillingAccountStatus(userId, "storage_exceeded");
    }
  }

  private qualifyReferralForUser(userId: string): void {
    const referral = this.snapshot.referrals.find(
      (entry) =>
        entry.inviteeUserId === userId &&
        (entry.status === "registered" || entry.status === "qualified") &&
        !entry.inviterRewardLedgerId,
    );
    if (!referral) {
      return;
    }
    const timestamp = this.timestamp();
    const qualifiedReferral: ReferralRecord = {
      ...referral,
      status: "qualified",
      qualifiedAt: referral.qualifiedAt ?? timestamp,
      updatedAt: timestamp,
    };
    if (!this.canRewardReferral(referral.inviterUserId)) {
      this.snapshot.referrals = upsertById(
        this.snapshot.referrals,
        qualifiedReferral,
        (entry) => entry.id,
      );
      return;
    }
    const inviterAccount = this.ensureBillingAccountForUser(referral.inviterUserId);
    const reward: CreditLedgerEntryRecord = {
      id: createId("led"),
      userId: referral.inviterUserId,
      accountId: inviterAccount.id,
      kind: "referral_inviter_reward",
      amountCny: this.snapshot.billingSettings.referralInviterRewardCny,
      expiresAt: addUtcDays(this.now(), this.snapshot.billingSettings.referralRewardExpiresDays),
      usageLogId: null,
      referralId: referral.id,
      note: null,
      metadata: { inviteeUserId: userId },
      createdAt: timestamp,
    };
    this.snapshot.creditLedger = [...this.snapshot.creditLedger, reward];
    this.snapshot.referrals = upsertById(
      this.snapshot.referrals,
      {
        ...qualifiedReferral,
        status: "rewarded",
        rewardedAt: timestamp,
        inviterRewardLedgerId: reward.id,
        updatedAt: timestamp,
      },
      (entry) => entry.id,
    );
    this.refreshBillingBalance(referral.inviterUserId);
  }

  private canRewardReferral(inviterUserId: string): boolean {
    if (this.snapshot.billingSettings.referralInviterRewardCny <= 0) {
      return false;
    }
    const timestamp = this.now();
    const dayStart = startOfUtcDay(timestamp).toISOString();
    const monthStart = startOfUtcMonth(timestamp).toISOString();
    const rewards = this.snapshot.creditLedger.filter(
      (entry) => entry.userId === inviterUserId && entry.kind === "referral_inviter_reward",
    );
    const dailyCount = rewards.filter((entry) => entry.createdAt >= dayStart).length;
    const monthlyCount = rewards.filter((entry) => entry.createdAt >= monthStart).length;
    return (
      dailyCount < this.snapshot.billingSettings.referralDailyRewardLimit &&
      monthlyCount < this.snapshot.billingSettings.referralMonthlyRewardLimit
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
      this.snapshot = createEmptySnapshot();
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

function normalizeReferralCode(value: string): string {
  return value.trim().toUpperCase();
}

function buildReferralCode(userId: string): string {
  return normalizeReferralCode(`DOYA-${userId.replace(/^usr_/, "").slice(0, 8)}`);
}

function decodedBase64ByteLength(value: string): number {
  const normalized = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  return Buffer.byteLength(normalized, "base64");
}

function generatedArtifactByteLength(metadata: unknown): number {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return 0;
  }
  const record = metadata as Record<string, unknown>;
  if (typeof record.content !== "string") {
    return 0;
  }
  return record.isBase64 === true
    ? decodedBase64ByteLength(record.content)
    : Buffer.byteLength(record.content, "utf8");
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
    return createEmptySnapshot();
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
  const billingSettings = normalizeBillingSettings(record.billingSettings);
  const plans = normalizePlans(record.plans);
  return {
    settings: {},
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
    billingSettings,
    plans,
    modelPricing: mergeDefaultModelPricing(
      Array.isArray(record.modelPricing)
        ? record.modelPricing.map(normalizeModelPricing).filter((entry) => entry !== null)
        : [],
    ),
    billingAccounts: Array.isArray(record.billingAccounts)
      ? record.billingAccounts.map((account) => ({
          ...account,
          planId: account.planId === "pro" ? "pro" : "free",
          status: normalizeBillingStatus(account.status),
          balanceCachedCny: numberOr(account.balanceCachedCny, 0),
        }))
      : [],
    creditLedger: Array.isArray(record.creditLedger)
      ? record.creditLedger.map((entry) => ({
          ...entry,
          expiresAt: typeof entry.expiresAt === "string" ? entry.expiresAt : null,
          usageLogId: typeof entry.usageLogId === "string" ? entry.usageLogId : null,
          referralId: typeof entry.referralId === "string" ? entry.referralId : null,
          note: typeof entry.note === "string" ? entry.note : null,
          metadata: entry.metadata ?? null,
        }))
      : [],
    usageLogs: Array.isArray(record.usageLogs) ? record.usageLogs : [],
    storageQuotas: Array.isArray(record.storageQuotas)
      ? record.storageQuotas.map((quota) => ({
          ...quota,
          uploadedBytesUsed: numberOr(quota.uploadedBytesUsed, 0),
          generatedBytesUsed: numberOr(quota.generatedBytesUsed, 0),
          workspaceBytesUsed: numberOr(quota.workspaceBytesUsed, 0),
          workspaceBytesLimit: numberOr(
            quota.workspaceBytesLimit,
            DEFAULT_PLANS[0].workspaceBytesLimit,
          ),
          singleUploadBytesLimit: numberOr(
            quota.singleUploadBytesLimit,
            DEFAULT_PLANS[0].singleUploadBytesLimit,
          ),
          temporaryWorkspaceBytesLimit:
            typeof quota.temporaryWorkspaceBytesLimit === "number"
              ? quota.temporaryWorkspaceBytesLimit
              : null,
          lastScannedAt: typeof quota.lastScannedAt === "string" ? quota.lastScannedAt : null,
        }))
      : [],
    referrals: Array.isArray(record.referrals)
      ? record.referrals.map((referral) => ({
          ...referral,
          inviteeUserId: typeof referral.inviteeUserId === "string" ? referral.inviteeUserId : null,
          rejectReason: typeof referral.rejectReason === "string" ? referral.rejectReason : null,
          sourceFingerprint:
            typeof referral.sourceFingerprint === "string" ? referral.sourceFingerprint : null,
          qualifiedAt: typeof referral.qualifiedAt === "string" ? referral.qualifiedAt : null,
          rewardedAt: typeof referral.rewardedAt === "string" ? referral.rewardedAt : null,
          inviteeBonusLedgerId:
            typeof referral.inviteeBonusLedgerId === "string"
              ? referral.inviteeBonusLedgerId
              : null,
          inviterRewardLedgerId:
            typeof referral.inviterRewardLedgerId === "string"
              ? referral.inviterRewardLedgerId
              : null,
        }))
      : [],
    paymentOrders: Array.isArray(record.paymentOrders)
      ? record.paymentOrders.map((order) => ({
          ...order,
          providerTradeNo: typeof order.providerTradeNo === "string" ? order.providerTradeNo : null,
          paymentUrl: typeof order.paymentUrl === "string" ? order.paymentUrl : null,
          qrcode: typeof order.qrcode === "string" ? order.qrcode : null,
          urlscheme: typeof order.urlscheme === "string" ? order.urlscheme : null,
          rawGatewayResponse: order.rawGatewayResponse ?? null,
          rawNotifyPayload: order.rawNotifyPayload ?? null,
          paidAt: typeof order.paidAt === "string" ? order.paidAt : null,
        }))
      : [],
  };
}

function createEmptySnapshot(): ControlSnapshot {
  return {
    ...EMPTY_SNAPSHOT,
    billingSettings: { ...DEFAULT_BILLING_SETTINGS },
    plans: DEFAULT_PLANS.map((plan) => ({ ...plan })),
    modelPricing: DEFAULT_MODEL_PRICING.map((entry) => ({ ...entry })),
  };
}

function createPlanQuotaAdjustmentLedgerEntry(input: {
  userId: string;
  accountId: string;
  amountCny: number;
  timestamp: string;
}): CreditLedgerEntryRecord | null {
  const amountCny = Math.round(input.amountCny * 100) / 100;
  if (Math.abs(amountCny) < 0.001) {
    return null;
  }
  return {
    id: createId("led"),
    userId: input.userId,
    accountId: input.accountId,
    kind: "plan_quota_adjustment",
    amountCny,
    expiresAt: null,
    usageLogId: null,
    referralId: null,
    note: null,
    metadata: null,
    createdAt: input.timestamp,
  };
}

function normalizeBillingSettings(
  settings: Partial<BillingSettingsRecord> | undefined,
): BillingSettingsRecord {
  return {
    ...DEFAULT_BILLING_SETTINGS,
    ...settings,
    displayCurrency: "CNY",
    usdToCnyRate: numberOr(settings?.usdToCnyRate, DEFAULT_BILLING_SETTINGS.usdToCnyRate),
    tokenMarkupMultiplier: numberOr(
      settings?.tokenMarkupMultiplier,
      DEFAULT_BILLING_SETTINGS.tokenMarkupMultiplier,
    ),
    updatedAt: typeof settings?.updatedAt === "string" ? settings.updatedAt : null,
  };
}

function normalizePlans(plans: PlanRecord[] | undefined): PlanRecord[] {
  if (!Array.isArray(plans) || plans.length === 0) {
    return DEFAULT_PLANS.map((plan) => ({ ...plan }));
  }
  const byId = new Map(DEFAULT_PLANS.map((plan) => [plan.id, { ...plan }]));
  for (const plan of plans) {
    if (plan.id === "free" || plan.id === "pro") {
      byId.set(plan.id, { ...byId.get(plan.id), ...plan });
    }
  }
  return [...byId.values()];
}

function normalizeModelPricing(entry: ModelPricingRecord): ModelPricingRecord | null {
  if (!entry || typeof entry.providerId !== "string" || typeof entry.modelId !== "string") {
    return null;
  }
  return {
    ...entry,
    billingMode: "token",
    inputPriceUsdPerToken: numberOr(entry.inputPriceUsdPerToken, 0),
    outputPriceUsdPerToken: numberOr(entry.outputPriceUsdPerToken, 0),
    cacheCreationPriceUsdPerToken: numberOr(entry.cacheCreationPriceUsdPerToken, 0),
    cacheReadPriceUsdPerToken: numberOr(entry.cacheReadPriceUsdPerToken, 0),
    supportsUsageAccounting: entry.supportsUsageAccounting !== false,
    enabled: entry.enabled !== false,
    source:
      entry.source === "fallback" || entry.source === "provider_reported" ? entry.source : "manual",
  };
}

function mergeDefaultModelPricing(modelPricing: ModelPricingRecord[]): ModelPricingRecord[] {
  const byKey = new Map<string, ModelPricingRecord>();
  for (const entry of DEFAULT_MODEL_PRICING) {
    byKey.set(modelPricingKey(entry), { ...entry });
  }
  for (const entry of modelPricing) {
    byKey.set(modelPricingKey(entry), entry);
  }
  return [...byKey.values()];
}

function modelPricingKey(entry: Pick<ModelPricingRecord, "providerId" | "modelId">): string {
  return `${entry.providerId.trim().toLowerCase()}:${entry.modelId.trim().toLowerCase()}`;
}

function normalizeBillingStatus(value: unknown): BillingStatus {
  switch (value) {
    case "active":
    case "usage_exhausted":
    case "storage_exceeded":
    case "past_due":
    case "disabled":
      return value;
    default:
      return "free";
  }
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

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
  );
}

function startOfNextUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

function addUtcDays(date: Date, days: number): string {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

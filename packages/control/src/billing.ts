import { createHash } from "node:crypto";
import type {
  BillingSettingsRecord,
  ModelPricingRecord,
  ModelPricingSnapshot,
  PlanRecord,
  UsageLogRecord,
} from "./domain.js";

export interface UsageTokenInput {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  contextWindowUsedTokens?: number | null;
  contextWindowMaxTokens?: number | null;
}

export interface NormalizedUsageTokens {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  contextWindowUsedTokens: number | null;
  contextWindowMaxTokens: number | null;
  actualInputTokens: number;
}

export interface UsageCostBreakdown {
  inputCostUsd: number;
  outputCostUsd: number;
  cacheCreationCostUsd: number;
  cacheReadCostUsd: number;
  baseCostUsd: number;
  markedCostUsd: number;
  actualCostCny: number;
}

export interface UsageFingerprintInput {
  userId: string;
  sessionId: string;
  runtimeId: string;
  agentId: string;
  providerId: string;
  modelId: string;
  turnId: string;
  tokens: NormalizedUsageTokens;
  cost: UsageCostBreakdown;
  pricingSnapshot: ModelPricingSnapshot;
}

export interface UsageAggregationFilters {
  userId?: string;
  sessionId?: string;
  providerId?: string;
  modelId?: string;
  planId?: string;
  startAt?: string;
  endAt?: string;
}

export interface UsageAggregation {
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

export const DEFAULT_BILLING_SETTINGS: BillingSettingsRecord = {
  displayCurrency: "CNY",
  usdToCnyRate: 7.2,
  tokenMarkupMultiplier: 1.3,
  freeMonthlyGrantCny: 3,
  proMonthlyGrantCny: 30,
  referralInviteeBonusCny: 3,
  referralInviterRewardCny: 5,
  referralMonthlyRewardLimit: 10,
  referralDailyRewardLimit: 5,
  referralRewardExpiresDays: 90,
  updatedAt: null,
};

export const DEFAULT_PLANS: PlanRecord[] = [
  {
    id: "free",
    name: "Free",
    priceCny: 0,
    monthlyGrantCny: 3,
    workspaceBytesLimit: 200 * 1024 * 1024,
    singleUploadBytesLimit: 20 * 1024 * 1024,
    enabled: true,
  },
  {
    id: "pro",
    name: "Pro",
    priceCny: 39,
    monthlyGrantCny: 30,
    workspaceBytesLimit: 5 * 1024 * 1024 * 1024,
    singleUploadBytesLimit: 200 * 1024 * 1024,
    enabled: true,
  },
];

export const MIN_PAYMENT_AMOUNT_CNY = 0.1;

export const DEFAULT_MODEL_PRICING: ModelPricingRecord[] = [
  fallbackPricing("openai", "gpt-5.5", "GPT-5.5", 5e-6, 30e-6, 5e-6, 0.5e-6),
  fallbackPricing("openai", "gpt-5.4", "GPT-5.4", 2.5e-6, 15e-6, 2.5e-6, 0.25e-6),
  fallbackPricing("openai", "gpt-5.4-mini", "GPT-5.4 mini", 0.75e-6, 4.5e-6, 0.75e-6, 0.075e-6),
  fallbackPricing("claude", "claude-fable-5", "Claude Fable 5", 10e-6, 50e-6, 12.5e-6, 1e-6),
  fallbackPricing("claude", "claude-mythos-5", "Claude Mythos 5", 10e-6, 50e-6, 12.5e-6, 1e-6),
  fallbackPricing("claude", "claude-opus-4.8", "Claude Opus 4.8", 5e-6, 25e-6, 6.25e-6, 0.5e-6),
  fallbackPricing("claude", "claude-opus-4.7", "Claude Opus 4.7", 5e-6, 25e-6, 6.25e-6, 0.5e-6),
  fallbackPricing("claude", "claude-opus-4.6", "Claude Opus 4.6", 5e-6, 25e-6, 6.25e-6, 0.5e-6),
  fallbackPricing("claude", "claude-opus-4.5", "Claude Opus 4.5", 5e-6, 25e-6, 6.25e-6, 0.5e-6),
  fallbackPricing("claude", "claude-opus-4.1", "Claude Opus 4.1", 15e-6, 75e-6, 18.75e-6, 1.5e-6),
  fallbackPricing("claude", "claude-opus-4", "Claude Opus 4", 15e-6, 75e-6, 18.75e-6, 1.5e-6),
  fallbackPricing("claude", "claude-sonnet-4.6", "Claude Sonnet 4.6", 3e-6, 15e-6, 3.75e-6, 0.3e-6),
  fallbackPricing("claude", "claude-sonnet-4.5", "Claude Sonnet 4.5", 3e-6, 15e-6, 3.75e-6, 0.3e-6),
  fallbackPricing("claude", "claude-sonnet-4", "Claude Sonnet 4", 3e-6, 15e-6, 3.75e-6, 0.3e-6),
  fallbackPricing("claude", "sonnet", "Claude Sonnet", 3e-6, 15e-6, 3.75e-6, 0.3e-6),
  fallbackPricing("claude", "claude-haiku-4.5", "Claude Haiku 4.5", 1e-6, 5e-6, 1.25e-6, 0.1e-6),
  fallbackPricing("claude", "claude-3-5-haiku", "Claude Haiku 3.5", 0.8e-6, 4e-6, 1e-6, 0.08e-6),
  fallbackPricing("claude", "opus", "Claude Opus", 5e-6, 25e-6, 6.25e-6, 0.5e-6),
];

export function normalizeUsageTokens(input: UsageTokenInput): NormalizedUsageTokens {
  const cacheReadTokens = nonNegativeInteger(input.cacheReadTokens ?? input.cachedInputTokens ?? 0);
  const inputTokens = nonNegativeInteger(input.inputTokens ?? 0);
  return {
    inputTokens,
    outputTokens: nonNegativeInteger(input.outputTokens ?? 0),
    cacheCreationTokens: nonNegativeInteger(input.cacheCreationTokens ?? 0),
    cacheReadTokens,
    reasoningTokens: nonNegativeInteger(input.reasoningTokens ?? 0),
    contextWindowUsedTokens: nullableNonNegativeInteger(input.contextWindowUsedTokens),
    contextWindowMaxTokens: nullableNonNegativeInteger(input.contextWindowMaxTokens),
    actualInputTokens: Math.max(0, inputTokens - cacheReadTokens),
  };
}

function fallbackPricing(
  providerId: string,
  modelId: string,
  displayName: string,
  inputPriceUsdPerToken: number,
  outputPriceUsdPerToken: number,
  cacheCreationPriceUsdPerToken: number,
  cacheReadPriceUsdPerToken: number,
): ModelPricingRecord {
  const timestamp = "2026-01-01T00:00:00.000Z";
  return {
    id: `fallback_${providerId}_${modelId}`.replaceAll(/[^a-zA-Z0-9_-]/g, "_"),
    providerId,
    modelId,
    displayName,
    billingMode: "token",
    inputPriceUsdPerToken,
    outputPriceUsdPerToken,
    cacheCreationPriceUsdPerToken,
    cacheReadPriceUsdPerToken,
    supportsUsageAccounting: true,
    enabled: true,
    source: "fallback",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function resolveModelPricing(input: {
  pricing: ModelPricingRecord[];
  providerId: string;
  modelId: string;
}): ModelPricingRecord | null {
  const providerId = input.providerId.trim().toLowerCase();
  const modelId = input.modelId.trim().toLowerCase();
  const candidates = buildPricingLookupCandidates(providerId, modelId);
  return (
    candidates
      .map((candidate) =>
        input.pricing.find(
          (entry) =>
            entry.enabled &&
            entry.providerId.trim().toLowerCase() === candidate.providerId &&
            entry.modelId.trim().toLowerCase() === candidate.modelId,
        ),
      )
      .find((entry) => entry !== undefined) ?? null
  );
}

function buildPricingLookupCandidates(
  providerId: string,
  modelId: string,
): Array<{ providerId: string; modelId: string }> {
  const candidates = [{ providerId, modelId }];
  const openAiModelId = normalizeOpenAiModelAlias(modelId);
  if (openAiModelId && (providerId === "codex" || providerId === "openai")) {
    candidates.push({ providerId: "openai", modelId: openAiModelId });
  }
  return candidates;
}

function normalizeOpenAiModelAlias(modelId: string): string | null {
  const normalized = modelId.trim().toLowerCase();
  if (normalized === "5.5" || normalized === "gpt-5.5") {
    return "gpt-5.5";
  }
  if (normalized === "5.4" || normalized === "gpt-5.4") {
    return "gpt-5.4";
  }
  if (normalized === "5.4-mini" || normalized === "gpt-5.4-mini") {
    return "gpt-5.4-mini";
  }
  return null;
}

export function createPricingSnapshot(pricing: ModelPricingRecord): ModelPricingSnapshot {
  return {
    pricingId: pricing.id,
    providerId: pricing.providerId,
    modelId: pricing.modelId,
    displayName: pricing.displayName,
    billingMode: pricing.billingMode,
    inputPriceUsdPerToken: pricing.inputPriceUsdPerToken,
    outputPriceUsdPerToken: pricing.outputPriceUsdPerToken,
    cacheCreationPriceUsdPerToken: pricing.cacheCreationPriceUsdPerToken,
    cacheReadPriceUsdPerToken: pricing.cacheReadPriceUsdPerToken,
    supportsUsageAccounting: pricing.supportsUsageAccounting,
    source: pricing.source,
  };
}

export function calculateUsageCost(input: {
  tokens: NormalizedUsageTokens;
  pricing: ModelPricingSnapshot;
  settings: BillingSettingsRecord;
}): UsageCostBreakdown {
  const inputCostUsd = input.tokens.actualInputTokens * input.pricing.inputPriceUsdPerToken;
  const outputCostUsd = input.tokens.outputTokens * input.pricing.outputPriceUsdPerToken;
  const cacheCreationCostUsd =
    input.tokens.cacheCreationTokens * input.pricing.cacheCreationPriceUsdPerToken;
  const cacheReadCostUsd = input.tokens.cacheReadTokens * input.pricing.cacheReadPriceUsdPerToken;
  const baseCostUsd = inputCostUsd + outputCostUsd + cacheCreationCostUsd + cacheReadCostUsd;
  const markedCostUsd = baseCostUsd * input.settings.tokenMarkupMultiplier;
  return {
    inputCostUsd,
    outputCostUsd,
    cacheCreationCostUsd,
    cacheReadCostUsd,
    baseCostUsd,
    markedCostUsd,
    actualCostCny: markedCostUsd * input.settings.usdToCnyRate,
  };
}

export function buildUsageRequestFingerprint(input: UsageFingerprintInput): string {
  const payload = {
    userId: input.userId,
    sessionId: input.sessionId,
    runtimeId: input.runtimeId,
    agentId: input.agentId,
    providerId: input.providerId,
    modelId: input.modelId,
    turnId: input.turnId,
    tokens: input.tokens,
    cost: input.cost,
    pricingSnapshot: input.pricingSnapshot,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function aggregateUsageLogs(input: {
  usageLogs: UsageLogRecord[];
  userPlanIds: Map<string, string>;
  filters?: UsageAggregationFilters;
}): UsageAggregation {
  const filters = input.filters ?? {};
  const logs = input.usageLogs.filter((log) =>
    usageLogMatchesFilters(log, input.userPlanIds, filters),
  );
  const totals = logs.reduce(
    (summary, log) => ({
      requestCount: summary.requestCount + 1,
      inputTokens: summary.inputTokens + log.inputTokens,
      outputTokens: summary.outputTokens + log.outputTokens,
      cacheCreationTokens: summary.cacheCreationTokens + log.cacheCreationTokens,
      cacheReadTokens: summary.cacheReadTokens + log.cacheReadTokens,
      totalTokens:
        summary.totalTokens +
        log.inputTokens +
        log.outputTokens +
        log.cacheCreationTokens +
        log.cacheReadTokens,
      baseCostUsd: summary.baseCostUsd + log.baseCostUsd,
      markedCostUsd: summary.markedCostUsd + log.markedCostUsd,
      actualCostCny: summary.actualCostCny + log.actualCostCny,
      averageCostCny: 0,
    }),
    emptyUsageAggregation(),
  );
  return {
    ...totals,
    averageCostCny: totals.requestCount > 0 ? totals.actualCostCny / totals.requestCount : 0,
  };
}

export function getPlan(plans: PlanRecord[], planId: string): PlanRecord {
  const plan = plans.find((entry) => entry.id === planId);
  if (!plan) {
    throw new Error(`Billing plan not found: ${planId}`);
  }
  return plan;
}

function usageLogMatchesFilters(
  log: UsageLogRecord,
  userPlanIds: Map<string, string>,
  filters: UsageAggregationFilters,
): boolean {
  if (filters.userId && log.userId !== filters.userId) {
    return false;
  }
  if (filters.sessionId && log.sessionId !== filters.sessionId) {
    return false;
  }
  if (filters.providerId && log.providerId !== filters.providerId) {
    return false;
  }
  if (filters.modelId && log.modelId !== filters.modelId) {
    return false;
  }
  if (filters.planId && userPlanIds.get(log.userId) !== filters.planId) {
    return false;
  }
  if (filters.startAt && log.createdAt < filters.startAt) {
    return false;
  }
  if (filters.endAt && log.createdAt > filters.endAt) {
    return false;
  }
  return true;
}

function emptyUsageAggregation(): UsageAggregation {
  return {
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    baseCostUsd: 0,
    markedCostUsd: 0,
    actualCostCny: 0,
    averageCostCny: 0,
  };
}

function nonNegativeInteger(value: number): number {
  return Math.max(0, Math.trunc(value));
}

function nullableNonNegativeInteger(value: number | null | undefined): number | null {
  return typeof value === "number" ? nonNegativeInteger(value) : null;
}

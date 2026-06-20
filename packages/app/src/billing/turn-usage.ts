import type { AgentStreamEventPayload } from "@getdoya/protocol/messages";
import type { AgentUsage } from "@getdoya/protocol/agent-types";
import type { AgentTurnUsageRecord } from "@/stores/session-store";

const USD_TO_CNY_FALLBACK_RATE = 7.2;

interface ModelPrice {
  inputPriceUsdPerToken: number;
  outputPriceUsdPerToken: number;
  cacheCreationPriceUsdPerToken: number;
  cacheReadPriceUsdPerToken: number;
}

const DEFAULT_MODEL_PRICES = new Map<string, ModelPrice>([
  [
    "openai:gpt-5.5",
    {
      inputPriceUsdPerToken: 5e-6,
      outputPriceUsdPerToken: 30e-6,
      cacheCreationPriceUsdPerToken: 5e-6,
      cacheReadPriceUsdPerToken: 0.5e-6,
    },
  ],
  [
    "openai:gpt-5.4",
    {
      inputPriceUsdPerToken: 2.5e-6,
      outputPriceUsdPerToken: 10e-6,
      cacheCreationPriceUsdPerToken: 2.5e-6,
      cacheReadPriceUsdPerToken: 0.25e-6,
    },
  ],
  [
    "openai:gpt-5.4-mini",
    {
      inputPriceUsdPerToken: 0.15e-6,
      outputPriceUsdPerToken: 0.6e-6,
      cacheCreationPriceUsdPerToken: 0.15e-6,
      cacheReadPriceUsdPerToken: 0.015e-6,
    },
  ],
  [
    "claude:claude-haiku-4.5",
    {
      inputPriceUsdPerToken: 0.8e-6,
      outputPriceUsdPerToken: 4e-6,
      cacheCreationPriceUsdPerToken: 1e-6,
      cacheReadPriceUsdPerToken: 0.08e-6,
    },
  ],
  [
    "claude:claude-sonnet-4.6",
    {
      inputPriceUsdPerToken: 3e-6,
      outputPriceUsdPerToken: 15e-6,
      cacheCreationPriceUsdPerToken: 3.75e-6,
      cacheReadPriceUsdPerToken: 0.3e-6,
    },
  ],
  [
    "claude:claude-opus-4.8",
    {
      inputPriceUsdPerToken: 15e-6,
      outputPriceUsdPerToken: 75e-6,
      cacheCreationPriceUsdPerToken: 18.75e-6,
      cacheReadPriceUsdPerToken: 1.5e-6,
    },
  ],
]);

export function mergeAgentTurnUsage(
  current: Map<string, AgentTurnUsageRecord> | undefined,
  incoming: Map<string, AgentTurnUsageRecord>,
): Map<string, AgentTurnUsageRecord> {
  const next = new Map(current);
  for (const [turnId, usage] of incoming) {
    next.set(turnId, usage);
  }
  return next;
}

export function extractAgentTurnUsageFromEvents(
  events: Iterable<AgentStreamEventPayload>,
): Map<string, AgentTurnUsageRecord> {
  const usageByTurnId = new Map<string, AgentTurnUsageRecord>();
  for (const event of events) {
    const usage = extractAgentTurnUsage(event);
    if (usage) {
      usageByTurnId.set(usage.turnId, usage.usage);
    }
  }
  return usageByTurnId;
}

export function extractAgentTurnUsage(
  event: AgentStreamEventPayload,
): { turnId: string; usage: AgentTurnUsageRecord } | null {
  const eventType = readEventType(event);
  if (
    eventType !== "turn_completed" &&
    eventType !== "turn_failed" &&
    eventType !== "turn_canceled" &&
    eventType !== "usage_updated"
  ) {
    return null;
  }
  const turnId = readEventTurnId(event);
  const usage = readEventUsage(event);
  if (!turnId || !usage) {
    return null;
  }
  return {
    turnId,
    usage: agentUsageToTurnUsageRecord({
      usage,
      provider: event.provider,
      model: readEventModel(event),
    }),
  };
}

export function agentUsageToTurnUsageRecord(input: {
  usage: AgentUsage;
  provider?: string;
  model?: string | null;
}): AgentTurnUsageRecord {
  const inputTokens = input.usage.inputTokens ?? 0;
  const outputTokens = input.usage.outputTokens ?? 0;
  const cacheCreationTokens = input.usage.cacheCreationTokens ?? 0;
  const cacheReadTokens = input.usage.cacheReadTokens ?? input.usage.cachedInputTokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    actualCostCny: estimateActualCostCny({
      provider: input.provider,
      model: input.model ?? undefined,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
    }),
  };
}

function estimateActualCostCny(input: {
  provider?: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}): number | undefined {
  const price = resolveModelPrice(input.provider, input.model);
  if (!price) {
    return undefined;
  }
  const billableInputTokens = Math.max(0, input.inputTokens - input.cacheReadTokens);
  const usd =
    billableInputTokens * price.inputPriceUsdPerToken +
    input.outputTokens * price.outputPriceUsdPerToken +
    input.cacheCreationTokens * price.cacheCreationPriceUsdPerToken +
    input.cacheReadTokens * price.cacheReadPriceUsdPerToken;
  return usd * USD_TO_CNY_FALLBACK_RATE;
}

function resolveModelPrice(
  provider: string | undefined,
  model: string | undefined,
): ModelPrice | null {
  if (!provider) {
    return null;
  }
  const normalizedProvider = provider.trim().toLowerCase();
  const normalizedModel = model?.trim().toLowerCase();
  if (normalizedProvider === "codex" || normalizedProvider === "openai") {
    const openAiModel = normalizedModel || "gpt-5.5";
    const withoutPrefix = openAiModel.startsWith("gpt-")
      ? openAiModel.slice("gpt-".length)
      : openAiModel;
    return (
      DEFAULT_MODEL_PRICES.get(`openai:gpt-${withoutPrefix}`) ??
      DEFAULT_MODEL_PRICES.get(`openai:${openAiModel}`) ??
      null
    );
  }
  if (normalizedProvider === "claude" || normalizedProvider === "anthropic") {
    return DEFAULT_MODEL_PRICES.get(`claude:${normalizedModel || "claude-sonnet-4.6"}`) ?? null;
  }
  if (!normalizedModel) {
    return null;
  }
  return DEFAULT_MODEL_PRICES.get(`${normalizedProvider}:${normalizedModel}`) ?? null;
}

function readEventModel(event: AgentStreamEventPayload): string | undefined {
  const record = event as Record<string, unknown>;
  return typeof record.model === "string" ? record.model : undefined;
}

function readEventType(event: AgentStreamEventPayload): string {
  return String((event as Record<string, unknown>).type);
}

function readEventTurnId(event: AgentStreamEventPayload): string | undefined {
  const record = event as Record<string, unknown>;
  return typeof record.turnId === "string" && record.turnId.trim() ? record.turnId : undefined;
}

function readEventUsage(event: AgentStreamEventPayload) {
  const record = event as Record<string, unknown>;
  const usage = record.usage;
  return usage && typeof usage === "object" && !Array.isArray(usage)
    ? (usage as {
        inputTokens?: number;
        outputTokens?: number;
        cacheCreationTokens?: number;
        cacheReadTokens?: number;
        cachedInputTokens?: number;
      })
    : null;
}

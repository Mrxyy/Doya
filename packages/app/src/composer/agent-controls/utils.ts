import type { AgentFeature, AgentModelDefinition } from "@getdoya/protocol/agent-types";
import { translateNow } from "@/i18n/translate";

export type ExplainedAgentControl = "mode" | "model" | "thinking";
export type FeatureHighlightColor = "blue" | "default" | "green" | "yellow";

export function getAgentControlHint(selector: ExplainedAgentControl): string {
  switch (selector) {
    case "thinking":
      return translateNow("composer.agentControls.hint.thinking");
    case "model":
      return translateNow("composer.agentControls.hint.model");
    case "mode":
      return translateNow("composer.agentControls.hint.mode");
    default:
      throw new Error("unreachable");
  }
}

export function normalizeModelId(modelId: string | null | undefined): string | null {
  const normalized = typeof modelId === "string" ? modelId.trim() : "";
  if (!normalized) {
    return null;
  }
  return normalized;
}

export function getFeatureTooltip(feature: Pick<AgentFeature, "id" | "label" | "tooltip">): string {
  const localized = getLocalizedFeatureTooltip(feature);
  if (localized) {
    return localized;
  }
  return feature.tooltip ?? feature.label;
}

export function getFeatureHighlightColor(featureId: string): FeatureHighlightColor {
  switch (featureId) {
    case "fast_mode":
      return "yellow";
    case "auto_accept":
      return "green";
    case "plan_mode":
      return "blue";
    default:
      return "default";
  }
}

interface ControlLabelInput {
  id: string;
  label?: string | null;
}

function sentenceCase(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function splitCompactLabel(value: string, splitHyphen: boolean): string {
  const separatorPattern = splitHyphen ? /[_-]+/g : /_+/g;

  return value
    .replace(separatorPattern, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function formatControlLabel(option: ControlLabelInput, splitHyphen: boolean): string {
  const rawLabel = (option.label ?? option.id).trim();
  return sentenceCase(splitCompactLabel(rawLabel, splitHyphen));
}

export function formatAgentModeLabel(mode: ControlLabelInput): string {
  const compact = (mode.label ?? mode.id).replace(/[\s_-]+/g, "").toLowerCase();
  const localized = getLocalizedAgentModeLabel(compact);
  if (localized) {
    return localized;
  }
  return formatControlLabel(mode, mode.label == null);
}

export function formatThinkingOptionLabel(option: ControlLabelInput): string {
  const rawLabel = (option.label ?? option.id).trim();
  const compactId = option.id.replace(/[\s_-]+/g, "").toLowerCase();
  const compactLabel = rawLabel.replace(/[\s_-]+/g, "").toLowerCase();

  if (compactId === "xhigh" || compactLabel === "xhigh") {
    return translateNow("composer.thinking.extraHigh");
  }

  const localized = getLocalizedThinkingOptionLabel(compactLabel || compactId);
  if (localized) {
    return localized;
  }

  return formatControlLabel(option, true);
}

function getLocalizedAgentModeLabel(compact: string): string | null {
  switch (compact) {
    case "defaultpermissions":
    case "default":
      return translateNow("composer.agentMode.defaultPermissions");
    case "readonly":
    case "read":
      return translateNow("composer.agentMode.readOnly");
    case "autoaccept":
    case "autoacceptedits":
      return translateNow("composer.agentMode.autoAccept");
    case "autoreview":
      return translateNow("composer.agentMode.autoReview");
    case "fullaccess":
      return translateNow("composer.agentMode.fullAccess");
    case "planmode":
      return translateNow("composer.agentMode.plan");
    default:
      return null;
  }
}

function getLocalizedThinkingOptionLabel(compact: string): string | null {
  switch (compact) {
    case "minimal":
      return translateNow("composer.thinking.minimal");
    case "low":
      return translateNow("composer.thinking.low");
    case "medium":
      return translateNow("composer.thinking.medium");
    case "high":
      return translateNow("composer.thinking.high");
    case "extra":
    case "extrahigh":
      return translateNow("composer.thinking.extraHigh");
    case "auto":
    case "default":
      return translateNow("composer.thinking.auto");
    default:
      return null;
  }
}

function getLocalizedFeatureTooltip(feature: Pick<AgentFeature, "id">): string | null {
  switch (feature.id) {
    case "fast_mode":
      return translateNow("composer.agentFeature.fastMode.tooltip");
    case "plan_mode":
      return translateNow("composer.agentFeature.planMode.tooltip");
    case "auto_accept":
      return translateNow("composer.agentFeature.autoAccept.tooltip");
    default:
      return null;
  }
}

function findModelById(
  models: AgentModelDefinition[] | null,
  modelId: string | null,
): AgentModelDefinition | null {
  if (!models || !modelId) {
    return null;
  }
  return models.find((model) => model.id === modelId) ?? null;
}

function getFallbackModel(models: AgentModelDefinition[] | null): AgentModelDefinition | null {
  return models?.find((model) => model.isDefault) ?? models?.[0] ?? null;
}

function resolvePreferredModelId(
  runtimeSelectedModel: AgentModelDefinition | null,
  normalizedConfiguredModelId: string | null,
  normalizedRuntimeModelId: string | null,
): string | null {
  return runtimeSelectedModel?.id ?? normalizedConfiguredModelId ?? normalizedRuntimeModelId;
}

function pickSelectedModel(
  models: AgentModelDefinition[] | null,
  preferredModelId: string | null,
  fallbackModel: AgentModelDefinition | null,
): AgentModelDefinition | null {
  if (!models || !preferredModelId) {
    return fallbackModel;
  }
  return findModelById(models, preferredModelId) ?? fallbackModel;
}

function resolveThinkingId(
  explicitThinkingOptionId: string | null | undefined,
  selectedModel: AgentModelDefinition | null,
): string | null {
  if (explicitThinkingOptionId && explicitThinkingOptionId !== "default") {
    return explicitThinkingOptionId;
  }
  return selectedModel?.defaultThinkingOptionId ?? null;
}

type ThinkingOption = NonNullable<AgentModelDefinition["thinkingOptions"]>[number];

function resolveEffectiveThinking(
  thinkingOptions: ThinkingOption[] | null,
  resolvedThinkingId: string | null,
): ThinkingOption | null {
  const selectedThinking =
    thinkingOptions?.find((option) => option.id === resolvedThinkingId) ?? null;
  return selectedThinking ?? thinkingOptions?.[0] ?? null;
}

function resolveModelDisplay(
  selectedModel: AgentModelDefinition | null,
  preferredModelId: string | null,
  fallbackModel: AgentModelDefinition | null,
): { activeModelId: string | null; displayModel: string } {
  return {
    activeModelId: selectedModel?.id ?? preferredModelId ?? null,
    displayModel:
      selectedModel?.label ??
      preferredModelId ??
      fallbackModel?.label ??
      translateNow("composer.agentControls.unknownModel"),
  };
}

function resolveThinkingDisplay(
  effectiveThinking: ThinkingOption | null,
  selectedThinkingId: string | null,
): string {
  if (effectiveThinking) {
    return formatThinkingOptionLabel(effectiveThinking);
  }

  if (selectedThinkingId) {
    return formatThinkingOptionLabel({ id: selectedThinkingId });
  }

  return translateNow("composer.agentControls.unknown");
}

export function resolveAgentModelSelection(input: {
  models: AgentModelDefinition[] | null;
  runtimeModelId: string | null | undefined;
  configuredModelId: string | null | undefined;
  explicitThinkingOptionId: string | null | undefined;
}) {
  const { models, runtimeModelId, configuredModelId, explicitThinkingOptionId } = input;
  const normalizedRuntimeModelId = normalizeModelId(runtimeModelId);
  const normalizedConfiguredModelId = normalizeModelId(configuredModelId);

  const runtimeSelectedModel = findModelById(models, normalizedRuntimeModelId);
  const preferredModelId = resolvePreferredModelId(
    runtimeSelectedModel,
    normalizedConfiguredModelId,
    normalizedRuntimeModelId,
  );
  const fallbackModel = getFallbackModel(models);
  const selectedModel = pickSelectedModel(models, preferredModelId, fallbackModel);

  const { activeModelId, displayModel } = resolveModelDisplay(
    selectedModel,
    preferredModelId,
    fallbackModel,
  );

  const thinkingOptions = selectedModel?.thinkingOptions ?? null;
  const resolvedThinkingId = resolveThinkingId(explicitThinkingOptionId, selectedModel);
  const effectiveThinking = resolveEffectiveThinking(thinkingOptions, resolvedThinkingId);
  const selectedThinkingId = effectiveThinking?.id ?? null;
  const displayThinking = resolveThinkingDisplay(effectiveThinking, selectedThinkingId);

  return {
    selectedModel,
    activeModelId,
    displayModel,
    thinkingOptions,
    selectedThinkingId,
    displayThinking,
  };
}

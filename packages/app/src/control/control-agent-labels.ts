import { controlApiBaseUrl } from "@/control/control-api";

export const CONTROL_SESSION_ID_LABEL = "doya.control.sessionId";
export const CONTROL_RUNTIME_ID_LABEL = "doya.control.runtimeId";
export const CONTROL_NODE_ID_LABEL = "doya.control.nodeId";
export const CONTROL_API_BASE_URL_LABEL = "doya.control.apiBaseUrl";

export function buildControlAgentLabels(input: {
  sessionId: string;
  nodeId: string;
  runtimeId: string;
  baseLabels?: Record<string, string>;
}): Record<string, string> {
  const apiBaseUrl = controlApiBaseUrl();
  return {
    ...input.baseLabels,
    [CONTROL_SESSION_ID_LABEL]: input.sessionId,
    [CONTROL_RUNTIME_ID_LABEL]: input.runtimeId,
    [CONTROL_NODE_ID_LABEL]: input.nodeId,
    ...(apiBaseUrl ? { [CONTROL_API_BASE_URL_LABEL]: apiBaseUrl } : {}),
  };
}

export function getControlSessionIdFromLabels(labels: Record<string, string>): string | null {
  const sessionId = labels[CONTROL_SESSION_ID_LABEL]?.trim();
  return sessionId || null;
}

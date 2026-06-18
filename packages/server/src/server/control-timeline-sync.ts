import type { AgentStreamEvent } from "./agent/agent-sdk-types.js";
import type { Logger } from "pino";

export const CONTROL_SESSION_ID_LABEL = "doya.control.sessionId";
export const CONTROL_RUNTIME_ID_LABEL = "doya.control.runtimeId";
export const CONTROL_NODE_ID_LABEL = "doya.control.nodeId";
export const CONTROL_API_BASE_URL_LABEL = "doya.control.apiBaseUrl";

export interface ControlTimelineSyncInput {
  agentId: string;
  event: AgentStreamEvent;
  labels: Record<string, string>;
}

export interface ControlTimelineSync {
  sync(input: ControlTimelineSyncInput): Promise<void>;
}

export function createControlTimelineSync(options: { logger: Logger }): ControlTimelineSync {
  return {
    async sync(input) {
      if (!shouldSyncControlEvent(input.event)) {
        return;
      }
      const sessionId = input.labels[CONTROL_SESSION_ID_LABEL]?.trim();
      const runtimeId = input.labels[CONTROL_RUNTIME_ID_LABEL]?.trim();
      const nodeId = input.labels[CONTROL_NODE_ID_LABEL]?.trim();
      const apiBaseUrl = input.labels[CONTROL_API_BASE_URL_LABEL]?.trim();
      if (!sessionId || !runtimeId || !nodeId || !apiBaseUrl) {
        return;
      }
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/api/runtime-sync/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          runtimeId,
          nodeId,
          agentId: input.agentId,
          event: input.event,
        }),
      });
      if (!response.ok) {
        options.logger.warn(
          {
            agentId: input.agentId,
            status: response.status,
            sessionId,
            runtimeId,
          },
          "Control timeline sync request failed",
        );
      }
    },
  };
}

function shouldSyncControlEvent(event: AgentStreamEvent): boolean {
  return (
    event.type === "timeline" ||
    event.type === "turn_started" ||
    event.type === "turn_completed" ||
    event.type === "turn_failed" ||
    event.type === "turn_canceled"
  );
}

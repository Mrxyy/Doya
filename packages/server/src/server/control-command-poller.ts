import type { Logger } from "pino";

import { DAEMON_INTERNAL_AUTH_HEADER } from "./auth.js";
import type { ControlRegistrationConfig } from "./control-registration.js";

type DaemonCommandMethod = "DELETE" | "GET" | "PATCH" | "POST";

interface DaemonCommand {
  id: string;
  method: DaemonCommandMethod;
  endpointPath: string;
  body?: unknown;
}

interface PollResponse {
  commands?: DaemonCommand[];
}

export interface ControlCommandPollerInput {
  config: ControlRegistrationConfig | undefined;
  nodeId: string;
  localHttpBaseUrl: string | null;
  localInternalAuthToken?: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
}

export interface ControlCommandPoller {
  start(): void;
  stop(): void;
  pollOnce(): Promise<void>;
}

const DEFAULT_POLL_INTERVAL_MS = 1_000;

export function createControlCommandPoller(input: ControlCommandPollerInput): ControlCommandPoller {
  const logger = input.logger.child({ module: "control-command-poller" });
  const fetchImpl = input.fetchImpl ?? fetch;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let polling = false;
  let stopped = false;

  async function pollOnce(): Promise<void> {
    if (!shouldPoll(input.config) || !input.localHttpBaseUrl) {
      return;
    }
    const config = input.config;
    const localHttpBaseUrl = input.localHttpBaseUrl;
    if (polling) {
      return;
    }
    polling = true;
    try {
      const apiBaseUrl = config.apiBaseUrl.trim().replace(/\/$/, "");
      const response = await fetchImpl(`${apiBaseUrl}/api/nodes/${input.nodeId}/commands/poll`, {
        method: "POST",
        headers: controlHeaders(config),
        body: JSON.stringify({ maxCommands: 5 }),
      });
      if (!response.ok) {
        logger.warn({ status: response.status }, "Control command poll failed");
        return;
      }
      const payload = (await response.json()) as PollResponse;
      for (const command of payload.commands ?? []) {
        await executeAndReport({
          config,
          nodeId: input.nodeId,
          localHttpBaseUrl,
          command,
          apiBaseUrl,
          localInternalAuthToken: input.localInternalAuthToken,
          fetchImpl,
          logger,
        });
      }
    } catch (error) {
      logger.warn({ err: error }, "Control command poll failed");
    } finally {
      polling = false;
    }
  }

  return {
    start() {
      if (!shouldPoll(input.config) || !input.localHttpBaseUrl || pollTimer || stopped) {
        return;
      }
      void pollOnce();
      pollTimer = setInterval(
        () => void pollOnce(),
        input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      );
      pollTimer.unref?.();
    },

    stop() {
      stopped = true;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    },

    pollOnce,
  };
}

async function executeAndReport(input: {
  config: ControlRegistrationConfig;
  nodeId: string;
  localHttpBaseUrl: string;
  command: DaemonCommand;
  apiBaseUrl: string;
  localInternalAuthToken?: string;
  fetchImpl: typeof fetch;
  logger: Logger;
}): Promise<void> {
  const result = await executeLocalCommand(input).catch((error) => ({
    ok: false,
    status: 500,
    error: error instanceof Error ? error.message : "Daemon command execution failed",
  }));
  const response = await input.fetchImpl(
    `${input.apiBaseUrl}/api/nodes/${input.nodeId}/commands/${input.command.id}/result`,
    {
      method: "POST",
      headers: controlHeaders(input.config),
      body: JSON.stringify(result),
    },
  );
  if (!response.ok) {
    input.logger.warn(
      { status: response.status, commandId: input.command.id },
      "Control command result report failed",
    );
  }
}

async function executeLocalCommand(input: {
  localHttpBaseUrl: string;
  localInternalAuthToken?: string;
  command: DaemonCommand;
  fetchImpl: typeof fetch;
}): Promise<{ ok: boolean; status: number; body?: unknown; error?: string }> {
  const response = await input.fetchImpl(`${input.localHttpBaseUrl}${input.command.endpointPath}`, {
    method: input.command.method,
    headers: {
      "Content-Type": "application/json",
      ...(input.localInternalAuthToken
        ? { [DAEMON_INTERNAL_AUTH_HEADER]: input.localInternalAuthToken }
        : {}),
    },
    ...(input.command.body === undefined ? {} : { body: JSON.stringify(input.command.body) }),
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error:
        body && typeof body === "object" && "error" in body && typeof body.error === "string"
          ? body.error
          : "Daemon command failed",
    };
  }
  return { ok: true, status: response.status, body };
}

function controlHeaders(config: ControlRegistrationConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(config.runtimeAuthToken ? { Authorization: `Bearer ${config.runtimeAuthToken}` } : {}),
  };
}

function shouldPoll(
  config: ControlRegistrationConfig | undefined,
): config is ControlRegistrationConfig & { apiBaseUrl: string; authToken: string } {
  return (
    config?.enabled === true &&
    typeof config.apiBaseUrl === "string" &&
    !!config.apiBaseUrl.trim() &&
    typeof config.authToken === "string" &&
    !!config.authToken.trim()
  );
}

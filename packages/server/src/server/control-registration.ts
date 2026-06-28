import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Logger } from "pino";

import type { ProviderSnapshotEntry } from "./agent/agent-sdk-types.js";
import { ensurePrivateFile, writePrivateFileSync } from "./private-files.js";

export interface ControlRegistrationConfig {
  enabled: boolean;
  apiBaseUrl?: string;
  userId?: string;
  authToken?: string;
  nodeEndpoint?: string;
  publicNodeEndpoint?: string;
  runtimeAuthToken?: string;
  heartbeatIntervalMs?: number;
}

export interface ControlRegistrationInput {
  config: ControlRegistrationConfig | undefined;
  nodeId: string;
  doyaHome: string;
  defaultEndpoint: string;
  defaultPublicEndpoint?: string;
  runtimeAuthToken?: string | null;
  getCapabilities: () => Promise<unknown>;
  logger: Logger;
  fetchImpl?: typeof fetch;
}

export interface ControlRegistrationController {
  start(): void;
  stop(): void;
  registerNow(): Promise<void>;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const CONTROL_RUNTIME_TOKEN_FILENAME = "control-runtime-token";

export function createControlRegistration(
  input: ControlRegistrationInput,
): ControlRegistrationController {
  const logger = input.logger.child({ module: "control-registration" });
  const fetchImpl = input.fetchImpl ?? fetch;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  async function registerNow(): Promise<void> {
    if (!shouldRegister(input.config)) {
      return;
    }

    const config = input.config;
    const apiBaseUrl = config.apiBaseUrl.trim().replace(/\/$/, "");
    const body = {
      nodeId: input.nodeId,
      endpoint: config.nodeEndpoint?.trim() || input.defaultEndpoint,
      publicEndpoint: config.publicNodeEndpoint?.trim() || input.defaultPublicEndpoint || null,
      doyaHome: input.doyaHome,
      capabilities: await input.getCapabilities(),
      runtimeAuthToken: config.runtimeAuthToken ?? input.runtimeAuthToken ?? null,
      status: "online" as const,
    };

    const response = await fetchImpl(`${apiBaseUrl}/api/nodes/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.userId ? { "X-Doya-User-Id": config.userId } : {}),
        ...(config.authToken ? { Authorization: `Bearer ${config.authToken}` } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status, nodeId: input.nodeId },
        "Control node registration failed",
      );
      return;
    }

    logger.debug({ nodeId: input.nodeId }, "Control node registration refreshed");
  }

  async function registerSafely(): Promise<void> {
    try {
      await registerNow();
    } catch (error) {
      logger.warn({ err: error, nodeId: input.nodeId }, "Control node registration failed");
    }
  }

  return {
    start() {
      if (!shouldRegister(input.config) || heartbeatTimer || stopped) {
        return;
      }
      void registerSafely();
      heartbeatTimer = setInterval(
        () => void registerSafely(),
        input.config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
      );
      heartbeatTimer.unref?.();
    },

    stop() {
      stopped = true;
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    },

    registerNow,
  };
}

export function buildControlRegistrationCapabilities(input: {
  providers: ProviderSnapshotEntry[];
  relay: {
    enabled: boolean;
    endpoint: string;
    publicEndpoint: string;
    useTls: boolean;
    publicUseTls: boolean;
  };
  listen: string;
  version: string;
}): Record<string, unknown> {
  return {
    version: input.version,
    listen: input.listen,
    relay: input.relay,
    controlCommands: {
      polling: true,
      version: 1,
    },
    providers: input.providers.map((entry) => ({
      providerId: entry.provider,
      label: entry.label,
      enabled: entry.enabled,
      status: entry.status,
      error: entry.status === "error" ? entry.error : null,
      models: entry.models?.map((model) => ({
        id: model.id,
        label: model.label,
        isDefault: model.isDefault === true,
      })),
      modes: entry.modes?.map((mode) => ({
        id: mode.id,
        label: mode.label,
        isDefault: mode.id === entry.defaultModeId,
      })),
    })),
  };
}

export function resolveControlRuntimeAuthToken(input: {
  doyaHome: string;
  configuredToken?: string;
  logger?: Logger;
}): string {
  const configured = input.configuredToken?.trim();
  if (configured) {
    return configured;
  }

  const tokenPath = path.join(input.doyaHome, CONTROL_RUNTIME_TOKEN_FILENAME);
  if (existsSync(tokenPath)) {
    try {
      ensurePrivateFile(tokenPath);
      const existing = readFileSync(tokenPath, "utf8").trim();
      if (existing) {
        return existing;
      }
    } catch (error) {
      input.logger?.warn({ err: error, tokenPath }, "Failed to read control runtime token");
    }
  }

  const created = `crt_${randomBytes(32).toString("base64url")}`;
  writePrivateFileSync(tokenPath, `${created}\n`);
  return created;
}

function shouldRegister(
  config: ControlRegistrationConfig | undefined,
): config is ControlRegistrationConfig & { apiBaseUrl: string; userId: string; authToken: string } {
  return (
    config?.enabled === true &&
    typeof config.apiBaseUrl === "string" &&
    !!config.apiBaseUrl.trim() &&
    typeof config.userId === "string" &&
    !!config.userId.trim() &&
    typeof config.authToken === "string" &&
    !!config.authToken.trim()
  );
}

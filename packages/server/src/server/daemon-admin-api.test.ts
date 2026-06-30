import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@getdoya/protocol/messages";
import { createDaemonAdminApiRouter } from "./daemon-admin-api.js";
import type { ControlRegistrationConfig } from "./control-registration.js";

interface TestServer {
  server: Server;
  baseUrl: string;
}

let tempRoot: string;
let testServer: TestServer;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "doya-daemon-admin-api-"));
  testServer = await startDaemonAdminApiTestServer(tempRoot);
});

afterEach(async () => {
  await new Promise<void>((resolve) => testServer.server.close(() => resolve()));
  await rm(tempRoot, { recursive: true, force: true });
});

describe("daemon admin API", () => {
  it("reports local daemon load", async () => {
    const response = await fetch(`${testServer.baseUrl}/api/admin/daemon/load`);

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      status: string;
      nodeId: string;
      cpu: { loadAverage: number[] };
      memory: { totalBytes: number; usedRatio: number };
      disk: { totalBytes: number; usedRatio: number } | null;
    };
    expect(payload.status).toBe("ok");
    expect(payload.nodeId).toBe("node_1");
    expect(payload.cpu.loadAverage.length).toBeGreaterThan(0);
    expect(payload.memory.totalBytes).toBeGreaterThan(0);
    expect(payload.memory.usedRatio).toBeGreaterThanOrEqual(0);
  });

  it("requests daemon restart", async () => {
    const requested: Array<{ requestId: string; reason?: string }> = [];
    const server = await startDaemonAdminApiTestServer(tempRoot, {
      requestRestart: (input) => requested.push(input),
    });
    await new Promise<void>((resolve) => testServer.server.close(() => resolve()));
    testServer = server;

    const response = await fetch(`${testServer.baseUrl}/api/admin/daemon/restart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: "restart_1", reason: "test_restart" }),
    });

    expect(response.status).toBe(202);
    const payload = (await response.json()) as {
      status: string;
      requestId: string;
      reason: string;
    };
    expect(payload).toEqual(
      expect.objectContaining({
        status: "restart_requested",
        requestId: "restart_1",
        reason: "test_restart",
      }),
    );
    expect(requested).toEqual([{ requestId: "restart_1", reason: "test_restart" }]);
  });

  it("reads and patches daemon config", async () => {
    let config: MutableDaemonConfig = {
      mcp: { injectIntoAgents: true },
      providers: {},
      metadataGeneration: { providers: [] },
      autoArchiveAfterMerge: false,
      appendSystemPrompt: "",
    };
    const server = await startDaemonAdminApiTestServer(tempRoot, {
      getConfig: () => config,
      patchConfig: (patch) => {
        config = {
          ...config,
          ...patch,
          mcp: {
            ...config.mcp,
            ...patch.mcp,
          },
        };
        return config;
      },
    });
    await new Promise<void>((resolve) => testServer.server.close(() => resolve()));
    testServer = server;

    const getResponse = await fetch(`${testServer.baseUrl}/api/admin/daemon/config`);
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toEqual({
      config,
    });

    const patchResponse = await fetch(`${testServer.baseUrl}/api/admin/daemon/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mcp: { injectIntoAgents: false },
        appendSystemPrompt: "Use team defaults.",
      }),
    });

    expect(patchResponse.status).toBe(200);
    await expect(patchResponse.json()).resolves.toEqual({
      config: {
        ...config,
        mcp: { injectIntoAgents: false },
        appendSystemPrompt: "Use team defaults.",
      },
    });
  });

  it("applies control registration config without restarting the daemon", async () => {
    const applied: unknown[] = [];
    const server = await startDaemonAdminApiTestServer(tempRoot, {
      applyControlRegistration: (config) => applied.push(config),
    });
    await new Promise<void>((resolve) => testServer.server.close(() => resolve()));
    testServer = server;

    const response = await fetch(`${testServer.baseUrl}/api/admin/daemon/control-registration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        apiBaseUrl: "https://control.example.test",
        userId: "user_123",
        authToken: "token_abc",
        ownerUserId: "user_123",
      }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      status: "control_registration_applied",
      enabled: true,
    });
    expect(applied).toEqual([
      {
        enabled: true,
        apiBaseUrl: "https://control.example.test",
        userId: "user_123",
        authToken: "token_abc",
        ownerUserId: "user_123",
      },
    ]);
  });

  it("applies cloud control registration config without a user owner", async () => {
    const applied: unknown[] = [];
    const server = await startDaemonAdminApiTestServer(tempRoot, {
      applyControlRegistration: (config) => applied.push(config),
    });
    await new Promise<void>((resolve) => testServer.server.close(() => resolve()));
    testServer = server;

    const response = await fetch(`${testServer.baseUrl}/api/admin/daemon/control-registration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        apiBaseUrl: "https://control.example.test",
        authToken: "node-registration-secret",
        nodeEndpoint: "http://127.0.0.1:6868",
      }),
    });

    expect(response.status).toBe(202);
    expect(applied).toEqual([
      {
        enabled: true,
        apiBaseUrl: "https://control.example.test",
        authToken: "node-registration-secret",
        nodeEndpoint: "http://127.0.0.1:6868",
      },
    ]);
  });

  it("rejects enabled control registration without account credentials", async () => {
    const applied: unknown[] = [];
    const server = await startDaemonAdminApiTestServer(tempRoot, {
      applyControlRegistration: (config) => applied.push(config),
    });
    await new Promise<void>((resolve) => testServer.server.close(() => resolve()));
    testServer = server;

    const response = await fetch(`${testServer.baseUrl}/api/admin/daemon/control-registration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
      }),
    });

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain("required when control registration is enabled");
    expect(applied).toEqual([]);
  });

  it("allows disabling control registration without account credentials", async () => {
    const applied: unknown[] = [];
    const server = await startDaemonAdminApiTestServer(tempRoot, {
      applyControlRegistration: (config) => applied.push(config),
    });
    await new Promise<void>((resolve) => testServer.server.close(() => resolve()));
    testServer = server;

    const response = await fetch(`${testServer.baseUrl}/api/admin/daemon/control-registration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: false,
      }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      status: "control_registration_applied",
      enabled: false,
    });
    expect(applied).toEqual([{ enabled: false }]);
  });
});

async function startDaemonAdminApiTestServer(
  doyaHome: string,
  options: {
    getConfig?: () => MutableDaemonConfig;
    patchConfig?: (patch: MutableDaemonConfigPatch) => MutableDaemonConfig;
    requestRestart?: (input: { requestId: string; reason?: string }) => void;
    applyControlRegistration?: (config: ControlRegistrationConfig) => void;
  } = {},
): Promise<TestServer> {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/admin/daemon",
    createDaemonAdminApiRouter({
      doyaHome,
      nodeId: "node_1",
      ...(options.getConfig ? { getConfig: options.getConfig } : {}),
      ...(options.patchConfig ? { patchConfig: options.patchConfig } : {}),
      ...(options.requestRestart ? { requestRestart: options.requestRestart } : {}),
      ...(options.applyControlRegistration
        ? { applyControlRegistration: options.applyControlRegistration }
        : {}),
    }),
  );
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port");
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

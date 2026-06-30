import { createServer, request as httpRequest, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as zlib from "node:zlib";
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { createControlApp } from "./app.js";
import { ControlStore } from "../store.js";

let tempRoot: string;
let store: ControlStore;
let server: Server;
let baseUrl: string;
let currentTime: Date;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "doya-control-app-"));
  currentTime = new Date("2026-01-01T00:00:00.000Z");
  store = new ControlStore({
    filePath: path.join(tempRoot, "control.json"),
    now: () => currentTime,
  });
  const app = createControlApp(store);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  delete process.env.DOYA_CONTROL_NODE_REGISTRATION_TOKEN;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await store.flush();
  await rm(tempRoot, { recursive: true, force: true });
});

describe("sessions", () => {
  it("answers CORS preflight requests for session routes", async () => {
    const response = await fetch(`${baseUrl}/api/sessions/ses_1/agent-binding`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:8081",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,x-doya-user-id,content-type",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toContain("OPTIONS");
    expect(response.headers.get("access-control-allow-headers")).toContain("Authorization");
  });

  it("returns 401 for invalid session credentials", async () => {
    const account = await register();
    const invalidTokenResponse = await fetch(`${baseUrl}/api/sessions?limit=200`, {
      headers: jsonHeaders({ ...account, accessToken: "token_invalid" }),
    });
    const invalidUserResponse = await fetch(`${baseUrl}/api/sessions?limit=200`, {
      headers: jsonHeaders({ user: { id: "usr_missing" }, accessToken: account.accessToken }),
    });

    expect(invalidTokenResponse.status).toBe(401);
    await expect(invalidTokenResponse.json()).resolves.toEqual({
      error: "Authentication required",
    });
    expect(invalidUserResponse.status).toBe(401);
    await expect(invalidUserResponse.json()).resolves.toEqual({
      error: "Authentication required",
    });
  });

  it("updates and deletes control-owned conversation sessions", async () => {
    const account = await register();
    const sessionResponse = await createGeneratedSession(account, "Initial title");

    const updateResponse = await fetchJson<{
      session: { id: string; title: string; status: string };
    }>(`/api/sessions/${sessionResponse.session.id}`, {
      method: "PATCH",
      account,
      body: {
        title: "Renamed session",
        status: "needs_input",
      },
    });

    expect(updateResponse.session).toEqual(
      expect.objectContaining({
        id: sessionResponse.session.id,
        title: "Renamed session",
        status: "needs_input",
      }),
    );

    const deleteResponse = await fetch(`${baseUrl}/api/sessions/${sessionResponse.session.id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        "X-Doya-User-Id": account.user.id,
      },
    });
    expect(deleteResponse.status).toBe(204);

    const listResponse = await fetchJson<{ sessions: Array<{ id: string }> }>("/api/sessions", {
      account,
    });
    expect(listResponse.sessions).toEqual([]);

    const getDeletedResponse = await fetch(
      `${baseUrl}/api/sessions/${sessionResponse.session.id}`,
      {
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          "X-Doya-User-Id": account.user.id,
        },
      },
    );
    expect(getDeletedResponse.status).toBe(404);
  });
});

describe("daemon command polling", () => {
  it("allows an authenticated daemon node registration with account headers", async () => {
    const account = await register();
    const response = await fetchJson<{
      node: { id: string; runtimeAuthToken?: string };
    }>("/api/nodes/register", {
      method: "POST",
      account,
      body: {
        nodeId: "node_1",
        endpoint: "http://127.0.0.1:6767",
        runtimeAuthToken: "daemon-secret",
        capabilities: {
          controlCommands: { polling: true, version: 1 },
        },
      },
    });

    expect(response.node.id).toBe("node_1");
    expect(response.node.runtimeAuthToken).toBeUndefined();
    expect((await store.getNode("node_1")).runtimeAuthToken).toBe("daemon-secret");
  });

  it("routes supported daemon requests through polled commands", async () => {
    const account = await register();
    await store.registerNode({
      nodeId: "node_1",
      endpoint: "http://127.0.0.1:1",
      runtimeAuthToken: "daemon-secret",
      capabilities: {
        controlCommands: {
          polling: true,
          version: 1,
        },
      },
    });

    const overviewPromise = fetchJson<{
      daemonNodes: Array<{ load: { status: string; nodeId?: string } }>;
    }>("/api/admin/daemon-overview", { account });

    const command = await pollForCommand("node_1", "daemon-secret");
    expect(command).toMatchObject({
      method: "GET",
      endpointPath: "/api/admin/daemon/load",
    });

    const resultResponse = await fetch(
      `${baseUrl}/api/nodes/node_1/commands/${command.id}/result`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer daemon-secret",
        },
        body: JSON.stringify({
          ok: true,
          status: 200,
          body: {
            status: "ok",
            nodeId: "node_1",
            sampledAt: "2026-01-01T00:00:00.000Z",
            cpu: { loadAverage: [0.1, 0.2, 0.3] },
            memory: {
              totalBytes: 100,
              freeBytes: 70,
              usedBytes: 30,
              usedRatio: 0.3,
            },
            disk: null,
            uptimeSeconds: 4,
          },
        }),
      },
    );
    expect(resultResponse.status).toBe(202);

    const overview = await overviewPromise;
    expect(overview.daemonNodes[0]?.load).toMatchObject({
      status: "ok",
      nodeId: "node_1",
    });
  });

  it("returns daemon admin overview without a user login", async () => {
    await store.registerNode({
      nodeId: "node_1",
      endpoint: "http://127.0.0.1:6767",
      status: "online",
    });

    const response = await fetch(`${baseUrl}/api/admin/daemon-overview`);

    expect(response.status).toBe(200);
    const overview = (await response.json()) as {
      daemonNodes: Array<{ node: { id: string } }>;
    };
    expect(overview.daemonNodes.map((summary) => summary.node.id)).toEqual(["node_1"]);
  });

  it("rejects command results reported by a different runtime node", async () => {
    const account = await register();
    await store.registerNode({
      nodeId: "node_1",
      endpoint: "http://127.0.0.1:1",
      runtimeAuthToken: "daemon-secret-1",
      capabilities: {
        controlCommands: {
          polling: true,
          version: 1,
        },
      },
    });
    await store.registerNode({
      nodeId: "node_2",
      endpoint: "http://127.0.0.1:2",
      runtimeAuthToken: "daemon-secret-2",
      capabilities: {
        controlCommands: {
          polling: true,
          version: 1,
        },
      },
    });

    const configPromise = fetchJson<{ config: { relayEnabled: boolean } }>(
      "/api/admin/nodes/node_1/config",
      { account },
    );

    const command = await pollForCommand("node_1", "daemon-secret-1");
    const wrongNodeResponse = await fetch(
      `${baseUrl}/api/nodes/node_2/commands/${command.id}/result`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer daemon-secret-2",
        },
        body: JSON.stringify({
          ok: true,
          status: 200,
          body: { config: { relayEnabled: false } },
        }),
      },
    );
    expect(wrongNodeResponse.status).toBe(404);

    const correctNodeResponse = await fetch(
      `${baseUrl}/api/nodes/node_1/commands/${command.id}/result`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer daemon-secret-1",
        },
        body: JSON.stringify({
          ok: true,
          status: 200,
          body: { config: { relayEnabled: true } },
        }),
      },
    );
    expect(correctNodeResponse.status).toBe(202);
    await expect(configPromise).resolves.toEqual({ config: { relayEnabled: true } });
  });

  it("requires daemon runtime token when polling commands", async () => {
    await store.registerNode({
      nodeId: "node_1",
      endpoint: "http://127.0.0.1:1",
      runtimeAuthToken: "daemon-secret",
    });

    const response = await fetch(`${baseUrl}/api/nodes/node_1/commands/poll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-secret",
      },
      body: JSON.stringify({ maxCommands: 1 }),
    });

    expect(response.status).toBe(401);
  });

  it("rejects command polling for nodes without a runtime token", async () => {
    await store.registerNode({
      nodeId: "node_1",
      endpoint: "http://127.0.0.1:1",
    });

    const response = await fetch(`${baseUrl}/api/nodes/node_1/commands/poll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ maxCommands: 1 }),
    });

    expect(response.status).toBe(401);
  });
});

describe("billing", () => {
  it("returns managed Codex config from control environment", async () => {
    const account = await register();
    const previousBaseUrl = process.env.DOYA_CONTROL_MANAGED_CODEX_BASE_URL;
    const previousApiKey = process.env.DOYA_CONTROL_MANAGED_CODEX_API_KEY;
    const previousModel = process.env.DOYA_CONTROL_MANAGED_CODEX_MODEL;
    process.env.DOYA_CONTROL_MANAGED_CODEX_BASE_URL = "https://sub2api.example.com";
    process.env.DOYA_CONTROL_MANAGED_CODEX_API_KEY = "doya-runtime-token";
    process.env.DOYA_CONTROL_MANAGED_CODEX_MODEL = "managed-codex-model";
    try {
      const payload = await fetchJson<{
        codex: {
          enabled: boolean;
          baseUrl: string | null;
          apiKey: string | null;
          model: string | null;
        };
      }>("/api/providers/managed-codex", { account });

      expect(payload.codex).toEqual({
        enabled: true,
        baseUrl: "https://sub2api.example.com",
        apiKey: "doya-runtime-token",
        model: "managed-codex-model",
      });
    } finally {
      restoreEnv("DOYA_CONTROL_MANAGED_CODEX_BASE_URL", previousBaseUrl);
      restoreEnv("DOYA_CONTROL_MANAGED_CODEX_API_KEY", previousApiKey);
      restoreEnv("DOYA_CONTROL_MANAGED_CODEX_MODEL", previousModel);
    }
  });

  it("returns a Doya AI Gateway runtime key for the current Doya user", async () => {
    const account = await register();
    const previousEnv = snapshotEnv([
      "DOYA_CONTROL_MANAGED_CODEX_API_KEY",
      "DOYA_CONTROL_MANAGED_CODEX_MODEL",
      "DOYA_CONTROL_AI_GATEWAY_PUBLIC_BASE_URL",
      "DOYA_CONTROL_AI_GATEWAY_UPSTREAM_BASE_URL",
      "DOYA_CONTROL_AI_GATEWAY_UPSTREAM_API_KEY",
    ]);
    delete process.env.DOYA_CONTROL_MANAGED_CODEX_API_KEY;
    process.env.DOYA_CONTROL_AI_GATEWAY_PUBLIC_BASE_URL = "https://control.example.com";
    process.env.DOYA_CONTROL_AI_GATEWAY_UPSTREAM_BASE_URL = "https://upstream.example.com";
    process.env.DOYA_CONTROL_AI_GATEWAY_UPSTREAM_API_KEY = "upstream-token";
    try {
      const payload = await fetchJson<{
        codex: {
          enabled: boolean;
          baseUrl: string | null;
          apiKey: string | null;
          model: string | null;
        };
      }>("/api/providers/managed-codex", { account });

      expect(payload.codex.enabled).toBe(true);
      expect(payload.codex.baseUrl).toBe("https://control.example.com/api/ai-gateway");
      expect(payload.codex.apiKey).toMatch(/^doya_rt_/);
      expect(payload.codex.model).toBe(null);
    } finally {
      restoreEnvSnapshot(previousEnv);
    }
  });

  it("proxies AI Gateway requests and bills response usage to Doya balance", async () => {
    const account = await register();
    const upstream = await startFakeAiGatewayUpstream();
    const previousEnv = snapshotEnv([
      "DOYA_CONTROL_MANAGED_CODEX_API_KEY",
      "DOYA_CONTROL_AI_GATEWAY_PUBLIC_BASE_URL",
      "DOYA_CONTROL_AI_GATEWAY_UPSTREAM_BASE_URL",
      "DOYA_CONTROL_AI_GATEWAY_UPSTREAM_API_KEY",
    ]);
    delete process.env.DOYA_CONTROL_MANAGED_CODEX_API_KEY;
    process.env.DOYA_CONTROL_AI_GATEWAY_PUBLIC_BASE_URL = baseUrl;
    process.env.DOYA_CONTROL_AI_GATEWAY_UPSTREAM_BASE_URL = upstream.baseUrl;
    process.env.DOYA_CONTROL_AI_GATEWAY_UPSTREAM_API_KEY = "upstream-token";
    try {
      const managed = await fetchJson<{
        codex: { enabled: boolean; baseUrl: string | null; apiKey: string | null };
      }>("/api/providers/managed-codex", { account });
      expect(managed.codex.apiKey).toMatch(/^doya_rt_/);

      const before = await store.getBillingSummary({ userId: account.user.id });
      const response = await fetch(`${baseUrl}/api/ai-gateway/v1/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept-Encoding": "gzip, deflate, br, zstd",
          Authorization: `Bearer ${managed.codex.apiKey}`,
        },
        body: JSON.stringify({ model: "gpt-5.4-mini", input: "hello" }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(
        expect.objectContaining({ id: "resp_gateway_test", model: "gpt-5.4-mini" }),
      );
      expect(upstream.authorizationHeaders()).toEqual(["Bearer upstream-token"]);
      expect(upstream.acceptEncodingHeaders()).toEqual(["identity"]);
      const after = await store.getBillingSummary({ userId: account.user.id });
      expect(after.balanceCny).toBeLessThan(before.balanceCny);
      expect(after.recentUsageLogs[0]).toEqual(
        expect.objectContaining({
          providerId: "openai",
          modelId: "gpt-5.4-mini",
          inputTokens: 100,
          outputTokens: 20,
        }),
      );
    } finally {
      restoreEnvSnapshot(previousEnv);
      await upstream.close();
    }
  });

  it("decodes zstd-encoded AI Gateway upstream responses before returning to Codex", async () => {
    const upstream = await startFakeAiGatewayUpstream({ contentEncoding: "zstd" });
    const account = await register();
    await store.createAdminTopUp({
      userId: account.user.id,
      amountCny: 3,
      note: "managed codex zstd upstream",
    });
    const previousEnv = snapshotEnv([
      "DOYA_CONTROL_MANAGED_CODEX_API_KEY",
      "DOYA_CONTROL_AI_GATEWAY_PUBLIC_BASE_URL",
      "DOYA_CONTROL_AI_GATEWAY_UPSTREAM_BASE_URL",
      "DOYA_CONTROL_AI_GATEWAY_UPSTREAM_API_KEY",
    ]);
    delete process.env.DOYA_CONTROL_MANAGED_CODEX_API_KEY;
    process.env.DOYA_CONTROL_AI_GATEWAY_PUBLIC_BASE_URL = baseUrl;
    process.env.DOYA_CONTROL_AI_GATEWAY_UPSTREAM_BASE_URL = upstream.baseUrl;
    process.env.DOYA_CONTROL_AI_GATEWAY_UPSTREAM_API_KEY = "upstream-token";
    try {
      const managed = await fetchJson<{
        codex: { apiKey: string | null };
      }>("/api/providers/managed-codex", { account });

      const response = await rawHttpRequest(`${baseUrl}/api/ai-gateway/v1/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept-Encoding": "gzip, deflate, br, zstd",
          Authorization: `Bearer ${managed.codex.apiKey}`,
        },
        body: JSON.stringify({ model: "gpt-5.4-mini", input: "hello" }),
      });

      expect(response.status).toBe(200);
      expect(response.headers["content-encoding"]).toBeUndefined();
      expect(response.body).toContain("resp_gateway_test");
      expect(upstream.acceptEncodingHeaders()).toEqual(["identity"]);
    } finally {
      restoreEnvSnapshot(previousEnv);
      await upstream.close();
    }
  });

  it("withholds the Doya AI Gateway runtime key when the account has no balance", async () => {
    const account = await register();
    await store.createAdminAdjustment({
      userId: account.user.id,
      amountCny: -3,
      note: "managed codex zero balance",
    });
    const previousEnv = snapshotEnv([
      "DOYA_CONTROL_MANAGED_CODEX_API_KEY",
      "DOYA_CONTROL_AI_GATEWAY_UPSTREAM_BASE_URL",
      "DOYA_CONTROL_AI_GATEWAY_UPSTREAM_API_KEY",
    ]);
    delete process.env.DOYA_CONTROL_MANAGED_CODEX_API_KEY;
    process.env.DOYA_CONTROL_AI_GATEWAY_UPSTREAM_BASE_URL = "https://upstream.example.com";
    process.env.DOYA_CONTROL_AI_GATEWAY_UPSTREAM_API_KEY = "upstream-token";
    try {
      const payload = await fetchJson<{
        codex: {
          enabled: boolean;
          baseUrl: string | null;
          apiKey: string | null;
          model: string | null;
        };
      }>("/api/providers/managed-codex", { account });

      expect(payload.codex).toEqual({
        enabled: false,
        baseUrl: null,
        apiKey: null,
        model: null,
      });
    } finally {
      restoreEnvSnapshot(previousEnv);
    }
  });

  it("withholds the Doya AI Gateway runtime key when upstream env is unavailable", async () => {
    const account = await register();
    const previousBaseUrl = process.env.DOYA_CONTROL_MANAGED_CODEX_BASE_URL;
    const previousApiKey = process.env.DOYA_CONTROL_MANAGED_CODEX_API_KEY;
    const previousModel = process.env.DOYA_CONTROL_MANAGED_CODEX_MODEL;
    const previousGatewayUpstreamBaseUrl = process.env.DOYA_CONTROL_AI_GATEWAY_UPSTREAM_BASE_URL;
    const previousGatewayUpstreamApiKey = process.env.DOYA_CONTROL_AI_GATEWAY_UPSTREAM_API_KEY;
    delete process.env.DOYA_CONTROL_MANAGED_CODEX_BASE_URL;
    delete process.env.DOYA_CONTROL_MANAGED_CODEX_API_KEY;
    delete process.env.DOYA_CONTROL_MANAGED_CODEX_MODEL;
    delete process.env.DOYA_CONTROL_AI_GATEWAY_UPSTREAM_BASE_URL;
    delete process.env.DOYA_CONTROL_AI_GATEWAY_UPSTREAM_API_KEY;
    try {
      const payload = await fetchJson<{
        codex: {
          enabled: boolean;
          baseUrl: string | null;
          apiKey: string | null;
          model: string | null;
        };
      }>("/api/providers/managed-codex", { account });

      expect(payload.codex).toEqual({
        enabled: false,
        baseUrl: null,
        apiKey: null,
        model: null,
      });
    } finally {
      restoreEnv("DOYA_CONTROL_MANAGED_CODEX_BASE_URL", previousBaseUrl);
      restoreEnv("DOYA_CONTROL_MANAGED_CODEX_API_KEY", previousApiKey);
      restoreEnv("DOYA_CONTROL_MANAGED_CODEX_MODEL", previousModel);
      restoreEnv("DOYA_CONTROL_AI_GATEWAY_UPSTREAM_BASE_URL", previousGatewayUpstreamBaseUrl);
      restoreEnv("DOYA_CONTROL_AI_GATEWAY_UPSTREAM_API_KEY", previousGatewayUpstreamApiKey);
    }
  });

  it("seeds official OpenAI and Claude API fallback pricing", async () => {
    const account = await register();

    const state = await fetchJson<{
      pricing: Array<{
        providerId: string;
        modelId: string;
        source: string;
        inputPriceUsdPerToken: number;
        outputPriceUsdPerToken: number;
        cacheCreationPriceUsdPerToken: number;
        cacheReadPriceUsdPerToken: number;
      }>;
    }>("/api/admin/billing", { account });
    const fallbackByKey = new Map(
      state.pricing
        .filter((entry) => entry.source === "fallback")
        .map((entry) => [`${entry.providerId}/${entry.modelId}`, entry]),
    );

    expect([...fallbackByKey.keys()]).toEqual(
      expect.arrayContaining([
        "openai/gpt-5.5",
        "openai/gpt-5.4",
        "openai/gpt-5.4-mini",
        "claude/claude-fable-5",
        "claude/claude-opus-4.8",
        "claude/claude-sonnet-4.6",
        "claude/claude-haiku-4.5",
      ]),
    );
    expect(fallbackByKey.get("openai/gpt-5.5")).toEqual(
      expect.objectContaining({
        inputPriceUsdPerToken: 5e-6,
        outputPriceUsdPerToken: 30e-6,
        cacheReadPriceUsdPerToken: 0.5e-6,
      }),
    );
    expect(fallbackByKey.get("claude/claude-fable-5")).toEqual(
      expect.objectContaining({
        inputPriceUsdPerToken: 10e-6,
        outputPriceUsdPerToken: 50e-6,
        cacheCreationPriceUsdPerToken: 12.5e-6,
        cacheReadPriceUsdPerToken: 1e-6,
      }),
    );
    expect(fallbackByKey.has("z-ai/glm-5.1")).toBe(false);
  });

  it("exposes enabled pricing to signed-in users", async () => {
    const account = await register();

    const payload = await fetchJson<{
      pricing: Array<{ providerId: string; modelId: string; enabled: boolean }>;
    }>("/api/billing/pricing", { account });

    expect(payload.pricing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: "openai",
          modelId: "gpt-5.5",
          enabled: true,
        }),
      ]),
    );
    expect(payload.pricing.every((entry) => entry.enabled)).toBe(true);
  });

  it("grants monthly credits, records usage once, snapshots pricing, and detects conflicts", async () => {
    const account = await register();
    const sessionResponse = await createGeneratedSession(account, "Billable session");
    await fetchJson<{ pricing: { id: string } }>("/api/admin/billing/pricing", {
      method: "POST",
      account,
      body: {
        providerId: "claude",
        modelId: "sonnet",
        displayName: "Claude Sonnet",
        inputPriceUsdPerToken: 0.000003,
        outputPriceUsdPerToken: 0.000015,
        cacheCreationPriceUsdPerToken: 0.00000375,
        cacheReadPriceUsdPerToken: 0.0000003,
      },
    });

    const initialSummary = await fetchJson<{ balanceCny: number; ledger: Array<{ kind: string }> }>(
      "/api/billing/summary",
      { account },
    );
    expect(initialSummary.balanceCny).toBe(3);
    expect(initialSummary.ledger.some((entry) => entry.kind === "monthly_grant")).toBe(true);

    const usage = await fetchJson<{
      applied: boolean;
      usageLog: {
        requestId: string;
        inputTokens: number;
        cacheReadTokens: number;
        inputCostUsd: number;
        actualCostCny: number;
        pricingSnapshot: { inputPriceUsdPerToken: number };
      };
      ledgerEntry: { kind: string; amountCny: number };
    }>("/api/billing/usage-turns", {
      method: "POST",
      account,
      body: {
        sessionId: sessionResponse.session.id,
        runtimeId: "rt_bill",
        agentId: "agent_bill",
        providerId: "claude",
        modelId: "sonnet",
        turnId: "turn_1",
        requestId: "rt_bill:agent_bill:turn_1",
        requestFingerprint: "fp_1",
        tokens: {
          inputTokens: 1000,
          outputTokens: 500,
          cachedInputTokens: 300,
          cacheCreationTokens: 200,
        },
      },
    });
    expect(usage.applied).toBe(true);
    expect(usage.usageLog.cacheReadTokens).toBe(300);
    expect(usage.usageLog.inputCostUsd).toBeCloseTo(700 * 0.000003);
    expect(usage.usageLog.actualCostCny).toBeCloseTo(
      (700 * 0.000003 + 500 * 0.000015 + 200 * 0.00000375 + 300 * 0.0000003) * 1.3 * 7.2,
    );
    expect(usage.usageLog.pricingSnapshot.inputPriceUsdPerToken).toBe(0.000003);
    expect(usage.ledgerEntry.kind).toBe("usage_charge");
    expect(usage.ledgerEntry.amountCny).toBeLessThan(0);

    await fetchJson<{ pricing: { id: string } }>("/api/admin/billing/pricing", {
      method: "POST",
      account,
      body: {
        providerId: "claude",
        modelId: "sonnet",
        displayName: "Claude Sonnet",
        inputPriceUsdPerToken: 0.5,
        outputPriceUsdPerToken: 0.5,
        cacheCreationPriceUsdPerToken: 0.5,
        cacheReadPriceUsdPerToken: 0.5,
      },
    });

    const replay = await fetchJson<{ applied: boolean; usageLog: { actualCostCny: number } }>(
      "/api/billing/usage-turns",
      {
        method: "POST",
        account,
        body: {
          sessionId: sessionResponse.session.id,
          runtimeId: "rt_bill",
          agentId: "agent_bill",
          providerId: "claude",
          modelId: "sonnet",
          turnId: "turn_1",
          requestId: "rt_bill:agent_bill:turn_1",
          requestFingerprint: "fp_1",
          tokens: {
            inputTokens: 1000,
            outputTokens: 500,
            cachedInputTokens: 300,
            cacheCreationTokens: 200,
          },
        },
      },
    );
    expect(replay.applied).toBe(false);
    expect(replay.usageLog.actualCostCny).toBe(usage.usageLog.actualCostCny);

    const conflict = await fetch(`${baseUrl}/api/billing/usage-turns`, {
      method: "POST",
      headers: jsonHeaders(account),
      body: JSON.stringify({
        sessionId: sessionResponse.session.id,
        runtimeId: "rt_bill",
        agentId: "agent_bill",
        providerId: "claude",
        modelId: "sonnet",
        turnId: "turn_1",
        requestId: "rt_bill:agent_bill:turn_1",
        requestFingerprint: "fp_2",
        tokens: {
          inputTokens: 1000,
        },
      }),
    });
    expect(conflict.status).toBe(409);
  });

  it("blocks preflight when model pricing is missing", async () => {
    const account = await register();

    const response = await fetch(`${baseUrl}/api/billing/preflight`, {
      method: "POST",
      headers: jsonHeaders(account),
      body: JSON.stringify({
        providerId: "claude",
        modelId: "missing",
      }),
    });

    expect(response.status).toBe(402);
  });

  it("matches Codex GPT-5.5 usage to OpenAI official pricing", async () => {
    const account = await register();
    const sessionResponse = await createGeneratedSession(account, "Codex billed session");

    const preflight = await fetchJson<{ ok: boolean }>("/api/billing/preflight", {
      method: "POST",
      account,
      body: {
        providerId: "codex",
        modelId: "5.5",
      },
    });
    expect(preflight.ok).toBe(true);

    const usage = await fetchJson<{
      usageLog: {
        pricingSnapshot: { providerId: string; modelId: string };
        inputCostUsd: number;
        outputCostUsd: number;
        cacheReadCostUsd: number;
      };
    }>("/api/billing/usage-turns", {
      method: "POST",
      account,
      body: {
        sessionId: sessionResponse.session.id,
        runtimeId: "rt_codex_55",
        agentId: "agent_codex_55",
        providerId: "codex",
        modelId: "gpt-5.5",
        turnId: "turn_1",
        requestFingerprint: "fp_codex_55",
        tokens: {
          inputTokens: 100,
          cachedInputTokens: 20,
          outputTokens: 10,
        },
      },
    });

    expect(usage.usageLog.pricingSnapshot).toEqual(
      expect.objectContaining({ providerId: "openai", modelId: "gpt-5.5" }),
    );
    expect(usage.usageLog.inputCostUsd).toBeCloseTo(80 * 5e-6);
    expect(usage.usageLog.outputCostUsd).toBeCloseTo(10 * 30e-6);
    expect(usage.usageLog.cacheReadCostUsd).toBeCloseTo(20 * 0.5e-6);
  });

  it("blocks unknown billable runtime allocation before pricing exists", async () => {
    const account = await register();
    const sessionResponse = await createGeneratedSession(account, "Preflight runtime");

    const missingPricingResponse = await fetch(
      `${baseUrl}/api/sessions/${sessionResponse.session.id}/runtimes`,
      {
        method: "POST",
        headers: jsonHeaders(account),
        body: JSON.stringify({
          nodeId: "node_1",
          runtimeId: "rt_1",
          providerId: "unknown-provider",
          modelId: "unknown-model",
          workspaceDir: "/tmp/runtime/workspace",
        }),
      },
    );
    expect(missingPricingResponse.status).toBe(402);

    await fetchJson<{ pricing: { id: string } }>("/api/admin/billing/pricing", {
      method: "POST",
      account,
      body: {
        providerId: "unknown-provider",
        modelId: "unknown-model",
        displayName: "Unknown Model",
        inputPriceUsdPerToken: 0.000003,
        outputPriceUsdPerToken: 0.000015,
        cacheCreationPriceUsdPerToken: 0.00000375,
        cacheReadPriceUsdPerToken: 0.0000003,
      },
    });
    await store.registerNode({ nodeId: "node_1", endpoint: "http://127.0.0.1:6767" });

    const runtimeResponse = await fetchJson<{ runtime: { runtimeId: string } }>(
      `/api/sessions/${sessionResponse.session.id}/runtimes`,
      {
        method: "POST",
        account,
        body: {
          nodeId: "node_1",
          runtimeId: "rt_1",
          providerId: "unknown-provider",
          modelId: "unknown-model",
          workspaceDir: "/tmp/runtime/workspace",
        },
      },
    );
    expect(runtimeResponse.runtime.runtimeId).toBe("rt_1");
  });

  it("allows runtime allocation when the provider uses its default model", async () => {
    const account = await register();
    const sessionResponse = await createGeneratedSession(account, "Default model runtime");
    await store.registerNode({ nodeId: "node_1", endpoint: "http://127.0.0.1:6767" });

    const runtimeResponse = await fetchJson<{
      runtime: { runtimeId: string; providerId: string; modelId: string | null };
    }>(`/api/sessions/${sessionResponse.session.id}/runtimes`, {
      method: "POST",
      account,
      body: {
        nodeId: "node_1",
        runtimeId: "rt_default_model",
        providerId: "claude",
        modelId: null,
        workspaceDir: "/tmp/runtime/workspace",
      },
    });

    expect(runtimeResponse.runtime).toEqual(
      expect.objectContaining({
        runtimeId: "rt_default_model",
        providerId: "claude",
        modelId: null,
      }),
    );
  });

  it("blocks billable runtime allocation when pricing lacks real usage accounting", async () => {
    const account = await register();
    const sessionResponse = await createGeneratedSession(account, "Unsupported usage accounting");
    await fetchJson<{ pricing: { id: string } }>("/api/admin/billing/pricing", {
      method: "POST",
      account,
      body: {
        providerId: "mock",
        modelId: "estimated",
        displayName: "Estimated Model",
        inputPriceUsdPerToken: 0.000001,
        outputPriceUsdPerToken: 0.000001,
        cacheCreationPriceUsdPerToken: 0,
        cacheReadPriceUsdPerToken: 0,
        supportsUsageAccounting: false,
      },
    });

    const response = await fetch(`${baseUrl}/api/sessions/${sessionResponse.session.id}/runtimes`, {
      method: "POST",
      headers: jsonHeaders(account),
      body: JSON.stringify({
        nodeId: "node_1",
        runtimeId: "rt_estimated",
        providerId: "mock",
        modelId: "estimated",
        workspaceDir: "/tmp/runtime/workspace",
      }),
    });

    expect(response.status).toBe(402);
  });

  it("filters admin usage aggregation by provider and model", async () => {
    const account = await register();
    const sessionResponse = await createGeneratedSession(account, "Filtered usage");
    for (const modelId of ["sonnet", "opus"]) {
      await fetchJson<{ pricing: { id: string } }>("/api/admin/billing/pricing", {
        method: "POST",
        account,
        body: {
          providerId: "claude",
          modelId,
          displayName: `Claude ${modelId}`,
          inputPriceUsdPerToken: 0.000003,
          outputPriceUsdPerToken: 0.000015,
          cacheCreationPriceUsdPerToken: 0,
          cacheReadPriceUsdPerToken: 0,
        },
      });
      await fetchJson("/api/billing/usage-turns", {
        method: "POST",
        account,
        body: {
          sessionId: sessionResponse.session.id,
          runtimeId: `rt_${modelId}`,
          agentId: `agent_${modelId}`,
          providerId: "claude",
          modelId,
          turnId: "turn_1",
          requestFingerprint: `fp_${modelId}`,
          tokens: { inputTokens: 100, outputTokens: 10 },
        },
      });
    }

    const filtered = await fetchJson<{
      usage: { requestCount: number };
      usageLogs: Array<{ modelId: string }>;
    }>("/api/admin/billing?providerId=claude&modelId=sonnet", { account });

    expect(filtered.usage.requestCount).toBe(1);
    expect(filtered.usageLogs).toEqual([expect.objectContaining({ modelId: "sonnet" })]);
  });

  it("updates user plans by switching balance to the plan quota", async () => {
    const account = await register();
    await store.createAdminTopUp({
      userId: account.user.id,
      amountCny: 194.12,
      note: "manual balance",
    });
    await store.updateBillingPlanDefinition({
      planId: "pro",
      priceCny: 39,
      monthlyGrantCny: 1,
      workspaceBytesLimit: 5 * 1024 * 1024 * 1024,
      singleUploadBytesLimit: 200 * 1024 * 1024,
      enabled: true,
    });

    const planUpdate = await fetchJson<{
      account: { planId: string; status: string };
      ledgerEntry: { kind: string; amountCny: number } | null;
      balanceCny: number;
    }>("/api/admin/billing/users/plan", {
      method: "PATCH",
      account,
      body: {
        userId: account.user.id,
        planId: "pro",
      },
    });
    expect(planUpdate.account).toEqual(
      expect.objectContaining({ planId: "pro", status: "active" }),
    );
    expect(planUpdate.ledgerEntry).toEqual(
      expect.objectContaining({ kind: "plan_quota_adjustment", amountCny: -196.12 }),
    );
    expect(planUpdate.balanceCny).toBe(1);

    const freeUpdate = await fetchJson<{
      account: { planId: string; status: string };
      ledgerEntry: { kind: string; amountCny: number } | null;
      balanceCny: number;
    }>("/api/admin/billing/users/plan", {
      method: "PATCH",
      account,
      body: {
        userId: account.user.id,
        planId: "free",
      },
    });

    expect(freeUpdate.account).toEqual(expect.objectContaining({ planId: "free", status: "free" }));
    expect(freeUpdate.ledgerEntry).toEqual(
      expect.objectContaining({ kind: "plan_quota_adjustment", amountCny: 2 }),
    );
    expect(freeUpdate.balanceCny).toBe(3);

    advanceTestClock(32 * 24 * 60 * 60 * 1000);
    const summary = await fetchJson<{
      account: { planId: string; currentPeriodStart: string };
      balanceCny: number;
    }>("/api/billing/summary", { account });

    expect(summary.account.planId).toBe("free");
    expect(summary.account.currentPeriodStart).toBe("2026-02-01T00:00:00.000Z");
    expect(summary.balanceCny).toBe(3);
  });

  it("raises low paid plan orders to the payment gateway minimum", async () => {
    const account = await register();
    await store.updateBillingPlanDefinition({
      planId: "pro",
      priceCny: 0.01,
      monthlyGrantCny: 1,
      workspaceBytesLimit: 5 * 1024 * 1024 * 1024,
      singleUploadBytesLimit: 200 * 1024 * 1024,
      enabled: true,
    });

    const order = await store.createPaymentOrder({
      userId: account.user.id,
      planId: "pro",
      billingPeriod: "monthly",
      providerType: "alipay",
    });

    expect(order.amountCny).toBe(0.1);
  });

  it("sends the payment gateway minimum for low paid plan checkout", async () => {
    const account = await register();
    await store.updateBillingPlanDefinition({
      planId: "pro",
      priceCny: 0.01,
      monthlyGrantCny: 1,
      workspaceBytesLimit: 5 * 1024 * 1024 * 1024,
      singleUploadBytesLimit: 200 * 1024 * 1024,
      enabled: true,
    });
    let gatewayMoney: string | null = null;
    const gatewayServer = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += String(chunk);
      });
      req.on("end", () => {
        const params = new URLSearchParams(body);
        gatewayMoney = params.get("money");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: 1,
            trade_no: "gateway_trade_1",
            payurl: "https://pay.example/checkout",
            money: gatewayMoney,
          }),
        );
      });
    });
    await new Promise<void>((resolve) => gatewayServer.listen(0, "127.0.0.1", () => resolve()));
    const address = gatewayServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Gateway test server did not bind to a TCP port");
    }
    const previousMerchantId = process.env.DOYA_PAYMENT_MERCHANT_ID;
    const previousMerchantKey = process.env.DOYA_PAYMENT_MERCHANT_KEY;
    const previousPublicBaseUrl = process.env.DOYA_PAYMENT_PUBLIC_BASE_URL;
    const previousGatewayBaseUrl = process.env.DOYA_PAYMENT_GATEWAY_BASE_URL;
    process.env.DOYA_PAYMENT_MERCHANT_ID = "1614";
    process.env.DOYA_PAYMENT_MERCHANT_KEY = "secret";
    process.env.DOYA_PAYMENT_PUBLIC_BASE_URL = "https://doya.example";
    process.env.DOYA_PAYMENT_GATEWAY_BASE_URL = `http://127.0.0.1:${address.port}`;
    try {
      const response = await fetchJson<{ order: { amountCny: number; paymentUrl: string } }>(
        "/api/billing/payments",
        {
          method: "POST",
          account,
          body: {
            planId: "pro",
            billingPeriod: "monthly",
            providerType: "alipay",
          },
        },
      );

      expect(response.order.amountCny).toBe(0.1);
      expect(response.order.paymentUrl).toBe("https://pay.example/checkout");
      expect(gatewayMoney).toBe("0.10");
    } finally {
      restoreEnv("DOYA_PAYMENT_MERCHANT_ID", previousMerchantId);
      restoreEnv("DOYA_PAYMENT_MERCHANT_KEY", previousMerchantKey);
      restoreEnv("DOYA_PAYMENT_PUBLIC_BASE_URL", previousPublicBaseUrl);
      restoreEnv("DOYA_PAYMENT_GATEWAY_BASE_URL", previousGatewayBaseUrl);
      await new Promise<void>((resolve) => gatewayServer.close(() => resolve()));
    }
  });

  it("records admin top-ups as top-up ledger entries", async () => {
    const account = await register();

    const response = await fetchJson<{
      ledgerEntry: { kind: string; amountCny: number };
      balanceCny: number;
    }>("/api/admin/billing/top-ups", {
      method: "POST",
      account,
      body: {
        userId: account.user.id,
        amountCny: 20,
        note: "manual payment",
      },
    });

    expect(response.ledgerEntry).toEqual(
      expect.objectContaining({ kind: "top_up", amountCny: 20 }),
    );
    expect(response.balanceCny).toBe(23);
  });

  it("rescans daemon workspace storage into generated bytes", async () => {
    const account = await register();
    const daemon = await startFakeDaemon({
      runtimes: new Map(),
      createdRuntimeId: "rt_1",
      workspaceScanTotalBytes: 25,
    });
    try {
      await store.registerNode({
        nodeId: "node_1",
        endpoint: daemon.baseUrl,
        runtimeAuthToken: "daemon-secret",
      });
      await store.upsertUserDaemonWorkspace({
        userId: account.user.id,
        nodeId: "node_1",
        workspaceDir: `/tmp/user-workspaces/${account.user.id}`,
      });
      await fetchJson("/api/file-snapshots", {
        method: "POST",
        account,
        body: {
          files: [{ path: "input.txt", contentBase64: Buffer.from("hello").toString("base64") }],
        },
      });

      const response = await fetchJson<{
        storageQuota: {
          uploadedBytesUsed: number;
          generatedBytesUsed: number;
          workspaceBytesUsed: number;
        };
      }>("/api/billing/storage/rescan", { method: "POST", account, body: {} });

      expect(response.storageQuota.uploadedBytesUsed).toBe(5);
      expect(response.storageQuota.generatedBytesUsed).toBe(20);
      expect(response.storageQuota.workspaceBytesUsed).toBe(25);
      expect(daemon.authorizationHeaders()).toContain("Bearer daemon-secret");
    } finally {
      await daemon.close();
    }
  });

  it("rejects high-frequency referral bindings from one source", async () => {
    const inviter = await register("source-inviter@example.com");
    const inviterSummary = await fetchJson<{ referralCode: string }>("/api/billing/summary", {
      account: inviter,
    });

    for (let index = 0; index < 6; index += 1) {
      const invitee = await register(`source-invitee-${index}@example.com`);
      const response = await fetchJson<{
        referral: { status: string; inviteeBonusLedgerId: string | null };
      }>("/api/billing/referrals/bind", {
        method: "POST",
        account: invitee,
        body: { code: inviterSummary.referralCode, clientId: "same-device" },
      });
      if (index < 5) {
        expect(response.referral.status).toBe("registered");
        expect(response.referral.inviteeBonusLedgerId).not.toBeNull();
      } else {
        expect(response.referral.status).toBe("rejected");
        expect(response.referral.inviteeBonusLedgerId).toBeNull();
      }
    }
  });

  it("enforces upload quotas and records referral rewards", async () => {
    const inviter = await register("inviter@example.com");
    const invitee = await register("invitee@example.com");

    const inviterSummary = await fetchJson<{ referralCode: string; balanceCny: number }>(
      "/api/billing/summary",
      { account: inviter },
    );

    const referralResponse = await fetchJson<{
      referral: { status: string; inviteeBonusLedgerId: string | null };
    }>("/api/billing/referrals/bind", {
      method: "POST",
      account: invitee,
      body: { code: inviterSummary.referralCode },
    });
    expect(referralResponse.referral.status).toBe("registered");
    expect(referralResponse.referral.inviteeBonusLedgerId).not.toBeNull();

    await createGeneratedSession(invitee, "Referral qualification");

    const rewardedInviterSummary = await fetchJson<{
      balanceCny: number;
      referrals: Array<{ status: string; inviterRewardLedgerId: string | null }>;
    }>("/api/billing/summary", { account: inviter });
    expect(rewardedInviterSummary.balanceCny).toBe(inviterSummary.balanceCny + 5);
    expect(rewardedInviterSummary.referrals[0]).toEqual(
      expect.objectContaining({ status: "rewarded", inviterRewardLedgerId: expect.any(String) }),
    );

    const snapshotResponse = await fetchJson<{
      snapshot: { files: Array<{ path: string }> };
    }>("/api/file-snapshots", {
      method: "POST",
      account: invitee,
      body: {
        files: [
          {
            path: "hello.txt",
            contentBase64: Buffer.from("hello").toString("base64"),
          },
        ],
      },
    });
    expect(snapshotResponse.snapshot.files[0]?.path).toBe("hello.txt");

    const storageSummary = await fetchJson<{
      storageQuota: { uploadedBytesUsed: number; workspaceBytesUsed: number };
    }>("/api/billing/summary", { account: invitee });
    expect(storageSummary.storageQuota.uploadedBytesUsed).toBe(5);
    expect(storageSummary.storageQuota.workspaceBytesUsed).toBe(5);

    await fetchJson("/api/admin/billing/storage", {
      method: "PATCH",
      account: inviter,
      body: {
        userId: invitee.user.id,
        temporaryWorkspaceBytesLimit: 5,
      },
    });

    const quotaResponse = await fetch(`${baseUrl}/api/file-snapshots`, {
      method: "POST",
      headers: jsonHeaders(invitee),
      body: JSON.stringify({
        files: [
          {
            path: "overflow.txt",
            contentBase64: Buffer.from("!").toString("base64"),
          },
        ],
      }),
    });
    expect(quotaResponse.status).toBe(402);
  });
});

describe("user daemon workspaces", () => {
  it("stores one active workspace per user and daemon node", async () => {
    const account = await register();
    await store.registerNode({ nodeId: "node_1", endpoint: "http://127.0.0.1:6767" });

    const created = await fetchJson<{
      workspace: { id: string; nodeId: string; workspaceDir: string; status: string };
    }>("/api/nodes/node_1/user-workspace", {
      method: "POST",
      account,
      body: {
        workspaceDir: "/tmp/doya/user-workspaces/usr_1",
      },
    });

    expect(created.workspace).toEqual(
      expect.objectContaining({
        nodeId: "node_1",
        workspaceDir: "/tmp/doya/user-workspaces/usr_1",
        status: "active",
      }),
    );

    const fetched = await fetchJson<{
      workspace: { id: string; workspaceDir: string };
    }>("/api/nodes/node_1/user-workspace", { account });

    expect(fetched.workspace).toEqual(
      expect.objectContaining({
        id: created.workspace.id,
        workspaceDir: "/tmp/doya/user-workspaces/usr_1",
      }),
    );
  });

  it("ensures a missing user daemon workspace through the registered daemon", async () => {
    const account = await register();
    const daemon = await startFakeDaemon({
      runtimes: new Map(),
      createdRuntimeId: "rt_1",
    });
    try {
      await store.registerNode({
        nodeId: "node_1",
        endpoint: daemon.baseUrl,
        runtimeAuthToken: "daemon-secret",
      });

      const ensured = await fetchJson<{
        workspace: { nodeId: string; workspaceDir: string; status: string };
      }>("/api/nodes/node_1/user-workspace/ensure", {
        method: "POST",
        account,
        body: {},
      });

      expect(ensured.workspace).toEqual(
        expect.objectContaining({
          nodeId: "node_1",
          workspaceDir: `/tmp/user-workspaces/${account.user.id}`,
          status: "active",
        }),
      );
      expect(daemon.authorizationHeaders()).toContain("Bearer daemon-secret");
    } finally {
      await daemon.close();
    }
  });
});

describe("daemon scheduling", () => {
  it("keeps admin scheduling status when an existing node registers again", async () => {
    const account = await register();
    await store.registerNode({
      nodeId: "node_1",
      endpoint: "http://127.0.0.1:6767",
      status: "online",
    });
    await store.updateNode({ nodeId: "node_1", status: "offline" });

    const registerResponse = await fetchJson<{ node: { id: string; status: string } }>(
      "/api/nodes/register",
      {
        method: "POST",
        account,
        body: {
          nodeId: "node_1",
          endpoint: "http://127.0.0.1:6767",
          status: "online",
        },
      },
    );

    expect(registerResponse.node).toEqual(
      expect.objectContaining({
        id: "node_1",
        status: "offline",
      }),
    );
  });

  it("lists only the signed-in user's desktop daemon options", async () => {
    const account = await register("owner@example.com");
    const otherAccount = await register("other@example.com");
    await fetchJson("/api/nodes/register", {
      method: "POST",
      account,
      body: {
        nodeId: "node_owner",
        ownerUserId: account.user.id,
        endpoint: "http://127.0.0.1:6767",
        status: "online",
      },
    });
    await fetchJson("/api/nodes/register", {
      method: "POST",
      account: otherAccount,
      body: {
        nodeId: "node_other",
        ownerUserId: otherAccount.user.id,
        endpoint: "http://127.0.0.1:6868",
        status: "online",
      },
    });

    const response = await fetchJson<{ nodes: Array<{ id: string; runtimeAuthToken?: unknown }> }>(
      "/api/scheduler/runtime-node-options",
      {
        account,
      },
    );

    expect(response.nodes).toEqual([expect.objectContaining({ id: "node_owner" })]);
    expect(response.nodes[0]).not.toHaveProperty("runtimeAuthToken");
  });

  it("selects the least-loaded online daemon for new runtimes", async () => {
    const account = await register();
    const sessionResponse = await createGeneratedSession(account, "Scheduled selection");
    await store.registerNode({
      nodeId: "node_busy",
      endpoint: "http://127.0.0.1:6767",
      status: "online",
    });
    advanceTestClock(1_000);
    await store.registerNode({
      nodeId: "node_idle",
      endpoint: "http://127.0.0.1:6868",
      status: "online",
    });
    advanceTestClock(1_000);
    await store.registerNode({
      nodeId: "node_draining",
      endpoint: "http://127.0.0.1:6969",
      status: "draining",
    });
    await store.createRuntimeAllocation({
      sessionId: sessionResponse.session.id,
      userId: account.user.id,
      nodeId: "node_busy",
      runtimeId: "rt_busy",
      workspaceDir: "/tmp/busy/workspace",
      status: "running",
    });

    const response = await fetch(`${baseUrl}/api/scheduler/runtime-node`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: "codex",
        modelId: "gpt-5",
      }),
    });
    expect(response.status).toBe(200);
    const selection = (await response.json()) as {
      node: {
        id: string;
        endpoint: string;
        status: string;
        lastHeartbeatAt: string;
        runtimeAuthToken?: unknown;
        doyaHome?: unknown;
        capabilities?: unknown;
      };
      selectionReason: string;
    };

    expect(selection).toEqual({
      node: expect.objectContaining({
        id: "node_idle",
        endpoint: "http://127.0.0.1:6868",
        status: "online",
        lastHeartbeatAt: expect.any(String),
      }),
      selectionReason: "least_active_online",
    });
    expect(selection.node.runtimeAuthToken).toBeUndefined();
    expect(selection.node.doyaHome).toBeUndefined();
    expect(selection.node.capabilities).toBeUndefined();
  });

  it("does not use account-owned desktop daemons for cloud auto scheduling", async () => {
    const account = await register();
    await fetchJson("/api/nodes/register", {
      method: "POST",
      account,
      body: {
        nodeId: "node_desktop",
        ownerUserId: account.user.id,
        endpoint: "http://127.0.0.1:6767",
        status: "online",
      },
    });

    const response = await fetch(`${baseUrl}/api/scheduler/runtime-node`, {
      method: "POST",
      headers: jsonHeaders(account),
      body: JSON.stringify({
        providerId: "codex",
        modelId: "gpt-5",
      }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "No online daemon nodes can accept new runtimes",
    });
  });

  it("uses authenticated ownerless daemon registrations for cloud auto scheduling", async () => {
    const account = await register();
    await fetchJson("/api/nodes/register", {
      method: "POST",
      account,
      body: {
        nodeId: "node_cloud",
        endpoint: "http://127.0.0.1:6868",
        status: "online",
      },
    });

    const response = await fetch(`${baseUrl}/api/scheduler/runtime-node`, {
      method: "POST",
      headers: jsonHeaders(account),
      body: JSON.stringify({
        providerId: "codex",
        modelId: "gpt-5",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      node: expect.objectContaining({
        id: "node_cloud",
        endpoint: "http://127.0.0.1:6868",
        status: "online",
      }),
      selectionReason: "least_active_online",
    });
  });

  it("accepts ownerless cloud daemon registration with the node registration token", async () => {
    process.env.DOYA_CONTROL_NODE_REGISTRATION_TOKEN = "node-registration-secret";
    const registerResponse = await fetch(`${baseUrl}/api/nodes/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer node-registration-secret",
      },
      body: JSON.stringify({
        nodeId: "node_cloud",
        endpoint: "http://127.0.0.1:6868",
        status: "online",
      }),
    });
    expect(registerResponse.status).toBe(201);

    const response = await fetch(`${baseUrl}/api/scheduler/runtime-node`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: "codex",
        modelId: "gpt-5",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      node: expect.objectContaining({
        id: "node_cloud",
        endpoint: "http://127.0.0.1:6868",
      }),
      selectionReason: "least_active_online",
    });
  });

  it("rejects owner assignment when registering with the node registration token", async () => {
    const account = await register();
    process.env.DOYA_CONTROL_NODE_REGISTRATION_TOKEN = "node-registration-secret";
    const response = await fetch(`${baseUrl}/api/nodes/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer node-registration-secret",
      },
      body: JSON.stringify({
        nodeId: "node_cloud",
        ownerUserId: account.user.id,
        endpoint: "http://127.0.0.1:6868",
        status: "online",
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Daemon owner requires user authentication",
    });
  });

  it("can clear an existing owner when a daemon re-registers as cloud", async () => {
    const account = await register();
    await fetchJson("/api/nodes/register", {
      method: "POST",
      account,
      body: {
        nodeId: "node_cloud",
        ownerUserId: account.user.id,
        endpoint: "http://127.0.0.1:6868",
        status: "online",
      },
    });
    await fetchJson("/api/nodes/register", {
      method: "POST",
      account,
      body: {
        nodeId: "node_cloud",
        ownerUserId: null,
        endpoint: "http://127.0.0.1:6868",
        status: "online",
      },
    });

    const response = await fetch(`${baseUrl}/api/scheduler/runtime-node`, {
      method: "POST",
      headers: jsonHeaders(account),
      body: JSON.stringify({
        providerId: "codex",
        modelId: "gpt-5",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      node: expect.objectContaining({
        id: "node_cloud",
        endpoint: "http://127.0.0.1:6868",
      }),
      selectionReason: "least_active_online",
    });
  });

  it("selects the requested online daemon for fixed-node scheduling", async () => {
    const account = await register();
    const sessionResponse = await createGeneratedSession(account, "Fixed node selection");
    await store.registerNode({
      nodeId: "node_busy",
      ownerUserId: account.user.id,
      endpoint: "http://127.0.0.1:6767",
      status: "online",
    });
    await store.registerNode({
      nodeId: "node_idle",
      ownerUserId: account.user.id,
      endpoint: "http://127.0.0.1:6868",
      status: "online",
    });
    await store.createRuntimeAllocation({
      sessionId: sessionResponse.session.id,
      userId: account.user.id,
      nodeId: "node_busy",
      runtimeId: "rt_busy",
      workspaceDir: "/tmp/busy/workspace",
      status: "running",
    });

    const response = await fetch(`${baseUrl}/api/scheduler/runtime-node`, {
      method: "POST",
      headers: jsonHeaders(account),
      body: JSON.stringify({
        nodeId: "node_busy",
        providerId: "codex",
        modelId: "gpt-5",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      node: expect.objectContaining({
        id: "node_busy",
        endpoint: "http://127.0.0.1:6767",
        status: "online",
        lastHeartbeatAt: expect.any(String),
      }),
      selectionReason: "fixed_node_preference",
    });
  });

  it("selects the requested fixed daemon even when its heartbeat is stale", async () => {
    const account = await register();
    await store.registerNode({
      nodeId: "node_local",
      ownerUserId: account.user.id,
      endpoint: "http://127.0.0.1:6767",
      status: "online",
    });
    advanceTestClock(3 * 60 * 1000);

    const response = await fetch(`${baseUrl}/api/scheduler/runtime-node`, {
      method: "POST",
      headers: jsonHeaders(account),
      body: JSON.stringify({ nodeId: "node_local" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      node: expect.objectContaining({
        id: "node_local",
        endpoint: "http://127.0.0.1:6767",
        status: "online",
        lastHeartbeatAt: expect.any(String),
      }),
      selectionReason: "fixed_node_preference",
    });
  });

  it("uses the authenticated user's fixed runtime node preference", async () => {
    const account = await register();
    await store.registerNode({
      nodeId: "node_local",
      ownerUserId: account.user.id,
      endpoint: "http://127.0.0.1:6767",
      status: "online",
    });
    await fetchJson("/api/scheduler/runtime-node-preference", {
      method: "PATCH",
      account,
      body: { mode: "fixed", nodeId: "node_local" },
    });
    advanceTestClock(3 * 60 * 1000);

    const response = await fetch(`${baseUrl}/api/scheduler/runtime-node`, {
      method: "POST",
      headers: jsonHeaders(account),
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      node: expect.objectContaining({
        id: "node_local",
        endpoint: "http://127.0.0.1:6767",
        status: "online",
      }),
      selectionReason: "fixed_node_preference",
    });
  });

  it("rejects fixed-node scheduling for another user's desktop daemon", async () => {
    const account = await register("owner@example.com");
    const otherAccount = await register("other@example.com");
    await store.registerNode({
      nodeId: "node_other",
      ownerUserId: otherAccount.user.id,
      endpoint: "http://127.0.0.1:6868",
      status: "online",
    });

    const response = await fetch(`${baseUrl}/api/scheduler/runtime-node`, {
      method: "POST",
      headers: jsonHeaders(account),
      body: JSON.stringify({ nodeId: "node_other" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Daemon node node_other is not available for this account",
    });
  });

  it("rejects scheduler selection when no daemon is online", async () => {
    await store.registerNode({
      nodeId: "node_offline",
      endpoint: "http://127.0.0.1:6767",
      status: "offline",
    });
    await store.registerNode({
      nodeId: "node_draining",
      endpoint: "http://127.0.0.1:6868",
      status: "draining",
    });

    const response = await fetch(`${baseUrl}/api/scheduler/runtime-node`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "codex", modelId: "gpt-5" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: expect.stringContaining("No online daemon nodes"),
    });
  });

  it("rejects scheduler selection when online daemon heartbeats are stale", async () => {
    await store.registerNode({
      nodeId: "node_stale",
      endpoint: "http://127.0.0.1:6767",
      status: "online",
    });
    advanceTestClock(3 * 60 * 1000);

    const response = await fetch(`${baseUrl}/api/scheduler/runtime-node`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "codex", modelId: "gpt-5" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: expect.stringContaining("No online daemon nodes"),
    });
  });

  it("rejects runtime allocation on offline or draining daemon nodes", async () => {
    const account = await register();
    const sessionResponse = await createGeneratedSession(account, "Scheduled runtime");
    await store.registerNode({
      nodeId: "node_offline",
      endpoint: "http://127.0.0.1:6767",
      status: "offline",
    });
    await store.registerNode({
      nodeId: "node_draining",
      endpoint: "http://127.0.0.1:6868",
      status: "draining",
    });

    for (const nodeId of ["node_offline", "node_draining"]) {
      const response = await fetch(
        `${baseUrl}/api/sessions/${sessionResponse.session.id}/runtimes`,
        {
          method: "POST",
          headers: jsonHeaders(account),
          body: JSON.stringify({
            nodeId,
            runtimeId: `rt_${nodeId}`,
            workspaceDir: `/tmp/${nodeId}/workspace`,
          }),
        },
      );

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: expect.stringContaining("cannot accept new runtimes"),
      });
    }
  });

  it("rejects generated workdir allocation on offline daemon nodes", async () => {
    const account = await register();
    const sessionResponse = await createGeneratedSession(account, "Scheduled workdir");
    await store.registerNode({
      nodeId: "node_1",
      endpoint: "http://127.0.0.1:6767",
      status: "offline",
    });
    await fetchJson("/api/nodes/node_1/user-workspace", {
      method: "POST",
      account,
      body: {
        workspaceDir: "/tmp/doya/user-workspaces/usr_1",
      },
    });

    const response = await fetch(`${baseUrl}/api/sessions/${sessionResponse.session.id}/workdir`, {
      method: "POST",
      headers: jsonHeaders(account),
      body: JSON.stringify({
        nodeId: "node_1",
        runtimeId: "rt_offline",
      }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: expect.stringContaining("cannot accept new runtimes"),
    });
  });
});

describe("daemon admin", () => {
  it("summarizes daemon load, workspaces, sessions, and cleanup state", async () => {
    const account = await register();
    const daemon = await startFakeDaemon({
      runtimes: new Map(),
      createdRuntimeId: "rt_1",
    });
    try {
      await store.registerNode({
        nodeId: "node_1",
        endpoint: daemon.baseUrl,
        runtimeAuthToken: "daemon-secret",
      });
      const sessionResponse = await createGeneratedSession(account, "Clean me");
      const workspace = await store.upsertUserDaemonWorkspace({
        userId: account.user.id,
        nodeId: "node_1",
        workspaceDir: `/tmp/user-workspaces/${account.user.id}`,
      });
      await store.createRuntimeAllocation({
        sessionId: sessionResponse.session.id,
        userId: account.user.id,
        nodeId: "node_1",
        runtimeId: "rt_1",
        userWorkspaceId: workspace.id,
        workspaceDir: `/tmp/user-workspaces/${account.user.id}/sessions/${sessionResponse.session.id}`,
        status: "running",
      });
      await store.upsertAgentBinding({
        sessionId: sessionResponse.session.id,
        userId: account.user.id,
        nodeId: "node_1",
        agentId: "agent_1",
        userWorkspaceId: workspace.id,
        cwd: `/tmp/user-workspaces/${account.user.id}/sessions/${sessionResponse.session.id}`,
      });

      const overview = await fetchJson<{
        daemonNodes: Array<{
          load: { status: string };
          userWorkspaces: Array<{ sessions: Array<{ session: { id: string } }> }>;
        }>;
      }>("/api/admin/daemon-overview", { account });
      expect(overview.daemonNodes[0]?.load.status).toBe("ok");
      expect(overview.daemonNodes[0]?.userWorkspaces[0]?.sessions[0]?.session.id).toBe(
        sessionResponse.session.id,
      );

      const cleanup = await fetchJson<{
        cleanup: {
          deletedSessionCount: number;
          stoppedRuntimeCount: number;
          archivedBindingCount: number;
          workDirCleanup: { deleted: Array<{ sessionId: string }> };
        };
      }>("/api/admin/nodes/node_1/cleanup-sessions", {
        method: "POST",
        account,
        body: {
          sessionIds: [sessionResponse.session.id],
          deleteSessions: true,
          deleteWorkDirs: true,
        },
      });
      expect(cleanup.cleanup).toEqual(
        expect.objectContaining({
          deletedSessionCount: 1,
          stoppedRuntimeCount: 1,
          archivedBindingCount: 1,
        }),
      );
      expect(cleanup.cleanup.workDirCleanup.deleted).toEqual([
        expect.objectContaining({ sessionId: sessionResponse.session.id }),
      ]);
      const overviewAfterCleanup = await fetchJson<{
        daemonNodes: Array<{
          userWorkspaces: Array<{ sessions: Array<{ session: { id: string } }> }>;
        }>;
      }>("/api/admin/daemon-overview", { account });
      expect(overviewAfterCleanup.daemonNodes[0]?.userWorkspaces[0]?.sessions).toEqual([]);
      expect(daemon.authorizationHeaders()).toContain("Bearer daemon-secret");
    } finally {
      await daemon.close();
    }
  });
});

describe("runtime sync events", () => {
  it("writes matched runtime timeline messages to the session history", async () => {
    const account = await register();
    const sessionResponse = await fetchJson<{ session: { id: string } }>("/api/sessions", {
      method: "POST",
      account,
      body: {
        title: "Sync me",
        workingContext: { type: "generated_workspace" },
      },
    });
    await store.registerNode({ nodeId: "node_1", endpoint: "localhost:6767" });
    const allocation = await store.createRuntimeAllocation({
      sessionId: sessionResponse.session.id,
      userId: account.user.id,
      nodeId: "node_1",
      runtimeId: "rt_1",
      workspaceDir: "/tmp/runtime/workspace",
      status: "running",
    });
    advanceTestClock(1_000);

    const syncResponse = await fetch(`${baseUrl}/api/runtime-sync/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionResponse.session.id,
        runtimeId: "rt_1",
        nodeId: "node_1",
        agentId: "agent_1",
        event: {
          type: "timeline",
          provider: "codex",
          item: {
            type: "assistant_message",
            text: "done",
            messageId: "assistant_1",
          },
        },
      }),
    });

    expect(syncResponse.status).toBe(201);
    const messagesResponse = await fetchJson<{
      messages: Array<{ role: string; externalId: string | null; content: { text?: string } }>;
    }>(`/api/sessions/${sessionResponse.session.id}/messages`, {
      account,
    });
    expect(messagesResponse.messages).toEqual([
      expect.objectContaining({
        role: "assistant",
        externalId: "runtime:rt_1:agent:agent_1:timeline:assistant_message:assistant_1",
        content: expect.objectContaining({ text: "done" }),
      }),
    ]);
    const touchedAllocation = await store.getRuntimeAllocationByRuntimeId({
      sessionId: sessionResponse.session.id,
      runtimeId: "rt_1",
      nodeId: "node_1",
    });
    expect(touchedAllocation.lastHeartbeatAt).not.toBe(allocation.lastHeartbeatAt);
    expect(touchedAllocation.lastHeartbeatAt).toBe("2026-01-01T00:00:01.000Z");
  });

  it("upserts matched runtime artifact metadata into the session artifacts", async () => {
    const account = await register();
    const sessionResponse = await fetchJson<{ session: { id: string } }>("/api/sessions", {
      method: "POST",
      account,
      body: {
        title: "Artifacts",
        workingContext: { type: "generated_workspace" },
      },
    });
    await store.registerNode({ nodeId: "node_1", endpoint: "localhost:6767" });
    await store.createRuntimeAllocation({
      sessionId: sessionResponse.session.id,
      userId: account.user.id,
      nodeId: "node_1",
      runtimeId: "rt_1",
      workspaceDir: "/tmp/runtime/workspace",
      status: "running",
    });

    for (const name of ["Draft", "Final"]) {
      const syncResponse = await fetch(`${baseUrl}/api/runtime-sync/artifacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionResponse.session.id,
          runtimeId: "rt_1",
          nodeId: "node_1",
          agentId: "agent_1",
          artifact: {
            type: "markdown",
            name,
            uri: "workspace://report.md",
            externalId: "artifact_report",
          },
        }),
      });
      expect(syncResponse.status).toBe(201);
    }

    const artifactsResponse = await fetchJson<{
      artifacts: Array<{ type: string; name: string; uri: string; externalId: string | null }>;
    }>(`/api/sessions/${sessionResponse.session.id}/artifacts`, {
      account,
    });
    expect(artifactsResponse.artifacts).toHaveLength(1);
    expect(artifactsResponse.artifacts[0]).toEqual(
      expect.objectContaining({
        type: "markdown",
        name: "Final",
        uri: "workspace://report.md",
        externalId: "artifact_report",
      }),
    );
  });

  it("indexes runtime timeline artifact items into the session artifacts", async () => {
    const account = await register();
    const sessionResponse = await fetchJson<{ session: { id: string } }>("/api/sessions", {
      method: "POST",
      account,
      body: {
        title: "Timeline artifact",
        workingContext: { type: "generated_workspace" },
      },
    });
    await store.registerNode({ nodeId: "node_1", endpoint: "localhost:6767" });
    await store.createRuntimeAllocation({
      sessionId: sessionResponse.session.id,
      userId: account.user.id,
      nodeId: "node_1",
      runtimeId: "rt_1",
      workspaceDir: "/tmp/runtime/workspace",
      status: "running",
    });

    for (const content of ["# Draft", "# Final"]) {
      const syncResponse = await fetch(`${baseUrl}/api/runtime-sync/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionResponse.session.id,
          runtimeId: "rt_1",
          nodeId: "node_1",
          agentId: "agent_1",
          event: {
            type: "timeline",
            provider: "codex",
            item: {
              type: "artifact",
              payload: {
                type: "markdown",
                id: "artifact_1",
                title: "Report",
                content,
                isBase64: false,
              },
            },
          },
        }),
      });
      expect(syncResponse.status).toBe(201);
    }

    const artifactsResponse = await fetchJson<{
      artifacts: Array<{
        type: string;
        name: string;
        uri: string;
        externalId: string | null;
        metadata: { content?: string };
      }>;
    }>(`/api/sessions/${sessionResponse.session.id}/artifacts`, {
      account,
    });
    expect(artifactsResponse.artifacts).toHaveLength(1);
    expect(artifactsResponse.artifacts[0]).toEqual(
      expect.objectContaining({
        type: "markdown",
        name: "Report",
        uri: "runtime-artifact://artifact_1",
        externalId: "runtime:rt_1:agent:agent_1:timeline:artifact:artifact_1",
        metadata: expect.objectContaining({ content: "# Final" }),
      }),
    );
    const billingSummary = await fetchJson<{ storageQuota: { generatedBytesUsed: number } }>(
      "/api/billing/summary",
      { account },
    );
    expect(billingSummary.storageQuota.generatedBytesUsed).toBe(Buffer.byteLength("# Final"));
  });

  it("maps runtime turn events into the session status", async () => {
    const account = await register();
    const sessionResponse = await createGeneratedSession(account, "Status sync");
    await store.registerNode({ nodeId: "node_1", endpoint: "localhost:6767" });
    await store.createRuntimeAllocation({
      sessionId: sessionResponse.session.id,
      userId: account.user.id,
      nodeId: "node_1",
      runtimeId: "rt_1",
      workspaceDir: "/tmp/runtime/workspace",
      status: "running",
    });

    for (const [eventType, expectedStatus] of [
      ["turn_started", "running"],
      ["turn_completed", "done"],
      ["turn_failed", "error"],
    ] as const) {
      const syncResponse = await fetch(`${baseUrl}/api/runtime-sync/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionResponse.session.id,
          runtimeId: "rt_1",
          nodeId: "node_1",
          agentId: "agent_1",
          event: {
            type: eventType,
            provider: "codex",
          },
        }),
      });
      expect(syncResponse.status).toBe(201);

      const currentSession = await fetchJson<{ session: { status: string } }>(
        `/api/sessions/${sessionResponse.session.id}`,
        {
          account,
        },
      );
      expect(currentSession.session.status).toBe(expectedStatus);
    }
  });

  it("charges runtime terminal usage events once", async () => {
    const account = await register();
    const sessionResponse = await createGeneratedSession(account, "Runtime billed");
    await fetchJson<{ pricing: { id: string } }>("/api/admin/billing/pricing", {
      method: "POST",
      account,
      body: {
        providerId: "claude",
        modelId: "sonnet",
        displayName: "Claude Sonnet",
        inputPriceUsdPerToken: 0.000003,
        outputPriceUsdPerToken: 0.000015,
        cacheCreationPriceUsdPerToken: 0.00000375,
        cacheReadPriceUsdPerToken: 0.0000003,
      },
    });
    await store.registerNode({ nodeId: "node_1", endpoint: "localhost:6767" });
    await store.createRuntimeAllocation({
      sessionId: sessionResponse.session.id,
      userId: account.user.id,
      nodeId: "node_1",
      runtimeId: "rt_1",
      providerId: "claude",
      modelId: "sonnet",
      workspaceDir: "/tmp/runtime/workspace",
      status: "running",
    });

    for (let index = 0; index < 2; index += 1) {
      const syncResponse = await fetch(`${baseUrl}/api/runtime-sync/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionResponse.session.id,
          runtimeId: "rt_1",
          nodeId: "node_1",
          agentId: "agent_1",
          event: {
            type: "turn_completed",
            provider: "claude",
            turnId: "turn_1",
            usage: {
              inputTokens: 1000,
              cachedInputTokens: 250,
              outputTokens: 100,
              cacheCreationTokens: 50,
            },
          },
        }),
      });
      expect(syncResponse.status).toBe(201);
    }

    const summary = await fetchJson<{
      usage: { requestCount: number };
      recentUsageLogs: Array<{ requestId: string; cacheReadTokens: number; inputCostUsd: number }>;
      ledger: Array<{ kind: string }>;
    }>("/api/billing/summary", { account });
    expect(summary.usage.requestCount).toBe(1);
    expect(summary.recentUsageLogs).toHaveLength(1);
    expect(summary.recentUsageLogs[0]).toEqual(
      expect.objectContaining({
        requestId: "rt_1:agent_1:turn_1",
        cacheReadTokens: 250,
      }),
    );
    expect(summary.recentUsageLogs[0]?.inputCostUsd).toBeCloseTo(750 * 0.000003);
    expect(summary.ledger.filter((entry) => entry.kind === "usage_charge")).toHaveLength(1);
  });

  it("syncs runtime usage events without charging when allocation has no model", async () => {
    const account = await register();
    const sessionResponse = await createGeneratedSession(account, "Runtime default model");
    await store.registerNode({ nodeId: "node_1", endpoint: "localhost:6767" });
    await store.createRuntimeAllocation({
      sessionId: sessionResponse.session.id,
      userId: account.user.id,
      nodeId: "node_1",
      runtimeId: "rt_1",
      providerId: "claude",
      modelId: null,
      workspaceDir: "/tmp/runtime/workspace",
      status: "running",
    });

    const syncResponse = await fetch(`${baseUrl}/api/runtime-sync/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionResponse.session.id,
        runtimeId: "rt_1",
        nodeId: "node_1",
        agentId: "agent_1",
        event: {
          type: "turn_completed",
          provider: "claude",
          turnId: "turn_1",
          usage: {
            inputTokens: 100,
            outputTokens: 10,
          },
        },
      }),
    });
    expect(syncResponse.status).toBe(201);

    const summary = await fetchJson<{
      usage: { requestCount: number };
      ledger: Array<{ kind: string }>;
    }>("/api/billing/summary", { account });
    expect(summary.usage.requestCount).toBe(0);
    expect(summary.ledger.filter((entry) => entry.kind === "usage_charge")).toHaveLength(0);
  });
});

describe("session agent bindings", () => {
  it("records and returns the active daemon agent for a session", async () => {
    const account = await register();
    const sessionResponse = await createGeneratedSession(account, "Bound agent");
    await store.registerNode({
      nodeId: "node_1",
      endpoint: "http://127.0.0.1:6767",
      runtimeAuthToken: "daemon-secret",
    });

    const createResponse = await fetchJson<{
      binding: { sessionId: string; nodeId: string; agentId: string; cwd: string };
      node: { id: string; runtimeAuthToken?: string };
    }>(`/api/sessions/${sessionResponse.session.id}/agent-binding`, {
      method: "POST",
      account,
      body: {
        nodeId: "node_1",
        agentId: "agent_1",
        workspaceId: "ws_1",
        cwd: "/tmp/workspace",
      },
    });

    expect(createResponse.binding).toEqual(
      expect.objectContaining({
        sessionId: sessionResponse.session.id,
        nodeId: "node_1",
        agentId: "agent_1",
        cwd: "/tmp/workspace",
      }),
    );
    expect(createResponse.node).toEqual(expect.objectContaining({ id: "node_1" }));
    expect(createResponse.node).not.toHaveProperty("runtimeAuthToken");

    const getResponse = await fetchJson<{
      binding: { nodeId: string; agentId: string };
      node: { id: string; runtimeAuthToken?: string };
    }>(`/api/sessions/${sessionResponse.session.id}/agent-binding`, { account });

    expect(getResponse.binding).toEqual(
      expect.objectContaining({ nodeId: "node_1", agentId: "agent_1" }),
    );
    expect(getResponse.node).toEqual(expect.objectContaining({ id: "node_1" }));
    expect(getResponse.node).not.toHaveProperty("runtimeAuthToken");
  });

  it("returns null binding when a session has not been assigned a daemon agent", async () => {
    const account = await register();
    const sessionResponse = await createGeneratedSession(account, "Unbound session");

    const response = await fetchJson<{ binding: null; node: null }>(
      `/api/sessions/${sessionResponse.session.id}/agent-binding`,
      { account },
    );

    expect(response).toEqual({ binding: null, node: null });
  });

  it("allows reading an existing binding after balance is exhausted", async () => {
    const account = await register();
    const sessionResponse = await createGeneratedSession(account, "Exhausted bound agent");
    await store.registerNode({
      nodeId: "node_1",
      endpoint: "http://127.0.0.1:6767",
    });
    await fetchJson(`/api/sessions/${sessionResponse.session.id}/agent-binding`, {
      method: "POST",
      account,
      body: {
        nodeId: "node_1",
        agentId: "agent_1",
        workspaceId: "ws_1",
        cwd: "/tmp/workspace",
      },
    });

    await store.createAdminAdjustment({
      userId: account.user.id,
      amountCny: -3,
      note: "exhaust test balance",
    });

    const response = await fetch(
      `${baseUrl}/api/sessions/${sessionResponse.session.id}/agent-binding`,
      {
        headers: jsonHeaders(account),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        binding: expect.objectContaining({ agentId: "agent_1" }),
      }),
    );
  });
});

async function register(email = "person@example.com") {
  const response = await fetch(`${baseUrl}/api/account/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return (await response.json()) as { user: { id: string }; accessToken: string };
}

function advanceTestClock(ms: number): void {
  currentTime = new Date(currentTime.getTime() + ms);
}

async function createGeneratedSession(
  account: { user: { id: string }; accessToken: string },
  title: string,
): Promise<{ session: { id: string } }> {
  return fetchJson<{ session: { id: string } }>("/api/sessions", {
    method: "POST",
    account,
    body: {
      title,
      workingContext: { type: "generated_workspace" },
    },
  });
}

async function startFakeAiGatewayUpstream(input?: { contentEncoding?: string }): Promise<{
  baseUrl: string;
  authorizationHeaders: () => string[];
  acceptEncodingHeaders: () => string[];
  close: () => Promise<void>;
}> {
  const authorizationHeaders: string[] = [];
  const acceptEncodingHeaders: string[] = [];
  const upstreamServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "POST" && url.pathname === "/v1/responses") {
      authorizationHeaders.push(req.headers.authorization ?? "");
      acceptEncodingHeaders.push(req.headers["accept-encoding"] ?? "");
      await readRequestJson(req);
      const body = {
        id: "resp_gateway_test",
        object: "response",
        model: "gpt-5.4-mini",
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          input_tokens_details: {
            cached_tokens: 10,
          },
          output_tokens_details: {
            reasoning_tokens: 4,
          },
        },
      };
      if (input?.contentEncoding) {
        res.setHeader("Content-Encoding", input.contentEncoding);
      }
      respondJson(res, 200, body, { contentEncoding: input?.contentEncoding });
      return;
    }
    respondJson(res, 404, { error: "not found" });
  });
  await new Promise<void>((resolve) => upstreamServer.listen(0, "127.0.0.1", () => resolve()));
  const address = upstreamServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Fake AI upstream server did not bind to a TCP port");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    authorizationHeaders: () => [...authorizationHeaders],
    acceptEncodingHeaders: () => [...acceptEncodingHeaders],
    close: () => new Promise<void>((resolve) => upstreamServer.close(() => resolve())),
  };
}

async function readRequestJson(req: AsyncIterable<Buffer>): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) {
    return {};
  }
  return JSON.parse(text) as Record<string, unknown>;
}

async function rawHttpRequest(
  url: string,
  input: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}> {
  return await new Promise((resolve, reject) => {
    const req = httpRequest(
      url,
      {
        method: input.method,
        headers: {
          ...input.headers,
          "Content-Length": String(Buffer.byteLength(input.body)),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end(input.body);
  });
}

function respondJson(
  res: {
    statusCode: number;
    setHeader(name: string, value: string): void;
    end(body: string | Buffer): void;
  },
  statusCode: number,
  body: unknown,
  options: { contentEncoding?: string } = {},
): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  const text = JSON.stringify(body);
  if (options.contentEncoding === "zstd") {
    res.end(zstdCompressSync(Buffer.from(text)));
    return;
  }
  res.end(text);
}

function zstdCompressSync(input: Buffer): Buffer {
  const compress = (zlib as typeof zlib & { zstdCompressSync?: (buffer: Buffer) => Buffer })
    .zstdCompressSync;
  if (typeof compress !== "function") {
    throw new Error("Current Node runtime does not expose zstdCompressSync");
  }
  return compress(input);
}

async function startFakeDaemon(input: {
  runtimes: Map<string, "starting" | "running" | "stopped" | "lost">;
  createdRuntimeId: string;
  runtimeApiUnavailable?: boolean;
  workspaceScanTotalBytes?: number;
}): Promise<{
  baseUrl: string;
  createdCount: () => number;
  authorizationHeaders: () => Array<string | null>;
  close: () => Promise<void>;
}> {
  let createdCount = 0;
  const authorizationHeaders: Array<string | null> = [];
  const daemonServer = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const statusMatch = /^\/api\/runtimes\/([^/]+)\/status$/.exec(url.pathname);
    if (req.method === "GET" && statusMatch) {
      authorizationHeaders.push(req.headers.authorization ?? null);
      const runtimeId = decodeURIComponent(statusMatch[1] ?? "");
      const status = input.runtimes.get(runtimeId);
      if (!status) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Runtime not found" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          runtime: {
            runtimeId,
            status,
            workspaceDir: `/tmp/${runtimeId}/workspace`,
          },
        }),
      );
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/runtimes") {
      if (input.runtimeApiUnavailable) {
        res.writeHead(404, { "Content-Type": "text/html" });
        res.end("<!DOCTYPE html><p>Not found</p>");
        return;
      }
      authorizationHeaders.push(req.headers.authorization ?? null);
      createdCount += 1;
      input.runtimes.set(input.createdRuntimeId, "running");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          runtime: {
            runtimeId: input.createdRuntimeId,
            status: "running",
            workspaceDir: `/tmp/${input.createdRuntimeId}/workspace`,
          },
        }),
      );
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/user-workspaces/ensure") {
      authorizationHeaders.push(req.headers.authorization ?? null);
      let body = "";
      req.on("data", (chunk) => {
        body += String(chunk);
      });
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}") as { userId?: string };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            workspace: {
              workspaceId: `uws_${parsed.userId}`,
              workspaceDir: `/tmp/user-workspaces/${parsed.userId}`,
            },
          }),
        );
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/admin/daemon/load") {
      authorizationHeaders.push(req.headers.authorization ?? null);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          nodeId: "node_1",
          sampledAt: "2026-01-01T00:00:00.000Z",
          cpu: { loadAverage: [0.25, 0.5, 0.75] },
          memory: {
            totalBytes: 100,
            freeBytes: 40,
            usedBytes: 60,
            usedRatio: 0.6,
          },
          disk: null,
          uptimeSeconds: 10,
        }),
      );
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/user-workspaces/scan") {
      authorizationHeaders.push(req.headers.authorization ?? null);
      let body = "";
      req.on("data", (chunk) => {
        body += String(chunk);
      });
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}") as { userId?: string };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            workspace: {
              workspaceDir: `/tmp/user-workspaces/${parsed.userId}`,
            },
            totalBytes: input.workspaceScanTotalBytes ?? 0,
            fileCount: 3,
            scannedAt: "2026-01-01T00:00:00.000Z",
          }),
        );
      });
      return;
    }
    if (req.method === "DELETE" && url.pathname === "/api/user-workspaces/session-workdirs") {
      authorizationHeaders.push(req.headers.authorization ?? null);
      let body = "";
      req.on("data", (chunk) => {
        body += String(chunk);
      });
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}") as { sessionIds?: string[] };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            deleted: (parsed.sessionIds ?? []).map((sessionId) => ({
              sessionId,
              workDir: `/tmp/user-workspaces/sessions/${sessionId}`,
              deleted: true,
            })),
            failed: [],
          }),
        );
      });
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });
  await new Promise<void>((resolve) => daemonServer.listen(0, "127.0.0.1", () => resolve()));
  const address = daemonServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Fake daemon did not bind to a TCP port");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    createdCount: () => createdCount,
    authorizationHeaders: () => [...authorizationHeaders],
    close: () => new Promise<void>((resolve) => daemonServer.close(() => resolve())),
  };
}

async function fetchJson<T>(
  pathName: string,
  input: {
    method?: string;
    account: { user: { id: string }; accessToken: string };
    body?: unknown;
  },
): Promise<T> {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: input.method ?? "GET",
    headers: jsonHeaders(input.account),
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  });
  expect(response.status).toBeLessThan(400);
  return (await response.json()) as T;
}

async function pollForCommand(
  nodeId: string,
  runtimeAuthToken: string,
): Promise<{ id: string; method: string; endpointPath: string; body?: unknown }> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/nodes/${nodeId}/commands/poll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${runtimeAuthToken}`,
      },
      body: JSON.stringify({ maxCommands: 1 }),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      commands: Array<{ id: string; method: string; endpointPath: string; body?: unknown }>;
    };
    const command = payload.commands[0];
    if (command) {
      return command;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for daemon command");
}

function jsonHeaders(account: {
  user: { id: string };
  accessToken: string;
}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${account.accessToken}`,
    "X-Doya-User-Id": account.user.id,
  };
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function snapshotEnv(names: string[]): Record<string, string | undefined> {
  const snapshot: Record<string, string | undefined> = {};
  for (const name of names) {
    snapshot[name] = process.env[name];
  }
  return snapshot;
}

function restoreEnvSnapshot(snapshot: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(snapshot)) {
    restoreEnv(name, value);
  }
}

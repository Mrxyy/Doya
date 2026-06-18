import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  await new Promise<void>((resolve) => server.close(() => resolve()));
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
});

async function register() {
  const response = await fetch(`${baseUrl}/api/account/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "person@example.com" }),
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

async function startFakeDaemon(input: {
  runtimes: Map<string, "starting" | "running" | "stopped" | "lost">;
  createdRuntimeId: string;
  runtimeApiUnavailable?: boolean;
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
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.account.accessToken}`,
      "X-Doya-User-Id": input.account.user.id,
    },
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  });
  expect(response.status).toBeLessThan(400);
  return (await response.json()) as T;
}

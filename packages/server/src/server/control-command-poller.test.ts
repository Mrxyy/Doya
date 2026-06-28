import pino from "pino";
import { describe, expect, test, vi } from "vitest";

import { DAEMON_INTERNAL_AUTH_HEADER } from "./auth.js";
import { createControlCommandPoller } from "./control-command-poller.js";

describe("control command poller", () => {
  test("polls control, executes local daemon command, and reports the result", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const urlString = String(url);
      if (urlString === "https://control.example.com/api/nodes/srv_test/commands/poll") {
        return jsonResponse({
          commands: [
            {
              id: "cmd_1",
              method: "POST",
              endpointPath: "/api/user-workspaces/ensure",
              body: { userId: "usr_1" },
            },
          ],
        });
      }
      if (urlString === "http://127.0.0.1:6767/api/user-workspaces/ensure") {
        expect(init?.method).toBe("POST");
        expect((init?.headers as Record<string, string>)[DAEMON_INTERNAL_AUTH_HEADER]).toBe(
          "internal-secret",
        );
        expect(JSON.parse(String(init?.body))).toEqual({ userId: "usr_1" });
        return jsonResponse({ workspace: { workspaceDir: "/tmp/usr_1" } });
      }
      if (urlString === "https://control.example.com/api/nodes/srv_test/commands/cmd_1/result") {
        return jsonResponse({ accepted: true }, 202);
      }
      throw new Error(`Unexpected fetch ${urlString}`);
    });

    const poller = createControlCommandPoller({
      config: {
        enabled: true,
        apiBaseUrl: "https://control.example.com",
        userId: "usr_control",
        authToken: "control-token",
        runtimeAuthToken: "runtime-secret",
      },
      nodeId: "srv_test",
      localHttpBaseUrl: "http://127.0.0.1:6767",
      localInternalAuthToken: "internal-secret",
      logger: pino({ level: "silent" }),
      fetchImpl,
    });

    await poller.pollOnce();

    expect(calls).toHaveLength(3);
    expect(calls[0]?.init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer runtime-secret",
    });
    expect(JSON.parse(String(calls[2]?.init.body))).toEqual({
      ok: true,
      status: 200,
      body: { workspace: { workspaceDir: "/tmp/usr_1" } },
    });
  });

  test("reports local daemon command failures", async () => {
    const reports: unknown[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlString = String(url);
      if (urlString.endsWith("/commands/poll")) {
        return jsonResponse({
          commands: [{ id: "cmd_1", method: "GET", endpointPath: "/api/admin/daemon/config" }],
        });
      }
      if (urlString === "http://127.0.0.1:6767/api/admin/daemon/config") {
        return jsonResponse({ error: "Daemon config is not available." }, 501);
      }
      if (urlString.endsWith("/commands/cmd_1/result")) {
        reports.push(JSON.parse(String(init?.body)));
        return jsonResponse({ accepted: true }, 202);
      }
      throw new Error(`Unexpected fetch ${urlString}`);
    });

    const poller = createControlCommandPoller({
      config: {
        enabled: true,
        apiBaseUrl: "https://control.example.com",
        userId: "usr_control",
        authToken: "control-token",
      },
      nodeId: "srv_test",
      localHttpBaseUrl: "http://127.0.0.1:6767",
      logger: pino({ level: "silent" }),
      fetchImpl,
    });

    await poller.pollOnce();

    expect(reports).toEqual([
      {
        ok: false,
        status: 501,
        error: "Daemon config is not available.",
      },
    ]);
  });

  test("does not poll without account credentials", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ commands: [] }));
    const poller = createControlCommandPoller({
      config: { enabled: true, apiBaseUrl: "https://control.example.com" },
      nodeId: "srv_test",
      localHttpBaseUrl: "http://127.0.0.1:6767",
      logger: pino({ level: "silent" }),
      fetchImpl,
    });

    await poller.pollOnce();

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

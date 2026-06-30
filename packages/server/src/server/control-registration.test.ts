import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  buildControlRegistrationCapabilities,
  createControlRegistration,
  resolveControlRuntimeAuthToken,
} from "./control-registration.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("control registration", () => {
  test("posts daemon node registration to the control API", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ node: { id: "srv_test" } }), { status: 201 });
    });
    const registration = createControlRegistration({
      config: {
        enabled: true,
        apiBaseUrl: "https://control.example.com/",
        userId: "usr_control",
        authToken: "control-token",
        nodeEndpoint: "http://127.0.0.1:6767",
        publicNodeEndpoint: "relay://relay.example.com/srv_test",
      },
      nodeId: "srv_test",
      doyaHome: "/tmp/doya",
      defaultEndpoint: "127.0.0.1:6767",
      runtimeAuthToken: "runtime-token",
      getCapabilities: async () => ({ providers: [] }),
      logger: pino({ level: "silent" }),
      fetchImpl,
    });

    await registration.registerNow();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://control.example.com/api/nodes/register");
    expect(calls[0]?.init.headers).toEqual({
      "Content-Type": "application/json",
      "X-Doya-User-Id": "usr_control",
      Authorization: "Bearer control-token",
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      nodeId: "srv_test",
      endpoint: "http://127.0.0.1:6767",
      publicEndpoint: "relay://relay.example.com/srv_test",
      doyaHome: "/tmp/doya",
      capabilities: { providers: [] },
      runtimeAuthToken: "runtime-token",
      ownerUserId: null,
      status: "online",
    });
  });

  test("posts cloud daemon registration with a node token and no user header", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ node: { id: "srv_test" } }), { status: 201 });
    });
    const registration = createControlRegistration({
      config: {
        enabled: true,
        apiBaseUrl: "https://control.example.com/",
        authToken: "node-registration-secret",
        nodeEndpoint: "http://127.0.0.1:6868",
      },
      nodeId: "srv_test",
      doyaHome: "/tmp/doya-cloud",
      defaultEndpoint: "127.0.0.1:6868",
      getCapabilities: async () => ({ providers: [] }),
      logger: pino({ level: "silent" }),
      fetchImpl,
    });

    await registration.registerNow();

    expect(calls[0]?.init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer node-registration-secret",
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(
      expect.objectContaining({
        endpoint: "http://127.0.0.1:6868",
        ownerUserId: null,
        status: "online",
      }),
    );
  });

  test("does not register when control is disabled", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 201 }));
    const registration = createControlRegistration({
      config: { enabled: false, apiBaseUrl: "https://control.example.com" },
      nodeId: "srv_test",
      doyaHome: "/tmp/doya",
      defaultEndpoint: "127.0.0.1:6767",
      getCapabilities: async () => ({}),
      logger: pino({ level: "silent" }),
      fetchImpl,
    });

    await registration.registerNow();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("does not register without account credentials", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 201 }));
    const registration = createControlRegistration({
      config: { enabled: true, apiBaseUrl: "https://control.example.com" },
      nodeId: "srv_test",
      doyaHome: "/tmp/doya",
      defaultEndpoint: "127.0.0.1:6767",
      getCapabilities: async () => ({}),
      logger: pino({ level: "silent" }),
      fetchImpl,
    });

    await registration.registerNow();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("builds provider and relay capabilities for node registration", () => {
    const capabilities = buildControlRegistrationCapabilities({
      listen: "127.0.0.1:6767",
      version: "0.1.0",
      relay: {
        enabled: true,
        endpoint: "relay.doya.sh:443",
        publicEndpoint: "relay.doya.sh:443",
        useTls: true,
        publicUseTls: true,
      },
      providers: [
        {
          provider: "codex",
          label: "Codex",
          enabled: true,
          status: "ready",
          models: [{ provider: "codex", id: "gpt-5", label: "GPT-5", isDefault: true }],
          modes: [{ id: "default", label: "Default" }],
          defaultModeId: "default",
        },
      ],
    });

    expect(capabilities).toEqual({
      version: "0.1.0",
      listen: "127.0.0.1:6767",
      relay: {
        enabled: true,
        endpoint: "relay.doya.sh:443",
        publicEndpoint: "relay.doya.sh:443",
        useTls: true,
        publicUseTls: true,
      },
      controlCommands: {
        polling: true,
        version: 1,
      },
      providers: [
        {
          providerId: "codex",
          label: "Codex",
          enabled: true,
          status: "ready",
          error: null,
          models: [{ id: "gpt-5", label: "GPT-5", isDefault: true }],
          modes: [{ id: "default", label: "Default", isDefault: true }],
        },
      ],
    });
  });

  test("creates and reuses a private runtime auth token when none is configured", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "doya-control-token-"));
    roots.push(root);

    const first = resolveControlRuntimeAuthToken({ doyaHome: root });
    const second = resolveControlRuntimeAuthToken({ doyaHome: root });

    expect(first).toMatch(/^crt_/);
    expect(second).toBe(first);
  });

  test("uses configured runtime auth token when present", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "doya-control-token-"));
    roots.push(root);

    expect(
      resolveControlRuntimeAuthToken({
        doyaHome: root,
        configuredToken: "configured-secret",
      }),
    ).toBe("configured-secret");
  });
});

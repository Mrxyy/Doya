import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig } from "./config.js";

const roots: string[] = [];

async function createDoyaHome(config: unknown): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "doya-config-relay-"));
  roots.push(root);
  const doyaHome = path.join(root, ".doya");
  await mkdir(doyaHome, { recursive: true });
  await writeFile(path.join(doyaHome, "config.json"), JSON.stringify(config, null, 2));
  return doyaHome;
}

describe("daemon relay config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("loads relay TLS from env, persisted config, and hosted relay fallback", async () => {
    const persistedHome = await createDoyaHome({
      version: 1,
      daemon: {
        relay: {
          endpoint: "relay.example.com:443",
          useTls: true,
        },
      },
    });
    expect(loadConfig(persistedHome, { env: {} }).relayUseTls).toBe(true);

    const envHome = await createDoyaHome({
      version: 1,
      daemon: {
        relay: {
          endpoint: "relay.example.com:443",
          useTls: false,
        },
      },
    });
    expect(loadConfig(envHome, { env: { DOYA_RELAY_USE_TLS: "true" } }).relayUseTls).toBe(true);

    const hostedHome = await createDoyaHome({
      version: 1,
      daemon: { relay: {} },
    });
    expect(loadConfig(hostedHome, { env: {} }).relayUseTls).toBe(true);
  });

  test("relayPublicUseTls falls back to relayUseTls when unset", async () => {
    const home = await createDoyaHome({ version: 1, daemon: { relay: {} } });
    // Default: both true (hosted relay)
    expect(loadConfig(home, { env: {} }).relayPublicUseTls).toBe(true);
  });

  test("DOYA_RELAY_PUBLIC_USE_TLS overrides relayUseTls for public side", async () => {
    const home = await createDoyaHome({ version: 1, daemon: { relay: {} } });
    const config = loadConfig(home, {
      env: { DOYA_RELAY_USE_TLS: "false", DOYA_RELAY_PUBLIC_USE_TLS: "true" },
    });
    expect(config.relayUseTls).toBe(false);
    expect(config.relayPublicUseTls).toBe(true);
  });

  test("relayPublicUseTls falls back to relayUseTls when only DOYA_RELAY_USE_TLS is set", async () => {
    const home = await createDoyaHome({ version: 1, daemon: { relay: {} } });
    const config = loadConfig(home, { env: { DOYA_RELAY_USE_TLS: "false" } });
    expect(config.relayUseTls).toBe(false);
    expect(config.relayPublicUseTls).toBe(false);
  });

  test("persisted publicUseTls overrides relayUseTls fallback", async () => {
    const home = await createDoyaHome({
      version: 1,
      daemon: { relay: { useTls: false, publicUseTls: true } },
    });
    const config = loadConfig(home, { env: {} });
    expect(config.relayUseTls).toBe(false);
    expect(config.relayPublicUseTls).toBe(true);
  });
});

describe("daemon worktree root config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("resolves relative worktrees.root against DOYA_HOME", async () => {
    const home = await createDoyaHome({
      version: 1,
      worktrees: { root: "custom-worktrees" },
    });

    expect(loadConfig(home, { env: {} }).worktreesRoot).toBe(path.join(home, "custom-worktrees"));
  });

  test("keeps absolute worktrees.root absolute", async () => {
    const home = await createDoyaHome({
      version: 1,
      worktrees: { root: path.join(os.tmpdir(), "doya-custom-worktrees") },
    });

    expect(loadConfig(home, { env: {} }).worktreesRoot).toBe(
      path.join(os.tmpdir(), "doya-custom-worktrees"),
    );
  });
});

describe("daemon control registration config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("enables control registration when a control API URL is configured", async () => {
    const home = await createDoyaHome({
      version: 1,
      daemon: {
        control: {
          apiBaseUrl: "https://control.example.com",
          userId: "usr_persisted",
          authToken: "persisted-token",
          nodeEndpoint: "http://localhost:6767",
          publicNodeEndpoint: "relay://relay.example.com/srv_1",
          runtimeAuthToken: "runtime-secret",
          heartbeatIntervalMs: 15000,
        },
      },
    });

    expect(loadConfig(home, { env: {} }).controlRegistration).toEqual({
      enabled: true,
      apiBaseUrl: "https://control.example.com",
      userId: "usr_persisted",
      authToken: "persisted-token",
      nodeEndpoint: "http://localhost:6767",
      publicNodeEndpoint: "relay://relay.example.com/srv_1",
      runtimeAuthToken: "runtime-secret",
      heartbeatIntervalMs: 15000,
    });
  });

  test("lets control registration env override persisted config", async () => {
    const home = await createDoyaHome({
      version: 1,
      daemon: {
        control: {
          enabled: false,
          apiBaseUrl: "https://old-control.example.com",
        },
      },
    });

    expect(
      loadConfig(home, {
        env: {
          DOYA_CONTROL_ENABLED: "true",
          DOYA_CONTROL_API_URL: "https://control.example.com",
          DOYA_CONTROL_USER_ID: "usr_env",
          DOYA_CONTROL_TOKEN: "env-token",
          DOYA_CONTROL_DAEMON_ENDPOINT: "http://127.0.0.1:6767",
          DOYA_CONTROL_RUNTIME_AUTH_TOKEN: "runtime-env-secret",
          DOYA_CONTROL_HEARTBEAT_INTERVAL_MS: "25000",
        },
      }).controlRegistration,
    ).toEqual({
      enabled: true,
      apiBaseUrl: "https://control.example.com",
      userId: "usr_env",
      authToken: "env-token",
      nodeEndpoint: "http://127.0.0.1:6767",
      runtimeAuthToken: "runtime-env-secret",
      heartbeatIntervalMs: 25000,
    });
  });

  test("lets env explicitly disable persisted control registration", async () => {
    const home = await createDoyaHome({
      version: 1,
      daemon: {
        control: {
          apiBaseUrl: "https://control.example.com",
          userId: "usr_persisted",
          authToken: "persisted-token",
        },
      },
    });

    expect(
      loadConfig(home, {
        env: {
          DOYA_CONTROL_ENABLED: "0",
        },
      }).controlRegistration,
    ).toEqual({
      enabled: false,
      apiBaseUrl: "https://control.example.com",
      userId: "usr_persisted",
      authToken: "persisted-token",
    });
  });
});

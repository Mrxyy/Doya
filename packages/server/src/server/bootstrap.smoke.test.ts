import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import pino from "pino";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createDoyaDaemon, parseListenString, type DoyaDaemonConfig } from "./bootstrap.js";
import { generateLocalPairingOffer } from "./pairing-offer.js";
import { createTestDoyaDaemon } from "./test-utils/doya-daemon.js";
import { createTestAgentClients } from "./test-utils/fake-agent-client.js";
import { isPlatform } from "../test-utils/platform.js";

describe("doya daemon bootstrap", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("starts and serves health endpoint", async () => {
    const daemonHandle = await createTestDoyaDaemon({
      openai: { apiKey: "test-openai-api-key" },
      speech: {
        providers: {
          dictationStt: { provider: "openai", explicit: true },
          voiceStt: { provider: "openai", explicit: true },
          voiceTts: { provider: "openai", explicit: true },
        },
      },
    });
    try {
      const response = await fetch(`http://127.0.0.1:${daemonHandle.port}/api/health`, {
        headers: daemonHandle.agentMcpAuthHeader
          ? { Authorization: daemonHandle.agentMcpAuthHeader }
          : undefined,
      });
      expect(response.ok).toBe(true);
      const payload = await response.json();
      expect(payload.status).toBe("ok");
      expect(typeof payload.timestamp).toBe("string");
    } finally {
      await daemonHandle.close();
    }
  });

  test("redacts Agent MCP debug request credentials and bodies", async () => {
    const logLines: string[] = [];
    const logger = pino(
      { level: "debug" },
      {
        write: (line: string) => {
          logLines.push(line);
        },
      },
    );
    const daemonHandle = await createTestDoyaDaemon({
      logger,
      mcpDebug: true,
    });

    try {
      const response = await fetch(`http://127.0.0.1:${daemonHandle.port}/mcp/agents`, {
        method: "POST",
        headers: {
          Authorization: "Bearer secret-debug-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            apiKey: "secret-body-token",
          },
        }),
      });

      expect(response.status).toBe(400);
      const logs = logLines.join("\n");
      expect(logs).toContain("Agent MCP request");
      expect(logs).toContain("[redacted]");
      expect(logs).toContain('"method":"tools/call"');
      expect(logs).toContain('"hasParams":true');
      expect(logs).not.toContain("secret-debug-token");
      expect(logs).not.toContain("secret-body-token");
      expect(logs).not.toContain("apiKey");
    } finally {
      await daemonHandle.close();
    }
  });

  test("fails fast when OpenAI speech provider is configured without credentials", async () => {
    const doyaHomeRoot = await mkdtemp(path.join(os.tmpdir(), "doya-openai-config-"));
    const doyaHome = path.join(doyaHomeRoot, ".doya");
    const staticDir = await mkdtemp(path.join(os.tmpdir(), "doya-static-"));
    await mkdir(doyaHome, { recursive: true });

    const config: DoyaDaemonConfig = {
      listen: "127.0.0.1:0",
      doyaHome: doyaHome,
      corsAllowedOrigins: [],
      hostnames: true,
      mcpEnabled: false,
      staticDir,
      mcpDebug: false,
      agentClients: createTestAgentClients(),
      agentStoragePath: path.join(doyaHome, "agents"),
      relayEnabled: false,
      appBaseUrl: "https://app.doya.sh",
      openai: undefined,
      speech: {
        providers: {
          dictationStt: { provider: "openai", explicit: true },
          voiceStt: { provider: "openai", explicit: true },
          voiceTts: { provider: "openai", explicit: true },
        },
      },
    };

    try {
      await expect(createDoyaDaemon(config, pino({ level: "silent" }))).rejects.toThrow(
        "Missing OpenAI credentials",
      );
    } finally {
      await rm(doyaHomeRoot, { recursive: true, force: true });
      await rm(staticDir, { recursive: true, force: true });
    }
  });

  test("does not block daemon start on local speech model downloads", async () => {
    const originalFetch = globalThis.fetch;
    let releaseFetch: ((value: Response) => void) | null = null;
    const fetchGate = new Promise<Response>((resolve) => {
      releaseFetch = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => fetchGate),
    );

    const daemonHandle = await createTestDoyaDaemon({
      speech: {
        providers: {
          dictationStt: { provider: "local", explicit: true, enabled: true },
          voiceTurnDetection: { provider: "local", explicit: true, enabled: false },
          voiceStt: { provider: "local", explicit: true, enabled: false },
          voiceTts: { provider: "local", explicit: true, enabled: false },
        },
        local: {
          modelsDir: path.join(os.tmpdir(), `doya-missing-models-${Date.now()}`),
          models: {
            dictationStt: "parakeet-tdt-0.6b-v2-int8",
            voiceStt: "parakeet-tdt-0.6b-v2-int8",
            voiceTts: "kokoro-en-v0_19",
          },
        },
      },
    });

    try {
      const response = await originalFetch(`http://127.0.0.1:${daemonHandle.port}/api/health`);
      expect(response.ok).toBe(true);
    } finally {
      releaseFetch?.(
        new Response(null, {
          status: 500,
          statusText: "test cleanup",
        }),
      );
      vi.unstubAllGlobals();
      globalThis.fetch = originalFetch;
      await daemonHandle.close();
    }
  });

  test("parses whitespace-padded numeric port strings", () => {
    expect(parseListenString(" 6767 ")).toEqual({
      type: "tcp",
      host: "127.0.0.1",
      port: 6767,
    });
  });

  test("rejects Windows absolute paths that are not named pipes", () => {
    // A Windows drive path like C:\daemon must NOT be silently parsed as TCP
    // (split(":") would yield host="C" and port="\\daemon" which is nonsensical).
    expect(() => parseListenString(String.raw`C:\daemon`)).toThrow();
    expect(() => parseListenString(String.raw`D:\Users\foo\.doya\daemon.sock`)).toThrow();
    // Single-letter "host" with no valid port is not a valid listen string
    expect(() => parseListenString(String.raw`C:\some\path`)).toThrow();
  });

  test("parses Windows named pipes as managed IPC listen targets", () => {
    expect(parseListenString(String.raw`\\.\pipe\doya-managed-test`)).toEqual({
      type: "pipe",
      path: String.raw`\\.\pipe\doya-managed-test`,
    });
    expect(parseListenString(`pipe://${String.raw`\\.\pipe\doya-managed-test`}`)).toEqual({
      type: "pipe",
      path: String.raw`\\.\pipe\doya-managed-test`,
    });
  });

  // POSIX-only: Unix socket listen paths are invalid Windows listen targets.
  test.skipIf(isPlatform("win32"))(
    "generates a relay pairing offer for unix socket listeners",
    async () => {
      const doyaHomeRoot = await mkdtemp(path.join(os.tmpdir(), "doya-socket-relay-"));
      const doyaHome = path.join(doyaHomeRoot, ".doya");
      const staticDir = await mkdtemp(path.join(os.tmpdir(), "doya-static-"));
      const socketPath = path.join(doyaHomeRoot, "run", "doya.sock");
      await mkdir(path.dirname(socketPath), { recursive: true });
      await mkdir(doyaHome, { recursive: true });
      const logger = pino({ level: "silent" });

      const config: DoyaDaemonConfig = {
        listen: socketPath,
        doyaHome: doyaHome,
        corsAllowedOrigins: [],
        hostnames: true,
        mcpEnabled: false,
        staticDir,
        mcpDebug: false,
        agentClients: createTestAgentClients(),
        agentStoragePath: path.join(doyaHome, "agents"),
        relayEnabled: true,
        relayEndpoint: "127.0.0.1:9",
        relayPublicEndpoint: "127.0.0.1:9",
        appBaseUrl: "https://app.doya.sh",
        openai: undefined,
        speech: undefined,
      };

      const daemon = await createDoyaDaemon(config, logger);

      try {
        await daemon.start();
        const pairing = await generateLocalPairingOffer({
          doyaHome: doyaHome,
          relayEnabled: true,
          relayEndpoint: "127.0.0.1:9",
          relayPublicEndpoint: "127.0.0.1:9",
          appBaseUrl: "https://app.doya.sh",
          includeQr: false,
        });
        expect(pairing.relayEnabled).toBe(true);
        expect(pairing.url?.startsWith("https://app.doya.sh/#offer=")).toBe(true);
      } finally {
        await daemon.stop().catch(() => undefined);
        await daemon.agentManager.flush().catch(() => undefined);
        await rm(doyaHomeRoot, { recursive: true, force: true });
        await rm(staticDir, { recursive: true, force: true });
      }
    },
  );
});

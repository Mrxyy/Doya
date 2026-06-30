import { EventEmitter } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_DESKTOP_SETTINGS } from "../settings/desktop-settings";
import { createDaemonCommandHandlers } from "./daemon-manager";

const mocks = vi.hoisted(() => ({
  settings: {
    releaseChannel: "stable",
    daemon: {
      manageBuiltInDaemon: true,
      keepRunningAfterQuit: true,
    },
  },
  runExternalCliJsonCommand: vi.fn(),
  runExternalCliTextCommand: vi.fn(),
  spawnProcess: vi.fn(),
  appPath: "/Users/test/doya/packages/desktop",
}));

vi.mock("electron", () => ({
  app: {
    getAppPath: vi.fn(() => mocks.appPath),
    getPath: vi.fn(() => "/tmp/doya-user-data"),
    getVersion: vi.fn(() => "1.2.3"),
    isPackaged: false,
  },
  ipcMain: { handle: vi.fn() },
  powerMonitor: { getSystemIdleTime: vi.fn(() => 0) },
}));

vi.mock("electron-log/main", () => ({
  default: { info: vi.fn(), error: vi.fn() },
}));

vi.mock("../system/doya-runtime.js", () => ({
  resolveDoyaHome: vi.fn(() => "/tmp/doya-home"),
  spawnProcess: mocks.spawnProcess,
}));

vi.mock("../settings/desktop-settings-electron.js", () => ({
  getDesktopSettingsStore: () => ({
    get: async () => mocks.settings,
    patch: vi.fn(),
    migrateLegacyRendererSettings: vi.fn(),
  }),
}));

vi.mock("./runtime-paths.js", () => ({
  createNodeEntrypointInvocation: vi.fn(() => ({
    command: "node",
    args: [],
    env: {},
  })),
  resolveDaemonRunnerEntrypoint: vi.fn(() => ({
    entryPath: "/tmp/daemon.js",
    execArgv: [],
  })),
}));

vi.mock("./cli/external.js", () => ({
  runExternalCliJsonCommand: mocks.runExternalCliJsonCommand,
  runExternalCliTextCommand: mocks.runExternalCliTextCommand,
}));

function desktopSettingsWithManagement(enabled: boolean) {
  return {
    ...DEFAULT_DESKTOP_SETTINGS,
    daemon: {
      ...DEFAULT_DESKTOP_SETTINGS.daemon,
      manageBuiltInDaemon: enabled,
    },
  };
}

function currentCodexTargetTriple(): string {
  if (process.platform === "darwin" && process.arch === "arm64") return "aarch64-apple-darwin";
  if (process.platform === "darwin" && process.arch === "x64") return "x86_64-apple-darwin";
  if (process.platform === "linux" && process.arch === "arm64") return "aarch64-unknown-linux-musl";
  if (process.platform === "linux" && process.arch === "x64") return "x86_64-unknown-linux-musl";
  if (process.platform === "win32" && process.arch === "arm64") return "aarch64-pc-windows-msvc";
  if (process.platform === "win32" && process.arch === "x64") return "x86_64-pc-windows-msvc";
  return "unsupported";
}

type MockChildProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid: number;
  spawnfile: string;
  spawnargs: string[];
  unref: ReturnType<typeof vi.fn>;
};

function createMockChildProcess(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 1234;
  child.spawnfile = "node";
  child.spawnargs = ["node", "daemon.js"];
  child.unref = vi.fn();
  return child;
}

function scheduleFailedStartupOutput(child: MockChildProcess): void {
  setImmediate(() => {
    child.stdout.emit("data", Buffer.from(`${"x".repeat(80_000)}stdout-tail`));
    child.stderr.emit("data", Buffer.from(`${"y".repeat(80_000)}stderr-tail`));
    child.emit("exit", 1, null);
  });
}

describe("daemon-manager commands", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    mocks.settings = DEFAULT_DESKTOP_SETTINGS;
    mocks.runExternalCliJsonCommand.mockReset();
    mocks.runExternalCliTextCommand.mockReset();
    mocks.spawnProcess.mockReset();
    mocks.appPath = "/Users/test/doya/packages/desktop";
  });

  it("refuses start and restart while built-in daemon management is disabled", async () => {
    mocks.settings = desktopSettingsWithManagement(false);
    const handlers = createDaemonCommandHandlers();

    await expect(handlers.start_desktop_daemon()).rejects.toThrow(
      "Built-in daemon management is disabled.",
    );
    await expect(handlers.restart_desktop_daemon()).rejects.toThrow(
      "Built-in daemon management is disabled.",
    );

    expect(mocks.runExternalCliJsonCommand).not.toHaveBeenCalled();
    expect(mocks.spawnProcess).not.toHaveBeenCalled();
  });

  it("keeps stop callable while built-in daemon management is disabled", async () => {
    mocks.settings = desktopSettingsWithManagement(false);
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      localDaemon: "stopped",
      serverId: "",
    });
    const handlers = createDaemonCommandHandlers();

    await expect(handlers.stop_desktop_daemon()).resolves.toEqual({
      serverId: "",
      status: "stopped",
      listen: null,
      hostname: null,
      pid: null,
      home: "/tmp/doya-home",
      version: null,
      desktopManaged: false,
      managedCodexEnabled: false,
      error: null,
    });

    expect(mocks.runExternalCliJsonCommand).toHaveBeenCalledWith(["daemon", "status", "--json"]);
  });

  it("routes running desktop daemon stops through external CLI daemon stop", async () => {
    mocks.runExternalCliJsonCommand
      .mockResolvedValueOnce({
        localDaemon: "running",
        serverId: "server-1",
        pid: 4242,
        listen: "127.0.0.1:6767",
        desktopManaged: true,
      })
      .mockResolvedValueOnce({ action: "stopped" })
      .mockResolvedValueOnce({
        localDaemon: "stopped",
        serverId: "",
      });
    const handlers = createDaemonCommandHandlers();

    await expect(handlers.stop_desktop_daemon()).resolves.toEqual({
      serverId: "",
      status: "stopped",
      listen: null,
      hostname: null,
      pid: null,
      home: "/tmp/doya-home",
      version: null,
      desktopManaged: false,
      managedCodexEnabled: false,
      error: null,
    });

    expect(mocks.runExternalCliJsonCommand).toHaveBeenNthCalledWith(1, [
      "daemon",
      "status",
      "--json",
    ]);
    expect(mocks.runExternalCliJsonCommand).toHaveBeenNthCalledWith(2, [
      "daemon",
      "stop",
      "--json",
      "--timeout",
      "5",
      "--force",
      "--kill-timeout",
      "5",
    ]);
    expect(mocks.runExternalCliJsonCommand).toHaveBeenNthCalledWith(3, [
      "daemon",
      "status",
      "--json",
    ]);
  });

  it("uses a reachable daemon when the PID file is stale", async () => {
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      localDaemon: "stale_pid",
      connectedDaemon: "reachable",
      serverId: "server-1",
      pid: 7675,
      listen: "127.0.0.1:6767",
      hostname: "dev-host",
      daemonVersion: "1.2.2",
      desktopManaged: true,
    });
    const handlers = createDaemonCommandHandlers();

    await expect(handlers.start_desktop_daemon()).resolves.toEqual({
      serverId: "server-1",
      status: "running",
      listen: "127.0.0.1:6767",
      hostname: "dev-host",
      pid: null,
      home: "/tmp/doya-home",
      version: "1.2.2",
      desktopManaged: false,
      managedCodexEnabled: false,
      error: null,
    });

    expect(mocks.spawnProcess).not.toHaveBeenCalled();
  });

  it("applies control registration to an already running daemon", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      localDaemon: "running",
      connectedDaemon: "reachable",
      serverId: "server-1",
      pid: 7675,
      listen: "127.0.0.1:6767",
      hostname: "dev-host",
      daemonVersion: "0.1.88",
      desktopManaged: true,
      managedCodexEnabled: false,
    });
    const handlers = createDaemonCommandHandlers();

    await expect(
      handlers.start_desktop_daemon({
        control: {
          apiBaseUrl: "https://control.example.test",
          userId: "user_123",
          accessToken: "token_abc",
        },
      }),
    ).resolves.toMatchObject({
      serverId: "server-1",
      status: "running",
    });

    expect(mocks.spawnProcess).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:6767/api/admin/daemon/control-registration",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: true,
          apiBaseUrl: "https://control.example.test",
          userId: "user_123",
          authToken: "token_abc",
        }),
      },
    );
  });

  it("restarts a desktop-managed daemon when managed Codex was not injected", async () => {
    mocks.runExternalCliJsonCommand
      .mockResolvedValueOnce({
        localDaemon: "running",
        connectedDaemon: "reachable",
        serverId: "server-1",
        pid: 7675,
        listen: "127.0.0.1:6767",
        hostname: "dev-host",
        daemonVersion: "0.1.88",
        desktopManaged: true,
        managedCodexEnabled: false,
      })
      .mockResolvedValueOnce({
        localDaemon: "running",
        connectedDaemon: "reachable",
        serverId: "server-1",
        pid: 7675,
        listen: "127.0.0.1:6767",
        hostname: "dev-host",
        daemonVersion: "0.1.88",
        desktopManaged: true,
        managedCodexEnabled: false,
      })
      .mockResolvedValueOnce({ action: "stopped" })
      .mockResolvedValue({
        localDaemon: "stopped",
        connectedDaemon: "unreachable",
        serverId: "",
      });
    mocks.spawnProcess.mockImplementation(() => {
      const child = createMockChildProcess();
      scheduleFailedStartupOutput(child);
      return child;
    });
    const handlers = createDaemonCommandHandlers();

    await expect(
      handlers.start_desktop_daemon({
        managedCodex: {
          baseUrl: "http://localhost:6777/api/ai-gateway",
          apiKey: "doya-runtime-token",
          model: "managed-codex-model",
        },
      }),
    ).rejects.toThrow("Daemon failed to start");

    expect(mocks.runExternalCliJsonCommand).toHaveBeenCalledWith([
      "daemon",
      "stop",
      "--json",
      "--timeout",
      "5",
      "--force",
      "--kill-timeout",
      "5",
    ]);
    expect(mocks.spawnProcess).toHaveBeenCalledWith(
      "node",
      [],
      expect.objectContaining({
        envOverlay: expect.objectContaining({
          DOYA_DESKTOP_MANAGED: "1",
          DOYA_MANAGED_CODEX_BASE_URL: "http://localhost:6777/api/ai-gateway",
          DOYA_MANAGED_CODEX_API_KEY: "doya-runtime-token",
          DOYA_MANAGED_CODEX_MODEL: "managed-codex-model",
        }),
      }),
    );
  });

  it("does not fail start when a running daemon rejects control registration", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      localDaemon: "running",
      connectedDaemon: "reachable",
      serverId: "server-1",
      pid: 7675,
      listen: "127.0.0.1:6767",
      hostname: "dev-host",
      daemonVersion: "0.1.88",
      desktopManaged: true,
    });
    const handlers = createDaemonCommandHandlers();

    await expect(
      handlers.start_desktop_daemon({
        control: {
          apiBaseUrl: "https://control.example.test",
          userId: "user_123",
          accessToken: "token_abc",
        },
      }),
    ).resolves.toMatchObject({
      serverId: "server-1",
      status: "running",
    });

    expect(mocks.spawnProcess).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("disables control registration on an already running daemon", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      localDaemon: "running",
      connectedDaemon: "reachable",
      serverId: "server-1",
      pid: 7675,
      listen: "127.0.0.1:6767",
      hostname: "dev-host",
      daemonVersion: "0.1.88",
      desktopManaged: true,
    });
    const handlers = createDaemonCommandHandlers();

    await expect(
      handlers.start_desktop_daemon({
        control: { enabled: false },
      }),
    ).resolves.toMatchObject({
      serverId: "server-1",
      status: "running",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:6767/api/admin/daemon/control-registration",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      },
    );
  });

  it("passes control registration settings to the detached daemon process", async () => {
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      localDaemon: "stopped",
      connectedDaemon: "unreachable",
      serverId: "",
    });
    mocks.spawnProcess.mockImplementation(() => {
      const child = createMockChildProcess();
      scheduleFailedStartupOutput(child);
      return child;
    });
    const handlers = createDaemonCommandHandlers();

    await expect(
      handlers.start_desktop_daemon({
        control: {
          apiBaseUrl: "https://control.example.test",
          userId: "user_123",
          accessToken: "token_abc",
        },
      }),
    ).rejects.toThrow("Daemon failed to start");

    expect(mocks.spawnProcess).toHaveBeenCalledWith(
      "node",
      [],
      expect.objectContaining({
        envOverlay: {
          DOYA_DESKTOP_MANAGED: "1",
          DOYA_CONTROL_ENABLED: "1",
          DOYA_CONTROL_API_URL: "https://control.example.test",
          DOYA_CONTROL_USER_ID: "user_123",
          DOYA_CONTROL_TOKEN: "token_abc",
        },
      }),
    );
  });

  it("passes managed Codex settings to the detached daemon process", async () => {
    vi.stubEnv("DOYA_BUNDLED_CODEX_PATH", "/Applications/Doya.app/Contents/Resources/bin/codex");
    vi.stubEnv("DOYA_MANAGED_CODEX_BASE_URL", "https://sub2api.example.com");
    vi.stubEnv("DOYA_MANAGED_CODEX_API_KEY", "doya-runtime-token");
    vi.stubEnv("DOYA_MANAGED_CODEX_MODEL", "managed-codex-model");
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      localDaemon: "stopped",
      connectedDaemon: "unreachable",
      serverId: "",
    });
    mocks.spawnProcess.mockImplementation(() => {
      const child = createMockChildProcess();
      scheduleFailedStartupOutput(child);
      return child;
    });
    const handlers = createDaemonCommandHandlers();

    await expect(handlers.start_desktop_daemon()).rejects.toThrow("Daemon failed to start");

    expect(mocks.spawnProcess).toHaveBeenCalledWith(
      "node",
      [],
      expect.objectContaining({
        envOverlay: {
          DOYA_DESKTOP_MANAGED: "1",
          DOYA_BUNDLED_CODEX_PATH: "/Applications/Doya.app/Contents/Resources/bin/codex",
          DOYA_MANAGED_CODEX_BASE_URL: "https://sub2api.example.com",
          DOYA_MANAGED_CODEX_API_KEY: "doya-runtime-token",
          DOYA_MANAGED_CODEX_MODEL: "managed-codex-model",
        },
      }),
    );
  });

  it("uses the prepared bundled Codex path in development mode", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "doya-desktop-codex-"));
    const codexPath = path.join(
      tempDir,
      ".generated",
      "codex",
      currentCodexTargetTriple(),
      "bin",
      process.platform === "win32" ? "codex.exe" : "codex",
    );
    mkdirSync(path.dirname(codexPath), { recursive: true });
    writeFileSync(codexPath, "#!/bin/sh\n");
    chmodSync(codexPath, 0o755);
    mocks.appPath = tempDir;
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      localDaemon: "stopped",
      connectedDaemon: "unreachable",
      serverId: "",
    });
    mocks.spawnProcess.mockImplementation(() => {
      const child = createMockChildProcess();
      scheduleFailedStartupOutput(child);
      return child;
    });
    const handlers = createDaemonCommandHandlers();

    try {
      await expect(handlers.start_desktop_daemon()).rejects.toThrow("Daemon failed to start");

      expect(mocks.spawnProcess).toHaveBeenCalledWith(
        "node",
        [],
        expect.objectContaining({
          envOverlay: {
            DOYA_DESKTOP_MANAGED: "1",
            DOYA_BUNDLED_CODEX_PATH: codexPath,
          },
        }),
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("prefers managed Codex start arguments over process environment", async () => {
    vi.stubEnv("DOYA_MANAGED_CODEX_BASE_URL", "https://env-sub2api.example.com");
    vi.stubEnv("DOYA_MANAGED_CODEX_API_KEY", "env-token");
    vi.stubEnv("DOYA_MANAGED_CODEX_MODEL", "env-model");
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      localDaemon: "stopped",
      connectedDaemon: "unreachable",
      serverId: "",
    });
    mocks.spawnProcess.mockImplementation(() => {
      const child = createMockChildProcess();
      scheduleFailedStartupOutput(child);
      return child;
    });
    const handlers = createDaemonCommandHandlers();

    await expect(
      handlers.start_desktop_daemon({
        managedCodex: {
          baseUrl: "https://control-sub2api.example.com",
          apiKey: "control-token",
          model: "control-model",
        },
      }),
    ).rejects.toThrow("Daemon failed to start");

    expect(mocks.spawnProcess).toHaveBeenCalledWith(
      "node",
      [],
      expect.objectContaining({
        envOverlay: {
          DOYA_DESKTOP_MANAGED: "1",
          DOYA_MANAGED_CODEX_BASE_URL: "https://control-sub2api.example.com",
          DOYA_MANAGED_CODEX_API_KEY: "control-token",
          DOYA_MANAGED_CODEX_MODEL: "control-model",
        },
      }),
    );
  });

  it("disables inherited control registration env when starting a detached daemon", async () => {
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      localDaemon: "stopped",
      connectedDaemon: "unreachable",
      serverId: "",
    });
    mocks.spawnProcess.mockImplementation(() => {
      const child = createMockChildProcess();
      scheduleFailedStartupOutput(child);
      return child;
    });
    const handlers = createDaemonCommandHandlers();

    await expect(
      handlers.start_desktop_daemon({
        control: { enabled: false },
      }),
    ).rejects.toThrow("Daemon failed to start");

    expect(mocks.spawnProcess).toHaveBeenCalledWith(
      "node",
      [],
      expect.objectContaining({
        envOverlay: {
          DOYA_DESKTOP_MANAGED: "1",
          DOYA_CONTROL_ENABLED: "0",
        },
      }),
    );
  });

  it("bounds captured daemon startup output", async () => {
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      localDaemon: "stopped",
      connectedDaemon: "unreachable",
      serverId: "",
    });
    mocks.spawnProcess.mockImplementation(() => {
      const child = createMockChildProcess();
      scheduleFailedStartupOutput(child);
      return child;
    });
    const handlers = createDaemonCommandHandlers();

    let thrown: Error | null = null;
    try {
      await handlers.start_desktop_daemon();
    } catch (error) {
      thrown = error instanceof Error ? error : new Error(String(error));
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = thrown?.message ?? "";
    expect(message).toContain("Daemon failed to start: exit code 1");
    expect(message).toContain("output truncated to the last 65536 chars");
    expect(message).toContain("stdout-tail");
    expect(message).toContain("stderr-tail");
    expect(message.length).toBeLessThan(150_000);
  });
});

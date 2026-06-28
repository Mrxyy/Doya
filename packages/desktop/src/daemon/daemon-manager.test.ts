import { EventEmitter } from "node:events";
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
}));

vi.mock("electron", () => ({
  app: {
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
    mocks.settings = DEFAULT_DESKTOP_SETTINGS;
    mocks.runExternalCliJsonCommand.mockReset();
    mocks.runExternalCliTextCommand.mockReset();
    mocks.spawnProcess.mockReset();
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

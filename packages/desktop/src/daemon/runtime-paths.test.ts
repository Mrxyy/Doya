import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveNodeExecPath } from "./runtime-paths";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  app: {
    isPackaged: true,
  },
}));

vi.mock("node:fs", () => ({
  existsSync: mocks.existsSync,
  readFileSync: vi.fn(),
}));

vi.mock("electron", () => ({
  app: mocks.app,
}));

vi.mock("electron-log/main", () => ({
  default: { warn: vi.fn() },
}));

vi.mock("@getdoya/server", () => ({
  spawnProcess: vi.fn(),
}));

const originalPlatform = process.platform;
const originalExecPath = process.execPath;
const originalResourcesPath = process.resourcesPath;

function setProcessRuntime(input: {
  platform: NodeJS.Platform;
  execPath: string;
  resourcesPath?: string;
}): void {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: input.platform,
  });
  Object.defineProperty(process, "execPath", {
    configurable: true,
    value: input.execPath,
  });
  Object.defineProperty(process, "resourcesPath", {
    configurable: true,
    value: input.resourcesPath,
  });
}

describe("runtime-paths", () => {
  beforeEach(() => {
    mocks.app.isPackaged = true;
    mocks.existsSync.mockReturnValue(true);
    setProcessRuntime({
      platform: "darwin",
      execPath: "/Applications/Doya.app/Contents/MacOS/Doya",
      resourcesPath: "/Applications/Doya.app/Contents/Resources",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.npm_node_execpath;
    delete process.env.NODE_BINARY;
    setProcessRuntime({
      platform: originalPlatform,
      execPath: originalExecPath,
      resourcesPath: originalResourcesPath,
    });
  });

  it("uses the macOS Helper executable for packaged daemon node launches", () => {
    expect(resolveNodeExecPath()).toBe(
      "/Applications/Doya.app/Contents/Frameworks/Doya Helper.app/Contents/MacOS/Doya Helper",
    );
  });

  it("uses npm's Node executable for development daemon node launches", () => {
    mocks.app.isPackaged = false;
    process.env.npm_node_execpath = "/opt/homebrew/bin/node";
    mocks.existsSync.mockImplementation((value) => value === "/opt/homebrew/bin/node");

    expect(resolveNodeExecPath()).toBe("/opt/homebrew/bin/node");
  });

  it("falls back to node on PATH for development daemon node launches", () => {
    mocks.app.isPackaged = false;
    process.env.npm_node_execpath = "/missing/node";
    process.env.NODE_BINARY = "/also-missing/node";
    mocks.existsSync.mockReturnValue(false);

    expect(resolveNodeExecPath()).toBe("node");
  });
});

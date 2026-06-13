/**
 * Test setup utilities for Doya CLI E2E tests
 *
 * Critical rules from design doc:
 * 1. Port: Random port via 10000 + Math.floor(Math.random() * 50000) - NEVER 6767
 * 2. Protocol: WebSocket ONLY - daemon has no HTTP endpoints
 * 3. Temp dirs: Create temp directories for DOYA_HOME and agent --cwd
 * 4. Model: Always --provider claude with haiku model for agent tests
 * 5. Cleanup: Kill daemon and remove temp dirs after each test
 */

import { $, ProcessPromise, sleep } from "zx";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const TEST_ENV_DEFAULTS = {
  DOYA_LOCAL_SPEECH_AUTO_DOWNLOAD: process.env.DOYA_LOCAL_SPEECH_AUTO_DOWNLOAD ?? "0",
  DOYA_DICTATION_ENABLED: process.env.DOYA_DICTATION_ENABLED ?? "0",
  DOYA_VOICE_MODE_ENABLED: process.env.DOYA_VOICE_MODE_ENABLED ?? "0",
};

function killPidTree(pid: number, signal: NodeJS.Signals): void {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ESRCH") {
        return;
      }
    }
  }

  try {
    process.kill(pid, signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH") {
      throw error;
    }
  }
}

export interface TestContext {
  /** Random port for test daemon (never 6767) */
  port: number;
  /** Temp directory for DOYA_HOME */
  doyaHome: string;
  /** Temp directory for agent working directory */
  workDir: string;
  /** Running daemon process */
  daemon: ProcessPromise | null;
  /** Run a Doya CLI command against the test daemon */
  doya: (args: string[]) => ProcessPromise;
  /** Clean up all resources */
  cleanup: () => Promise<void>;
}

/**
 * Generate a random port for test daemon
 * NEVER uses 6767 (user's running daemon)
 */
export function getRandomPort(): number {
  return 10000 + Math.floor(Math.random() * 50000);
}

/**
 * Create isolated temp directories for testing
 */
export async function createTempDirs(): Promise<{ doyaHome: string; workDir: string }> {
  const doyaHome = await mkdtemp(join(tmpdir(), "doya-test-home-"));
  const workDir = await mkdtemp(join(tmpdir(), "doya-test-work-"));
  return { doyaHome, workDir };
}

/**
 * Wait for daemon to be ready by testing WebSocket connection
 * Uses `doya agent ls` which connects via WebSocket
 */
async function probeDaemon(port: number): Promise<boolean> {
  try {
    const result = await $`DOYA_HOST=localhost:${port} doya agent ls`.nothrow();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function waitForDaemon(port: number, timeout = 30000): Promise<void> {
  const deadline = Date.now() + timeout;
  async function poll(): Promise<void> {
    if (await probeDaemon(port)) return;
    if (Date.now() >= deadline) {
      throw new Error(`Daemon failed to start on port ${port} within ${timeout}ms`);
    }
    await sleep(100);
    return poll();
  }
  return poll();
}

/**
 * Start an isolated test daemon
 */
export async function startDaemon(port: number, doyaHome: string): Promise<ProcessPromise> {
  $.verbose = false;
  const daemon =
    $`DOYA_HOME=${doyaHome} DOYA_LISTEN=127.0.0.1:${port} DOYA_RELAY_ENABLED=false DOYA_LOCAL_SPEECH_AUTO_DOWNLOAD=${TEST_ENV_DEFAULTS.DOYA_LOCAL_SPEECH_AUTO_DOWNLOAD} DOYA_DICTATION_ENABLED=${TEST_ENV_DEFAULTS.DOYA_DICTATION_ENABLED} DOYA_VOICE_MODE_ENABLED=${TEST_ENV_DEFAULTS.DOYA_VOICE_MODE_ENABLED} CI=true doya daemon start --foreground`.nothrow();
  return daemon;
}

/**
 * Create a full test context with daemon, temp dirs, and helpers
 */
export async function createTestContext(): Promise<TestContext> {
  const port = getRandomPort();
  const { doyaHome, workDir } = await createTempDirs();

  // Helper to run CLI commands against test daemon
  const doya = (args: string[]): ProcessPromise => {
    $.verbose = false;
    return $`DOYA_HOST=localhost:${port} DOYA_LOCAL_SPEECH_AUTO_DOWNLOAD=${TEST_ENV_DEFAULTS.DOYA_LOCAL_SPEECH_AUTO_DOWNLOAD} DOYA_DICTATION_ENABLED=${TEST_ENV_DEFAULTS.DOYA_DICTATION_ENABLED} DOYA_VOICE_MODE_ENABLED=${TEST_ENV_DEFAULTS.DOYA_VOICE_MODE_ENABLED} doya ${args}`.nothrow();
  };

  // Cleanup function
  const cleanup = async (): Promise<void> => {
    if (ctx.daemon) {
      if (typeof ctx.daemon.pid === "number") {
        killPidTree(ctx.daemon.pid, "SIGTERM");
        await sleep(250);
        killPidTree(ctx.daemon.pid, "SIGKILL");
      } else {
        ctx.daemon.kill();
      }
    }
    await rm(doyaHome, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  };

  const ctx: TestContext = {
    port,
    doyaHome,
    workDir,
    daemon: null,
    doya,
    cleanup,
  };

  return ctx;
}

/**
 * Create a test context and start the daemon
 * Use this for tests that need a running daemon
 */
export async function createTestContextWithDaemon(): Promise<TestContext> {
  const ctx = await createTestContext();
  ctx.daemon = await startDaemon(ctx.port, ctx.doyaHome);
  await waitForDaemon(ctx.port);
  return ctx;
}

/**
 * Register cleanup handlers for process exit
 */
export function registerCleanupHandlers(cleanup: () => Promise<void>): void {
  const handler = async () => {
    await cleanup();
    process.exit(0);
  };

  process.on("exit", () => {
    // Can't await in exit handler, but at least try to kill daemon
  });
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
}

import {
  startDesktopDaemon,
  type DesktopDaemonStatus,
  type StartDesktopDaemonOptions,
} from "@/desktop/daemon/desktop-daemon";
import { connectionFromListen } from "@/types/host-connection";
import type { HostRuntimeStore } from "@/runtime/host-runtime";

export type DaemonStartResult = { ok: true } | { ok: false; error: string };
interface ControlAccountSessionLike {
  user: {
    userId: string;
  };
  accessToken: string;
}
type LoadAccountSession = () => Promise<ControlAccountSessionLike | null>;
type ResolveControlApiBaseUrl = () => string | null | Promise<string | null>;
type LoadManagedCodexConfig = (
  session: ControlAccountSessionLike,
) => Promise<{ baseUrl: string; apiKey: string; model?: string | null } | null>;
type MaybePromise<T> = T | Promise<T>;

export interface DaemonStartServiceDeps {
  store: Pick<HostRuntimeStore, "upsertConnectionFromListen">;
  startDesktopDaemon?: (options?: StartDesktopDaemonOptions) => Promise<DesktopDaemonStatus>;
  loadAccountSession?: LoadAccountSession;
  resolveControlApiBaseUrl?: ResolveControlApiBaseUrl;
  loadManagedCodexConfig?: LoadManagedCodexConfig;
}

export class DaemonStartService {
  private readonly store: Pick<HostRuntimeStore, "upsertConnectionFromListen">;
  private readonly invokeStartDesktopDaemon: (
    options?: StartDesktopDaemonOptions,
  ) => Promise<DesktopDaemonStatus>;
  private readonly loadAccountSession: LoadAccountSession;
  private readonly resolveControlApiBaseUrl: ResolveControlApiBaseUrl;
  private readonly loadManagedCodexConfig: LoadManagedCodexConfig;
  private readonly listeners = new Set<() => void>();
  private lastError: string | null = null;
  private inFlightCount = 0;

  constructor(deps: DaemonStartServiceDeps) {
    const usesInjectedDesktopDaemon = Boolean(deps.startDesktopDaemon);
    this.store = deps.store;
    this.invokeStartDesktopDaemon = deps.startDesktopDaemon ?? startDesktopDaemon;
    this.loadAccountSession =
      deps.loadAccountSession ??
      (usesInjectedDesktopDaemon ? loadNoAccountSession : loadDefaultAccountSession);
    this.resolveControlApiBaseUrl =
      deps.resolveControlApiBaseUrl ??
      (usesInjectedDesktopDaemon ? resolveNoControlApiBaseUrl : resolveDefaultControlApiBaseUrl);
    this.loadManagedCodexConfig =
      deps.loadManagedCodexConfig ??
      (usesInjectedDesktopDaemon ? loadNoManagedCodexConfig : loadDefaultManagedCodexConfig);
  }

  async start(): Promise<DaemonStartResult> {
    this.beginRequest();
    try {
      const options = this.resolveStartOptionsSafely();
      const daemon = await this.invokeStartDesktopDaemon(
        isPromiseLike(options) ? await options : options,
      );
      const listenAddress = daemon.listen?.trim() ?? "";
      const serverId = daemon.serverId.trim();
      if (!listenAddress) {
        return this.fail("Desktop daemon did not return a listen address.");
      }
      if (!serverId) {
        return this.fail("Desktop daemon did not return a server id.");
      }
      if (!connectionFromListen(listenAddress)) {
        return this.fail(`Desktop daemon returned an unsupported listen address: ${listenAddress}`);
      }
      await this.store.upsertConnectionFromListen({
        listenAddress,
        serverId,
        hostname: daemon.hostname,
      });
      return { ok: true };
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : String(error));
    } finally {
      this.endRequest();
    }
  }

  getLastError(): string | null {
    return this.lastError;
  }

  recordError(message: string): void {
    this.setLastError(message);
  }

  isRunning(): boolean {
    return this.inFlightCount > 0;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private fail(message: string): DaemonStartResult {
    this.setLastError(message);
    return { ok: false, error: message };
  }

  private setLastError(value: string | null): void {
    if (this.lastError === value) {
      return;
    }
    this.lastError = value;
    this.notify();
  }

  private beginRequest(): void {
    const becameRunning = this.inFlightCount === 0;
    this.inFlightCount += 1;
    const errorChanged = this.lastError !== null;
    this.lastError = null;
    if (becameRunning || errorChanged) {
      this.notify();
    }
  }

  private endRequest(): void {
    this.inFlightCount = Math.max(0, this.inFlightCount - 1);
    if (this.inFlightCount === 0) {
      this.notify();
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private resolveStartOptionsSafely(): MaybePromise<StartDesktopDaemonOptions | undefined> {
    try {
      const options = this.resolveStartOptions();
      if (isPromiseLike(options)) {
        return options.catch(() => undefined);
      }
      return options;
    } catch {
      return undefined;
    }
  }

  private resolveStartOptions(): MaybePromise<StartDesktopDaemonOptions | undefined> {
    const apiBaseUrl = this.resolveControlApiBaseUrl();
    if (isPromiseLike(apiBaseUrl)) {
      return apiBaseUrl.then((resolvedApiBaseUrl) =>
        this.resolveStartOptionsForApiBaseUrl(resolvedApiBaseUrl),
      );
    }
    return this.resolveStartOptionsForApiBaseUrl(apiBaseUrl);
  }

  private resolveStartOptionsForApiBaseUrl(
    apiBaseUrl: string | null,
  ): MaybePromise<StartDesktopDaemonOptions | undefined> {
    if (!apiBaseUrl) {
      return undefined;
    }

    return this.loadAccountSession().then(async (session) => {
      const userId = session?.user.userId.trim() ?? "";
      const accessToken = session?.accessToken.trim() ?? "";
      if (!userId || !accessToken) {
        return { control: { enabled: false } };
      }

      const managedCodex = await this.loadManagedCodexConfigSafely(session);
      return {
        control: {
          apiBaseUrl,
          userId,
          accessToken,
        },
        ...(managedCodex ? { managedCodex } : {}),
      };
    });
  }

  private async loadManagedCodexConfigSafely(
    session: ControlAccountSessionLike,
  ): Promise<{ baseUrl: string; apiKey: string; model?: string | null } | null> {
    try {
      return await this.loadManagedCodexConfig(session);
    } catch {
      return null;
    }
  }
}

function isPromiseLike<T>(value: MaybePromise<T>): value is Promise<T> {
  return typeof value === "object" && value !== null && "then" in value;
}

async function loadDefaultAccountSession(): Promise<ControlAccountSessionLike | null> {
  const accountApi = await import("@/account/account-api");
  return accountApi.loadAccountBootstrapSession();
}

async function loadNoAccountSession(): Promise<ControlAccountSessionLike | null> {
  return null;
}

async function resolveDefaultControlApiBaseUrl(): Promise<string | null> {
  const controlApi = await import("@/control/control-api");
  return controlApi.controlApiBaseUrl();
}

function resolveNoControlApiBaseUrl(): string | null {
  return null;
}

async function loadDefaultManagedCodexConfig(
  session: ControlAccountSessionLike,
): Promise<{ baseUrl: string; apiKey: string; model?: string | null } | null> {
  const controlApi = await import("@/control/control-api");
  const codex = await controlApi.getControlManagedCodexConfig({
    accountSession: {
      user: {
        userId: session.user.userId,
        email: "",
        phone: null,
      },
      workspace: {
        workspaceId: `control:${session.user.userId}`,
        displayName: "Doya",
        runtime: null,
      },
      projects: [],
      accessToken: session.accessToken,
      apiBaseUrl: "",
    },
  });
  if (!codex.enabled || !codex.baseUrl || !codex.apiKey) {
    return null;
  }
  return {
    baseUrl: codex.baseUrl,
    apiKey: codex.apiKey,
    model: codex.model,
  };
}

async function loadNoManagedCodexConfig(): Promise<null> {
  return null;
}

let singletonDaemonStartService: DaemonStartService | null = null;
const DAEMON_START_SERVICE_GLOBAL_KEY = "__doyaDaemonStartService";

export function getDaemonStartService(deps: DaemonStartServiceDeps): DaemonStartService {
  if (singletonDaemonStartService) {
    return singletonDaemonStartService;
  }

  const runtimeGlobal = globalThis as unknown as {
    [DAEMON_START_SERVICE_GLOBAL_KEY]?: DaemonStartService;
  };
  if (runtimeGlobal[DAEMON_START_SERVICE_GLOBAL_KEY]) {
    singletonDaemonStartService = runtimeGlobal[DAEMON_START_SERVICE_GLOBAL_KEY] ?? null;
    if (singletonDaemonStartService) {
      return singletonDaemonStartService;
    }
  }

  singletonDaemonStartService = new DaemonStartService(deps);
  runtimeGlobal[DAEMON_START_SERVICE_GLOBAL_KEY] = singletonDaemonStartService;
  return singletonDaemonStartService;
}

import { randomUUID } from "node:crypto";

export type DaemonCommandMethod = "DELETE" | "GET" | "PATCH" | "POST";

export interface DaemonCommandRequest {
  method: DaemonCommandMethod;
  endpointPath: string;
  body?: unknown;
}

export interface DaemonCommand {
  id: string;
  nodeId: string;
  method: DaemonCommandMethod;
  endpointPath: string;
  body?: unknown;
  createdAt: string;
}

export interface DaemonCommandResult {
  ok: boolean;
  status?: number;
  body?: unknown;
  error?: string;
}

interface PendingCommand {
  command: DaemonCommand;
  resolve: (result: DaemonCommandResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

export class DaemonCommandFailedError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class DaemonCommandTimeoutError extends Error {}

export class DaemonCommandBroker {
  private readonly pendingByNodeId = new Map<string, PendingCommand[]>();
  private readonly pendingByCommandId = new Map<string, PendingCommand>();

  request<TResponse>(
    nodeId: string,
    request: DaemonCommandRequest,
    options: { timeoutMs?: number; now?: () => Date } = {},
  ): Promise<TResponse> {
    const command: DaemonCommand = {
      id: `cmd_${randomUUID()}`,
      nodeId,
      method: request.method,
      endpointPath: request.endpointPath,
      ...(request.body === undefined ? {} : { body: request.body }),
      createdAt: (options.now?.() ?? new Date()).toISOString(),
    };

    return new Promise<TResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removePending(command.id);
        reject(new DaemonCommandTimeoutError("Daemon command timed out"));
      }, options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);
      timer.unref?.();

      const pending: PendingCommand = {
        command,
        timer,
        resolve: (result) => {
          if (!result.ok) {
            reject(
              new DaemonCommandFailedError(
                result.error ?? "Daemon command failed",
                result.status ?? 500,
              ),
            );
            return;
          }
          resolve((result.body ?? {}) as TResponse);
        },
        reject,
      };
      this.pendingByCommandId.set(command.id, pending);
      const queue = this.pendingByNodeId.get(nodeId) ?? [];
      queue.push(pending);
      this.pendingByNodeId.set(nodeId, queue);
    });
  }

  takePending(nodeId: string, limit: number): DaemonCommand[] {
    const queue = this.pendingByNodeId.get(nodeId) ?? [];
    const selected = queue.splice(0, Math.max(1, limit));
    if (queue.length === 0) {
      this.pendingByNodeId.delete(nodeId);
    }
    return selected.map((entry) => entry.command);
  }

  complete(nodeId: string, commandId: string, result: DaemonCommandResult): boolean {
    const pending = this.pendingByCommandId.get(commandId);
    if (!pending || pending.command.nodeId !== nodeId) {
      return false;
    }
    this.removePending(commandId);
    pending.resolve(result);
    return true;
  }

  private removePending(commandId: string): void {
    const pending = this.pendingByCommandId.get(commandId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pendingByCommandId.delete(commandId);
    const queue = this.pendingByNodeId.get(pending.command.nodeId);
    if (!queue) {
      return;
    }
    const index = queue.findIndex((entry) => entry.command.id === commandId);
    if (index >= 0) {
      queue.splice(index, 1);
    }
    if (queue.length === 0) {
      this.pendingByNodeId.delete(pending.command.nodeId);
    }
  }
}

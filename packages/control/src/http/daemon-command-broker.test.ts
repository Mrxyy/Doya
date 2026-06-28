import { describe, expect, it } from "vitest";

import {
  DaemonCommandBroker,
  DaemonCommandFailedError,
  DaemonCommandTimeoutError,
} from "./daemon-command-broker.js";

describe("daemon command broker", () => {
  it("queues commands by node and resolves completed results", async () => {
    const broker = new DaemonCommandBroker();
    const resultPromise = broker.request<{ status: string }>(
      "node_1",
      {
        method: "GET",
        endpointPath: "/api/admin/daemon/load",
      },
      { now: () => new Date("2026-01-01T00:00:00.000Z") },
    );

    const commands = broker.takePending("node_1", 1);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      nodeId: "node_1",
      method: "GET",
      endpointPath: "/api/admin/daemon/load",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(
      broker.complete("node_1", commands[0]?.id ?? "", {
        ok: true,
        status: 200,
        body: { status: "ok" },
      }),
    ).toBe(true);
    await expect(resultPromise).resolves.toEqual({ status: "ok" });
  });

  it("rejects failed command results", async () => {
    const broker = new DaemonCommandBroker();
    const resultPromise = broker.request("node_1", {
      method: "GET",
      endpointPath: "/api/admin/daemon/config",
    });
    const [command] = broker.takePending("node_1", 1);

    broker.complete("node_1", command?.id ?? "", {
      ok: false,
      status: 501,
      error: "Daemon config is not available.",
    });

    await expect(resultPromise).rejects.toBeInstanceOf(DaemonCommandFailedError);
  });

  it("times out commands that are never completed", async () => {
    const broker = new DaemonCommandBroker();
    const resultPromise = broker.request(
      "node_1",
      {
        method: "GET",
        endpointPath: "/api/admin/daemon/load",
      },
      { timeoutMs: 1 },
    );

    await expect(resultPromise).rejects.toBeInstanceOf(DaemonCommandTimeoutError);
    expect(broker.takePending("node_1", 1)).toEqual([]);
  });

  it("rejects command results from a different node", async () => {
    const broker = new DaemonCommandBroker();
    const resultPromise = broker.request(
      "node_1",
      {
        method: "GET",
        endpointPath: "/api/admin/daemon/load",
      },
      { timeoutMs: 1 },
    );
    const [command] = broker.takePending("node_1", 1);

    expect(
      broker.complete("node_2", command?.id ?? "", {
        ok: true,
        status: 200,
        body: { status: "ok" },
      }),
    ).toBe(false);
    await expect(resultPromise).rejects.toBeInstanceOf(DaemonCommandTimeoutError);
  });
});

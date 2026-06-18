import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRuntimeApiRouter } from "./runtime-api.js";

interface TestServer {
  server: Server;
  baseUrl: string;
}

let tempRoot: string;
let testServer: TestServer;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "doya-runtime-api-"));
  testServer = await startRuntimeApiTestServer(tempRoot);
});

afterEach(async () => {
  await new Promise<void>((resolve) => testServer.server.close(() => resolve()));
  await rm(tempRoot, { recursive: true, force: true });
});

describe("runtime API uploaded file snapshots", () => {
  it("restores snapshot files into the runtime workspace", async () => {
    const response = await fetch(`${testServer.baseUrl}/api/runtimes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "ses_1",
        workingContext: { type: "uploaded_files", snapshotId: "snap_1" },
        fileSnapshot: {
          files: [
            {
              path: "src/hello.txt",
              contentBase64: Buffer.from("hello").toString("base64"),
            },
          ],
        },
      }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      runtime: { workspaceDir: string };
    };
    await expect(
      readFile(path.join(payload.runtime.workspaceDir, "src", "hello.txt"), "utf8"),
    ).resolves.toBe("hello");
  });

  it("rejects snapshot files that escape the workspace", async () => {
    const response = await fetch(`${testServer.baseUrl}/api/runtimes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "ses_1",
        workingContext: { type: "uploaded_files", snapshotId: "snap_1" },
        fileSnapshot: {
          files: [
            {
              path: "../escaped.txt",
              contentBase64: Buffer.from("nope").toString("base64"),
            },
          ],
        },
      }),
    });

    expect(response.status).toBe(500);
    await expect(readFile(path.join(tempRoot, "escaped.txt"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

async function startRuntimeApiTestServer(doyaHome: string): Promise<TestServer> {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/runtimes",
    createRuntimeApiRouter({
      doyaHome,
      nodeId: "node_1",
      logger: {
        error: () => undefined,
      } as never,
    }),
  );
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port");
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUserWorkspaceApiRouter } from "./user-workspace-api.js";

interface TestServer {
  server: Server;
  baseUrl: string;
}

let tempRoot: string;
let testServer: TestServer;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "doya-user-workspace-api-"));
  testServer = await startUserWorkspaceApiTestServer(tempRoot);
});

afterEach(async () => {
  await new Promise<void>((resolve) => testServer.server.close(() => resolve()));
  await rm(tempRoot, { recursive: true, force: true });
});

describe("user workspace API", () => {
  it("creates a daemon-local user workspace and session work directory", async () => {
    const ensureResponse = await fetch(`${testServer.baseUrl}/api/user-workspaces/ensure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "usr_1" }),
    });

    expect(ensureResponse.status).toBe(200);
    const ensurePayload = (await ensureResponse.json()) as {
      workspace: { workspaceId: string; workspaceDir: string };
    };
    expect(ensurePayload.workspace.workspaceId).toBe("uws_usr_1");
    await expect(stat(ensurePayload.workspace.workspaceDir)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });

    const sessionResponse = await fetch(
      `${testServer.baseUrl}/api/user-workspaces/session-workdirs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "usr_1", sessionId: "ses_1" }),
      },
    );

    expect(sessionResponse.status).toBe(200);
    const sessionPayload = (await sessionResponse.json()) as { workDir: string };
    await expect(stat(sessionPayload.workDir)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
    await expect(readFile(path.join(tempRoot, "accounts", "accounts.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("deletes selected daemon-local session work directories", async () => {
    const createResponse = await fetch(
      `${testServer.baseUrl}/api/user-workspaces/session-workdirs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "usr_1", sessionId: "ses_1" }),
      },
    );
    const createPayload = (await createResponse.json()) as { workDir: string };

    const deleteResponse = await fetch(
      `${testServer.baseUrl}/api/user-workspaces/session-workdirs`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "usr_1", sessionIds: ["ses_1"] }),
      },
    );

    expect(deleteResponse.status).toBe(200);
    const deletePayload = (await deleteResponse.json()) as {
      deleted: Array<{ sessionId: string; workDir: string }>;
      failed: Array<{ sessionId: string }>;
    };
    expect(deletePayload.deleted).toEqual([
      expect.objectContaining({ sessionId: "ses_1", workDir: createPayload.workDir }),
    ]);
    expect(deletePayload.failed).toEqual([]);
    await expect(stat(createPayload.workDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("scans daemon-local user workspace bytes without deleting files", async () => {
    const ensureResponse = await fetch(`${testServer.baseUrl}/api/user-workspaces/ensure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "usr_1" }),
    });
    const ensurePayload = (await ensureResponse.json()) as {
      workspace: { workspaceDir: string };
    };
    await mkdir(path.join(ensurePayload.workspace.workspaceDir, "nested"), { recursive: true });
    await writeFile(path.join(ensurePayload.workspace.workspaceDir, "a.txt"), "hello", "utf8");
    await writeFile(
      path.join(ensurePayload.workspace.workspaceDir, "nested", "b.txt"),
      "world!",
      "utf8",
    );

    const scanResponse = await fetch(`${testServer.baseUrl}/api/user-workspaces/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "usr_1" }),
    });

    expect(scanResponse.status).toBe(200);
    const scanPayload = (await scanResponse.json()) as {
      totalBytes: number;
      fileCount: number;
      scannedAt: string;
    };
    expect(scanPayload.totalBytes).toBe(11);
    expect(scanPayload.fileCount).toBe(2);
    expect(scanPayload.scannedAt).toEqual(expect.any(String));
    await expect(
      stat(path.join(ensurePayload.workspace.workspaceDir, "a.txt")),
    ).resolves.toMatchObject({
      isFile: expect.any(Function),
    });
  });
});

async function startUserWorkspaceApiTestServer(doyaHome: string): Promise<TestServer> {
  const app = express();
  app.use(express.json());
  app.use("/api/user-workspaces", createUserWorkspaceApiRouter({ doyaHome }));
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

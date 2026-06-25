import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Logger } from "pino";
import type { AgentManager } from "../agent/agent-manager.js";
import { createPptPreviewRouter } from "./ppt-preview-service.js";

describe("ppt preview service", () => {
  const slideName = "01_武汉早餐美食介绍.svg";
  let root: string;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "doya-ppt-preview-"));
    const svgDir = path.join(root, "projects/demo/svg_output");
    await mkdir(svgDir, { recursive: true });
    await writeFile(
      path.join(svgDir, slideName),
      [
        '<svg width="1600" height="900" xmlns="http://www.w3.org/2000/svg">',
        '<rect x="0" y="0" width="100" height="100" />',
        '<text x="10" y="20">Hello</text>',
        '<use data-icon="tabler-outline/cpu" x="20" y="30" width="32" height="32" fill="#1A365D"/>',
        "</svg>",
      ].join(""),
      "utf8",
    );

    const app = express();
    app.use(express.json());
    app.use(
      "/ppt-preview",
      createPptPreviewRouter({
        agentManager: {
          getAgent(id: string) {
            if (id !== "agent-1") return null;
            return {
              id,
              cwd: root,
              labels: { surface: "ai_creation", intent: "ppt_creation" },
            };
          },
        } as unknown as AgentManager,
        logger: {
          child: () => loggerStub,
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
        } as unknown as Logger,
      }),
    );
    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("test server did not bind a TCP port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(root, { recursive: true, force: true });
  });

  it("lists slides and serves preview SVG with deterministic edit ids", async () => {
    const slidesResponse = await fetch(`${baseUrl}/ppt-preview/agent-1/demo/api/slides`);
    expect(slidesResponse.status).toBe(200);
    await expect(slidesResponse.json()).resolves.toMatchObject({
      slides: [{ name: slideName, annotated: false, ok: true }],
    });

    const slideResponse = await fetch(
      `${baseUrl}/ppt-preview/agent-1/demo/api/slide/${encodeURIComponent(slideName)}`,
    );
    expect(slideResponse.status).toBe(200);
    const slide = (await slideResponse.json()) as { content: string };
    expect(slide.content).toContain('id="_edit_0"');
    expect(slide.content).toMatch(
      /<rect x="0" y="0" width="100" height="100"\s+id="_edit_0"\s*\/>/,
    );
    expect(slide.content).not.toContain("/ id=");
  });

  it("expands PPT Master data-icon placeholders in preview responses", async () => {
    const slideResponse = await fetch(
      `${baseUrl}/ppt-preview/agent-1/demo/api/slide/${encodeURIComponent(slideName)}`,
    );
    expect(slideResponse.status).toBe(200);
    const slide = (await slideResponse.json()) as { content: string };
    expect(slide.content).not.toContain("<use");
    expect(slide.content).toContain("<!-- icon: tabler-outline/cpu -->");
    expect(slide.content).toContain('data-icon="tabler-outline/cpu"');
    expect(slide.content).toContain('stroke="#1A365D"');
    expect(slide.content).toContain('transform="translate(20, 30) scale(1.33333333333)"');
  });

  it("stages annotations and writes them back on save-all", async () => {
    const annotateResponse = await fetch(
      `${baseUrl}/ppt-preview/agent-1/demo/api/slide/${encodeURIComponent(slideName)}/annotate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ element_id: "_edit_0", annotation: "Make this title shorter" }),
      },
    );
    expect(annotateResponse.status).toBe(200);

    const saveResponse = await fetch(`${baseUrl}/ppt-preview/agent-1/demo/api/save-all`, {
      method: "POST",
    });
    expect(saveResponse.status).toBe(200);

    const saved = await readFile(path.join(root, "projects/demo/svg_output", slideName), "utf8");
    expect(saved).toContain('id="_edit_0"');
    expect(saved).toContain('data-edit-target="true"');
    expect(saved).toContain('data-edit-annotation="Make this title shorter"');
  });
});

const loggerStub = {
  child: () => loggerStub,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

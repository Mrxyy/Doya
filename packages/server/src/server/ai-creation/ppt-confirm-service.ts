import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type { Logger } from "pino";
import type { AgentManager } from "../agent/agent-manager.js";

interface PptConfirmServiceOptions {
  agentManager: AgentManager;
  logger: Logger;
}

interface ResolvedConfirmProject {
  projectPath: string;
  confirmPath: string;
}

export function createPptConfirmRouter(options: PptConfirmServiceOptions): express.Router {
  const service = new PptConfirmService(options);
  return service.router;
}

class PptConfirmService {
  readonly router = express.Router();
  private readonly staticDir = resolveBundledConfirmStaticPath();

  constructor(private readonly options: PptConfirmServiceOptions) {
    this.router.get("/:agentId/:projectName", (req, res) => {
      void this.handleIndex(req, res);
    });
    this.router.get("/:agentId/:projectName/", (req, res) => {
      void this.handleIndex(req, res);
    });
    this.router.get("/:agentId/:projectName/static/:fileName", (req, res) => {
      void this.handleStatic(req, res);
    });
    this.router.get("/:agentId/:projectName/static/*", (req, res) => {
      void this.handleStaticAsset(req, res);
    });
    this.router.get("/:agentId/:projectName/api/catalogs", (_req, res) => {
      void this.handleCatalogs(res);
    });
    this.router.get("/:agentId/:projectName/api/recommendations", (req, res) => {
      void this.handleRecommendations(req, res);
    });
    this.router.post("/:agentId/:projectName/api/confirm", (req, res) => {
      void this.handleConfirm(req, res);
    });
    this.router.post("/:agentId/:projectName/api/shutdown", (_req, res) => {
      res.json({ status: "ok", managed_by: "doya" });
    });
  }

  private async handleIndex(req: express.Request, res: express.Response): Promise<void> {
    if (!this.resolveConfirmProject(req, res)) return;
    const basePath = this.confirmBasePath(req);
    const html = await readFile(path.join(this.staticDir, "index.html"), "utf8");
    res
      .type("html")
      .send(
        html
          .replace('href="/static/style.css"', `href="${basePath}/static/style.css"`)
          .replace('src="/static/app.js"', `src="${basePath}/static/app.js"`),
      );
  }

  private async handleStatic(req: express.Request, res: express.Response): Promise<void> {
    const fileName = req.params.fileName;
    if (!["app.js", "style.css", "catalogs.json"].includes(fileName)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const filePath = path.join(this.staticDir, fileName);
    if (fileName !== "app.js") {
      res.sendFile(filePath);
      return;
    }
    const basePath = this.confirmBasePath(req);
    const source = await readFile(filePath, "utf8");
    res
      .type("application/javascript")
      .send(
        [
          `window.__DOYA_PPT_CONFIRM_BASE__ = ${JSON.stringify(basePath)};`,
          `window.fetch = ((originalFetch) => (input, init) => {`,
          `  if (typeof input === "string" && (input === "/static/catalogs.json" || input === "/api/confirm" || input === "/api/shutdown" || input.startsWith("/api/"))) input = window.__DOYA_PPT_CONFIRM_BASE__ + input;`,
          `  return originalFetch(input, init);`,
          `})(window.fetch.bind(window));`,
          source,
        ].join("\n"),
      );
  }

  private async handleStaticAsset(req: express.Request, res: express.Response): Promise<void> {
    const relativePath = req.params[0] ?? "";
    const filePath = safeChildPath(this.staticDir, relativePath);
    if (!filePath || !existsSync(filePath)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.sendFile(filePath);
  }

  private async handleCatalogs(res: express.Response): Promise<void> {
    res.sendFile(path.join(this.staticDir, "catalogs.json"));
  }

  private async handleRecommendations(req: express.Request, res: express.Response): Promise<void> {
    const project = this.resolveConfirmProject(req, res);
    if (!project) return;
    const recommendationsPath = path.join(project.confirmPath, "recommendations.json");
    if (!existsSync(recommendationsPath)) {
      res.status(404).json({ error: "recommendations not found" });
      return;
    }
    try {
      const data = JSON.parse(await readFile(recommendationsPath, "utf8")) as Record<
        string,
        unknown
      >;
      const resultPath = path.join(project.confirmPath, "result.json");
      data._already_confirmed = existsSync(resultPath);
      if (data._already_confirmed) {
        data._confirmed_at = await readConfirmedAt(resultPath);
        data._confirmed_result = JSON.parse(await readFile(resultPath, "utf8"));
      }
      res.json(data);
    } catch (error) {
      this.options.logger.warn({ err: error, recommendationsPath }, "Invalid PPT confirm file");
      res.status(400).json({ error: "invalid recommendations.json" });
    }
  }

  private async handleConfirm(req: express.Request, res: express.Response): Promise<void> {
    const project = this.resolveConfirmProject(req, res);
    if (!project) return;
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      res.status(400).json({ error: "invalid payload" });
      return;
    }
    await mkdir(project.confirmPath, { recursive: true });
    const result = {
      ...(req.body as Record<string, unknown>),
      status: "confirmed",
      confirmed_at: new Date().toISOString().slice(0, 19),
    };
    await writeFile(
      path.join(project.confirmPath, "result.json"),
      JSON.stringify(result, null, 2),
      "utf8",
    );
    res.json({ status: "ok" });
  }

  private resolveConfirmProject(
    req: express.Request,
    res: express.Response,
  ): ResolvedConfirmProject | null {
    const { agentId, projectName } = req.params;
    if (!isSafeLocalName(projectName)) {
      res.status(400).json({ error: "Invalid project name" });
      return null;
    }
    const agent = this.options.agentManager.getAgent(agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return null;
    }
    if (agent.labels.surface !== "ai_creation" || agent.labels.intent !== "ppt_creation") {
      res.status(403).json({ error: "Agent is not a PPT creation session" });
      return null;
    }
    const projectsDir = path.join(agent.cwd, "projects");
    const projectPath = path.resolve(projectsDir, projectName);
    if (!projectPath.startsWith(path.resolve(projectsDir) + path.sep)) {
      res.status(400).json({ error: "Invalid project path" });
      return null;
    }
    return {
      projectPath,
      confirmPath: path.join(projectPath, "confirm_ui"),
    };
  }

  private confirmBasePath(req: express.Request): string {
    return `/ppt-confirm/${encodeURIComponent(req.params.agentId)}/${encodeURIComponent(
      req.params.projectName,
    )}`;
  }
}

function isSafeLocalName(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    value !== "." &&
    value !== ".."
  );
}

function safeChildPath(root: string, relativePath: string): string | null {
  const normalizedRoot = path.resolve(root);
  const childPath = path.resolve(normalizedRoot, relativePath);
  if (childPath !== normalizedRoot && childPath.startsWith(normalizedRoot + path.sep)) {
    return childPath;
  }
  return null;
}

async function readConfirmedAt(resultPath: string): Promise<string | null> {
  try {
    const result = JSON.parse(await readFile(resultPath, "utf8")) as { confirmed_at?: unknown };
    return typeof result.confirmed_at === "string" ? result.confirmed_at : null;
  } catch {
    return null;
  }
}

function resolveBundledConfirmStaticPath(): string {
  const candidates = [
    new URL("../../../assets/skills/ppt-master/scripts/confirm_ui/static", import.meta.url),
    new URL("../../assets/skills/ppt-master/scripts/confirm_ui/static", import.meta.url),
  ].map((url) => fileURLToPath(url));

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }

  throw new Error("Bundled ppt-master Confirm UI static assets are missing.");
}

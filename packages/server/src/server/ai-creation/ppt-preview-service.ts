import { existsSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type { Logger } from "pino";
import type { AgentManager } from "../agent/agent-manager.js";

const SVG_TAG_RE = /<([A-Za-z][\w:.-]*)(\s[^<>]*?)?(\/?)>/g;
const SVG_ROOT_TAG_RE = /^svg$/i;
const ANNOTATION_TARGET_RE = /\sdata-edit-target="true"/g;
const ANNOTATION_TEXT_RE = /\sdata-edit-annotation="[^"]*"/g;
const ID_ATTR_RE = /\sid="([^"]+)"/;
const MAX_EDIT_TEXT_LENGTH = 5000;
const MAX_ATTR_VALUE_LENGTH = 256;
const EDITABLE_ATTR_RE = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const PROTECTED_ATTRS = new Set(["id", "class", "data-edit-target", "data-edit-annotation"]);
const PROTECTED_ATTR_SUFFIXES = ["href", ":href"];

interface PptPreviewServiceOptions {
  agentManager: AgentManager;
  logger: Logger;
}

interface PreviewSessionState {
  annotations: Map<string, Map<string, string>>;
  pendingEdits: Map<string, StagedEdit[]>;
}

interface StagedEdit {
  elementId: string;
  text?: string;
  attrs?: Record<string, string | null>;
}

interface ResolvedPreviewProject {
  projectPath: string;
  svgOutputPath: string;
  imagesPath: string;
  assetsPath: string;
}

export function createPptPreviewRouter(options: PptPreviewServiceOptions): express.Router {
  const service = new PptPreviewService(options);
  return service.router;
}

class PptPreviewService {
  readonly router = express.Router();
  private readonly sessions = new Map<string, PreviewSessionState>();
  private readonly staticDir = resolveBundledSvgEditorStaticPath();

  constructor(private readonly options: PptPreviewServiceOptions) {
    this.router.get("/:agentId", (req, res) => {
      void this.handleListProjects(req, res);
    });
    this.router.get("/:agentId/:projectName", (req, res) => {
      void this.handleIndex(req, res);
    });
    this.router.get("/:agentId/:projectName/", (req, res) => {
      void this.handleIndex(req, res);
    });
    this.router.get("/:agentId/:projectName/static/:fileName", (req, res) => {
      void this.handleStatic(req, res);
    });
    this.router.get("/:agentId/:projectName/api/config", (_req, res) => {
      res.json({ live: true, doyaPreview: true });
    });
    this.router.get("/:agentId/:projectName/api/slides", (req, res) => {
      void this.handleSlides(req, res);
    });
    this.router.get("/:agentId/:projectName/api/slide/:slideName", (req, res) => {
      void this.handleSlide(req, res);
    });
    this.router.post("/:agentId/:projectName/api/slide/:slideName/annotate", (req, res) => {
      void this.handleAnnotate(req, res);
    });
    this.router.delete(
      "/:agentId/:projectName/api/slide/:slideName/annotate/:elementId",
      (req, res) => {
        void this.handleDeleteAnnotation(req, res);
      },
    );
    this.router.post("/:agentId/:projectName/api/slide/:slideName/edit", (req, res) => {
      void this.handleEdit(req, res);
    });
    this.router.post("/:agentId/:projectName/api/slide/:slideName/undo", (req, res) => {
      void this.handleUndo(req, res);
    });
    this.router.post("/:agentId/:projectName/api/save-all", (req, res) => {
      void this.handleSaveAll(req, res);
    });
    this.router.post("/:agentId/:projectName/api/shutdown", (_req, res) => {
      res.json({ status: "ok", managed_by: "doya" });
    });
    this.router.get("/:agentId/:projectName/images/*", (req, res) => {
      void this.handleProjectFile(req, res, "images");
    });
    this.router.get("/:agentId/:projectName/assets/*", (req, res) => {
      void this.handleProjectFile(req, res, "assets");
    });
  }

  private async handleListProjects(req: express.Request, res: express.Response): Promise<void> {
    const agent = this.options.agentManager.getAgent(req.params.agentId);
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    const projectsDir = path.join(agent.cwd, "projects");
    if (!existsSync(projectsDir)) {
      res.json({ projects: [] });
      return;
    }
    const entries = await readdir(projectsDir, { withFileTypes: true });
    const projects = entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => existsSync(path.join(projectsDir, entry.name, "svg_output")))
      .map((entry) => ({
        name: entry.name,
        url: `/ppt-preview/${encodeURIComponent(agent.id)}/${encodeURIComponent(entry.name)}`,
      }));
    res.json({ projects });
  }

  private async handleIndex(req: express.Request, res: express.Response): Promise<void> {
    if (!this.resolvePreviewProject(req, res)) return;
    const basePath = this.previewBasePath(req);
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
    if (!["app.js", "style.css"].includes(fileName)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const filePath = path.join(this.staticDir, fileName);
    if (fileName !== "app.js") {
      res.sendFile(filePath);
      return;
    }
    const basePath = this.previewBasePath(req);
    const source = await readFile(filePath, "utf8");
    res
      .type("application/javascript")
      .send(
        [
          `window.__DOYA_PPT_PREVIEW_BASE__ = ${JSON.stringify(basePath)};`,
          `window.fetch = ((originalFetch) => (input, init) => {`,
          `  if (typeof input === "string" && (input === "/api/save-all" || input === "/api/shutdown" || input.startsWith("/api/"))) input = window.__DOYA_PPT_PREVIEW_BASE__ + input;`,
          `  return originalFetch(input, init);`,
          `})(window.fetch.bind(window));`,
          source,
        ].join("\n"),
      );
  }

  private async handleSlides(req: express.Request, res: express.Response): Promise<void> {
    const project = this.resolvePreviewProject(req, res);
    if (!project) return;
    if (!existsSync(project.svgOutputPath)) {
      res.json({ slides: [] });
      return;
    }
    const entries = await readdir(project.svgOutputPath, { withFileTypes: true });
    const state = this.getSessionState(req);
    const slides = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".svg"))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(async (entry) => {
          const svgPath = path.join(project.svgOutputPath, entry.name);
          const svgStat = await stat(svgPath);
          const diskAnnotations = parseAnnotationCount(await readFile(svgPath, "utf8"));
          const memoryAnnotations = state.annotations.get(entry.name)?.size ?? 0;
          return {
            name: entry.name,
            annotated: Math.max(diskAnnotations, memoryAnnotations) > 0,
            annotation_count: Math.max(diskAnnotations, memoryAnnotations),
            ok: true,
            error: null,
            mtime: svgStat.mtimeMs / 1000,
          };
        }),
    );
    res.json({ slides });
  }

  private async handleSlide(req: express.Request, res: express.Response): Promise<void> {
    const resolved = await this.readSlide(req, res);
    if (!resolved) return;
    const { content, mtime, slideName } = resolved;
    const state = this.getSessionState(req);
    const pendingEdits = state.pendingEdits.get(slideName) ?? [];
    const { content: previewContent, annotations } = buildPreviewSvg({
      content,
      basePath: this.previewBasePath(req),
      memoryAnnotations: state.annotations.get(slideName),
      pendingEdits,
    });

    res.json({
      name: slideName,
      content: previewContent,
      annotations,
      warnings: [],
      mtime: mtime / 1000,
      undo_depth: pendingEdits.length,
    });
  }

  private async handleAnnotate(req: express.Request, res: express.Response): Promise<void> {
    const resolved = await this.readSlide(req, res);
    if (!resolved) return;
    const elementId = typeof req.body?.element_id === "string" ? req.body.element_id : "";
    const annotation = typeof req.body?.annotation === "string" ? req.body.annotation : "";
    if (!elementId || !annotation) {
      res.status(400).json({ error: "Missing element_id or annotation" });
      return;
    }
    if (elementId.length > 200 || annotation.length > 10_000) {
      res.status(400).json({ error: "Annotation too long" });
      return;
    }
    const annotations = getNestedMap(this.getSessionState(req).annotations, resolved.slideName);
    annotations.set(elementId, annotation);
    res.json({ status: "ok", annotations_count: annotations.size });
  }

  private async handleDeleteAnnotation(req: express.Request, res: express.Response): Promise<void> {
    const resolved = await this.readSlide(req, res);
    if (!resolved) return;
    const annotations = getNestedMap(this.getSessionState(req).annotations, resolved.slideName);
    annotations.delete(req.params.elementId);
    res.json({ status: "ok", annotations_count: annotations.size });
  }

  private async handleEdit(req: express.Request, res: express.Response): Promise<void> {
    const resolved = await this.readSlide(req, res);
    if (!resolved) return;
    const elementId = typeof req.body?.element_id === "string" ? req.body.element_id : "";
    if (!elementId || elementId.length > 200) {
      res.status(400).json({ error: "Missing or invalid element_id" });
      return;
    }
    const text = req.body?.text;
    const attrs = req.body?.attrs;
    if (text === undefined && !attrs) {
      res.status(400).json({ error: "Nothing to edit" });
      return;
    }
    if (text !== undefined && (typeof text !== "string" || text.length > MAX_EDIT_TEXT_LENGTH)) {
      res.status(400).json({ error: "Invalid or too-long text" });
      return;
    }
    if (attrs !== undefined && !isSafeAttrs(attrs)) {
      res.status(400).json({ error: "Invalid attrs" });
      return;
    }
    const pendingEdits = getNestedArray(this.getSessionState(req).pendingEdits, resolved.slideName);
    pendingEdits.push({
      elementId,
      ...(text !== undefined ? { text } : {}),
      ...(attrs ? { attrs } : {}),
    });
    res.json({ status: "ok", undo_depth: pendingEdits.length });
  }

  private async handleUndo(req: express.Request, res: express.Response): Promise<void> {
    const resolved = await this.readSlide(req, res);
    if (!resolved) return;
    const pendingEdits = this.getSessionState(req).pendingEdits.get(resolved.slideName) ?? [];
    if (pendingEdits.length === 0) {
      res.json({ status: "empty", undo_depth: 0 });
      return;
    }
    pendingEdits.pop();
    res.json({ status: "ok", undo_depth: pendingEdits.length });
  }

  private async handleSaveAll(req: express.Request, res: express.Response): Promise<void> {
    const project = this.resolvePreviewProject(req, res);
    if (!project) return;
    const state = this.getSessionState(req);
    const slideNames = new Set([...state.annotations.keys(), ...state.pendingEdits.keys()]);
    const modified: string[] = [];

    for (const slideName of slideNames) {
      const slidePath = safeSlidePath(project.svgOutputPath, slideName);
      if (!slidePath || !existsSync(slidePath)) continue;
      const content = await readFile(slidePath, "utf8");
      const next = persistPreviewSvg({
        content,
        memoryAnnotations: state.annotations.get(slideName),
        pendingEdits: state.pendingEdits.get(slideName) ?? [],
      });
      await writeFile(slidePath, next, "utf8");
      modified.push(slideName);
    }

    state.annotations.clear();
    state.pendingEdits.clear();
    res.json({ status: "ok", files_modified: modified });
  }

  private async handleProjectFile(
    req: express.Request,
    res: express.Response,
    kind: "images" | "assets",
  ): Promise<void> {
    const project = this.resolvePreviewProject(req, res);
    if (!project) return;
    const root = kind === "images" ? project.imagesPath : project.assetsPath;
    const relativePath = req.params[0] ?? "";
    const filePath = safeChildPath(root, relativePath);
    if (!filePath || !existsSync(filePath)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.sendFile(filePath);
  }

  private async readSlide(
    req: express.Request,
    res: express.Response,
  ): Promise<{ content: string; mtime: number; slideName: string } | null> {
    const project = this.resolvePreviewProject(req, res);
    if (!project) return null;
    const slideName = req.params.slideName;
    const slidePath = safeSlidePath(project.svgOutputPath, slideName);
    if (!slidePath) {
      res.status(400).json({ error: "Invalid slide name" });
      return null;
    }
    if (!existsSync(slidePath)) {
      res.status(404).json({ error: "Slide not found" });
      return null;
    }
    const [content, svgStat] = await Promise.all([readFile(slidePath, "utf8"), stat(slidePath)]);
    return { content, mtime: svgStat.mtimeMs, slideName };
  }

  private resolvePreviewProject(
    req: express.Request,
    res: express.Response,
  ): ResolvedPreviewProject | null {
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
      svgOutputPath: path.join(projectPath, "svg_output"),
      imagesPath: path.join(projectPath, "images"),
      assetsPath: path.join(projectPath, "assets"),
    };
  }

  private getSessionState(req: express.Request): PreviewSessionState {
    const key = `${req.params.agentId}:${req.params.projectName}`;
    let state = this.sessions.get(key);
    if (!state) {
      state = { annotations: new Map(), pendingEdits: new Map() };
      this.sessions.set(key, state);
    }
    return state;
  }

  private previewBasePath(req: express.Request): string {
    return `/ppt-preview/${encodeURIComponent(req.params.agentId)}/${encodeURIComponent(
      req.params.projectName,
    )}`;
  }
}

function buildPreviewSvg(input: {
  content: string;
  basePath: string;
  memoryAnnotations: Map<string, string> | undefined;
  pendingEdits: readonly StagedEdit[];
}): {
  content: string;
  annotations: Array<{ element_id: string; tag: string; annotation: string }>;
} {
  const annotations: Array<{ element_id: string; tag: string; annotation: string }> = [];
  let content = rewriteProjectResourceHrefs(assignPreviewIds(input.content), input.basePath);
  for (const edit of input.pendingEdits) {
    content = applyEditToSvg(content, edit);
  }
  content = content.replace(SVG_TAG_RE, (match, tagName: string, attrs = "", slash = "") => {
    const id = ID_ATTR_RE.exec(attrs)?.[1];
    if (!id) return match;
    const memoryAnnotation = input.memoryAnnotations?.get(id);
    const diskAnnotation = /data-edit-target="true"/.test(attrs)
      ? /data-edit-annotation="([^"]*)"/.exec(attrs)?.[1]
      : undefined;
    const annotation = memoryAnnotation ?? (diskAnnotation ? unescapeXml(diskAnnotation) : "");
    if (!annotation) return match;
    annotations.push({ element_id: id, tag: tagName, annotation });
    const cleanAttrs = attrs.replace(ANNOTATION_TARGET_RE, "").replace(ANNOTATION_TEXT_RE, "");
    return `<${tagName}${cleanAttrs} data-edit-target="true" data-edit-annotation="${escapeXml(
      annotation,
    )}"${slash}>`;
  });
  return { content, annotations };
}

function persistPreviewSvg(input: {
  content: string;
  memoryAnnotations: Map<string, string> | undefined;
  pendingEdits: readonly StagedEdit[];
}): string {
  let content = assignPreviewIds(input.content);
  for (const edit of input.pendingEdits) {
    content = applyEditToSvg(content, edit);
  }
  content = content.replace(SVG_TAG_RE, (_match, tagName: string, attrs = "", slash = "") => {
    const id = ID_ATTR_RE.exec(attrs)?.[1];
    const cleanAttrs = attrs.replace(ANNOTATION_TARGET_RE, "").replace(ANNOTATION_TEXT_RE, "");
    if (!id) return `<${tagName}${cleanAttrs}${slash}>`;
    const annotation = input.memoryAnnotations?.get(id);
    if (!annotation) return `<${tagName}${cleanAttrs}${slash}>`;
    return `<${tagName}${cleanAttrs} data-edit-target="true" data-edit-annotation="${escapeXml(
      annotation,
    )}"${slash}>`;
  });
  return content;
}

function assignPreviewIds(content: string): string {
  let index = 0;
  return content.replace(SVG_TAG_RE, (match, tagName: string, attrs = "", slash = "") => {
    if (SVG_ROOT_TAG_RE.test(tagName) || ID_ATTR_RE.test(attrs)) {
      return match;
    }
    const id = `_edit_${index}`;
    index += 1;
    return `<${tagName}${attrs} id="${id}"${slash}>`;
  });
}

function rewriteProjectResourceHrefs(content: string, basePath: string): string {
  return content
    .replaceAll('href="../images/', `href="${basePath}/images/`)
    .replaceAll('xlink:href="../images/', `xlink:href="${basePath}/images/`)
    .replaceAll('href="../assets/', `href="${basePath}/assets/`)
    .replaceAll('xlink:href="../assets/', `xlink:href="${basePath}/assets/`);
}

function applyEditToSvg(content: string, edit: StagedEdit): string {
  let applied = false;
  const withAttrs = content.replace(
    SVG_TAG_RE,
    (match, tagName: string, attrs = "", slash = "") => {
      if (applied || ID_ATTR_RE.exec(attrs)?.[1] !== edit.elementId) {
        return match;
      }
      applied = true;
      let nextAttrs = attrs;
      for (const [key, value] of Object.entries(edit.attrs ?? {})) {
        const attrRe = new RegExp(`\\s${escapeRegExp(key)}="[^"]*"`);
        if (value === null) {
          nextAttrs = nextAttrs.replace(attrRe, "");
        } else if (attrRe.test(nextAttrs)) {
          nextAttrs = nextAttrs.replace(attrRe, ` ${key}="${escapeXml(value)}"`);
        } else {
          nextAttrs += ` ${key}="${escapeXml(value)}"`;
        }
      }
      return `<${tagName}${nextAttrs}${slash}>`;
    },
  );
  if (edit.text === undefined) {
    return withAttrs;
  }
  const elementRe = new RegExp(
    `(<[A-Za-z][\\w:.-]*[^>]*\\sid="${escapeRegExp(edit.elementId)}"[^>]*>)([\\s\\S]*?)(</[A-Za-z][\\w:.-]*>)`,
  );
  return withAttrs.replace(elementRe, (_match, open: string, _body: string, close: string) => {
    return `${open}${escapeXml(edit.text ?? "")}${close}`;
  });
}

function parseAnnotationCount(content: string): number {
  return content.match(/data-edit-target="true"/g)?.length ?? 0;
}

function safeSlidePath(svgOutputPath: string, slideName: string): string | null {
  if (!isSafeLocalName(slideName) || !slideName.toLowerCase().endsWith(".svg")) {
    return null;
  }
  return safeChildPath(svgOutputPath, slideName);
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
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + path.sep)) {
    return null;
  }
  return resolvedPath;
}

function getNestedMap<K, V>(root: Map<string, Map<K, V>>, key: string): Map<K, V> {
  let value = root.get(key);
  if (!value) {
    value = new Map<K, V>();
    root.set(key, value);
  }
  return value;
}

function getNestedArray<T>(root: Map<string, T[]>, key: string): T[] {
  let value = root.get(key);
  if (!value) {
    value = [];
    root.set(key, value);
  }
  return value;
}

function isSafeAttrs(value: unknown): value is Record<string, string | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  for (const [key, attrValue] of Object.entries(value)) {
    if (!EDITABLE_ATTR_RE.test(key) || PROTECTED_ATTRS.has(key.toLowerCase())) {
      return false;
    }
    if (PROTECTED_ATTR_SUFFIXES.some((suffix) => key.toLowerCase().endsWith(suffix))) {
      return false;
    }
    if (attrValue === null) continue;
    if (typeof attrValue !== "string" || attrValue.length > MAX_ATTR_VALUE_LENGTH) {
      return false;
    }
    if (/[<>"`]|\bjavascript\s*:|\bdata\s*:|url\s*\(/i.test(attrValue)) {
      return false;
    }
  }
  return true;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function unescapeXml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveBundledSvgEditorStaticPath(): string {
  const candidates = [
    new URL("../../../assets/skills/ppt-master/scripts/svg_editor/static", import.meta.url),
    new URL("../../assets/skills/ppt-master/scripts/svg_editor/static", import.meta.url),
  ].map((url) => fileURLToPath(url));

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }

  throw new Error("Bundled ppt-master SVG editor static assets are missing.");
}

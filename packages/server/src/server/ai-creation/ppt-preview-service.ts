import { existsSync, readFileSync } from "node:fs";
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
const STATIC_ASSET_VERSION = "20260621-annotation-tip-x";
const USE_ICON_RE = /<use\s+[^>]*data-icon="[^"]*"[^>]*\/>/g;
const ATTR_RE = /\s([A-Za-z_:][A-Za-z0-9_.:-]*)="([^"]*)"/g;
const ICON_SHAPE_RE =
  /<(path|circle|rect|line|polyline|polygon|ellipse)(\s[^>]*)?(?:\/>|><\/\1>)/gs;
const ICON_BASE_SIZES: Record<string, number> = {
  "chunk-filled": 16,
  chunk: 16,
  "tabler-filled": 24,
  "tabler-outline": 24,
  "phosphor-duotone": 256,
  "simple-icons": 24,
};
const DEFAULT_ICON_BASE_SIZE = 24;

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
  iconsPath: string;
}

interface PreviewSlideAnimation {
  transition: {
    effect: string;
    duration: number;
    autoAdvance: number | null;
  };
  entrance: {
    enabled: boolean;
    effect: string;
    trigger: "after-previous" | "with-previous" | "on-click";
    duration: number;
    stagger: number;
    groups: Record<string, PreviewAnimationGroup>;
  };
}

interface PreviewAnimationGroup {
  effect?: string;
  order?: number;
  delay?: number;
  duration?: number;
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
      .set("Cache-Control", "no-store")
      .send(
        html
          .replace(
            'href="/static/style.css"',
            `href="${basePath}/static/style.css?v=${STATIC_ASSET_VERSION}"`,
          )
          .replace(
            'src="/static/app.js"',
            `src="${basePath}/static/app.js?v=${STATIC_ASSET_VERSION}"`,
          ),
      );
  }

  private async handleStatic(req: express.Request, res: express.Response): Promise<void> {
    const fileName = req.params.fileName;
    if (!["app.js", "style.css"].includes(fileName)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const filePath = path.join(this.staticDir, fileName);
    res.set("Cache-Control", "no-store");
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
    const { content, mtime, project, slideName } = resolved;
    const state = this.getSessionState(req);
    const pendingEdits = state.pendingEdits.get(slideName) ?? [];
    const { content: previewContent, annotations } = buildPreviewSvg({
      content,
      basePath: this.previewBasePath(req),
      projectIconsPath: project.iconsPath,
      memoryAnnotations: state.annotations.get(slideName),
      pendingEdits,
    });

    res.json({
      name: slideName,
      content: previewContent,
      annotations,
      animation: await readSlideAnimation(project.projectPath, slideName),
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
  ): Promise<{
    content: string;
    mtime: number;
    project: ResolvedPreviewProject;
    slideName: string;
  } | null> {
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
    return { content, mtime: svgStat.mtimeMs, project, slideName };
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
      iconsPath: path.join(projectPath, "icons"),
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
  projectIconsPath: string | undefined;
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
  content = inlineIconPlaceholders(content, input.projectIconsPath);
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

function inlineIconPlaceholders(content: string, projectIconsPath: string | undefined): string {
  if (!content.includes("data-icon=")) {
    return content;
  }
  return content.replace(USE_ICON_RE, (useElement) => {
    const attrs = parseXmlAttrs(useElement);
    const iconName = attrs["data-icon"];
    if (!iconName) {
      return useElement;
    }
    const icon = loadPreviewIcon(iconName, projectIconsPath);
    if (!icon || icon.elements.length === 0) {
      return useElement;
    }
    return generatePreviewIconGroup(attrs, icon);
  });
}

async function readSlideAnimation(
  projectPath: string,
  slideName: string,
): Promise<PreviewSlideAnimation | null> {
  const config = mergeAnimationConfigs(
    await readConfirmedAnimationConfig(projectPath),
    await readAnimationConfig(projectPath),
  );
  if (!config) {
    return null;
  }
  const defaults = asRecord(config.defaults);
  const slides = asRecord(config.slides);
  const slide = asRecord(slides[slideName.replace(/\.svg$/i, "")]);
  const defaultTransition = asRecord(defaults.transition);
  const slideTransition = asRecord(slide.transition);
  const defaultAnimation = asRecord(defaults.animation);
  const slideAnimation = asRecord(slide.animation);
  const groups = readAnimationGroups(asRecord(slide.groups));
  const effect = readString(slideAnimation.effect) ?? readString(defaultAnimation.effect) ?? "none";
  const trigger =
    readTrigger(slideAnimation.trigger) ??
    readTrigger(defaultAnimation.trigger) ??
    "after-previous";
  const hasGroupAnimation = Object.values(groups).some(
    (group) => group.effect !== undefined && group.effect !== "none",
  );

  return {
    transition: {
      effect: readString(slideTransition.effect) ?? readString(defaultTransition.effect) ?? "fade",
      duration: readNumber(slideTransition.duration, readNumber(defaultTransition.duration, 0.4)),
      autoAdvance:
        readNumber(
          slideTransition.auto_advance,
          readNumber(defaultTransition.auto_advance, null),
        ) ?? null,
    },
    entrance: {
      enabled: effect !== "none" || hasGroupAnimation,
      effect,
      trigger,
      duration: readNumber(slideAnimation.duration, readNumber(defaultAnimation.duration, 0.4)),
      stagger: readNumber(slideAnimation.stagger, readNumber(defaultAnimation.stagger, 0.5)),
      groups,
    },
  };
}

async function readAnimationConfig(projectPath: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await readFile(path.join(projectPath, "animations.json"), "utf8");
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    return null;
  }
}

async function readConfirmedAnimationConfig(
  projectPath: string,
): Promise<Record<string, unknown> | null> {
  try {
    const content = await readFile(path.join(projectPath, "confirm_ui/result.json"), "utf8");
    const parsed: unknown = JSON.parse(content);
    const animation = readString(asRecord(parsed).animation);
    if (!animation) {
      return null;
    }
    return configForConfirmedAnimation(animation);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    return null;
  }
}

function configForConfirmedAnimation(animation: string): Record<string, unknown> | null {
  const transition = { effect: "fade", duration: 0.4 };
  if (animation === "subtle") {
    return {
      defaults: {
        transition,
        animation: {
          effect: "auto",
          trigger: "after-previous",
          duration: 0.4,
          stagger: 0.5,
        },
      },
    };
  }
  if (animation === "presenter_reveal") {
    return {
      defaults: {
        transition,
        animation: {
          effect: "auto",
          trigger: "on-click",
          duration: 0.4,
          stagger: 0.5,
        },
      },
    };
  }
  if (animation === "showcase") {
    return {
      defaults: {
        transition,
        animation: {
          effect: "mixed",
          trigger: "after-previous",
          duration: 0.4,
          stagger: 0.35,
        },
      },
    };
  }
  if (animation === "page_only") {
    return {
      defaults: {
        transition,
        animation: { effect: "none" },
      },
    };
  }
  if (animation === "none") {
    return {
      defaults: {
        transition: { effect: "none", duration: 0 },
        animation: { effect: "none" },
      },
    };
  }
  return null;
}

function mergeAnimationConfigs(
  base: Record<string, unknown> | null,
  override: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!base) {
    return override;
  }
  if (!override) {
    return base;
  }

  const baseDefaults = asRecord(base.defaults);
  const overrideDefaults = asRecord(override.defaults);
  return {
    ...base,
    ...override,
    defaults: {
      ...baseDefaults,
      ...overrideDefaults,
      transition: {
        ...asRecord(baseDefaults.transition),
        ...asRecord(overrideDefaults.transition),
      },
      animation: {
        ...asRecord(baseDefaults.animation),
        ...asRecord(overrideDefaults.animation),
      },
    },
    slides: {
      ...asRecord(base.slides),
      ...asRecord(override.slides),
    },
  };
}

function readAnimationGroups(
  groups: Record<string, unknown>,
): Record<string, PreviewAnimationGroup> {
  const result: Record<string, PreviewAnimationGroup> = {};
  for (const [groupId, rawGroup] of Object.entries(groups)) {
    if (!isSafeLocalName(groupId)) {
      continue;
    }
    const group = asRecord(rawGroup);
    result[groupId] = {
      ...(readString(group.effect) ? { effect: readString(group.effect) } : {}),
      ...(readNumber(group.order, null) !== null
        ? { order: readNumber(group.order, null) ?? 0 }
        : {}),
      ...(readNumber(group.delay, null) !== null
        ? { delay: readNumber(group.delay, null) ?? 0 }
        : {}),
      ...(readNumber(group.duration, null) !== null
        ? { duration: readNumber(group.duration, null) ?? 0 }
        : {}),
    };
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readTrigger(value: unknown): PreviewSlideAnimation["entrance"]["trigger"] | undefined {
  if (value === "after-previous" || value === "with-previous" || value === "on-click") {
    return value;
  }
  return undefined;
}

function readNumber(value: unknown, fallback: number): number;
function readNumber(value: unknown, fallback: null): number | null;
function readNumber(value: unknown, fallback: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return value >= 0 ? value : fallback;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function parseXmlAttrs(element: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of element.matchAll(ATTR_RE)) {
    attrs[match[1]] = unescapeXml(match[2]);
  }
  return attrs;
}

interface PreviewIcon {
  elements: string[];
  style: "fill" | "stroke" | "preserve";
  viewBox: { minX: number; minY: number; width: number; height: number };
}

function loadPreviewIcon(
  iconName: string,
  projectIconsPath: string | undefined,
): PreviewIcon | null {
  const resolved = resolvePreviewIconPath(iconName, projectIconsPath);
  if (!resolved) {
    return null;
  }
  const content = readFileSync(resolved.iconPath, "utf8");
  const viewBox = parseSvgViewBox(content) ?? {
    minX: 0,
    minY: 0,
    width: resolved.baseSize,
    height: resolved.baseSize,
  };
  if (content.includes('data-icon-style="preserve-color"')) {
    const body = /<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/.exec(content)?.[1]?.trim();
    return { elements: body ? [body] : [], style: "preserve", viewBox };
  }
  const style =
    content.includes('stroke="currentColor"') && content.includes('fill="none"')
      ? "stroke"
      : "fill";
  const elements = [...content.matchAll(ICON_SHAPE_RE)].map((match) => {
    const tagName = match[1];
    const rawAttrs = match[2] ?? "";
    const cleanAttrs = rawAttrs
      .replace(/\s*fill="(?:currentColor|#[0-9a-fA-F]{3,8}|none)"/g, "")
      .replace(/\s*stroke="(?:currentColor|#[0-9a-fA-F]{3,8}|none)"/g, "")
      .replace(/\s*stroke-width="[^"]*"/g, "");
    return `<${tagName}${cleanAttrs}/>`;
  });
  return { elements, style, viewBox };
}

function resolvePreviewIconPath(
  iconName: string,
  projectIconsPath: string | undefined,
): { iconPath: string; baseSize: number } | null {
  const candidates = [
    projectIconsPath ? resolveIconPathInDir(iconName, projectIconsPath) : null,
    resolveIconPathInDir(iconName, resolveBundledIconLibraryPath()),
  ].filter((candidate): candidate is { iconPath: string; baseSize: number } => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate.iconPath)) ?? null;
}

function resolveIconPathInDir(
  iconName: string,
  iconsDir: string,
): { iconPath: string; baseSize: number } | null {
  if (iconName.includes("\0") || iconName.includes("\\") || iconName.includes("..")) {
    return null;
  }
  if (iconName.includes("/")) {
    const [rawLibrary, rawName] = iconName.split("/", 2);
    if (!isSafeLocalName(rawLibrary) || !isSafeLocalName(rawName)) {
      return null;
    }
    const library = rawLibrary === "chunk" ? "chunk-filled" : rawLibrary;
    return {
      iconPath: path.join(iconsDir, library, `${rawName}.svg`),
      baseSize: ICON_BASE_SIZES[library] ?? DEFAULT_ICON_BASE_SIZE,
    };
  }
  if (!isSafeLocalName(iconName)) {
    return null;
  }
  const chunkIconPath = path.join(iconsDir, "chunk-filled", `${iconName}.svg`);
  if (existsSync(chunkIconPath)) {
    return { iconPath: chunkIconPath, baseSize: ICON_BASE_SIZES["chunk-filled"] };
  }
  return { iconPath: path.join(iconsDir, `${iconName}.svg`), baseSize: ICON_BASE_SIZES.chunk };
}

function parseSvgViewBox(content: string): PreviewIcon["viewBox"] | null {
  const match = /viewBox=["']([^"']+)["']/.exec(content);
  if (!match) {
    return null;
  }
  const parts = match[1]
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length < 4 || parts.some((value) => !Number.isFinite(value))) {
    return null;
  }
  const minX = parts[0] ?? 0;
  const minY = parts[1] ?? 0;
  const width = parts[2] ?? 0;
  const height = parts[3] ?? 0;
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { minX, minY, width, height };
}

function generatePreviewIconGroup(attrs: Record<string, string>, icon: PreviewIcon): string {
  const x = parseSvgNumber(attrs.x, 0);
  const y = parseSvgNumber(attrs.y, 0);
  const width = parseSvgNumber(attrs.width, icon.viewBox.width);
  const height = parseSvgNumber(attrs.height, icon.viewBox.height);
  const scaleX = width / icon.viewBox.width;
  const scaleY = height / icon.viewBox.height;
  const transform = attrs.transform ?? buildPreviewIconTransform({ x, y, scaleX, scaleY });
  const previewAttrs = [
    attrs.id ? `id="${escapeXml(attrs.id)}"` : "",
    `data-icon="${escapeXml(attrs["data-icon"] ?? "")}"`,
    attrs.x ? `data-use-x="${escapeXml(attrs.x)}"` : "",
    attrs.y ? `data-use-y="${escapeXml(attrs.y)}"` : "",
    attrs.width ? `data-use-width="${escapeXml(attrs.width)}"` : "",
    attrs.height ? `data-use-height="${escapeXml(attrs.height)}"` : "",
    attrs.transform ? 'data-use-has-transform="1"' : "",
  ].filter(Boolean);
  const color = resolvePreviewIconColor(attrs, icon.style);
  const colorAttrs = buildPreviewIconColorAttrs({ attrs, color, style: icon.style });
  let elements = icon.elements.join("\n    ");
  if (icon.style === "preserve" && (icon.viewBox.minX || icon.viewBox.minY)) {
    elements = `<g transform="translate(${formatSvgNumber(-icon.viewBox.minX)}, ${formatSvgNumber(
      -icon.viewBox.minY,
    )})">\n    ${elements}\n    </g>`;
  }
  return `<!-- icon: ${escapeXml(attrs["data-icon"] ?? "unknown")} -->
  <g ${previewAttrs.join(" ")} transform="${escapeXml(transform)}"${colorAttrs}>
    ${elements}
  </g>`;
}

function buildPreviewIconColorAttrs(input: {
  attrs: Record<string, string>;
  color: string;
  style: PreviewIcon["style"];
}): string {
  if (input.style === "preserve") {
    return "";
  }
  if (input.style === "stroke") {
    return ` fill="none" stroke="${escapeXml(input.color)}" stroke-width="${escapeXml(
      input.attrs["stroke-width"] ?? "2",
    )}"`;
  }
  return ` fill="${escapeXml(input.color)}"`;
}

function buildPreviewIconTransform(input: {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}): string {
  const translate = `translate(${formatSvgNumber(input.x)}, ${formatSvgNumber(input.y)})`;
  if (Math.abs(input.scaleX - 1) < 1e-6 && Math.abs(input.scaleY - 1) < 1e-6) {
    return translate;
  }
  if (Math.abs(input.scaleX - input.scaleY) < 1e-6) {
    return `${translate} scale(${formatSvgNumber(input.scaleX)})`;
  }
  return `${translate} scale(${formatSvgNumber(input.scaleX)}, ${formatSvgNumber(input.scaleY)})`;
}

function resolvePreviewIconColor(
  attrs: Record<string, string>,
  style: PreviewIcon["style"],
): string {
  if (style === "preserve") {
    return "preserve";
  }
  const fill = attrs.fill?.trim() ?? "";
  const stroke = attrs.stroke?.trim() ?? "";
  if (style === "stroke") {
    if (fill && fill !== "none") return fill;
    if (stroke && stroke !== "none") return stroke;
    return "#000000";
  }
  if (fill) return fill;
  if (stroke && stroke !== "none") return stroke;
  return "#000000";
}

function parseSvgNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatSvgNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12)));
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

function resolveBundledIconLibraryPath(): string {
  const candidates = [
    new URL("../../../assets/skills/ppt-master/templates/icons", import.meta.url),
    new URL("../../assets/skills/ppt-master/templates/icons", import.meta.url),
  ].map((url) => fileURLToPath(url));

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "tabler-outline"))) {
      return candidate;
    }
  }

  throw new Error("Bundled ppt-master icon assets are missing.");
}

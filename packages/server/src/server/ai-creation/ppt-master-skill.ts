import { cp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentAttachment } from "../messages.js";

const DOYA_SKILLS_DIR = ".doya/skills";
const PPT_MASTER_SKILL_NAME = "ppt-master";
const PPT_CREATION_ATTACHMENTS_DIR = "attachments";

export function isPptCreationLabels(labels: Record<string, string> | undefined): boolean {
  return labels?.surface === "ai_creation" && labels?.intent === "ppt_creation";
}

export async function preparePptCreationWorkspace(input: {
  cwd: string;
  attachments: readonly AgentAttachment[] | undefined;
}): Promise<AgentAttachment[] | undefined> {
  await preparePptMasterSkillLink(input.cwd);
  return await materializePptCreationFileAttachments({
    cwd: input.cwd,
    attachments: input.attachments,
  });
}

async function preparePptMasterSkillLink(cwd: string): Promise<void> {
  const skillSource = resolveBundledPptMasterSkillPath();
  const skillsDir = path.join(cwd, DOYA_SKILLS_DIR);
  const linkPath = path.join(skillsDir, PPT_MASTER_SKILL_NAME);

  await mkdir(skillsDir, { recursive: true });
  await rm(linkPath, { recursive: true, force: true });

  try {
    await symlink(skillSource, linkPath, "dir");
  } catch (error) {
    if (isSymlinkUnsupportedError(error)) {
      await cp(skillSource, linkPath, { recursive: true });
      return;
    }
    throw error;
  }
}

async function materializePptCreationFileAttachments(input: {
  cwd: string;
  attachments: readonly AgentAttachment[] | undefined;
}): Promise<AgentAttachment[] | undefined> {
  const passthrough: AgentAttachment[] = [];
  const filePaths: string[] = [];
  const attachmentsDir = path.join(input.cwd, PPT_CREATION_ATTACHMENTS_DIR);
  let fileIndex = 0;

  for (const attachment of input.attachments ?? []) {
    if (attachment.type !== "file" || typeof attachment.data !== "string") {
      passthrough.push(attachment);
      continue;
    }

    await mkdir(attachmentsDir, { recursive: true });
    fileIndex += 1;
    const fileName = sanitizeAttachmentFileName(attachment.title, fileIndex);
    const relativePath = path.join(PPT_CREATION_ATTACHMENTS_DIR, fileName);
    await writeFile(path.join(input.cwd, relativePath), Buffer.from(attachment.data, "base64"));
    filePaths.push(relativePath);
  }

  if (filePaths.length === 0) {
    return passthrough.length > 0 ? passthrough : undefined;
  }

  return [
    ...passthrough,
    {
      type: "text",
      mimeType: "text/plain",
      title: "PPT source files",
      text: [
        "The user's source files have been written into the workspace.",
        "Use these paths as PPT Master source files:",
        "",
        ...filePaths.map((filePath) => `- ${filePath}`),
      ].join("\n"),
    },
  ];
}

function sanitizeAttachmentFileName(title: string | null | undefined, index: number): string {
  const fallback = `source-${index}`;
  const trimmed = title?.trim() || fallback;
  const sanitized = trimmed
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim();
  return sanitized || fallback;
}

function resolveBundledPptMasterSkillPath(): string {
  const candidates = [
    new URL("../../../assets/skills/ppt-master", import.meta.url),
    new URL("../../assets/skills/ppt-master", import.meta.url),
  ].map((url) => fileURLToPath(url));

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "SKILL.md"))) {
      return candidate;
    }
  }

  throw new Error("Bundled ppt-master skill is missing.");
}

function isSymlinkUnsupportedError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }
  return ["EPERM", "ENOTSUP", "EOPNOTSUPP", "UNKNOWN"].includes(String(error.code));
}

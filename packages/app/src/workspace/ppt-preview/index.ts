import { parseHostPort } from "@getdoya/protocol/daemon-endpoints";

export interface WorkspacePptPreviewTabTarget {
  kind: "pptPreview";
  agentId: string;
  projectName: string;
}

export function normalizeWorkspacePptPreviewTabTarget(
  value: WorkspacePptPreviewTabTarget | null | undefined,
): WorkspacePptPreviewTabTarget | null {
  const agentId = trimNonEmpty(value?.agentId);
  const projectName = trimNonEmpty(value?.projectName);
  return agentId && projectName ? { kind: "pptPreview", agentId, projectName } : null;
}

export function workspacePptPreviewTabTargetsEqual(
  left: WorkspacePptPreviewTabTarget,
  right: WorkspacePptPreviewTabTarget,
): boolean {
  return left.agentId === right.agentId && left.projectName === right.projectName;
}

export function createWorkspacePptPreviewTabTarget(input: {
  agentId: string;
  projectName: string;
}): WorkspacePptPreviewTabTarget {
  return {
    kind: "pptPreview",
    agentId: input.agentId,
    projectName: input.projectName,
  };
}

export function buildWorkspacePptPreviewUrl(input: {
  activeConnection: { type: string; endpoint: string } | null;
  agentId: string;
  projectName: string;
  locale?: "en" | "zh";
}): string {
  let previewPath = `/ppt-preview/${encodeURIComponent(input.agentId)}/${encodeURIComponent(
    input.projectName,
  )}`;
  if (input.locale) {
    previewPath = `${previewPath}?locale=${encodeURIComponent(input.locale)}`;
  }
  if (input.activeConnection?.type !== "directTcp") {
    return previewPath;
  }
  try {
    const { host, port, isIpv6 } = parseHostPort(input.activeConnection.endpoint);
    const baseHost = isIpv6 ? `[${host}]` : host;
    return `http://${baseHost}:${port}${previewPath}`;
  } catch {
    return previewPath;
  }
}

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

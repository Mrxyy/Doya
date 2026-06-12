export type OpenFileDisposition = "main" | "side";

export interface WorkspaceFileLocation {
  path: string;
  lineStart?: number;
  lineEnd?: number;
}

export type WorkspaceFileTabTarget = {
  kind: "file";
  sourceAgentId?: string;
} & WorkspaceFileLocation;

export interface WorkspaceFileOpenRequest {
  location: WorkspaceFileLocation;
  disposition: OpenFileDisposition;
  sourceAgentId?: string;
}

export function normalizeWorkspaceFileLocation(
  location: WorkspaceFileLocation | null | undefined,
): WorkspaceFileLocation | null {
  if (!location) {
    return null;
  }

  const path = location.path.trim().replace(/\\/g, "/");
  if (!path) {
    return null;
  }

  const lineStart = normalizeLineNumber(location.lineStart);
  const lineEnd = normalizeLineNumber(location.lineEnd);
  return {
    path,
    ...(lineStart ? { lineStart } : {}),
    ...(lineStart && lineEnd && lineEnd >= lineStart ? { lineEnd } : {}),
  };
}

export function workspaceFileLocationsEqual(
  left: WorkspaceFileLocation & { sourceAgentId?: string },
  right: WorkspaceFileLocation & { sourceAgentId?: string },
): boolean {
  return (
    left.path === right.path &&
    left.lineStart === right.lineStart &&
    left.lineEnd === right.lineEnd &&
    left.sourceAgentId === right.sourceAgentId
  );
}

export function createWorkspaceFileTabTarget(
  location: WorkspaceFileLocation,
  options?: { sourceAgentId?: string | null },
): WorkspaceFileTabTarget {
  const sourceAgentId = options?.sourceAgentId?.trim();
  return {
    kind: "file",
    ...location,
    ...(sourceAgentId ? { sourceAgentId } : {}),
  };
}

function normalizeLineNumber(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

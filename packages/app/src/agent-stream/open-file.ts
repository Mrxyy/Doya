import { normalizeInlinePathTarget, type InlinePathTarget } from "@/assistant-file-links/parse";
import {
  normalizeWorkspaceFileLocation,
  type OpenFileDisposition,
  type WorkspaceFileOpenRequest,
} from "@/workspace/file-open";

export interface AgentStreamWorkspaceFileOpenInput {
  target: InlinePathTarget;
  disposition: OpenFileDisposition;
  sourceAgentId: string;
  cwd?: string | null;
}

export function buildAgentStreamWorkspaceFileOpenRequest({
  cwd,
  disposition,
  sourceAgentId,
  target,
}: AgentStreamWorkspaceFileOpenInput): WorkspaceFileOpenRequest | null {
  const trimmedSourceAgentId = sourceAgentId.trim();
  if (!target.path || !trimmedSourceAgentId) {
    return null;
  }

  const normalized = normalizeInlinePathTarget(target.path, cwd ?? undefined);
  if (!normalized?.file) {
    return null;
  }

  const location = normalizeWorkspaceFileLocation({
    path: normalized.file,
    lineStart: target.lineStart,
    lineEnd: target.lineEnd,
  });
  if (!location) {
    return null;
  }

  return {
    location,
    disposition,
    sourceAgentId: trimmedSourceAgentId,
  };
}

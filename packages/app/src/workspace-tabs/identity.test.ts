import { describe, expect, it } from "vitest";
import {
  buildDeterministicWorkspaceTabId,
  normalizeWorkspaceTabTarget,
  workspaceTabTargetsEqual,
} from "./identity";

describe("workspace tab identity", () => {
  it("preserves source agent identity for file tabs", () => {
    expect(
      normalizeWorkspaceTabTarget({
        kind: "file",
        path: " output/report.docx ",
        sourceAgentId: " agent-1 ",
      }),
    ).toEqual({
      kind: "file",
      path: "output/report.docx",
      sourceAgentId: "agent-1",
    });
  });

  it("keeps file tabs from different source agents distinct", () => {
    const first = { kind: "file" as const, path: "output/report.docx", sourceAgentId: "agent-1" };
    const second = {
      kind: "file" as const,
      path: "output/report.docx",
      sourceAgentId: "agent-2",
    };

    expect(workspaceTabTargetsEqual(first, second)).toBe(false);
    expect(buildDeterministicWorkspaceTabId(first)).toBe("file_agent-1_output/report.docx");
    expect(buildDeterministicWorkspaceTabId(second)).toBe("file_agent-2_output/report.docx");
  });
});

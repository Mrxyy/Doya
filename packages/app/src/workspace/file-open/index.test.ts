import { describe, expect, it } from "vitest";
import {
  createWorkspaceFileTabTarget,
  normalizeWorkspaceFileLocation,
  workspaceFileLocationsEqual,
} from ".";

describe("normalizeWorkspaceFileLocation", () => {
  it("normalizes paths and valid line ranges", () => {
    expect(
      normalizeWorkspaceFileLocation({
        path: "src\\app.ts",
        lineStart: 12.8,
        lineEnd: 20.2,
      }),
    ).toEqual({
      path: "src/app.ts",
      lineStart: 12,
      lineEnd: 20,
    });
  });

  it("drops invalid or backwards line ranges", () => {
    expect(normalizeWorkspaceFileLocation({ path: "src/app.ts", lineStart: -1 })).toEqual({
      path: "src/app.ts",
    });
    expect(
      normalizeWorkspaceFileLocation({ path: "src/app.ts", lineStart: 20, lineEnd: 12 }),
    ).toEqual({
      path: "src/app.ts",
      lineStart: 20,
    });
  });

  it("rejects empty paths", () => {
    expect(normalizeWorkspaceFileLocation({ path: " " })).toBeNull();
  });
});

describe("workspace file tab targets", () => {
  it("keeps file tab identity separate from line selection", () => {
    expect(createWorkspaceFileTabTarget({ path: "src/app.ts", lineStart: 12 })).toEqual({
      kind: "file",
      path: "src/app.ts",
      lineStart: 12,
    });
  });

  it("preserves the source agent on file tab targets", () => {
    expect(
      createWorkspaceFileTabTarget(
        { path: "output/report.docx", lineStart: 4 },
        { sourceAgentId: "agent-1" },
      ),
    ).toEqual({
      kind: "file",
      path: "output/report.docx",
      lineStart: 4,
      sourceAgentId: "agent-1",
    });
  });

  it("compares full location equality", () => {
    expect(
      workspaceFileLocationsEqual(
        { path: "src/app.ts", lineStart: 12 },
        { path: "src/app.ts", lineStart: 12 },
      ),
    ).toBe(true);
    expect(
      workspaceFileLocationsEqual(
        { path: "src/app.ts", lineStart: 12 },
        { path: "src/app.ts", lineStart: 13 },
      ),
    ).toBe(false);
    expect(
      workspaceFileLocationsEqual(
        { path: "src/app.ts", sourceAgentId: "agent-1" },
        { path: "src/app.ts", sourceAgentId: "agent-2" },
      ),
    ).toBe(false);
  });
});

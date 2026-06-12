import { describe, expect, it } from "vitest";
import { buildAgentStreamWorkspaceFileOpenRequest } from "./open-file";

describe("buildAgentStreamWorkspaceFileOpenRequest", () => {
  it("keeps the source agent id on result-card file opens", () => {
    expect(
      buildAgentStreamWorkspaceFileOpenRequest({
        target: {
          raw: "output/spreadsheets/restaurant_quarterly_budget.xlsx",
          path: "output/spreadsheets/restaurant_quarterly_budget.xlsx",
        },
        disposition: "main",
        sourceAgentId: "agent-1",
        cwd: "/workspace",
      }),
    ).toEqual({
      location: { path: "output/spreadsheets/restaurant_quarterly_budget.xlsx" },
      disposition: "main",
      sourceAgentId: "agent-1",
    });
  });

  it("trims the source agent id and preserves valid line ranges", () => {
    expect(
      buildAgentStreamWorkspaceFileOpenRequest({
        target: {
          raw: "docs/report.docx#L12-L18",
          path: "docs/report.docx",
          lineStart: 12,
          lineEnd: 18,
        },
        disposition: "side",
        sourceAgentId: " agent-2 ",
      }),
    ).toEqual({
      location: { path: "docs/report.docx", lineStart: 12, lineEnd: 18 },
      disposition: "side",
      sourceAgentId: "agent-2",
    });
  });

  it("normalizes absolute paths inside the workspace to workspace-relative paths", () => {
    expect(
      buildAgentStreamWorkspaceFileOpenRequest({
        target: {
          raw: "/workspace/output/report.pdf",
          path: "/workspace/output/report.pdf",
        },
        disposition: "main",
        sourceAgentId: "agent-3",
        cwd: "/workspace",
      }),
    ).toEqual({
      location: { path: "output/report.pdf" },
      disposition: "main",
      sourceAgentId: "agent-3",
    });
  });

  it("does not create a file-open request for directories or missing source agents", () => {
    expect(
      buildAgentStreamWorkspaceFileOpenRequest({
        target: { raw: "output/", path: "output/" },
        disposition: "main",
        sourceAgentId: "agent-1",
      }),
    ).toBeNull();
    expect(
      buildAgentStreamWorkspaceFileOpenRequest({
        target: { raw: "output/report.pdf", path: "output/report.pdf" },
        disposition: "main",
        sourceAgentId: "   ",
      }),
    ).toBeNull();
  });
});

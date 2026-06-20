import { describe, expect, it } from "vitest";
import {
  buildWorkspacePptPreviewUrl,
  createWorkspacePptPreviewTabTarget,
  normalizeWorkspacePptPreviewTabTarget,
  workspacePptPreviewTabTargetsEqual,
} from ".";

describe("workspace PPT preview tab targets", () => {
  it("normalizes stable preview identity", () => {
    expect(
      normalizeWorkspacePptPreviewTabTarget({
        kind: "pptPreview",
        agentId: " agent-1 ",
        projectName: " breakfast_ppt ",
      }),
    ).toEqual({
      kind: "pptPreview",
      agentId: "agent-1",
      projectName: "breakfast_ppt",
    });
    expect(
      normalizeWorkspacePptPreviewTabTarget({
        kind: "pptPreview",
        agentId: "",
        projectName: "breakfast_ppt",
      }),
    ).toBeNull();
  });

  it("compares previews by agent and project", () => {
    expect(
      workspacePptPreviewTabTargetsEqual(
        createWorkspacePptPreviewTabTarget({ agentId: "agent-1", projectName: "deck" }),
        createWorkspacePptPreviewTabTarget({ agentId: "agent-1", projectName: "deck" }),
      ),
    ).toBe(true);
    expect(
      workspacePptPreviewTabTargetsEqual(
        createWorkspacePptPreviewTabTarget({ agentId: "agent-1", projectName: "deck" }),
        createWorkspacePptPreviewTabTarget({ agentId: "agent-2", projectName: "deck" }),
      ),
    ).toBe(false);
  });
});

describe("buildWorkspacePptPreviewUrl", () => {
  it("builds a daemon-relative URL when the active connection is proxied", () => {
    expect(
      buildWorkspacePptPreviewUrl({
        activeConnection: null,
        agentId: "agent/1",
        locale: "zh",
        projectName: "武汉早餐",
      }),
    ).toBe("/ppt-preview/agent%2F1/%E6%AD%A6%E6%B1%89%E6%97%A9%E9%A4%90?lang=zh");
  });

  it("passes the app locale through to the preview shell", () => {
    expect(
      buildWorkspacePptPreviewUrl({
        activeConnection: null,
        agentId: "agent-1",
        locale: "zh",
        projectName: "deck",
      }),
    ).toBe("/ppt-preview/agent-1/deck?lang=zh");
  });

  it("builds an absolute URL for direct TCP connections", () => {
    expect(
      buildWorkspacePptPreviewUrl({
        activeConnection: { type: "directTcp", endpoint: "127.0.0.1:6767" },
        agentId: "agent-1",
        locale: "en",
        projectName: "deck",
      }),
    ).toBe("http://127.0.0.1:6767/ppt-preview/agent-1/deck?lang=en");
  });
});

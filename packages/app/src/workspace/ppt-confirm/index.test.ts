import { describe, expect, it } from "vitest";
import { buildWorkspacePptConfirmUrl } from ".";

describe("buildWorkspacePptConfirmUrl", () => {
  it("builds a daemon-relative URL when the active connection is proxied", () => {
    expect(
      buildWorkspacePptConfirmUrl({
        activeConnection: null,
        agentId: "agent/1",
        projectName: "武汉早餐",
      }),
    ).toBe("/ppt-confirm/agent%2F1/%E6%AD%A6%E6%B1%89%E6%97%A9%E9%A4%90");
  });

  it("builds an absolute HTTP URL for direct TCP connections", () => {
    expect(
      buildWorkspacePptConfirmUrl({
        activeConnection: { type: "directTcp", endpoint: "127.0.0.1:6767" },
        agentId: "agent-1",
        projectName: "deck",
      }),
    ).toBe("http://127.0.0.1:6767/ppt-confirm/agent-1/deck");
  });

  it("builds an absolute HTTPS URL for TLS direct TCP connections", () => {
    expect(
      buildWorkspacePptConfirmUrl({
        activeConnection: { type: "directTcp", endpoint: "www.codexppt.com:443", useTls: true },
        agentId: "agent-1",
        projectName: "deck",
      }),
    ).toBe("https://www.codexppt.com/ppt-confirm/agent-1/deck");
  });
});

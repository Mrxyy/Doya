import { describe, expect, it } from "vitest";
import type { WorkspaceScriptPayload } from "@getdoya/protocol/messages";
import type { ActiveConnection } from "@/runtime/host-runtime";
import { resolveWorkspaceScriptLink } from "./workspace-script-links";

const runningService: WorkspaceScriptPayload = {
  scriptName: "web",
  type: "service",
  hostname: "web.feature.doya.localhost",
  port: 3000,
  proxyUrl: "http://web.feature.doya.localhost:6767",
  lifecycle: "running",
  health: "healthy",
  exitCode: null,
  terminalId: null,
};

function resolveLink(activeConnection: ActiveConnection | null) {
  return resolveWorkspaceScriptLink({
    script: runningService,
    activeConnection,
  });
}

describe("resolveWorkspaceScriptLink", () => {
  it("uses the local proxy URL for loopback TCP connections", () => {
    expect(
      resolveLink({ type: "directTcp", endpoint: "localhost:6767", display: "localhost:6767" }),
    ).toEqual({
      openUrl: "http://web.feature.doya.localhost:6767",
      labelUrl: "http://web.feature.doya.localhost:6767",
    });
  });

  it("uses the local proxy URL for socket and pipe connections", () => {
    expect(
      resolveLink({ type: "directSocket", endpoint: "/tmp/doya.sock", display: "socket" }),
    ).toEqual({
      openUrl: "http://web.feature.doya.localhost:6767",
      labelUrl: "http://web.feature.doya.localhost:6767",
    });
  });

  it("degrades to daemon-host plus service port for direct network connections", () => {
    expect(
      resolveLink({
        type: "directTcp",
        endpoint: "mac-mini.tail123.ts.net:6767",
        display: "mac-mini.tail123.ts.net:6767",
      }),
    ).toEqual({
      openUrl: "http://mac-mini.tail123.ts.net:3000",
      labelUrl: "http://mac-mini.tail123.ts.net:3000",
    });
  });

  it("uses HTTPS for TLS direct network connections", () => {
    expect(
      resolveLink({
        type: "directTcp",
        endpoint: "www.codexppt.com:443",
        display: "www.codexppt.com:443",
        useTls: true,
      }),
    ).toEqual({
      openUrl: "https://www.codexppt.com:3000",
      labelUrl: "https://www.codexppt.com:3000",
    });
  });

  it("shows the local proxy URL but disables opening over relay", () => {
    expect(resolveLink({ type: "relay", endpoint: "relay.doya.sh:443", display: "relay" })).toEqual(
      {
        openUrl: null,
        labelUrl: "http://web.feature.doya.localhost:6767",
      },
    );
  });
});

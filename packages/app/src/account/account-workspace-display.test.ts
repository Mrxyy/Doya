import { describe, expect, it } from "vitest";
import {
  isAccountSessionUsableForDirectHost,
  selectAccountSessionForDirectHost,
} from "@/account/account-workspace-display";
import type { AccountBootstrapSession } from "@/account/account-api";

const accountSession = {
  user: {
    userId: "usr_1",
    email: "person@example.com",
    phone: null,
  },
  workspace: {
    workspaceId: "ws_1",
    displayName: "Doya",
    runtime: {
      cwd: "/tmp/doya-6767/accounts/workspaces/ws_1",
    },
  },
  projects: [
    {
      projectId: "prj_1",
      workspaceId: "ws_1",
      displayName: "default",
      cwd: "/tmp/doya-6767/accounts/workspaces/ws_1/projects/default",
    },
  ],
  accessToken: "token_1",
  apiBaseUrl: "http://127.0.0.1:6767",
} satisfies AccountBootstrapSession;

describe("account workspace host scope", () => {
  it("allows the direct host that owns the saved account API endpoint", () => {
    expect(
      isAccountSessionUsableForDirectHost({
        session: accountSession,
        endpoint: "localhost:6767",
      }),
    ).toBe(true);
    expect(
      selectAccountSessionForDirectHost({
        session: accountSession,
        endpoint: "localhost:6767",
      }),
    ).toBe(accountSession);
  });

  it("rejects another direct host instead of reusing that host's project cwd", () => {
    expect(
      isAccountSessionUsableForDirectHost({
        session: accountSession,
        endpoint: "localhost:6868",
      }),
    ).toBe(false);
    expect(
      selectAccountSessionForDirectHost({
        session: accountSession,
        endpoint: "localhost:6868",
      }),
    ).toBeNull();
  });
});

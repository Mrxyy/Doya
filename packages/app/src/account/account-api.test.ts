import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadAccountBootstrapSession,
  saveAccountBootstrapSession,
  type AccountBootstrapSession,
} from "./account-api";

const storageState = vi.hoisted(() => ({
  ...(() => {
    const values = new Map<string, string>();
    return {
      values,
      getItem: vi.fn(async (key: string) => values.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        values.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        values.delete(key);
      }),
    };
  })(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: storageState.getItem,
    setItem: storageState.setItem,
    removeItem: storageState.removeItem,
  },
}));

vi.mock("@/i18n/i18n", () => ({
  translateNow: (key: string) => key,
}));

const session = {
  user: {
    userId: "usr_1",
    email: "person@example.com",
    phone: null,
  },
  workspace: {
    workspaceId: "ws_1",
    displayName: "豆芽",
    runtime: {
      cwd: "/tmp/doya/accounts/workspaces/ws_1",
    },
  },
  projects: [
    {
      projectId: "prj_1",
      workspaceId: "ws_1",
      displayName: "default",
      cwd: "/tmp/doya/accounts/workspaces/ws_1/default",
    },
  ],
  accessToken: "token_1",
  apiBaseUrl: "http://127.0.0.1:6767",
} satisfies AccountBootstrapSession;

describe("account session storage", () => {
  beforeEach(() => {
    delete process.env.EXPO_PUBLIC_CONTROL_API_URL;
    storageState.values.clear();
    storageState.getItem.mockClear();
    storageState.setItem.mockClear();
    storageState.removeItem.mockClear();
  });

  it("keeps a saved Doya account session readable", async () => {
    await saveAccountBootstrapSession(session);

    await expect(loadAccountBootstrapSession()).resolves.toMatchObject({
      user: { userId: "usr_1" },
      workspace: { workspaceId: "ws_1" },
      accessToken: "token_1",
    });
    expect(storageState.values.has("doya.account.session.v1")).toBe(true);
  });

  it("migrates a legacy account session to the Doya key", async () => {
    const legacyKey = `${"pa"}${"seo"}.account.session.v1`;
    storageState.values.set(legacyKey, JSON.stringify(session));

    await expect(loadAccountBootstrapSession()).resolves.toMatchObject({
      user: { userId: "usr_1" },
      workspace: { workspaceId: "ws_1" },
    });

    expect(storageState.values.has("doya.account.session.v1")).toBe(true);
    expect(storageState.values.has(legacyKey)).toBe(false);
  });

  it("repairs a stored control account session without workspace metadata", async () => {
    storageState.values.set(
      "doya.account.session.v1",
      JSON.stringify({
        user: session.user,
        accessToken: "token_1",
        projects: [],
      }),
    );

    await expect(loadAccountBootstrapSession()).resolves.toMatchObject({
      user: { userId: "usr_1" },
      workspace: {
        workspaceId: "control:usr_1",
        runtime: null,
      },
      accessToken: "token_1",
    });
  });

  it("preserves the configured control API URL for stored control sessions", async () => {
    process.env.EXPO_PUBLIC_CONTROL_API_URL = "http://127.0.0.1:6777";
    storageState.values.set(
      "doya.account.session.v1",
      JSON.stringify({
        user: session.user,
        workspace: {
          workspaceId: "control:usr_1",
          displayName: "Doya",
          runtime: null,
        },
        accessToken: "token_1",
        projects: [],
        apiBaseUrl: "http://stale.example",
      }),
    );

    await expect(loadAccountBootstrapSession()).resolves.toMatchObject({
      workspace: { workspaceId: "control:usr_1" },
      apiBaseUrl: "http://127.0.0.1:6777",
    });
  });

  it("does not reuse legacy workspace sessions when the control API is configured", async () => {
    process.env.EXPO_PUBLIC_CONTROL_API_URL = "http://127.0.0.1:6777";
    storageState.values.set("doya.account.session.v1", JSON.stringify(session));

    await expect(loadAccountBootstrapSession()).resolves.toBeNull();
    expect(storageState.values.has("doya.account.session.v1")).toBe(false);
  });
});

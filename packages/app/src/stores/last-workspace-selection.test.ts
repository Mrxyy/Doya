import { describe, expect, it } from "vitest";
import {
  createLastWorkspaceSelectionStore,
  type ActiveWorkspaceSelection,
  type LastWorkspaceSelectionStorage,
} from "./last-workspace-selection";

class DelayedWorkspaceSelectionStorage implements LastWorkspaceSelectionStorage {
  private finishRead: (value: string | null) => void = () => {};
  private readonly pendingRead = new Promise<string | null>((resolve) => {
    this.finishRead = resolve;
  });
  private saved: string | null = null;

  read(): Promise<string | null> {
    return this.pendingRead;
  }

  async clear(): Promise<void> {
    this.saved = null;
  }

  async write(value: string): Promise<void> {
    this.saved = value;
  }

  finishHydrationWith(selection: ActiveWorkspaceSelection | null) {
    this.finishRead(selection ? JSON.stringify(selection) : null);
  }

  getSavedSelection(): ActiveWorkspaceSelection | null {
    return this.saved ? (JSON.parse(this.saved) as ActiveWorkspaceSelection) : null;
  }
}

describe("last workspace selection", () => {
  it("hydrates the saved workspace selection", async () => {
    const storage = new DelayedWorkspaceSelectionStorage();
    const store = createLastWorkspaceSelectionStore(storage);
    const hydration = store.hydrate();

    storage.finishHydrationWith({ serverId: "server-saved", workspaceId: "workspace-saved" });
    await hydration;

    expect(store.getSelection()).toEqual({
      serverId: "server-saved",
      workspaceId: "workspace-saved",
    });
    expect(store.isHydrated()).toBe(true);
  });

  it("keeps a newer workspace selection when storage hydration finishes late", async () => {
    const storage = new DelayedWorkspaceSelectionStorage();
    const store = createLastWorkspaceSelectionStore(storage);
    const hydration = store.hydrate();

    store.remember({ serverId: "server-new", workspaceId: "workspace-new" });
    storage.finishHydrationWith({ serverId: "server-old", workspaceId: "workspace-old" });
    await hydration;

    expect(store.getSelection()).toEqual({
      serverId: "server-new",
      workspaceId: "workspace-new",
    });
    expect(storage.getSavedSelection()).toEqual({
      serverId: "server-new",
      workspaceId: "workspace-new",
    });
  });

  it("forgets the current workspace selection", () => {
    const storage = new DelayedWorkspaceSelectionStorage();
    const store = createLastWorkspaceSelectionStore(storage);

    store.remember({ serverId: "server-1", workspaceId: "workspace-a" });
    store.forget({ serverId: "server-1", workspaceId: "workspace-a" });

    expect(store.getSelection()).toBeNull();
    expect(storage.getSavedSelection()).toBeNull();
  });

  it("keeps a different workspace selection when forgetting a stale route", () => {
    const storage = new DelayedWorkspaceSelectionStorage();
    const store = createLastWorkspaceSelectionStore(storage);

    store.remember({ serverId: "server-1", workspaceId: "workspace-a" });
    store.forget({ serverId: "server-1", workspaceId: "workspace-b" });

    expect(store.getSelection()).toEqual({ serverId: "server-1", workspaceId: "workspace-a" });
    expect(storage.getSavedSelection()).toEqual({
      serverId: "server-1",
      workspaceId: "workspace-a",
    });
  });
});

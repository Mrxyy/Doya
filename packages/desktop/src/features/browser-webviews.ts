import { webContents as allWebContents, type WebContents } from "electron";

const browserIdsByWebContentsId = new Map<number, string>();
let workspaceActiveBrowserId: string | null = null;

export function listRegisteredDoyaBrowserIds(): string[] {
  return Array.from(new Set(browserIdsByWebContentsId.values())).sort();
}

export function registerDoyaBrowserWebContents(contents: WebContents, browserId: string): void {
  browserIdsByWebContentsId.set(contents.id, browserId);
  contents.once("destroyed", () => {
    browserIdsByWebContentsId.delete(contents.id);
    if (workspaceActiveBrowserId === browserId) {
      workspaceActiveBrowserId = null;
    }
  });
}

export function getDoyaBrowserIdForWebContents(contents: WebContents | null): string | null {
  if (!contents || contents.isDestroyed()) {
    return null;
  }
  return browserIdsByWebContentsId.get(contents.id) ?? null;
}

export function setWorkspaceActiveDoyaBrowserId(browserId: string | null): void {
  workspaceActiveBrowserId = browserId;
}

export function getDoyaBrowserWebContents(browserId: string): WebContents | null {
  for (const [contentsId, registeredBrowserId] of browserIdsByWebContentsId) {
    if (registeredBrowserId !== browserId) continue;
    const contents = allWebContents.fromId(contentsId);
    if (contents && !contents.isDestroyed()) {
      return contents;
    }
  }
  return null;
}

export function getWorkspaceActiveDoyaBrowserWebContents(): WebContents | null {
  if (!workspaceActiveBrowserId) {
    return null;
  }
  return getDoyaBrowserWebContents(workspaceActiveBrowserId);
}

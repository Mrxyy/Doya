import { contextBridge, ipcRenderer, webUtils } from "electron";

type EventHandler = (payload: unknown) => void;

const desktopBridge = {
  platform: process.platform,
  invoke: (command: string, args?: Record<string, unknown>) =>
    ipcRenderer.invoke("doya:invoke", command, args),
  getPendingOpenProject: () =>
    ipcRenderer.invoke("doya:get-pending-open-project") as Promise<string | null>,
  events: {
    on: (event: string, handler: EventHandler): Promise<() => void> => {
      const listener = (_ipcEvent: Electron.IpcRendererEvent, payload: unknown) => {
        handler(payload);
      };
      ipcRenderer.on(`doya:event:${event}`, listener);
      return Promise.resolve(() => {
        ipcRenderer.removeListener(`doya:event:${event}`, listener);
      });
    },
  },
  window: {
    getCurrentWindow: () => ({
      toggleMaximize: () => ipcRenderer.invoke("doya:window:toggleMaximize"),
      isFullscreen: () => ipcRenderer.invoke("doya:window:isFullscreen"),
      updateWindowControls: (update: {
        height?: number;
        backgroundColor?: string;
        foregroundColor?: string;
      }) => ipcRenderer.invoke("doya:window:updateWindowControls", update),
      onResized: (handler: EventHandler): (() => void) => {
        const listener = (_ipcEvent: Electron.IpcRendererEvent, payload: unknown) => {
          handler(payload);
        };
        ipcRenderer.on("doya:window:resized", listener);
        return () => {
          ipcRenderer.removeListener("doya:window:resized", listener);
        };
      },
      setBadgeCount: (count?: number) => ipcRenderer.invoke("doya:window:setBadgeCount", count),
    }),
  },
  dialog: {
    ask: (message: string, options?: Record<string, unknown>) =>
      ipcRenderer.invoke("doya:dialog:ask", message, options),
    askWithCheckbox: (message: string, options: Record<string, unknown>) =>
      ipcRenderer.invoke("doya:dialog:askWithCheckbox", message, options),
    open: (options?: Record<string, unknown>) => ipcRenderer.invoke("doya:dialog:open", options),
  },
  notification: {
    isSupported: () => ipcRenderer.invoke("doya:notification:isSupported"),
    sendNotification: (payload: { title: string; body?: string; data?: Record<string, unknown> }) =>
      ipcRenderer.invoke("doya:notification:send", payload),
  },
  opener: {
    openUrl: (url: string) => ipcRenderer.invoke("doya:opener:openUrl", url),
  },
  webUtils: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  },
  menu: {
    showContextMenu: (input?: Record<string, unknown>) =>
      ipcRenderer.invoke("doya:menu:showContextMenu", input),
  },
  browser: {
    setWorkspaceActiveBrowser: (browserId: string | null) =>
      ipcRenderer.invoke("doya:browser:set-workspace-active-browser", browserId),
    openDevTools: (browserId: string) =>
      ipcRenderer.invoke("doya:browser:open-devtools", browserId),
    clearPartition: (browserId: string) =>
      ipcRenderer.invoke("doya:browser:clear-partition", browserId),
  },
};

contextBridge.exposeInMainWorld("doyaDesktop", desktopBridge);

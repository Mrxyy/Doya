// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

const desktopHostState = {
  api: null as {
    dialog?: {
      ask?: (message: string, options?: Record<string, unknown>) => Promise<boolean>;
    };
  } | null,
};

type MockPlatform = "web" | "ios" | "android";

interface AlertButton {
  onPress?: () => void;
}

async function loadModuleForPlatform(platform: MockPlatform): Promise<{
  confirmDialog: typeof import("./confirm-dialog").confirmDialog;
  alertMock: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();

  const alertMock = vi.fn();
  vi.doMock("react-native", () => ({
    Alert: {
      alert: alertMock,
    },
    Platform: { OS: platform },
  }));
  vi.doMock("@/desktop/host", () => ({
    getDesktopHost: () => desktopHostState.api,
  }));
  vi.doMock("@/constants/platform", () => ({
    isNative: platform !== "web",
  }));

  const module = await import("./confirm-dialog");
  return { confirmDialog: module.confirmDialog, alertMock };
}

function clearDialogGlobals(): void {
  desktopHostState.api = null;
  delete (globalThis as { confirm?: unknown }).confirm;
  document.body.innerHTML = "";
}

describe("confirmDialog", () => {
  afterEach(() => {
    vi.doUnmock("react-native");
    vi.restoreAllMocks();
    vi.resetModules();
    clearDialogGlobals();
  });

  it("uses the desktop dialog bridge on web when available", async () => {
    const askMock = vi.fn(async () => true);
    document.body.innerHTML = `<button id="active-button">Active</button>`;
    document.getElementById("active-button")?.focus();
    const blurMock = vi.spyOn(HTMLElement.prototype, "blur");
    desktopHostState.api = {
      dialog: { ask: askMock },
    };

    const { confirmDialog, alertMock } = await loadModuleForPlatform("web");
    const confirmed = await confirmDialog({
      title: "Restart host",
      message: "This will restart the daemon.",
      confirmLabel: "Restart",
      cancelLabel: "Cancel",
      destructive: true,
    });

    expect(confirmed).toBe(true);
    expect(alertMock).not.toHaveBeenCalled();
    expect(blurMock).toHaveBeenCalledTimes(1);
    expect(askMock).toHaveBeenCalledWith("This will restart the daemon.", {
      title: "Restart host",
      okLabel: "Restart",
      cancelLabel: "Cancel",
      kind: "warning",
    });
  });

  it("renders a custom web confirmation dialog when desktop APIs are unavailable", async () => {
    const browserConfirm = vi.fn(() => true);
    document.body.innerHTML = `<button id="active-button">Active</button>`;
    document.getElementById("active-button")?.focus();
    const blurMock = vi.spyOn(HTMLElement.prototype, "blur");
    (globalThis as { confirm?: unknown }).confirm = browserConfirm;

    const { confirmDialog } = await loadModuleForPlatform("web");
    const confirmedPromise = confirmDialog({
      title: "Restart host",
      message: "This will restart the daemon.",
      confirmLabel: "Restart",
      cancelLabel: "Cancel",
    });
    await Promise.resolve();

    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Restart host");
    expect(dialog?.textContent).toContain("This will restart the daemon.");
    expect(browserConfirm).not.toHaveBeenCalled();

    const confirmButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Restart",
    );
    confirmButton?.click();

    const confirmed = await confirmedPromise;
    expect(confirmed).toBe(true);
    expect(blurMock).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("throws on web when no confirm backend exists", async () => {
    vi.stubGlobal("document", undefined);
    const { confirmDialog } = await loadModuleForPlatform("web");

    await expect(
      confirmDialog({
        title: "Restart host",
        message: "This will restart the daemon.",
      }),
    ).rejects.toThrow("[ConfirmDialog] No web confirmation backend is available.");
    vi.unstubAllGlobals();
  });

  it("uses native Alert on iOS/Android", async () => {
    const { confirmDialog, alertMock } = await loadModuleForPlatform("ios");
    alertMock.mockImplementation((_title: string, _message: string, buttons?: AlertButton[]) => {
      const confirmButton = buttons?.[1];
      confirmButton?.onPress?.();
    });

    const confirmed = await confirmDialog({
      title: "Restart host",
      message: "This will restart the daemon.",
      confirmLabel: "Restart",
      cancelLabel: "Cancel",
      destructive: true,
    });

    expect(confirmed).toBe(true);
    expect(alertMock).toHaveBeenCalled();
  });
});

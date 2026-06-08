import { Alert } from "react-native";
import { getDesktopHost, type DesktopDialogAskOptions } from "@/desktop/host";
import { isNative } from "@/constants/platform";
import { getOverlayRoot, OVERLAY_Z } from "@/lib/overlay-root";

export interface ConfirmDialogInput {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmButtonConfig {
  confirmLabel: string;
  cancelLabel: string;
}

function resolveButtonLabels(input: ConfirmDialogInput): ConfirmButtonConfig {
  return {
    confirmLabel: input.confirmLabel ?? "Confirm",
    cancelLabel: input.cancelLabel ?? "Cancel",
  };
}

async function showNativeConfirmDialog(input: ConfirmDialogInput): Promise<boolean> {
  const labels = resolveButtonLabels(input);

  return new Promise<boolean>((resolve) => {
    Alert.alert(
      input.title,
      input.message,
      [
        {
          text: labels.cancelLabel,
          style: "cancel",
          onPress: () => resolve(false),
        },
        {
          text: labels.confirmLabel,
          style: input.destructive ? "destructive" : "default",
          onPress: () => resolve(true),
        },
      ],
      {
        cancelable: true,
        onDismiss: () => resolve(false),
      },
    );
  });
}

function getDesktopApi() {
  if (isNative) {
    return null;
  }
  return getDesktopHost();
}

function buildDesktopAskOptions(input: ConfirmDialogInput): DesktopDialogAskOptions {
  const labels = resolveButtonLabels(input);

  return {
    title: input.title,
    okLabel: labels.confirmLabel,
    cancelLabel: labels.cancelLabel,
    kind: input.destructive ? "warning" : "info",
  };
}

function blurActiveWebElement(): void {
  if (isNative) {
    return;
  }
  const activeElement = (globalThis as { document?: Document }).document?.activeElement;
  (activeElement as HTMLElement | null)?.blur?.();
}

async function showDesktopConfirmDialog(input: ConfirmDialogInput): Promise<boolean | null> {
  const desktopApi = getDesktopApi();
  if (!desktopApi) {
    return null;
  }

  blurActiveWebElement();
  const options = buildDesktopAskOptions(input);
  const desktopAsk = desktopApi.dialog?.ask;

  if (typeof desktopAsk === "function") {
    return await desktopAsk(input.message, options);
  }

  return null;
}

function createWebConfirmStyles(destructive: boolean): string {
  const confirmBackground = destructive ? "#b04138" : "#20744A";
  const confirmHoverBackground = destructive ? "#96372f" : "#1b633f";
  return `
    .paseo-confirm-dialog-overlay {
      position: fixed;
      inset: 0;
      z-index: ${OVERLAY_Z.modal};
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: rgba(18, 18, 20, 0.42);
      pointer-events: auto;
    }
    .paseo-confirm-dialog-card {
      width: min(420px, 100%);
      border: 1px solid #e4e4e7;
      border-radius: 12px;
      background: #ffffff;
      color: #1a1a1e;
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.16);
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .paseo-confirm-dialog-body {
      padding: 24px 24px 18px;
    }
    .paseo-confirm-dialog-title {
      margin: 0;
      color: #1a1a1e;
      font-size: 16px;
      font-weight: 500;
      line-height: 22px;
    }
    .paseo-confirm-dialog-message {
      margin: 12px 0 0;
      color: #52525b;
      font-size: 14px;
      line-height: 21px;
      white-space: pre-wrap;
    }
    .paseo-confirm-dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 14px 16px 16px;
      border-top: 1px solid #f4f4f5;
      background: #fafafa;
    }
    .paseo-confirm-dialog-button {
      min-width: 76px;
      height: 34px;
      padding: 0 14px;
      border-radius: 8px;
      border: 1px solid transparent;
      font: inherit;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
    }
    .paseo-confirm-dialog-cancel {
      border-color: #e4e4e7;
      background: #ffffff;
      color: #3f3f46;
    }
    .paseo-confirm-dialog-cancel:hover {
      background: #f4f4f5;
    }
    .paseo-confirm-dialog-confirm {
      background: ${confirmBackground};
      color: #ffffff;
    }
    .paseo-confirm-dialog-confirm:hover {
      background: ${confirmHoverBackground};
    }
    .paseo-confirm-dialog-button:focus-visible {
      outline: 2px solid #20744A;
      outline-offset: 2px;
    }
    @media (prefers-color-scheme: dark) {
      .paseo-confirm-dialog-overlay {
        background: rgba(0, 0, 0, 0.55);
      }
      .paseo-confirm-dialog-card {
        border-color: #303036;
        background: #1f1f22;
        color: #fafafa;
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.38);
      }
      .paseo-confirm-dialog-title {
        color: #fafafa;
      }
      .paseo-confirm-dialog-message {
        color: #a1a1aa;
      }
      .paseo-confirm-dialog-actions {
        border-top-color: #27272a;
        background: #18181b;
      }
      .paseo-confirm-dialog-cancel {
        border-color: #303036;
        background: #1f1f22;
        color: #fafafa;
      }
      .paseo-confirm-dialog-cancel:hover {
        background: #27272a;
      }
    }
  `;
}

function appendTextElement(input: {
  document: Document;
  parent: HTMLElement;
  tagName: "h2" | "p";
  className: string;
  text: string;
}): HTMLElement {
  const element = input.document.createElement(input.tagName);
  element.className = input.className;
  element.textContent = input.text;
  input.parent.appendChild(element);
  return element;
}

function showWebConfirmDialog(input: ConfirmDialogInput): Promise<boolean> {
  const document = (globalThis as { document?: Document }).document;
  if (!document) {
    throw new Error("[ConfirmDialog] No web confirmation backend is available.");
  }

  const labels = resolveButtonLabels(input);
  blurActiveWebElement();

  return new Promise<boolean>((resolve) => {
    const overlayRoot = getOverlayRoot();
    const overlay = document.createElement("div");
    overlay.className = "paseo-confirm-dialog-overlay";

    const style = document.createElement("style");
    style.textContent = createWebConfirmStyles(Boolean(input.destructive));

    const card = document.createElement("div");
    card.className = "paseo-confirm-dialog-card";
    card.setAttribute("role", "alertdialog");
    card.setAttribute("aria-modal", "true");

    const body = document.createElement("div");
    body.className = "paseo-confirm-dialog-body";
    const title = appendTextElement({
      document,
      parent: body,
      tagName: "h2",
      className: "paseo-confirm-dialog-title",
      text: input.title,
    });
    const message = appendTextElement({
      document,
      parent: body,
      tagName: "p",
      className: "paseo-confirm-dialog-message",
      text: input.message,
    });
    card.setAttribute("aria-labelledby", "paseo-confirm-dialog-title");
    card.setAttribute("aria-describedby", "paseo-confirm-dialog-message");
    title.id = "paseo-confirm-dialog-title";
    message.id = "paseo-confirm-dialog-message";

    const actions = document.createElement("div");
    actions.className = "paseo-confirm-dialog-actions";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "paseo-confirm-dialog-button paseo-confirm-dialog-cancel";
    cancelButton.textContent = labels.cancelLabel;

    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.className = "paseo-confirm-dialog-button paseo-confirm-dialog-confirm";
    confirmButton.textContent = labels.confirmLabel;

    actions.appendChild(cancelButton);
    actions.appendChild(confirmButton);
    card.appendChild(body);
    card.appendChild(actions);
    overlay.appendChild(style);
    overlay.appendChild(card);

    const cleanup = (confirmed: boolean) => {
      document.removeEventListener("keydown", handleKeyDown, true);
      overlay.remove();
      resolve(confirmed);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cleanup(false);
      }
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) cleanup(false);
    });
    cancelButton.addEventListener("click", () => cleanup(false));
    confirmButton.addEventListener("click", () => cleanup(true));
    document.addEventListener("keydown", handleKeyDown, true);
    overlayRoot.appendChild(overlay);
    cancelButton.focus();
  });
}

export async function confirmDialog(input: ConfirmDialogInput): Promise<boolean> {
  if (isNative) {
    return showNativeConfirmDialog(input);
  }

  const desktopResult = await showDesktopConfirmDialog(input);
  if (desktopResult !== null) {
    return desktopResult;
  }

  return await showWebConfirmDialog(input);
}

export const __private__ = {
  blurActiveWebElement,
  buildDesktopAskOptions,
};

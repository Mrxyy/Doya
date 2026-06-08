import { useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  type DesktopDaemonStatus,
  startDesktopDaemon,
  stopDesktopDaemon,
} from "@/desktop/daemon/desktop-daemon";
import {
  executeDaemonManagementToggle,
  type DaemonManagementToggleResult,
} from "@/desktop/daemon/daemon-management-toggle";
import { useDesktopIpcErrorReporter } from "@/desktop/hooks/desktop-ipc-error";
import type { DesktopSettings } from "@/desktop/settings/desktop-settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { translateNow } from "@/i18n/i18n";

type DesktopDaemonSettings = DesktopSettings["daemon"];

interface UseBuiltInDaemonManagementInput {
  daemonStatus: DesktopDaemonStatus | null;
  settings: DesktopDaemonSettings;
  updateSettings: (next: Partial<DesktopDaemonSettings>) => Promise<unknown>;
  setStatus: (status: DesktopDaemonStatus) => void;
  refreshStatus: () => void;
}

interface UseBuiltInDaemonManagementResult {
  isUpdating: boolean;
  toggle: () => void;
}

export function useBuiltInDaemonManagement(
  input: UseBuiltInDaemonManagementInput,
): UseBuiltInDaemonManagementResult {
  const { daemonStatus, settings, updateSettings, setStatus, refreshStatus } = input;
  const reportError = useDesktopIpcErrorReporter();
  const { mutate: toggleDaemonManagement, isPending: isUpdating } = useMutation<
    DaemonManagementToggleResult,
    Error
  >({
    mutationFn: () =>
      executeDaemonManagementToggle(settings.manageBuiltInDaemon, daemonStatus, {
        confirm: () =>
          confirmDialog({
            title: translateNow("ui.pause.built.in.daemon.1qgqy2u"),
            message: translateNow("ui.this.will.stop.the.built.in.daemon.immediately.1mntzq1"),
            confirmLabel: translateNow("ui.pause.and.stop.2kmjed"),
            cancelLabel: translateNow("ui.cancel.x9d2fu"),
            destructive: true,
          }),
        persistSettings: (next) => updateSettings(next) as Promise<void>,
        startDaemon: startDesktopDaemon,
        stopDaemon: stopDesktopDaemon,
      }),
    onError: (error) => {
      reportError({
        error,
        message: settings.manageBuiltInDaemon
          ? "Built-in daemon management was paused, but Paseo could not stop the daemon."
          : "Unable to update built-in daemon management.",
        logLabel: "[Settings] Failed to update built-in daemon management",
      });
    },
    onSuccess: (result) => {
      if (result.kind === "cancelled") {
        return;
      }
      if (result.newStatus) {
        setStatus(result.newStatus);
      }
      refreshStatus();
    },
  });

  const toggle = useCallback(() => {
    if (isUpdating) {
      return;
    }

    toggleDaemonManagement();
  }, [isUpdating, toggleDaemonManagement]);

  return { isUpdating, toggle };
}

import React, { type ReactElement, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { settingsStyles } from "@/styles/settings";
import { SettingsSection } from "@/screens/settings/settings-section";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { openExternalUrl } from "@/utils/open-external-url";
import { isVersionMismatch } from "@/desktop/updates/desktop-updates";
import { getCliDaemonStatus, shouldUseDesktopDaemon } from "@/desktop/daemon/desktop-daemon";
import { useBuiltInDaemonManagement } from "@/desktop/hooks/use-built-in-daemon-management";
import { useDaemonStatus } from "@/desktop/hooks/use-daemon-status";
import { useDesktopSettings, type DesktopSettings } from "@/desktop/settings/desktop-settings";
import { resolveAppVersion } from "@/utils/app-version";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { translateNow } from "@/i18n/i18n";
import { Activity, ArrowUpRight, Copy, FileText } from "@/components/icons/lucide";

type DesktopDaemonSettings = DesktopSettings["daemon"];

function useKeepRunningAfterQuitToggle(args: {
  settings: DesktopDaemonSettings;
  updateSettings: (next: Partial<DesktopDaemonSettings>) => Promise<unknown>;
}) {
  const { settings, updateSettings } = args;
  const [isUpdatingKeepRunningAfterQuit, setIsUpdatingKeepRunningAfterQuit] = useState(false);

  const handleToggleKeepRunningAfterQuit = useCallback(() => {
    setIsUpdatingKeepRunningAfterQuit(true);
    void updateSettings({ keepRunningAfterQuit: !settings.keepRunningAfterQuit })
      .catch(() => {
        // useDesktopSettings owns the user-visible IPC error.
      })
      .finally(() => {
        setIsUpdatingKeepRunningAfterQuit(false);
      });
  }, [settings.keepRunningAfterQuit, updateSettings]);

  return { isUpdatingKeepRunningAfterQuit, handleToggleKeepRunningAfterQuit };
}

function useDaemonCliStatusModal() {
  const [cliStatusOutput, setCliStatusOutput] = useState<string | null>(null);
  const [isCliStatusModalOpen, setIsCliStatusModalOpen] = useState(false);
  const [isLoadingCliStatus, setIsLoadingCliStatus] = useState(false);

  const handleOpenCliStatus = useCallback(async () => {
    setIsLoadingCliStatus(true);
    try {
      setCliStatusOutput(await getCliDaemonStatus());
      setIsCliStatusModalOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCliStatusOutput(`Failed to fetch daemon status: ${message}`);
      setIsCliStatusModalOpen(true);
    } finally {
      setIsLoadingCliStatus(false);
    }
  }, []);

  const handleCopyCliStatus = useCallback(() => {
    if (!cliStatusOutput) {
      return;
    }
    void Clipboard.setStringAsync(cliStatusOutput)
      .then(() => {
        Alert.alert(
          translateNow("ui.copied.xh3l5w"),
          translateNow("ui.status.copied.to.clipboard.hljevj"),
        );
        return;
      })
      .catch((error) => {
        console.error("[Settings] Failed to copy daemon status", error);
      });
  }, [cliStatusOutput]);

  const handleCloseCliStatusModal = useCallback(() => setIsCliStatusModalOpen(false), []);

  return {
    cliStatusOutput,
    isCliStatusModalOpen,
    isLoadingCliStatus,
    handleCopyCliStatus,
    handleOpenCliStatus,
    handleCloseCliStatusModal,
  };
}

function useDaemonLogsModal(daemonLogs: { logPath?: string } | null) {
  const [isLogsModalOpen, setIsLogsModalOpen] = useState(false);

  const handleCopyLogPath = useCallback(() => {
    const logPath = daemonLogs?.logPath;
    if (!logPath) {
      return;
    }

    void Clipboard.setStringAsync(logPath)
      .then(() => {
        Alert.alert(translateNow("ui.copied.xh3l5w"), translateNow("ui.log.path.copied.11v2y5n"));
        return;
      })
      .catch((error) => {
        console.error("[Settings] Failed to copy log path", error);
        Alert.alert(
          translateNow("ui.error.1410q0"),
          translateNow("ui.unable.to.copy.log.path.117fwt6"),
        );
      });
  }, [daemonLogs?.logPath]);

  const handleOpenLogs = useCallback(() => {
    if (!daemonLogs) {
      return;
    }
    setIsLogsModalOpen(true);
  }, [daemonLogs]);

  const handleCloseLogsModal = useCallback(() => setIsLogsModalOpen(false), []);

  return { isLogsModalOpen, handleCopyLogPath, handleOpenLogs, handleCloseLogsModal };
}

interface DaemonLogsModalProps {
  visible: boolean;
  onClose: () => void;
  daemonLogs: { logPath?: string; contents?: string } | null;
}

function DaemonLogsModal({ visible, onClose, daemonLogs }: DaemonLogsModalProps) {
  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={onClose}
      header={DAEMON_LOGS_HEADER}
      testID="managed-daemon-logs-dialog"
      snapPoints={LOGS_MODAL_SNAP_POINTS}
    >
      <View style={styles.modalBody}>
        <Text style={settingsStyles.rowHint}>{daemonLogs?.logPath ?? "Log path unavailable"}</Text>
        <Text style={styles.logOutput} selectable dataSet={CODE_SURFACE_DATASET}>
          {daemonLogs?.contents?.length ? daemonLogs.contents : "(log file is empty)"}
        </Text>
      </View>
    </AdaptiveModalSheet>
  );
}

interface DaemonCliStatusModalProps {
  visible: boolean;
  onClose: () => void;
  cliStatusOutput: string | null;
  onCopy: () => void;
}

function DaemonCliStatusModal({
  visible,
  onClose,
  cliStatusOutput,
  onCopy,
}: DaemonCliStatusModalProps) {
  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={onClose}
      header={DAEMON_STATUS_HEADER}
      testID="daemon-cli-status-dialog"
      snapPoints={CLI_STATUS_MODAL_SNAP_POINTS}
    >
      <View style={styles.modalBody}>
        <Text style={styles.logOutput} selectable dataSet={CODE_SURFACE_DATASET}>
          {cliStatusOutput ?? ""}
        </Text>
        <View style={styles.modalActions}>
          <Button variant="outline" size="sm" onPress={onClose}>
            {translateNow("ui.close.12tjh4")}
          </Button>
          <Button size="sm" onPress={onCopy}>
            {translateNow("ui.copy.19579")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

interface DaemonInfoCardProps {
  daemonStatusStateText: string;
  daemonStatusDetailText: string;
  isDaemonManagementPaused: boolean;
  copyIcon: ReactElement;
  fileTextIcon: ReactElement;
  activityIcon: ReactElement;
  handleToggleDaemonManagement: () => void;
  isUpdatingDaemonManagement: boolean;
  keepRunningAfterQuit: boolean;
  handleToggleKeepRunningAfterQuit: () => void;
  isUpdatingKeepRunningAfterQuit: boolean;
  daemonLogs: { logPath?: string } | null;
  handleCopyLogPath: () => void;
  handleOpenLogs: () => void;
  handleRunCliStatus: () => void;
  isLoadingCliStatus: boolean;
}

function DaemonInfoCard(props: DaemonInfoCardProps) {
  const {
    daemonStatusStateText,
    daemonStatusDetailText,
    isDaemonManagementPaused,
    copyIcon,
    fileTextIcon,
    activityIcon,
    handleToggleDaemonManagement,
    isUpdatingDaemonManagement,
    keepRunningAfterQuit,
    handleToggleKeepRunningAfterQuit,
    isUpdatingKeepRunningAfterQuit,
    daemonLogs,
    handleCopyLogPath,
    handleOpenLogs,
    handleRunCliStatus,
    isLoadingCliStatus,
  } = props;

  return (
    <View style={settingsStyles.card}>
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{translateNow("ui.status.154b66q")}</Text>
          <Text style={settingsStyles.rowHint}>
            {translateNow("ui.only.the.built.in.desktop.daemon.is.9kmfra")}
          </Text>
        </View>
        <View style={styles.statusValueGroup}>
          <Text style={styles.valueText}>{daemonStatusStateText}</Text>
          <Text style={styles.valueSubtext}>{daemonStatusDetailText}</Text>
        </View>
      </View>
      <View style={ROW_WITH_BORDER_STYLE}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {translateNow("ui.manage.built.in.daemon.1arvqut")}
          </Text>
          <Text style={settingsStyles.rowHint}>
            {translateNow("ui.let.doya.start.and.stop.the.built.1rj5o2r")}
          </Text>
        </View>
        <Switch
          value={!isDaemonManagementPaused}
          onValueChange={handleToggleDaemonManagement}
          disabled={isUpdatingDaemonManagement}
          accessibilityLabel={translateNow("ui.manage.built.in.daemon.1arvqut")}
        />
      </View>
      <View style={ROW_WITH_BORDER_STYLE}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {translateNow("ui.keep.daemon.running.after.quit.l9xbhx")}
          </Text>
          <Text style={settingsStyles.rowHint}>
            {translateNow("ui.daemon.keeps.running.when.you.quit.doya.1cyvilv")}
          </Text>
        </View>
        <Switch
          value={keepRunningAfterQuit}
          onValueChange={handleToggleKeepRunningAfterQuit}
          disabled={isUpdatingKeepRunningAfterQuit}
          accessibilityLabel={translateNow("ui.keep.daemon.running.after.quit.l9xbhx")}
        />
      </View>
      <View style={ROW_WITH_BORDER_STYLE}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{translateNow("ui.log.file.xeifi0")}</Text>
          <Text style={settingsStyles.rowHint}>
            {daemonLogs?.logPath ?? "Log path unavailable"}
          </Text>
        </View>
        <View style={styles.actionGroup}>
          {daemonLogs?.logPath ? (
            <Button variant="outline" size="sm" leftIcon={copyIcon} onPress={handleCopyLogPath}>
              {translateNow("ui.copy.path.1l2u0uo")}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            leftIcon={fileTextIcon}
            onPress={handleOpenLogs}
            disabled={!daemonLogs}
          >
            {translateNow("ui.open.logs.1lqzdlx")}
          </Button>
        </View>
      </View>
      <View style={ROW_WITH_BORDER_STYLE}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{translateNow("ui.full.status.9v381v")}</Text>
          <Text style={settingsStyles.rowHint}>
            {translateNow("ui.runs.doya.daemon.status.and.shows.the.1q0sf9x")}
          </Text>
        </View>
        <Button
          variant="outline"
          size="sm"
          leftIcon={activityIcon}
          onPress={handleRunCliStatus}
          disabled={isLoadingCliStatus}
        >
          {isLoadingCliStatus ? "Loading..." : "View status"}
        </Button>
      </View>
    </View>
  );
}

export function LocalDaemonSection() {
  const { theme } = useUnistyles();
  const showSection = shouldUseDesktopDaemon();
  const appVersion = resolveAppVersion();
  const { settings, updateSettings, isLoading: isLoadingSettings } = useDesktopSettings();
  const daemonSettings = settings.daemon;
  const updateDaemonSettings = useCallback(
    (updates: Partial<DesktopDaemonSettings>) => updateSettings({ daemon: updates }),
    [updateSettings],
  );
  const { data, isLoading, error: statusError, setStatus, refetch } = useDaemonStatus();

  const daemonStatus = data?.status ?? null;
  const daemonLogs = data?.logs ?? null;
  const daemonVersion = daemonStatus?.version ?? null;

  const daemonVersionMismatch = isVersionMismatch(appVersion, daemonVersion);
  const daemonStatusStateText =
    statusError ?? (daemonStatus?.status === "running" ? daemonStatus.status : "not running");
  const daemonStatusDetailText = `PID ${daemonStatus?.pid ? daemonStatus.pid : "—"}`;
  const isDaemonManagementPaused = !daemonSettings.manageBuiltInDaemon;

  const { isUpdating: isUpdatingDaemonManagement, toggle: handleToggleDaemonManagement } =
    useBuiltInDaemonManagement({
      daemonStatus,
      settings: daemonSettings,
      updateSettings: updateDaemonSettings,
      setStatus,
      refreshStatus: refetch,
    });
  const { isUpdatingKeepRunningAfterQuit, handleToggleKeepRunningAfterQuit } =
    useKeepRunningAfterQuitToggle({
      settings: daemonSettings,
      updateSettings: updateDaemonSettings,
    });

  const { isLogsModalOpen, handleCopyLogPath, handleOpenLogs, handleCloseLogsModal } =
    useDaemonLogsModal(daemonLogs);

  const {
    cliStatusOutput,
    isCliStatusModalOpen,
    isLoadingCliStatus,
    handleCopyCliStatus,
    handleOpenCliStatus,
    handleCloseCliStatusModal,
  } = useDaemonCliStatusModal();
  const handleRunCliStatus = useCallback(() => {
    void handleOpenCliStatus();
  }, [handleOpenCliStatus]);

  const handleOpenAdvancedSettings = useCallback(
    () => void openExternalUrl(ADVANCED_DAEMON_SETTINGS_URL),
    [],
  );

  const advancedSettingsIcon = useMemo(
    () => <ArrowUpRight size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />,
    [theme.iconSize.sm, theme.colors.foregroundMuted],
  );
  const copyIcon = useMemo(
    () => <Copy size={theme.iconSize.sm} color={theme.colors.foreground} />,
    [theme.iconSize.sm, theme.colors.foreground],
  );
  const fileTextIcon = useMemo(
    () => <FileText size={theme.iconSize.sm} color={theme.colors.foreground} />,
    [theme.iconSize.sm, theme.colors.foreground],
  );
  const activityIcon = useMemo(
    () => <Activity size={theme.iconSize.sm} color={theme.colors.foreground} />,
    [theme.iconSize.sm, theme.colors.foreground],
  );

  const advancedSettingsButton = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        leftIcon={advancedSettingsIcon}
        textStyle={settingsStyles.sectionHeaderLinkText}
        style={settingsStyles.sectionHeaderLink}
        onPress={handleOpenAdvancedSettings}
        accessibilityLabel={translateNow("ui.open.advanced.daemon.settings.4auzw7")}
      >
        {translateNow("ui.advanced.settings.6gdg01")}
      </Button>
    ),
    [advancedSettingsIcon, handleOpenAdvancedSettings],
  );

  if (!showSection) {
    return null;
  }

  return (
    <SettingsSection
      title={translateNow("ui.daemon.xq95lw")}
      trailing={advancedSettingsButton}
      testID="host-page-daemon-lifecycle-card"
    >
      {isLoading || isLoadingSettings ? (
        <View style={LOADING_CARD_STYLE}>
          <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
        </View>
      ) : (
        <>
          <DaemonInfoCard
            daemonStatusStateText={daemonStatusStateText}
            daemonStatusDetailText={daemonStatusDetailText}
            isDaemonManagementPaused={isDaemonManagementPaused}
            copyIcon={copyIcon}
            fileTextIcon={fileTextIcon}
            activityIcon={activityIcon}
            handleToggleDaemonManagement={handleToggleDaemonManagement}
            isUpdatingDaemonManagement={isUpdatingDaemonManagement}
            keepRunningAfterQuit={daemonSettings.keepRunningAfterQuit}
            handleToggleKeepRunningAfterQuit={handleToggleKeepRunningAfterQuit}
            isUpdatingKeepRunningAfterQuit={isUpdatingKeepRunningAfterQuit}
            daemonLogs={daemonLogs}
            handleCopyLogPath={handleCopyLogPath}
            handleOpenLogs={handleOpenLogs}
            handleRunCliStatus={handleRunCliStatus}
            isLoadingCliStatus={isLoadingCliStatus}
          />

          {daemonVersionMismatch ? (
            <View style={styles.warningCard}>
              <Text style={styles.warningText}>
                {
                  "App and daemon versions don't match. Update both to the same version for the best experience."
                }
              </Text>
            </View>
          ) : null}
        </>
      )}

      <DaemonLogsModal
        visible={isLogsModalOpen}
        onClose={handleCloseLogsModal}
        daemonLogs={daemonLogs}
      />

      <DaemonCliStatusModal
        visible={isCliStatusModalOpen}
        onClose={handleCloseCliStatusModal}
        cliStatusOutput={cliStatusOutput}
        onCopy={handleCopyCliStatus}
      />
    </SettingsSection>
  );
}

const ADVANCED_DAEMON_SETTINGS_URL = "https://doya.sh/docs/configuration";

const styles = StyleSheet.create((theme) => ({
  actionGroup: {
    flexDirection: "row",
    gap: theme.spacing[2],
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  loadingCard: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[6],
  },
  statusValueGroup: {
    alignItems: "flex-end",
    gap: 2,
  },
  valueText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  valueSubtext: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  warningCard: {
    marginTop: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.palette.amber[500],
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  warningText: {
    color: theme.colors.palette.amber[500],
    fontSize: theme.fontSize.xs,
  },
  modalBody: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  logOutput: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    lineHeight: 18,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));

const LOADING_CARD_STYLE = [settingsStyles.card, styles.loadingCard];
const ROW_WITH_BORDER_STYLE = [settingsStyles.row, settingsStyles.rowBorder];
const LOGS_MODAL_SNAP_POINTS = ["70%", "92%"];
const CLI_STATUS_MODAL_SNAP_POINTS = ["60%", "85%"];
const DAEMON_LOGS_HEADER: SheetHeader = { title: translateNow("ui.daemon.logs.10lycob") };
const DAEMON_STATUS_HEADER: SheetHeader = { title: translateNow("ui.daemon.status.p57sha") };

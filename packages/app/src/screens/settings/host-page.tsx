import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { SettingsTextAreaCard } from "@/components/settings-textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { LocalDaemonSection } from "@/desktop/components/desktop-updates-section";
import { PairDeviceModal } from "@/desktop/components/pair-device-modal";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import {
  getHostRuntimeStore,
  isHostRuntimeConnected,
  useHostMutations,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
  useHostRuntimeSnapshot,
  useHosts,
} from "@/runtime/host-runtime";
import { ProvidersSection } from "@/screens/settings/providers-section";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import type { HostConnection, HostProfile } from "@/types/host-connection";
import { confirmDialog } from "@/utils/confirm-dialog";
import { formatConnectionStatus, getConnectionStatusTone } from "@/utils/daemons";
import { formatLatency } from "@/utils/latency";
import { translateNow } from "@/i18n/i18n";
import { ChevronRight, Globe, Monitor, Pencil, RotateCw, Trash2 } from "@/components/icons/lucide";

const RESTART_CONFIRMATION_MESSAGE =
  "This will restart the daemon. Agents running on it will keep going; the app will reconnect automatically.";

function formatHostConnectionLabel(connection: HostConnection): string {
  if (connection.type === "relay") {
    return `Relay (${connection.relayEndpoint})`;
  }
  if (connection.type === "directSocket" || connection.type === "directPipe") {
    return `Local (${connection.path})`;
  }
  return `TCP (${connection.endpoint})`;
}

function formatActiveConnectionBadge(
  activeConnection: { type: HostConnection["type"]; display: string } | null,
  theme: ReturnType<typeof useUnistyles>["theme"],
): { icon: React.ReactNode; text: string } | null {
  if (!activeConnection) return null;
  if (activeConnection.type === "relay") {
    return {
      icon: <Globe size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />,
      text: translateNow("ui.relay.1axwtt"),
    };
  }
  if (activeConnection.type === "directSocket" || activeConnection.type === "directPipe") {
    return {
      icon: <Monitor size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />,
      text: translateNow("ui.local.17tcgb"),
    };
  }
  return {
    icon: <Monitor size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />,
    text: activeConnection.display,
  };
}

function formatDaemonVersionBadge(version: string | null): string | null {
  const trimmed = version?.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

const REMOVE_CONNECTION_HEADER: SheetHeader = {
  title: translateNow("ui.remove.connection.umljh6"),
};
const REMOVE_HOST_HEADER: SheetHeader = { title: translateNow("ui.remove.host.lrdtwk") };

function useHostProfile(serverId: string): HostProfile | null {
  const daemons = useHosts();
  return daemons.find((entry) => entry.serverId === serverId) ?? null;
}

function HostNotFound() {
  return (
    <View>
      <View style={EMPTY_CARD_STYLE}>
        <Text style={styles.emptyText}>{translateNow("ui.host.not.found.peumjh")}</Text>
      </View>
    </View>
  );
}

function HostStatusBadges({ serverId }: { serverId: string }) {
  const { theme } = useUnistyles();
  const snapshot = useHostRuntimeSnapshot(serverId);
  const daemonVersion = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.version ?? null,
  );

  const connectionStatus = snapshot?.connectionStatus ?? "connecting";
  const activeConnection = snapshot?.activeConnection ?? null;
  const statusLabel = formatConnectionStatus(connectionStatus);
  const statusTone = getConnectionStatusTone(connectionStatus);
  let statusColor: string;
  if (statusTone === "success") {
    statusColor = theme.colors.palette.green[400];
  } else if (statusTone === "warning") {
    statusColor = theme.colors.palette.amber[500];
  } else if (statusTone === "error") {
    statusColor = theme.colors.destructive;
  } else {
    statusColor = theme.colors.foregroundMuted;
  }
  let statusPillBg: string;
  if (statusTone === "success") {
    statusPillBg = "rgba(74, 222, 128, 0.1)";
  } else if (statusTone === "warning") {
    statusPillBg = "rgba(245, 158, 11, 0.1)";
  } else if (statusTone === "error") {
    statusPillBg = "rgba(248, 113, 113, 0.1)";
  } else {
    statusPillBg = "rgba(161, 161, 170, 0.1)";
  }
  const connectionBadge = formatActiveConnectionBadge(activeConnection, theme);
  const versionBadgeText = formatDaemonVersionBadge(daemonVersion);

  const statusPillStyle = useMemo(
    () => [styles.statusPill, { backgroundColor: statusPillBg }],
    [statusPillBg],
  );
  const statusDotStyle = useMemo(
    () => [styles.statusDot, { backgroundColor: statusColor }],
    [statusColor],
  );
  const statusTextStyle = useMemo(() => [styles.statusText, { color: statusColor }], [statusColor]);

  return (
    <View style={styles.identityBadges} testID="host-page-identity">
      <View style={statusPillStyle}>
        <View style={statusDotStyle} />
        <Text style={statusTextStyle}>{statusLabel}</Text>
      </View>
      {connectionBadge ? (
        <View style={styles.badgePill}>
          {connectionBadge.icon}
          <Text style={styles.badgeText} numberOfLines={1}>
            {connectionBadge.text}
          </Text>
        </View>
      ) : null}
      {versionBadgeText ? (
        <View style={styles.badgePill}>
          <Text style={styles.badgeText} numberOfLines={1}>
            {versionBadgeText}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function HostConnectionError({ serverId }: { serverId: string }) {
  const snapshot = useHostRuntimeSnapshot(serverId);
  const lastError = snapshot?.lastError ?? null;
  const connectionError =
    typeof lastError === "string" && lastError.trim().length > 0 ? lastError.trim() : null;
  if (!connectionError) return null;
  return <Text style={styles.errorText}>{connectionError}</Text>;
}

export function HostConnectionsPage({
  serverId,
  onAddHost,
}: {
  serverId: string;
  onAddHost?: () => void;
}) {
  const host = useHostProfile(serverId);
  const isLocalDaemon = useIsLocalDaemon(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      <HostConnectionError serverId={serverId} />
      <ConnectionsSection host={host} onAddHost={onAddHost} />
      {isLocalDaemon ? (
        <SettingsSection title={translateNow("ui.pair.devices.rppznb")}>
          <PairDeviceRow />
        </SettingsSection>
      ) : null}
    </View>
  );
}

export function HostOrchestrationPage({ serverId }: { serverId: string }) {
  const host = useHostProfile(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      {isConnected ? (
        <SettingsSection title={translateNow("ui.orchestration.1i7le75")}>
          <InjectDoyaToolsCard serverId={serverId} />
          <AppendSystemPromptCard serverId={serverId} />
        </SettingsSection>
      ) : (
        <View style={EMPTY_CARD_STYLE}>
          <Text style={styles.emptyText}>
            {translateNow("ui.connect.to.this.host.to.manage.orchestration.11czly")}
          </Text>
        </View>
      )}
    </View>
  );
}

export function HostProvidersPage({ serverId }: { serverId: string }) {
  const host = useHostProfile(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      <ProvidersSection serverId={serverId} />
    </View>
  );
}

export function HostDaemonPage({
  serverId,
  onHostRemoved,
}: {
  serverId: string;
  onHostRemoved?: () => void;
}) {
  const host = useHostProfile(serverId);
  const isLocalDaemon = useIsLocalDaemon(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      <View style={styles.daemonHeader}>
        <Text style={styles.daemonHeaderLabel} numberOfLines={1}>
          {host.label}
        </Text>
        <HostRenameButton host={host} />
      </View>

      <HostStatusBadges serverId={serverId} />

      {isLocalDaemon ? <LocalDaemonSection /> : null}

      <RemoveHostSection host={host} onRemoved={onHostRemoved} />
    </View>
  );
}

export function HostRenameButton({ host }: { host: HostProfile }) {
  const { theme } = useUnistyles();
  const { renameHost } = useHostMutations();
  const [isEditing, setIsEditing] = useState(false);

  const handleSubmit = useCallback(
    async (value: string) => {
      const nextLabel = value.trim();
      if (nextLabel === host.label.trim()) return;
      await renameHost(host.serverId, nextLabel);
    },
    [host.label, host.serverId, renameHost],
  );

  const openEditor = useCallback(() => setIsEditing(true), []);
  const closeEditor = useCallback(() => setIsEditing(false), []);

  return (
    <>
      <Pressable
        onPress={openEditor}
        hitSlop={8}
        style={styles.identityEditButton}
        accessibilityRole="button"
        accessibilityLabel={translateNow("ui.edit.label.14rpdvi")}
        testID="host-page-label-edit-button"
      >
        <Pencil size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
      </Pressable>

      <AdaptiveRenameModal
        visible={isEditing}
        title={translateNow("ui.rename.host.ohv222")}
        initialValue={host.label}
        placeholder={translateNow("ui.my.host.1fi50gs")}
        submitLabel={translateNow("ui.save.1j2ql")}
        onClose={closeEditor}
        onSubmit={handleSubmit}
        testID="host-page-rename-modal"
      />
    </>
  );
}

function ConnectionsSection({ host, onAddHost }: { host: HostProfile; onAddHost?: () => void }) {
  const { removeConnection } = useHostMutations();
  const snapshot = useHostRuntimeSnapshot(host.serverId);
  const probeByConnectionId = snapshot?.probeByConnectionId ?? new Map();
  const [pendingRemoveConnection, setPendingRemoveConnection] = useState<{
    connectionId: string;
    title: string;
  } | null>(null);
  const [isRemovingConnection, setIsRemovingConnection] = useState(false);

  const handleRequestRemove = useCallback((connection: HostConnection) => {
    setPendingRemoveConnection({
      connectionId: connection.id,
      title: formatHostConnectionLabel(connection),
    });
  }, []);

  const handleCloseConfirm = useCallback(() => {
    if (isRemovingConnection) return;
    setPendingRemoveConnection(null);
  }, [isRemovingConnection]);

  const handleCancelConfirm = useCallback(() => {
    setPendingRemoveConnection(null);
  }, []);

  const handleConfirmRemove = useCallback(() => {
    if (!pendingRemoveConnection) return;
    const { connectionId } = pendingRemoveConnection;
    setIsRemovingConnection(true);
    void removeConnection(host.serverId, connectionId)
      .then(() => setPendingRemoveConnection(null))
      .catch((error) => {
        console.error("[HostPage] Failed to remove connection", error);
        Alert.alert(
          translateNow("ui.error.1410q0"),
          translateNow("ui.unable.to.remove.connection.1351af6"),
        );
      })
      .finally(() => setIsRemovingConnection(false));
  }, [pendingRemoveConnection, removeConnection, host.serverId]);

  const addConnectionButton = useMemo(
    () => (onAddHost ? <AddHostHeaderButton onPress={onAddHost} /> : null),
    [onAddHost],
  );

  return (
    <SettingsSection title={translateNow("ui.connections.1k3sgfp")} trailing={addConnectionButton}>
      <View style={settingsStyles.card} testID="host-page-connections-card">
        {host.connections.map((conn, index) => {
          const probe = probeByConnectionId.get(conn.id);
          return (
            <ConnectionRow
              key={conn.id}
              connection={conn}
              showBorder={index > 0}
              latencyMs={probe?.status === "available" ? probe.latencyMs : undefined}
              latencyLoading={!probe || probe.status === "pending"}
              latencyError={probe?.status === "unavailable"}
              onRemove={handleRequestRemove}
            />
          );
        })}
      </View>

      {pendingRemoveConnection ? (
        <AdaptiveModalSheet
          header={REMOVE_CONNECTION_HEADER}
          visible
          onClose={handleCloseConfirm}
          testID="remove-connection-confirm-modal"
        >
          <Text style={styles.confirmText}>
            {translateNow("ui.remove.14f871g")}
            {pendingRemoveConnection.title}
            {translateNow("ui.this.cannot.be.undone.ka2hde")}
          </Text>
          <View style={styles.confirmActions}>
            <Button
              variant="secondary"
              size="sm"
              style={FLEX_1_STYLE}
              onPress={handleCancelConfirm}
              disabled={isRemovingConnection}
            >
              {translateNow("ui.cancel.x9d2fu")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              style={FLEX_1_STYLE}
              onPress={handleConfirmRemove}
              disabled={isRemovingConnection}
              testID="remove-connection-confirm"
            >
              {translateNow("ui.remove.14f871g")}
            </Button>
          </View>
        </AdaptiveModalSheet>
      ) : null}
    </SettingsSection>
  );
}

function AddHostHeaderButton({ onPress }: { onPress: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      textStyle={settingsStyles.sectionHeaderLinkText}
      style={settingsStyles.sectionHeaderLink}
      onPress={onPress}
    >
      {translateNow("settings.addHost")}
    </Button>
  );
}

function ConnectionRow({
  connection,
  showBorder,
  latencyMs,
  latencyLoading,
  latencyError,
  onRemove,
}: {
  connection: HostConnection;
  showBorder: boolean;
  latencyMs: number | null | undefined;
  latencyLoading: boolean;
  latencyError: boolean;
  onRemove: (connection: HostConnection) => void;
}) {
  const { theme } = useUnistyles();
  const title = formatHostConnectionLabel(connection);

  const latencyText = (() => {
    if (latencyLoading) return "...";
    if (latencyError) return "Timeout";
    if (latencyMs != null) return formatLatency(latencyMs);
    return "—";
  })();
  const latencyColor = latencyError ? theme.colors.palette.red[300] : theme.colors.foregroundMuted;

  const handlePressRemove = useCallback(() => {
    onRemove(connection);
  }, [onRemove, connection]);

  const rowStyle = useMemo(
    () => [settingsStyles.row, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );
  const latencyTextStyle = useMemo(
    () => [styles.connectionLatency, { color: latencyColor }],
    [latencyColor],
  );
  const destructiveTextStyle = useMemo(
    () => ({ color: theme.colors.destructive }),
    [theme.colors.destructive],
  );

  return (
    <View style={rowStyle}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <Text style={latencyTextStyle}>{latencyText}</Text>
      <Button
        variant="ghost"
        size="sm"
        textStyle={destructiveTextStyle}
        onPress={handlePressRemove}
      >
        {translateNow("ui.remove.14f871g")}
      </Button>
    </View>
  );
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function RestartDaemonCard({ host }: { host: HostProfile }) {
  const { theme } = useUnistyles();
  const daemonClient = useHostRuntimeClient(host.serverId);
  const isConnected = useHostRuntimeIsConnected(host.serverId);
  const runtime = getHostRuntimeStore();
  const [isRestarting, setIsRestarting] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const isHostConnected = useCallback(
    () => isHostRuntimeConnected(runtime.getSnapshot(host.serverId)),
    [host.serverId, runtime],
  );

  const waitForCondition = useCallback(
    async (predicate: () => boolean, timeoutMs: number, intervalMs = 250) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!isMountedRef.current) return false;
        if (predicate()) return true;
        await delay(intervalMs);
      }
      return predicate();
    },
    [],
  );

  const waitForDaemonRestart = useCallback(async () => {
    const disconnectTimeoutMs = 7000;
    const reconnectTimeoutMs = 30000;
    if (isHostConnected()) {
      await waitForCondition(() => !isHostConnected(), disconnectTimeoutMs);
    }
    const reconnected = await waitForCondition(() => isHostConnected(), reconnectTimeoutMs);
    if (isMountedRef.current) {
      setIsRestarting(false);
      if (!reconnected) {
        Alert.alert(
          translateNow("ui.unable.to.reconnect.m4pw7z"),
          `${host.label} did not come back online. Please verify it restarted.`,
        );
      }
    }
  }, [host.label, isHostConnected, waitForCondition]);

  const handleRestart = useCallback(() => {
    if (!daemonClient) {
      Alert.alert(
        translateNow("ui.host.unavailable.1h6vzzs"),
        translateNow("ui.this.host.is.not.connected.wait.for.5p5tv3"),
      );
      return;
    }
    if (!isHostConnected()) {
      Alert.alert(
        translateNow("ui.host.offline.j4wgi3"),
        translateNow("ui.this.host.is.offline.doya.reconnects.automatically.kn27va"),
      );
      return;
    }

    void confirmDialog({
      title: `Restart ${host.label}`,
      message: RESTART_CONFIRMATION_MESSAGE,
      confirmLabel: translateNow("ui.restart.19oinzj"),
      cancelLabel: translateNow("ui.cancel.x9d2fu"),
      destructive: true,
    })
      .then((confirmed) => {
        if (!confirmed) return;
        setIsRestarting(true);
        void daemonClient
          .restartServer(`settings_daemon_restart_${host.serverId}`)
          .catch((error) => {
            console.error(`[HostPage] Failed to restart daemon ${host.label}`, error);
            if (!isMountedRef.current) return;
            setIsRestarting(false);
            Alert.alert(
              translateNow("ui.error.1410q0"),
              translateNow("ui.failed.to.send.the.restart.request.doya.17n7sos"),
            );
          });
        void waitForDaemonRestart();
        return;
      })
      .catch((error) => {
        console.error(`[HostPage] Failed to open restart confirmation for ${host.label}`, error);
        Alert.alert(
          translateNow("ui.error.1410q0"),
          translateNow("ui.unable.to.open.the.restart.confirmation.dialog.8wa6s9"),
        );
      });
  }, [daemonClient, host.label, host.serverId, isHostConnected, waitForDaemonRestart]);

  const restartIcon = useMemo(
    () => <RotateCw size={theme.iconSize.sm} color={theme.colors.foreground} />,
    [theme.iconSize.sm, theme.colors.foreground],
  );

  return (
    <View style={settingsStyles.card} testID="host-page-restart-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{translateNow("ui.restart.daemon.nfiswl")}</Text>
          <Text style={settingsStyles.rowHint}>
            {translateNow("ui.restarts.the.daemon.process.the.app.will.1cntp62")}
          </Text>
        </View>
        <Button
          variant="outline"
          size="sm"
          leftIcon={restartIcon}
          onPress={handleRestart}
          disabled={isRestarting || !daemonClient || !isConnected}
          testID="host-page-restart-button"
        >
          {isRestarting ? "Restarting..." : "Restart"}
        </Button>
      </View>
    </View>
  );
}

function InjectDoyaToolsCard({ serverId }: { serverId: string }) {
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);

  const handleValueChange = useCallback(
    (next: boolean) => {
      void patchConfig({
        mcp: {
          injectIntoAgents: next,
        },
      });
    },
    [patchConfig],
  );

  if (!isConnected) return null;

  return (
    <View style={settingsStyles.card} testID="host-page-inject-mcp-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {translateNow("ui.enable.doya.tools.1erbjhm")}
          </Text>
          <Text style={settingsStyles.rowHint}>
            {translateNow("ui.agents.will.be.able.to.manage.worktrees.bnzb32")}
          </Text>
        </View>
        <Switch
          value={config?.mcp.injectIntoAgents !== false}
          onValueChange={handleValueChange}
          accessibilityLabel={translateNow("ui.inject.doya.tools.1l3ngc8")}
        />
      </View>
    </View>
  );
}

function AppendSystemPromptCard({ serverId }: { serverId: string }) {
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const persistedPrompt = config?.appendSystemPrompt ?? "";
  const [draft, setDraft] = useState(persistedPrompt);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const header = useMemo<SheetHeader>(
    () => ({ title: translateNow("ui.append.system.prompt.obrrbj") }),
    [],
  );

  useEffect(() => {
    setDraft(persistedPrompt);
  }, [persistedPrompt]);

  const hasChanges = draft !== persistedPrompt;

  const handleOpen = useCallback(() => {
    setDraft(persistedPrompt);
    setIsEditing(true);
  }, [persistedPrompt]);

  const handleClose = useCallback(() => {
    if (isSaving) return;
    setDraft(persistedPrompt);
    setIsEditing(false);
  }, [isSaving, persistedPrompt]);

  const handleSave = useCallback(() => {
    setIsSaving(true);
    void patchConfig({ appendSystemPrompt: draft })
      .then(() => {
        setIsEditing(false);
        return;
      })
      .catch((error) => {
        console.error("[HostPage] Failed to save append system prompt", error);
      })
      .finally(() => setIsSaving(false));
  }, [draft, patchConfig]);

  const handleReset = useCallback(() => {
    setDraft(persistedPrompt);
  }, [persistedPrompt]);

  if (!isConnected) return null;

  return (
    <>
      <View style={settingsStyles.card} testID="host-page-append-system-prompt-card">
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{translateNow("ui.system.prompt.1aj8itx")}</Text>
            <Text style={settingsStyles.rowHint}>
              {translateNow("ui.adds.a.system.prompt.to.all.agents.1l5aqd6")}
            </Text>
          </View>
          <Button
            variant="outline"
            size="sm"
            onPress={handleOpen}
            testID="host-page-append-system-prompt-edit"
          >
            {translateNow("ui.edit.1a6ui")}
          </Button>
        </View>
      </View>

      {isEditing ? (
        <AdaptiveModalSheet
          header={header}
          visible
          onClose={handleClose}
          testID="host-page-append-system-prompt-sheet"
          desktopMaxWidth={560}
        >
          <SettingsTextAreaCard
            testID="host-page-append-system-prompt-input"
            accessibilityLabel={translateNow("ui.append.system.prompt.obrrbj")}
            value={draft}
            onChangeText={setDraft}
            placeholder={translateNow("ui.always.keep.replies.concise.1j8wc7q")}
          />
          <View style={styles.appendPromptActions}>
            <Button
              variant="ghost"
              size="sm"
              onPress={handleReset}
              disabled={!hasChanges || isSaving}
              testID="host-page-append-system-prompt-reset"
            >
              {translateNow("ui.reset.1ay23z")}
            </Button>
            <Button
              variant="default"
              size="sm"
              onPress={handleSave}
              disabled={!hasChanges || isSaving}
              testID="host-page-append-system-prompt-save"
            >
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </View>
        </AdaptiveModalSheet>
      ) : null}
    </>
  );
}

function PairDeviceRow() {
  const { theme } = useUnistyles();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleOpen = useCallback(() => setIsModalOpen(true), []);
  const handleClose = useCallback(() => setIsModalOpen(false), []);

  return (
    <View style={settingsStyles.card}>
      <Pressable
        style={settingsStyles.row}
        onPress={handleOpen}
        accessibilityRole="button"
        testID="host-page-pair-device-row"
      >
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{translateNow("ui.pair.a.device.zgwqcb")}</Text>
          <Text style={settingsStyles.rowHint}>
            {translateNow("ui.scan.a.qr.code.or.copy.a.e77n3g")}
          </Text>
        </View>
        <ChevronRight size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
      </Pressable>

      <PairDeviceModal
        visible={isModalOpen}
        onClose={handleClose}
        testID="host-page-pair-device-card"
      />
    </View>
  );
}

function RemoveHostSection({ host, onRemoved }: { host: HostProfile; onRemoved?: () => void }) {
  const { theme } = useUnistyles();
  const { removeHost } = useHostMutations();
  const [isConfirming, setIsConfirming] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  const destructiveTextStyle = useMemo(
    () => ({ color: theme.colors.destructive }),
    [theme.colors.destructive],
  );

  const handleOpenConfirm = useCallback(() => setIsConfirming(true), []);
  const handleCloseConfirm = useCallback(() => {
    if (isRemoving) return;
    setIsConfirming(false);
  }, [isRemoving]);
  const handleCancel = useCallback(() => setIsConfirming(false), []);
  const handleConfirmRemove = useCallback(() => {
    setIsRemoving(true);
    void removeHost(host.serverId)
      .then(() => {
        setIsConfirming(false);
        onRemoved?.();
        return;
      })
      .catch((error) => {
        console.error("[HostPage] Failed to remove host", error);
        Alert.alert(
          translateNow("ui.error.1410q0"),
          translateNow("ui.unable.to.remove.host.1k0ppl8"),
        );
      })
      .finally(() => setIsRemoving(false));
  }, [host.serverId, onRemoved, removeHost]);

  const removeIcon = useMemo(
    () => <Trash2 size={theme.iconSize.sm} color={theme.colors.destructive} />,
    [theme.iconSize.sm, theme.colors.destructive],
  );

  return (
    <SettingsSection
      title={translateNow("ui.danger.zone.i0kcbt")}
      testID="host-page-remove-host-card"
    >
      <RestartDaemonCard host={host} />

      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{translateNow("ui.remove.host.lrdtwk")}</Text>
            <Text style={settingsStyles.rowHint}>
              {translateNow("ui.removes.this.host.and.its.saved.connections.1e4hvda")}
            </Text>
          </View>
          <Button
            variant="outline"
            size="sm"
            leftIcon={removeIcon}
            textStyle={destructiveTextStyle}
            onPress={handleOpenConfirm}
            testID="host-page-remove-host-button"
          >
            {translateNow("ui.remove.14f871g")}
          </Button>
        </View>
      </View>

      {isConfirming ? (
        <AdaptiveModalSheet
          header={REMOVE_HOST_HEADER}
          visible
          onClose={handleCloseConfirm}
          testID="remove-host-confirm-modal"
        >
          <Text style={styles.confirmText}>
            {translateNow("ui.remove.14f871g")}
            {host.label}
            {translateNow("ui.this.will.delete.its.saved.connections.16c0zqq")}
          </Text>
          <View style={styles.confirmActions}>
            <Button
              variant="secondary"
              size="sm"
              style={FLEX_1_STYLE}
              onPress={handleCancel}
              disabled={isRemoving}
            >
              {translateNow("ui.cancel.x9d2fu")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              style={FLEX_1_STYLE}
              onPress={handleConfirmRemove}
              disabled={isRemoving}
              testID="remove-host-confirm"
            >
              {translateNow("ui.remove.14f871g")}
            </Button>
          </View>
        </AdaptiveModalSheet>
      ) : null}
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  identityEditButton: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
  },
  daemonHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    marginBottom: theme.spacing[4],
  },
  daemonHeaderLabel: {
    flexShrink: 1,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  identityBadges: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexWrap: "wrap",
    marginBottom: theme.spacing[6],
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
  },
  statusText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
  },
  badgePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface3,
    maxWidth: 200,
  },
  badgeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
  },
  errorText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.xs,
    marginBottom: theme.spacing[2],
  },
  connectionLatency: {
    fontSize: theme.fontSize.sm,
    marginRight: theme.spacing[2],
  },
  confirmText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  confirmActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[4],
  },
  appendPromptActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  emptyCard: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));

const FLEX_1_STYLE = { flex: 1 };
const EMPTY_CARD_STYLE = [settingsStyles.card, styles.emptyCard];

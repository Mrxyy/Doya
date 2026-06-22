import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { Image, Pressable, ScrollView, Text, View, type DimensionValue } from "react-native";
import {
  Activity,
  Check,
  CreditCard,
  Cpu,
  HardDrive,
  Power,
  MemoryStick,
  Server,
  ShieldCheck,
  Users,
  Workflow,
} from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { loadAccountBootstrapSession, type AccountBootstrapSession } from "@/account/account-api";
import { BillingAdminPanel } from "@/app/admin/billing";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { AdminAccessGate } from "@/components/admin-access-gate";
import { AddHostMethodModal } from "@/components/add-host-method-modal";
import { AddHostModal } from "@/components/add-host-modal";
import { DraftAgentControls } from "@/composer/agent-controls";
import { buildDraftAgentControls } from "@/composer/draft/input-draft-core";
import { PairLinkModal } from "@/components/pair-link-modal";
import { SettingsTextAreaCard } from "@/components/settings-textarea";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import {
  cleanupControlDaemonSessions,
  getControlDaemonConfig,
  getControlAdminOverview,
  isControlApiConfigured,
  patchControlDaemonConfig,
  registerControlNode,
  removeControlDaemonNode,
  restartControlDaemonNode,
  updateControlDaemonNode,
  type ControlAdminOverview,
  type ControlAdminSessionSummary,
  type ControlDaemonConfig,
  type ControlDaemonConfigPatch,
  type ControlDaemonNodeRecord,
  type ControlDaemonNodeSummary,
  type ControlUserDaemonWorkspaceSummary,
  type RuntimeStatus,
} from "@/control/control-api";
import { getControlSessionDisplayTitle } from "@/control/control-session-display-title";
import { useToast } from "@/contexts/toast-context";
import { useAgentFormState, type FormInitialValues } from "@/hooks/use-agent-form-state";
import { useDraftAgentFeatures } from "@/hooks/use-draft-agent-features";
import { useI18n } from "@/i18n/i18n";
import {
  resolveEffectiveComposerModelId,
  resolveEffectiveComposerThinkingOptionId,
  type ProviderSelectionState,
} from "@/provider-selection/provider-selection";
import { useEnsureHostRuntimeStarted } from "@/runtime/host-runtime";
import { ProvidersSection } from "@/screens/settings/providers-section";
import type { HostProfile } from "@/types/host-connection";
import { confirmDialog } from "@/utils/confirm-dialog";

const RUNTIME_STATUSES: RuntimeStatus[] = ["starting", "running", "stopped", "lost"];
const EMPTY_SELECTED_SESSION_IDS: string[] = [];
type DaemonDetailTab = "overview" | "providers" | "workspaces";
type AdminConsoleTab = "daemons" | "billing";
type AdminIcon = ComponentType<{ size: number; color: string }>;
const DAEMON_ADMIN_LOGO_SOURCE = require("../../../assets/images/daemon-admin-logo.png");

export default function DaemonAdminScreen() {
  const { t } = useI18n();
  const toast = useToast();
  const [accountSession, setAccountSession] = useState<AccountBootstrapSession | null>(null);
  const [overview, setOverview] = useState<ControlAdminOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAddHostMethodVisible, setIsAddHostMethodVisible] = useState(false);
  const [isDirectHostVisible, setIsDirectHostVisible] = useState(false);
  const [isPasteLinkVisible, setIsPasteLinkVisible] = useState(false);
  const [isAccessUnlocked, setIsAccessUnlocked] = useState(false);
  const [selectedConsoleTab, setSelectedConsoleTab] = useState<AdminConsoleTab>("daemons");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedSessionIdsByNode, setSelectedSessionIdsByNode] = useState<
    Record<string, string[]>
  >({});

  const reload = useCallback(async () => {
    if (!isControlApiConfigured()) {
      setAccountSession(null);
      setOverview(null);
      setError(t("admin.daemons.error.notConfigured"));
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const stored = await loadAccountBootstrapSession();
      if (!stored || !stored.workspace.workspaceId.startsWith("control:")) {
        throw new Error(t("session.error.loginRequired"));
      }
      const nextOverview = await getControlAdminOverview({ accountSession: stored });
      setAccountSession(stored);
      setOverview(nextOverview);
      setSelectedNodeId((current) => {
        if (current && nextOverview.daemonNodes.some((summary) => summary.node.id === current)) {
          return current;
        }
        return nextOverview.daemonNodes[0]?.node.id ?? null;
      });
      setSelectedSessionIdsByNode((current) => pruneSelectedSessionIds(current, nextOverview));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!isAccessUnlocked) {
      return;
    }
    void reload();
  }, [isAccessUnlocked, reload]);

  const handleAccessUnlock = useCallback(() => {
    setIsAccessUnlocked(true);
  }, []);

  const closeAddConnectionFlow = useCallback(() => {
    setIsAddHostMethodVisible(false);
    setIsDirectHostVisible(false);
    setIsPasteLinkVisible(false);
  }, []);

  const goBackToAddConnectionMethods = useCallback(() => {
    setIsDirectHostVisible(false);
    setIsPasteLinkVisible(false);
    setIsAddHostMethodVisible(true);
  }, []);

  const handleAddDaemon = useCallback(() => {
    setIsAddHostMethodVisible(true);
  }, []);

  const handleSelectDirectConnection = useCallback(() => {
    setIsAddHostMethodVisible(false);
    setIsDirectHostVisible(true);
  }, []);

  const handleSelectPasteLink = useCallback(() => {
    setIsAddHostMethodVisible(false);
    setIsPasteLinkVisible(true);
  }, []);

  const handleScanQr = useCallback(() => {
    closeAddConnectionFlow();
    router.push({
      pathname: "/pair-scan",
      params: { source: "settings" },
    });
  }, [closeAddConnectionFlow]);

  const registerAddedHost = useCallback(
    async (profile: HostProfile, serverId: string) => {
      if (!accountSession) {
        return;
      }
      const directConnection = profile.connections.find(
        (connection) => connection.type === "directTcp",
      );
      if (!directConnection) {
        await reload();
        toast.show(t("admin.daemons.toast.added"));
        return;
      }
      setIsMutating(true);
      try {
        await registerControlNode({
          accountSession,
          nodeId: serverId,
          endpoint: directConnection.endpoint,
          runtimeAuthToken: directConnection.password ?? null,
          status: "online",
        });
        await reload();
        toast.show(t("admin.daemons.toast.added"));
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setIsMutating(false);
      }
    },
    [accountSession, reload, t, toast],
  );

  const handleHostAdded = useCallback(
    (result: { profile: HostProfile; serverId: string }) => {
      void registerAddedHost(result.profile, result.serverId);
    },
    [registerAddedHost],
  );

  const handleRetry = useCallback(() => {
    void reload();
  }, [reload]);

  const handleUpdateStatus = useCallback(
    async (targetNodeId: string, status: ControlDaemonNodeRecord["status"]) => {
      if (!accountSession) {
        return;
      }
      setIsMutating(true);
      try {
        await updateControlDaemonNode({ accountSession, nodeId: targetNodeId, status });
        await reload();
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setIsMutating(false);
      }
    },
    [accountSession, reload, toast],
  );

  const handleRemoveDaemon = useCallback(
    async (targetNodeId: string) => {
      if (!accountSession) {
        return;
      }
      const confirmed = await confirmDialog({
        title: t("admin.daemons.remove.title"),
        message: t("admin.daemons.remove.message"),
        confirmLabel: t("admin.daemons.action.remove"),
        cancelLabel: t("ui.cancel.x9d2fu"),
        destructive: true,
      });
      if (!confirmed) {
        return;
      }
      setIsMutating(true);
      try {
        await removeControlDaemonNode({ accountSession, nodeId: targetNodeId });
        await reload();
        toast.show(t("admin.daemons.toast.removed"));
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setIsMutating(false);
      }
    },
    [accountSession, reload, t, toast],
  );

  const handleRestartDaemon = useCallback(
    async (targetNodeId: string) => {
      if (!accountSession) {
        return;
      }
      const confirmed = await confirmDialog({
        title: t("admin.daemons.restart.title"),
        message: t("admin.daemons.restart.message"),
        confirmLabel: t("admin.daemons.action.restart"),
        cancelLabel: t("ui.cancel.x9d2fu"),
        destructive: true,
      });
      if (!confirmed) {
        return;
      }
      setIsMutating(true);
      try {
        await restartControlDaemonNode({ accountSession, nodeId: targetNodeId });
        await reload();
        toast.show(t("admin.daemons.toast.restartRequested"));
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setIsMutating(false);
      }
    },
    [accountSession, reload, t, toast],
  );

  const handleToggleSession = useCallback((targetNodeId: string, sessionId: string) => {
    setSelectedSessionIdsByNode((current) => {
      const currentIds = current[targetNodeId] ?? [];
      const nextIds = currentIds.includes(sessionId)
        ? currentIds.filter((id) => id !== sessionId)
        : [...currentIds, sessionId];
      return {
        ...current,
        [targetNodeId]: nextIds,
      };
    });
  }, []);

  const handleSelectNodeSessions = useCallback((targetNodeId: string, sessionIds: string[]) => {
    setSelectedSessionIdsByNode((current) => ({
      ...current,
      [targetNodeId]: sessionIds,
    }));
  }, []);

  const handleCleanupSessions = useCallback(
    async (targetNodeId: string) => {
      if (!accountSession) {
        return;
      }
      const sessionIds = selectedSessionIdsByNode[targetNodeId] ?? [];
      if (sessionIds.length === 0) {
        toast.error(t("admin.daemons.error.selectSession"));
        return;
      }
      if (!overview || !canCleanupSelectedWorkDirs(overview, targetNodeId, sessionIds)) {
        toast.error(t("admin.daemons.cleanup.workdirRequiresDeletedSession"));
        return;
      }
      setIsMutating(true);
      try {
        const cleanup = await cleanupControlDaemonSessions({
          accountSession,
          nodeId: targetNodeId,
          sessionIds,
          deleteSessions: true,
          deleteWorkDirs: true,
        });
        const cleanedSessionIds = cleanup.workDirCleanup.deleted.map((entry) => entry.sessionId);
        setOverview((current) =>
          current
            ? removeCleanedWorkDirSessionsFromOverview(current, targetNodeId, cleanedSessionIds)
            : current,
        );
        setSelectedSessionIdsByNode((current) => ({
          ...current,
          [targetNodeId]: (current[targetNodeId] ?? []).filter(
            (sessionId) => !cleanedSessionIds.includes(sessionId),
          ),
        }));
        if (cleanup.workDirCleanup.failed.length > 0) {
          toast.error(
            t("admin.daemons.toast.cleanupPartialFailed", {
              workdirs: cleanup.workDirCleanup.deleted.length,
              failed: cleanup.workDirCleanup.failed.length,
            }),
          );
          return;
        }
        toast.show(
          t("admin.daemons.toast.workdirsCleaned", { workdirs: cleanedSessionIds.length }),
        );
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setIsMutating(false);
      }
    },
    [accountSession, overview, selectedSessionIdsByNode, t, toast],
  );

  const selectedSummary = useMemo(
    () =>
      overview?.daemonNodes.find((summary) => summary.node.id === selectedNodeId) ??
      overview?.daemonNodes[0] ??
      null,
    [overview, selectedNodeId],
  );
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerSurface}>
          <View style={styles.headerBrand}>
            <Image source={DAEMON_ADMIN_LOGO_SOURCE} style={styles.headerLogo} resizeMode="cover" />
            <View style={styles.headerTitleBlock}>
              <Text style={styles.headerTitle}>{t("admin.daemons.title")}</Text>
            </View>
          </View>
          <View style={styles.headerDivider} />
          <AdminConsoleNav value={selectedConsoleTab} onChange={setSelectedConsoleTab} />
        </View>
      </View>
      <AdminAccessGate onUnlock={handleAccessUnlock}>
        <View style={styles.content}>
          {isLoading ? (
            <View style={styles.centered}>
              <LoadingSpinner size="large" color={styles.spinnerColor.color} />
            </View>
          ) : null}
          {!isLoading && error ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>{t("admin.daemons.unavailable")}</Text>
              <Text style={styles.muted}>{error}</Text>
              <Button variant="outline" size="sm" onPress={handleRetry}>
                {t("ui.retry.1ay360")}
              </Button>
            </View>
          ) : null}
          {!isLoading && selectedConsoleTab === "billing" ? (
            <View style={styles.billingPanel}>
              <BillingAdminPanel />
            </View>
          ) : null}
          {!isLoading && selectedConsoleTab === "daemons" && overview ? (
            overview.daemonNodes.length === 0 ? (
              <View style={styles.panel}>
                <Text style={styles.panelTitle}>{t("admin.daemons.empty.title")}</Text>
                <Text style={styles.muted}>{t("admin.daemons.empty.description")}</Text>
              </View>
            ) : (
              <View style={styles.workspaceShell}>
                <View style={styles.daemonListPane}>
                  <View style={styles.paneHeader}>
                    <View style={styles.sourceListTitleBlock}>
                      <Text style={styles.sourceListTitle}>
                        {t("admin.daemons.metric.daemons")}
                      </Text>
                    </View>
                    <Button
                      variant="secondary"
                      size="xs"
                      style={styles.addDaemonButton}
                      onPress={handleAddDaemon}
                      disabled={isMutating}
                    >
                      {t("admin.daemons.action.add")}
                    </Button>
                  </View>
                  <ScrollView
                    style={styles.daemonList}
                    contentContainerStyle={styles.daemonListContent}
                  >
                    {overview.daemonNodes.map((summary) => (
                      <DaemonListItem
                        key={summary.node.id}
                        summary={summary}
                        selected={selectedSummary?.node.id === summary.node.id}
                        onSelect={setSelectedNodeId}
                      />
                    ))}
                  </ScrollView>
                </View>
                {selectedSummary ? (
                  <DaemonCard
                    accountSession={accountSession}
                    summary={selectedSummary}
                    selectedSessionIds={
                      selectedSessionIdsByNode[selectedSummary.node.id] ??
                      EMPTY_SELECTED_SESSION_IDS
                    }
                    isMutating={isMutating}
                    onUpdateStatus={handleUpdateStatus}
                    onRestartDaemon={handleRestartDaemon}
                    onRemoveDaemon={handleRemoveDaemon}
                    onToggleSession={handleToggleSession}
                    onSelectNodeSessions={handleSelectNodeSessions}
                    onCleanupSessions={handleCleanupSessions}
                  />
                ) : null}
              </View>
            )
          ) : null}
        </View>
      </AdminAccessGate>
      <AddHostMethodModal
        visible={isAddHostMethodVisible}
        onClose={closeAddConnectionFlow}
        onDirectConnection={handleSelectDirectConnection}
        onPasteLink={handleSelectPasteLink}
        onScanQr={handleScanQr}
      />
      <AddHostModal
        visible={isDirectHostVisible}
        onClose={closeAddConnectionFlow}
        onCancel={goBackToAddConnectionMethods}
        onSaved={handleHostAdded}
      />
      <PairLinkModal
        visible={isPasteLinkVisible}
        onClose={closeAddConnectionFlow}
        onCancel={goBackToAddConnectionMethods}
        onSaved={handleHostAdded}
      />
    </View>
  );
}

function StatusDot({ status }: { status: ControlDaemonNodeRecord["status"] }) {
  if (status === "online") {
    return <View style={styles.statusDotOnline} />;
  }
  if (status === "draining") {
    return <View style={styles.statusDotDraining} />;
  }
  return <View style={styles.statusDotMuted} />;
}

function AdminConsoleNav({
  value,
  onChange,
}: {
  value: AdminConsoleTab;
  onChange: (value: AdminConsoleTab) => void;
}) {
  const { t } = useI18n();
  const items: Array<{
    value: AdminConsoleTab;
    label: string;
    icon: AdminIcon;
  }> = [
    { value: "daemons", label: t("admin.daemons.tabs.daemons"), icon: Server },
    { value: "billing", label: t("admin.daemons.tabs.billing"), icon: CreditCard },
  ];
  return (
    <View style={styles.consoleNav}>
      {items.map((item) => (
        <AdminConsoleNavItem
          key={item.value}
          item={item}
          selected={value === item.value}
          onChange={onChange}
        />
      ))}
    </View>
  );
}

function AdminConsoleNavItem({
  item,
  selected,
  onChange,
}: {
  item: { value: AdminConsoleTab; label: string; icon: AdminIcon };
  selected: boolean;
  onChange: (value: AdminConsoleTab) => void;
}) {
  const Icon = item.icon;
  const handlePress = useCallback(() => {
    onChange(item.value);
  }, [item.value, onChange]);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={handlePress}
      style={[styles.consoleNavItem, selected && styles.consoleNavItemSelected]}
    >
      <View style={[styles.consoleNavIcon, selected && styles.consoleNavIconSelected]}>
        <Icon
          size={18}
          color={
            selected ? styles.consoleNavIconSelectedColor.color : styles.consoleNavIconColor.color
          }
        />
      </View>
      <Text style={[styles.consoleNavText, selected && styles.consoleNavTextSelected]}>
        {item.label}
      </Text>
    </Pressable>
  );
}

function UsageBar({ value }: { value: number }) {
  const ratio = clamp01(value);
  const fillStyle = useMemo(
    () => ({ width: `${Math.round(ratio * 100)}%` as DimensionValue }),
    [ratio],
  );
  return (
    <View style={styles.usageTrack}>
      <View
        style={ratio > 0.9 ? [styles.usageFillHot, fillStyle] : [styles.usageFill, fillStyle]}
      />
    </View>
  );
}

function RuntimeDistribution({ counts }: { counts: Record<RuntimeStatus, number> }) {
  return (
    <View style={styles.runtimeChart}>
      <View style={styles.runtimeBar}>
        {RUNTIME_STATUSES.filter((status) => counts[status] > 0).map((status) => (
          <View
            key={status}
            style={[
              styles.runtimeSegment,
              runtimeSegmentStyle(status),
              {
                flexGrow: counts[status],
                flexBasis: 0,
              },
            ]}
          />
        ))}
      </View>
      <View style={styles.runtimeLegend}>
        {RUNTIME_STATUSES.map((status) => (
          <View key={status} style={styles.runtimeLegendItem}>
            <View style={[styles.runtimeLegendDot, runtimeSegmentStyle(status)]} />
            <Text style={styles.runtimeLegendText}>
              {status} {counts[status]}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ResourceRow({
  icon: Icon,
  label,
  value,
}: {
  icon: AdminIcon;
  label: string;
  value: number;
}) {
  return (
    <View style={styles.resourceRow}>
      <View style={styles.resourceLabel}>
        <Icon size={14} color={styles.iconColor.color} />
        <Text style={styles.runtimeLegendText}>{label}</Text>
      </View>
      <View style={styles.resourceMeter}>
        <UsageBar value={value} />
        <Text style={styles.resourceValue}>{formatRatio(value)}</Text>
      </View>
    </View>
  );
}

function DaemonListItem({
  summary,
  selected,
  onSelect,
}: {
  summary: ControlDaemonNodeSummary;
  selected: boolean;
  onSelect: (nodeId: string) => void;
}) {
  const { t } = useI18n();
  const memoryRatio = summary.load.status === "ok" ? summary.load.memory.usedRatio : 0;
  const diskRatio =
    summary.load.status === "ok" && summary.load.disk ? summary.load.disk.usedRatio : 0;
  const handlePress = useCallback(() => {
    onSelect(summary.node.id);
  }, [onSelect, summary.node.id]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={handlePress}
      style={selected ? styles.daemonListItemSelected : styles.daemonListItem}
    >
      <View style={styles.daemonListItemHeader}>
        <View style={styles.daemonListItemTitle}>
          <StatusDot status={summary.node.status} />
          <Text style={styles.daemonListItemName} numberOfLines={1}>
            {summary.node.id}
          </Text>
        </View>
      </View>
      <Text style={styles.muted} numberOfLines={1}>
        {summary.node.endpoint}
      </Text>
      <View style={styles.listUsageGrid}>
        <View style={styles.listUsageItem}>
          <View style={styles.listUsageLabel}>
            <MemoryStick size={12} color={styles.iconColor.color} />
            <Text style={styles.runtimeLegendText}>mem</Text>
          </View>
          <UsageBar value={memoryRatio} />
        </View>
        <View style={styles.listUsageItem}>
          <View style={styles.listUsageLabel}>
            <HardDrive size={12} color={styles.iconColor.color} />
            <Text style={styles.runtimeLegendText}>disk</Text>
          </View>
          <UsageBar value={diskRatio} />
        </View>
      </View>
      <View style={styles.daemonListItemStats}>
        <Text style={styles.statPill}>
          {t("admin.daemons.metric.sessions")} {summary.activeSessionCount}
        </Text>
        <Text style={styles.statPill}>
          {t("admin.daemons.metric.agents")} {summary.agentBindingCounts.active}
        </Text>
      </View>
    </Pressable>
  );
}

function DaemonCard({
  accountSession,
  summary,
  selectedSessionIds,
  isMutating,
  onUpdateStatus,
  onRestartDaemon,
  onRemoveDaemon,
  onToggleSession,
  onSelectNodeSessions,
  onCleanupSessions,
}: {
  accountSession: AccountBootstrapSession | null;
  summary: ControlDaemonNodeSummary;
  selectedSessionIds: string[];
  isMutating: boolean;
  onUpdateStatus: (nodeId: string, status: ControlDaemonNodeRecord["status"]) => Promise<void>;
  onRestartDaemon: (nodeId: string) => Promise<void>;
  onRemoveDaemon: (nodeId: string) => Promise<void>;
  onToggleSession: (nodeId: string, sessionId: string) => void;
  onSelectNodeSessions: (nodeId: string, sessionIds: string[]) => void;
  onCleanupSessions: (nodeId: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<DaemonDetailTab>("overview");
  const [daemonConfig, setDaemonConfig] = useState<ControlDaemonConfig | null>(null);
  const [isConfigLoading, setIsConfigLoading] = useState(false);
  const [isPromptEditing, setIsPromptEditing] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");
  const [isModelLockEditing, setIsModelLockEditing] = useState(false);
  useEnsureHostRuntimeStarted(
    activeTab === "providers" && summary.node.status !== "offline" ? summary.node.id : null,
  );
  useEnsureHostRuntimeStarted(
    isModelLockEditing && summary.node.status !== "offline" ? summary.node.id : null,
  );
  const activeAgents = summary.agentBindingCounts.active;
  const resourceStats = readResourceStats(summary.load);
  const persistedPrompt = daemonConfig?.appendSystemPrompt ?? "";
  const lockedProviderModel = daemonConfig?.agents?.lockedProviderModel ?? null;
  const isDoyaToolsEnabled = daemonConfig?.mcp.injectIntoAgents !== false;
  const promptHeader = useMemo<SheetHeader>(
    () => ({ title: t("admin.daemons.config.prompt.title") }),
    [t],
  );
  const modelLockHeader = useMemo<SheetHeader>(
    () => ({ title: t("admin.daemons.config.modelLock.title") }),
    [t],
  );
  const modelLockLabel = lockedProviderModel
    ? `${lockedProviderModel.provider}/${lockedProviderModel.model}`
    : t("admin.daemons.config.modelLock.empty");
  const modelLockInitialValues = useMemo<FormInitialValues>(
    () => ({
      serverId: summary.node.id,
      ...(lockedProviderModel?.provider ? { provider: lockedProviderModel.provider } : {}),
      ...(lockedProviderModel?.model ? { model: lockedProviderModel.model } : {}),
      ...(lockedProviderModel?.modeId ? { modeId: lockedProviderModel.modeId } : {}),
      ...(lockedProviderModel?.thinkingOptionId
        ? { thinkingOptionId: lockedProviderModel.thinkingOptionId }
        : {}),
    }),
    [
      lockedProviderModel?.modeId,
      lockedProviderModel?.model,
      lockedProviderModel?.provider,
      lockedProviderModel?.thinkingOptionId,
      summary.node.id,
    ],
  );
  const modelLockFormState = useAgentFormState({
    initialServerId: summary.node.id,
    initialValues: modelLockInitialValues,
    isVisible: isModelLockEditing,
    isCreateFlow: true,
    ignoreDaemonProviderModelLock: true,
  });
  const modelLockProviderSelection = useMemo<ProviderSelectionState>(
    () => ({
      provider: modelLockFormState.selectedProvider,
      modelId: modelLockFormState.selectedModel,
      modeId: modelLockFormState.selectedMode,
      thinkingOptionId: modelLockFormState.selectedThinkingOptionId,
      availableModels: modelLockFormState.availableModels,
      modeOptions: modelLockFormState.modeOptions,
    }),
    [
      modelLockFormState.availableModels,
      modelLockFormState.modeOptions,
      modelLockFormState.selectedMode,
      modelLockFormState.selectedModel,
      modelLockFormState.selectedProvider,
      modelLockFormState.selectedThinkingOptionId,
    ],
  );
  const modelLockEffectiveModelId = useMemo(
    () => resolveEffectiveComposerModelId(modelLockProviderSelection),
    [modelLockProviderSelection],
  );
  const modelLockEffectiveThinkingOptionId = useMemo(
    () =>
      resolveEffectiveComposerThinkingOptionId(
        modelLockProviderSelection,
        modelLockEffectiveModelId,
      ),
    [modelLockEffectiveModelId, modelLockProviderSelection],
  );
  const modelLockFeatureWorkingDir =
    summary.userWorkspaces[0]?.workspace.workspaceDir ?? summary.node.doyaHome ?? "";
  const {
    features: modelLockFeatures,
    featureValues: modelLockFeatureValues,
    setFeatureValue: setModelLockFeatureValue,
  } = useDraftAgentFeatures({
    serverId: summary.node.id,
    provider: modelLockFormState.selectedProvider,
    cwd: modelLockFeatureWorkingDir,
    modeId: modelLockFormState.selectedMode,
    modelId: modelLockEffectiveModelId,
    thinkingOptionId: modelLockEffectiveThinkingOptionId,
    initialFeatureValues: lockedProviderModel?.featureValues,
  });
  const modelLockControls = useMemo(
    () =>
      buildDraftAgentControls({
        formState: modelLockFormState,
        features: modelLockFeatures,
        onSetFeature: setModelLockFeatureValue,
      }),
    [modelLockFeatures, modelLockFormState, setModelLockFeatureValue],
  );
  const detailTabOptions = useMemo<SegmentedControlOption<DaemonDetailTab>[]>(
    () => [
      {
        value: "overview",
        label: t("admin.daemons.tabs.overview"),
        icon: ({ color, size }) => <Activity size={size} color={color} />,
      },
      {
        value: "providers",
        label: t("admin.daemons.tabs.providers"),
        icon: ({ color, size }) => <ShieldCheck size={size} color={color} />,
      },
      {
        value: "workspaces",
        label: t("admin.daemons.tabs.workspaces"),
        icon: ({ color, size }) => <Users size={size} color={color} />,
      },
    ],
    [t],
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const sessionIds = useMemo(
    () =>
      summary.userWorkspaces.flatMap((workspace) =>
        workspace.sessions.map((session) => session.session.id),
      ),
    [summary.userWorkspaces],
  );
  const selectedWorkspace = useMemo(
    () =>
      summary.userWorkspaces.find((workspace) => workspace.workspace.id === selectedWorkspaceId) ??
      summary.userWorkspaces[0] ??
      null,
    [selectedWorkspaceId, summary.userWorkspaces],
  );
  const selectedCount = selectedSessionIds.length;
  const canCleanupWorkDirs =
    selectedCount > 0 &&
    selectedSessionIds.every((sessionId) =>
      summary.userWorkspaces.some((workspace) =>
        workspace.sessions.some(
          (session) => session.session.id === sessionId && session.session.deletedAt,
        ),
      ),
    );

  useEffect(() => {
    setSelectedWorkspaceId((current) => {
      if (
        current &&
        summary.userWorkspaces.some((workspace) => workspace.workspace.id === current)
      ) {
        return current;
      }
      return summary.userWorkspaces[0]?.workspace.id ?? null;
    });
  }, [summary.userWorkspaces]);

  useEffect(() => {
    if (!accountSession) {
      setDaemonConfig(null);
      return;
    }
    let active = true;
    setIsConfigLoading(true);
    void getControlDaemonConfig({ accountSession, nodeId: summary.node.id })
      .then((config) => {
        if (active) {
          setDaemonConfig(config);
        }
      })
      .catch((caught) => {
        if (active) {
          toast.error(
            caught instanceof Error ? caught.message : t("admin.daemons.config.errorLoad"),
          );
        }
      })
      .finally(() => {
        if (active) {
          setIsConfigLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [accountSession, summary.node.id, t, toast]);

  useEffect(() => {
    setPromptDraft(persistedPrompt);
  }, [persistedPrompt]);

  const patchDaemonConfig = useCallback(
    async (patch: ControlDaemonConfigPatch): Promise<boolean> => {
      if (!accountSession) {
        return false;
      }
      setIsConfigLoading(true);
      try {
        const nextConfig = await patchControlDaemonConfig({
          accountSession,
          nodeId: summary.node.id,
          patch,
        });
        setDaemonConfig(nextConfig);
        toast.show(t("admin.daemons.config.toastSaved"));
        return true;
      } catch (caught) {
        toast.error(
          caught instanceof Error ? caught.message : t("admin.daemons.config.errorSave"),
        );
        return false;
      } finally {
        setIsConfigLoading(false);
      }
    },
    [accountSession, summary.node.id, t, toast],
  );

  const handleToggleDoyaTools = useCallback(
    (next: boolean) => {
      void patchDaemonConfig({
        mcp: {
          injectIntoAgents: next,
        },
      });
    },
    [patchDaemonConfig],
  );

  const handleOpenPrompt = useCallback(() => {
    setPromptDraft(persistedPrompt);
    setIsPromptEditing(true);
  }, [persistedPrompt]);

  const handleClosePrompt = useCallback(() => {
    if (isConfigLoading) {
      return;
    }
    setPromptDraft(persistedPrompt);
    setIsPromptEditing(false);
  }, [isConfigLoading, persistedPrompt]);

  const handleResetPrompt = useCallback(() => {
    setPromptDraft(persistedPrompt);
  }, [persistedPrompt]);

  const handleSavePrompt = useCallback(() => {
    void patchDaemonConfig({ appendSystemPrompt: promptDraft }).then((saved) => {
      if (saved) {
        setIsPromptEditing(false);
      }
    });
  }, [patchDaemonConfig, promptDraft]);

  const handleOpenModelLock = useCallback(() => {
    setIsModelLockEditing(true);
  }, []);

  const handleCloseModelLock = useCallback(() => {
    if (isConfigLoading) {
      return;
    }
    setIsModelLockEditing(false);
  }, [isConfigLoading]);

  const handleResetModelLockDraft = useCallback(() => {
    void patchDaemonConfig({
      agents: {
        lockedProviderModel: null,
      },
    }).then((saved) => {
      if (saved) {
        setIsModelLockEditing(false);
      }
    });
  }, [patchDaemonConfig]);

  const modelLockDraftChanged =
    modelLockFormState.selectedProvider !== (lockedProviderModel?.provider ?? null) ||
    modelLockEffectiveModelId !== (lockedProviderModel?.model ?? "") ||
    modelLockFormState.selectedMode !== (lockedProviderModel?.modeId ?? "") ||
    modelLockEffectiveThinkingOptionId !== (lockedProviderModel?.thinkingOptionId ?? "") ||
    JSON.stringify(modelLockFeatureValues ?? {}) !==
      JSON.stringify(lockedProviderModel?.featureValues ?? {});
  const modelLockDraftIsComplete =
    Boolean(modelLockFormState.selectedProvider) && modelLockEffectiveModelId.length > 0;

  const handleSaveModelLock = useCallback(() => {
    if (!modelLockFormState.selectedProvider || !modelLockEffectiveModelId) {
      return;
    }
    void patchDaemonConfig({
      agents: {
        lockedProviderModel: {
          provider: modelLockFormState.selectedProvider,
          model: modelLockEffectiveModelId,
          ...(modelLockFormState.selectedMode
            ? { modeId: modelLockFormState.selectedMode }
            : {}),
          ...(modelLockEffectiveThinkingOptionId
            ? { thinkingOptionId: modelLockEffectiveThinkingOptionId }
            : {}),
          ...(modelLockFeatureValues ? { featureValues: modelLockFeatureValues } : {}),
        },
      },
    }).then((saved) => {
      if (saved) {
        setIsModelLockEditing(false);
      }
    });
  }, [
    modelLockEffectiveModelId,
    modelLockEffectiveThinkingOptionId,
    modelLockFeatureValues,
    modelLockFormState.selectedMode,
    modelLockFormState.selectedProvider,
    patchDaemonConfig,
  ]);

  const handleDrain = useCallback(() => {
    void onUpdateStatus(summary.node.id, "draining");
  }, [onUpdateStatus, summary.node.id]);
  const handleMarkOnline = useCallback(() => {
    void onUpdateStatus(summary.node.id, "online");
  }, [onUpdateStatus, summary.node.id]);
  const handleMarkOffline = useCallback(() => {
    void onUpdateStatus(summary.node.id, "offline");
  }, [onUpdateStatus, summary.node.id]);
  const handleRemoveDaemon = useCallback(() => {
    void onRemoveDaemon(summary.node.id);
  }, [onRemoveDaemon, summary.node.id]);
  const handleRestartDaemon = useCallback(() => {
    void onRestartDaemon(summary.node.id);
  }, [onRestartDaemon, summary.node.id]);
  const handleSelectAll = useCallback(() => {
    onSelectNodeSessions(summary.node.id, sessionIds);
  }, [onSelectNodeSessions, sessionIds, summary.node.id]);
  const handleClearSelection = useCallback(() => {
    onSelectNodeSessions(summary.node.id, []);
  }, [onSelectNodeSessions, summary.node.id]);
  const handleCleanup = useCallback(() => {
    void onCleanupSessions(summary.node.id);
  }, [onCleanupSessions, summary.node.id]);

  return (
    <>
      <View style={styles.detailPanel}>
        <View style={styles.daemonHero}>
          <View style={styles.daemonHeroMain}>
            <View style={styles.daemonAvatar}>
              <Server size={20} color={styles.iconColor.color} />
            </View>
            <View style={styles.daemonTitleBlock}>
              <View style={styles.daemonTitleRow}>
                <Text style={styles.panelTitle} numberOfLines={1}>
                  {summary.node.id}
                </Text>
              </View>
              <Text style={styles.muted} numberOfLines={1}>
                {summary.node.endpoint}
              </Text>
              {summary.node.doyaHome ? (
                <Text style={styles.subtlePath} numberOfLines={1}>
                  {summary.node.doyaHome}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={styles.daemonHeroActions}>
            <View style={styles.statusBadge}>
              <StatusDot status={summary.node.status} />
              <Text style={styles.statusText}>{summary.node.status}</Text>
            </View>
            <Button variant="outline" size="sm" disabled={isMutating} onPress={handleRestartDaemon}>
              {t("admin.daemons.action.restart")}
            </Button>
          </View>
        </View>
        <View style={styles.topologyStrip}>
          <MetricTile
            label={t("admin.daemons.metric.sessions")}
            value={summary.activeSessionCount}
          />
          <MetricTile
            label={t("admin.daemons.metric.userWorkspaces")}
            value={summary.userWorkspaceCount}
          />
          <MetricTile label={t("admin.daemons.metric.agents")} value={activeAgents} />
          <MetricTile
            label={t("admin.daemons.metric.lastSeen")}
            value={formatTimestamp(summary.node.lastHeartbeatAt)}
          />
        </View>
        <SegmentedControl
          value={activeTab}
          options={detailTabOptions}
          onValueChange={setActiveTab}
          size="sm"
          style={styles.detailTabs}
        />
        <View style={styles.detailTabBody}>
          {activeTab === "overview" ? (
            <View style={styles.overviewTab}>
              <View style={styles.visualGrid}>
                <View style={styles.visualPanel}>
                  <View style={styles.visualHeader}>
                    <View style={styles.visualTitle}>
                      <Cpu size={16} color={styles.iconColor.color} />
                      <Text style={styles.sectionTitle}>{t("admin.daemons.metric.load")}</Text>
                    </View>
                    <Text style={styles.visualValue}>{resourceStats.cpuLabel}</Text>
                  </View>
                  <View style={styles.resourceBars}>
                    <ResourceRow
                      icon={MemoryStick}
                      label={t("admin.daemons.resource.memory")}
                      value={resourceStats.memoryRatio}
                    />
                    <ResourceRow
                      icon={HardDrive}
                      label={t("admin.daemons.resource.disk")}
                      value={resourceStats.diskRatio}
                    />
                  </View>
                </View>
                <View style={styles.visualPanel}>
                  <View style={styles.visualHeader}>
                    <View style={styles.visualTitle}>
                      <Activity size={16} color={styles.iconColor.color} />
                      <Text style={styles.sectionTitle}>{t("admin.daemons.metric.runtimes")}</Text>
                    </View>
                    <Text style={styles.visualValue}>{summary.runtimeCounts.running}</Text>
                  </View>
                  <RuntimeDistribution counts={summary.runtimeCounts} />
                </View>
              </View>
              <View style={styles.controlDock}>
                <View style={styles.controlDockGroup}>
                  <View style={styles.controlDockTitle}>
                    <Workflow size={15} color={styles.iconColor.color} />
                    <Text style={styles.sectionTitle}>{t("admin.daemons.scheduling.title")}</Text>
                  </View>
                  <View style={styles.compactActions}>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isMutating || summary.node.status === "draining"}
                      onPress={handleDrain}
                    >
                      {t("admin.daemons.action.drain")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isMutating || summary.node.status === "online"}
                      onPress={handleMarkOnline}
                    >
                      {t("admin.daemons.action.online")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isMutating || summary.node.status === "offline"}
                      onPress={handleMarkOffline}
                    >
                      {t("admin.daemons.action.offline")}
                    </Button>
                  </View>
                </View>
                <View style={styles.controlDockGroup}>
                  <View style={styles.controlDockTitle}>
                    <ShieldCheck size={15} color={styles.iconColor.color} />
                    <Text style={styles.sectionTitle}>{t("admin.daemons.config.title")}</Text>
                  </View>
                  <View style={styles.configRows}>
                    <View style={styles.configRow}>
                      <View style={styles.configRowContent}>
                        <Text style={styles.configRowTitle}>
                          {t("admin.daemons.config.tools.title")}
                        </Text>
                        <Text style={styles.muted}>{t("admin.daemons.config.tools.hint")}</Text>
                      </View>
                      <Switch
                        value={isDoyaToolsEnabled}
                        onValueChange={handleToggleDoyaTools}
                        disabled={isMutating || isConfigLoading || !daemonConfig}
                        accessibilityLabel={t("admin.daemons.config.tools.title")}
                      />
                    </View>
                    <View style={styles.configRow}>
                      <View style={styles.configRowContent}>
                        <Text style={styles.configRowTitle}>
                          {t("admin.daemons.config.prompt.title")}
                        </Text>
                        <Text style={styles.muted}>
                          {persistedPrompt
                            ? t("admin.daemons.config.prompt.configured")
                            : t("admin.daemons.config.prompt.empty")}
                        </Text>
                      </View>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isMutating || isConfigLoading || !daemonConfig}
                        onPress={handleOpenPrompt}
                      >
                        {t("ui.edit.1a6ui")}
                      </Button>
                    </View>
                    <View style={styles.configRow}>
                      <View style={styles.configRowContent}>
                        <Text style={styles.configRowTitle}>
                          {t("admin.daemons.config.modelLock.title")}
                        </Text>
                        <Text style={styles.muted} numberOfLines={1}>
                          {modelLockLabel}
                        </Text>
                      </View>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isMutating || isConfigLoading || !daemonConfig}
                        onPress={handleOpenModelLock}
                      >
                        {t("ui.edit.1a6ui")}
                      </Button>
                    </View>
                  </View>
                </View>
              </View>
              <View style={styles.dangerDock}>
                <View style={styles.controlDockTitle}>
                  <Power size={15} color={styles.dangerText.color} />
                  <Text style={styles.dangerText}>{t("admin.daemons.danger.title")}</Text>
                </View>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isMutating}
                  onPress={handleRemoveDaemon}
                >
                  {t("admin.daemons.action.remove")}
                </Button>
              </View>
            </View>
          ) : null}
          {activeTab === "providers" ? (
            <View style={styles.providerDock}>
              <ProvidersSection serverId={summary.node.id} />
            </View>
          ) : null}
          {activeTab === "workspaces" ? (
            <View style={styles.workspaceList}>
              <View style={styles.workspaceToolbar}>
                <View style={styles.workspaceToolbarTitle}>
                  <Text style={styles.sectionTitle}>{t("admin.daemons.workspaces.title")}</Text>
                  <View style={styles.selectionBadge}>
                    <Text style={styles.selectionBadgeText}>
                      {t("admin.daemons.selection.count", { count: selectedCount })}
                    </Text>
                  </View>
                </View>
                <View style={styles.actions}>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={isMutating || sessionIds.length === 0}
                    onPress={handleSelectAll}
                  >
                    {t("admin.daemons.action.selectAll")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={isMutating || selectedCount === 0}
                    onPress={handleClearSelection}
                  >
                    {t("admin.daemons.action.clear")}
                  </Button>
                  <Button
                    variant="destructive"
                    size="xs"
                    disabled={isMutating || !canCleanupWorkDirs}
                    onPress={handleCleanup}
                  >
                    {t("admin.daemons.action.cleanup")}
                  </Button>
                </View>
              </View>
              {selectedCount > 0 && !canCleanupWorkDirs ? (
                <Text style={styles.cleanupHint}>
                  {t("admin.daemons.cleanup.workdirRequiresDeletedSession")}
                </Text>
              ) : null}
              {summary.userWorkspaces.length > 0 && selectedWorkspace ? (
                <View style={styles.workspaceSplit}>
                  <View style={styles.workspaceIndex}>
                    {summary.userWorkspaces.map((workspace) => (
                      <WorkspaceListItem
                        key={workspace.workspace.id}
                        workspace={workspace}
                        selected={selectedWorkspace.workspace.id === workspace.workspace.id}
                        selectedSessionIds={selectedSessionIds}
                        onSelect={setSelectedWorkspaceId}
                      />
                    ))}
                  </View>
                  <WorkspaceSessionPanel
                    nodeId={summary.node.id}
                    workspace={selectedWorkspace}
                    selectedSessionIds={selectedSessionIds}
                    onToggleSession={onToggleSession}
                  />
                </View>
              ) : null}
              {summary.userWorkspaces.length === 0 ? (
                <Text style={styles.muted}>{t("admin.daemons.workspaces.empty")}</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
      {isPromptEditing ? (
        <AdaptiveModalSheet
          header={promptHeader}
          visible
          onClose={handleClosePrompt}
          desktopMaxWidth={560}
        >
          <SettingsTextAreaCard
            accessibilityLabel={t("admin.daemons.config.prompt.title")}
            value={promptDraft}
            onChangeText={setPromptDraft}
            placeholder={t("admin.daemons.config.prompt.placeholder")}
          />
          <View style={styles.promptActions}>
            <Button
              variant="ghost"
              size="sm"
              disabled={isConfigLoading || promptDraft === persistedPrompt}
              onPress={handleResetPrompt}
            >
              {t("ui.reset.1ay23z")}
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={isConfigLoading || promptDraft === persistedPrompt}
              onPress={handleSavePrompt}
            >
              {t("ui.save.1j2ql")}
            </Button>
          </View>
        </AdaptiveModalSheet>
      ) : null}
      {isModelLockEditing ? (
        <AdaptiveModalSheet
          header={modelLockHeader}
          visible
          onClose={handleCloseModelLock}
          desktopMaxWidth={560}
        >
          <View style={styles.modelLockFields}>
            <DraftAgentControls {...modelLockControls} />
            <Text style={styles.muted}>{t("admin.daemons.config.modelLock.hint")}</Text>
          </View>
          <View style={styles.promptActions}>
            <Button
              variant="ghost"
              size="sm"
              disabled={isConfigLoading || !lockedProviderModel}
              onPress={handleResetModelLockDraft}
            >
              {t("ui.reset.1ay23z")}
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={
                isConfigLoading ||
                !modelLockDraftChanged ||
                !modelLockDraftIsComplete
              }
              onPress={handleSaveModelLock}
            >
              {t("ui.save.1j2ql")}
            </Button>
          </View>
        </AdaptiveModalSheet>
      ) : null}
    </>
  );
}

function WorkspaceListItem({
  workspace,
  selected,
  selectedSessionIds,
  onSelect,
}: {
  workspace: ControlUserDaemonWorkspaceSummary;
  selected: boolean;
  selectedSessionIds: string[];
  onSelect: (workspaceId: string) => void;
}) {
  const { t } = useI18n();
  const selectedCount = workspace.sessions.filter((session) =>
    selectedSessionIds.includes(session.session.id),
  ).length;
  const workspaceTitle = getWorkspaceDisplayName(workspace, t);
  const handlePress = useCallback(() => {
    onSelect(workspace.workspace.id);
  }, [onSelect, workspace.workspace.id]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={selected ? styles.workspaceIndexItemSelected : styles.workspaceIndexItem}
      onPress={handlePress}
    >
      <View style={styles.workspaceHeader}>
        <View style={styles.workspaceIdentity}>
          <View style={styles.workspaceAvatar}>
            <Users size={14} color={styles.iconColor.color} />
          </View>
          <View style={styles.workspaceNameBlock}>
            <Text style={styles.workspaceTitle} numberOfLines={1}>
              {workspaceTitle}
            </Text>
            <Text style={styles.workspaceSessionPath} numberOfLines={1}>
              {formatPathTail(workspace.workspace.workspaceDir)}
            </Text>
          </View>
        </View>
        <View style={styles.workspaceMeta}>
          <Text style={styles.workspaceCount}>
            {selectedCount}/{workspace.sessions.length}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function WorkspaceSessionPanel({
  nodeId,
  workspace,
  selectedSessionIds,
  onToggleSession,
}: {
  nodeId: string;
  workspace: ControlUserDaemonWorkspaceSummary;
  selectedSessionIds: string[];
  onToggleSession: (nodeId: string, sessionId: string) => void;
}) {
  const { t } = useI18n();
  const userState = getWorkspaceUserState(workspace);
  const workspaceTitle = getWorkspaceDisplayName(workspace, t);
  return (
    <View style={styles.workspaceSessionPanel}>
      <View style={styles.workspaceSessionHeader}>
        <View style={styles.workspaceSessionTitleGroup}>
          <Text style={styles.workspaceTitle} numberOfLines={1}>
            {workspaceTitle}
          </Text>
          <Text style={styles.workspaceSessionPath} numberOfLines={1}>
            {formatPathTail(workspace.workspace.workspaceDir)}
          </Text>
        </View>
        <View style={styles.workspaceStatusGroup}>
          <View style={userState === "deleted" ? styles.deletedBadge : styles.compactBadge}>
            <Text style={userState === "deleted" ? styles.deletedBadgeText : styles.badgeText}>
              {t(getWorkspaceUserStateTranslationKey(userState))}
            </Text>
          </View>
          <View style={styles.compactBadge}>
            <Text style={styles.badgeText}>
              {t("admin.daemons.workspace.status", { status: workspace.workspace.status })}
            </Text>
          </View>
        </View>
      </View>
      <View style={styles.sessionCanvas}>
        <ScrollView style={styles.sessionRows} contentContainerStyle={styles.sessionRowsContent}>
          {workspace.sessions.map((session) => (
            <SessionRow
              key={session.session.id}
              nodeId={nodeId}
              summary={session}
              selected={selectedSessionIds.includes(session.session.id)}
              onToggleSession={onToggleSession}
            />
          ))}
        </ScrollView>
        {workspace.sessions.length === 0 ? (
          <View style={styles.emptySessionStrip}>
            <Activity size={14} color={styles.iconColor.color} />
            <Text style={styles.muted}>{t("admin.daemons.sessions.empty")}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function SessionRow({
  nodeId,
  summary,
  selected,
  onToggleSession,
}: {
  nodeId: string;
  summary: ControlAdminSessionSummary;
  selected: boolean;
  onToggleSession: (nodeId: string, sessionId: string) => void;
}) {
  const { t } = useI18n();
  const sessionTitle = getControlSessionDisplayTitle({ session: summary.session });
  const sessionMeta = `${formatTimestamp(summary.session.updatedAt)} · ${formatShortId(
    summary.session.id,
  )}`;
  const handlePress = useCallback(() => {
    onToggleSession(nodeId, summary.session.id);
  }, [nodeId, onToggleSession, summary.session.id]);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      style={selected ? styles.sessionRowSelected : styles.sessionRow}
      onPress={handlePress}
    >
      <View style={styles.sessionSelectColumn}>
        <View style={selected ? styles.sessionCheckSelected : styles.sessionCheck}>
          {selected ? <Check size={12} color={styles.badgeText.color} /> : null}
        </View>
      </View>
      <View style={styles.sessionMainColumn}>
        <View style={styles.sessionTitleLine}>
          <View style={sessionStatusDotStyle(summary.session.status)} />
          <Text style={styles.sessionTitle} numberOfLines={1}>
            {sessionTitle}
          </Text>
        </View>
        <Text style={styles.sessionMeta} numberOfLines={1}>
          {sessionMeta}
        </Text>
      </View>
      <View style={styles.sessionPills}>
        {summary.session.deletedAt ? (
          <View style={styles.deletedBadge}>
            <Text style={styles.deletedBadgeText}>{t("admin.daemons.session.deleted")}</Text>
          </View>
        ) : null}
        <View style={styles.sessionPill}>
          <Text style={styles.sessionStatusText}>{summary.session.status}</Text>
        </View>
        <View style={styles.sessionPill}>
          <Text style={styles.sessionStatusText}>rt {summary.runtimeAllocations.length}</Text>
        </View>
        <View style={styles.sessionPill}>
          <Text style={styles.sessionStatusText}>agent {summary.agentBindings.length}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function MetricTile({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.metricTile}>
      <Text style={styles.metricTileValue} numberOfLines={1}>
        {String(value)}
      </Text>
      <Text style={styles.metricTileLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function readResourceStats(load: ControlDaemonNodeSummary["load"]): {
  cpuLabel: string;
  memoryRatio: number;
  diskRatio: number;
} {
  if (load.status === "unavailable") {
    return { cpuLabel: "n/a", memoryRatio: 0, diskRatio: 0 };
  }
  return {
    cpuLabel: load.cpu.loadAverage[0]?.toFixed(2) ?? "0.00",
    memoryRatio: load.memory.usedRatio,
    diskRatio: load.disk?.usedRatio ?? 0,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function runtimeSegmentStyle(status: RuntimeStatus) {
  if (status === "running") {
    return styles.runtimeSegmentRunning;
  }
  if (status === "starting") {
    return styles.runtimeSegmentStarting;
  }
  if (status === "lost") {
    return styles.runtimeSegmentLost;
  }
  return styles.runtimeSegmentStopped;
}

function sessionStatusDotStyle(status: ControlAdminSessionSummary["session"]["status"]) {
  if (status === "running") {
    return styles.sessionDotRunning;
  }
  if (status === "error") {
    return styles.sessionDotError;
  }
  if (status === "done") {
    return styles.sessionDotDone;
  }
  return styles.sessionDotIdle;
}

function formatRatio(value: number): string {
  return `${Math.round(clamp01(value) * 100)}%`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatShortId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 14) {
    return trimmed;
  }
  const prefix = trimmed.includes("_") ? `${trimmed.split("_")[0]}_` : "";
  return `${prefix}...${trimmed.slice(-8)}`;
}

function formatPathTail(value: string): string {
  const parts = value.split("/").filter(Boolean);
  if (parts.length === 0) {
    return value;
  }
  return parts.slice(-2).join("/");
}

function getWorkspaceDisplayName(
  workspace: ControlUserDaemonWorkspaceSummary,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (workspace.user?.email) {
    return workspace.user.email;
  }
  if (!workspace.user) {
    return t("admin.daemons.userStatus.deleted");
  }
  return formatShortId(workspace.workspace.userId);
}

type WorkspaceUserState = "active" | "disabled" | "deleted";

function getWorkspaceUserState(workspace: ControlUserDaemonWorkspaceSummary): WorkspaceUserState {
  if (!workspace.user) {
    return "deleted";
  }
  if (workspace.user.disabledAt) {
    return "disabled";
  }
  return "active";
}

function getWorkspaceUserStateTranslationKey(
  state: WorkspaceUserState,
):
  | "admin.daemons.userStatus.deleted"
  | "admin.daemons.userStatus.disabled"
  | "admin.daemons.userStatus.active" {
  if (state === "deleted") {
    return "admin.daemons.userStatus.deleted";
  }
  if (state === "disabled") {
    return "admin.daemons.userStatus.disabled";
  }
  return "admin.daemons.userStatus.active";
}

function canCleanupSelectedWorkDirs(
  overview: ControlAdminOverview,
  nodeId: string,
  sessionIds: string[],
): boolean {
  if (sessionIds.length === 0) {
    return false;
  }
  const node = overview.daemonNodes.find((summary) => summary.node.id === nodeId);
  if (!node) {
    return false;
  }
  return sessionIds.every((sessionId) =>
    node.userWorkspaces.some((workspace) =>
      workspace.sessions.some(
        (session) => session.session.id === sessionId && session.session.deletedAt,
      ),
    ),
  );
}

function removeCleanedWorkDirSessionsFromOverview(
  overview: ControlAdminOverview,
  nodeId: string,
  sessionIds: string[],
): ControlAdminOverview {
  if (sessionIds.length === 0) {
    return overview;
  }
  const cleanedSessionIds = new Set(sessionIds);
  return {
    ...overview,
    daemonNodes: overview.daemonNodes.map((summary) => {
      if (summary.node.id !== nodeId) {
        return summary;
      }
      return {
        ...summary,
        userWorkspaces: summary.userWorkspaces.map((workspace) => ({
          ...workspace,
          sessions: workspace.sessions.filter(
            (session) => !cleanedSessionIds.has(session.session.id),
          ),
        })),
      };
    }),
  };
}

function pruneSelectedSessionIds(
  current: Record<string, string[]>,
  overview: ControlAdminOverview,
): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const summary of overview.daemonNodes) {
    const availableSessionIds = new Set(
      summary.userWorkspaces.flatMap((workspace) =>
        workspace.sessions.map((session) => session.session.id),
      ),
    );
    const selected = (current[summary.node.id] ?? []).filter((id) => availableSessionIds.has(id));
    if (selected.length > 0) {
      next[summary.node.id] = selected;
    }
  }
  return next;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f7",
    overflow: "hidden",
  },
  header: {
    minHeight: 86,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    borderBottomWidth: 1,
    borderBottomColor: "#e8eaee",
    backgroundColor: "#f7f8fa",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
  headerSurface: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    borderWidth: 1,
    borderColor: "#e2e6eb",
    borderRadius: 18,
    backgroundColor: "#ffffff",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
  },
  headerBrand: {
    minWidth: 0,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  headerLogo: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e7ecef",
  },
  headerTitleBlock: {
    minWidth: 0,
    paddingRight: theme.spacing[1],
  },
  headerTitle: {
    flexShrink: 1,
    color: "#18181b",
    fontSize: 20,
    fontWeight: theme.fontWeight.semibold,
  },
  headerDivider: {
    width: 1,
    height: 28,
    backgroundColor: "#e6e8ec",
  },
  content: {
    flex: 1,
    width: "100%",
    alignSelf: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[3],
    minHeight: 0,
    overflow: "hidden",
  },
  consoleNav: {
    flexDirection: "row",
    flexShrink: 0,
    alignItems: "center",
    gap: 3,
    borderRadius: 14,
    backgroundColor: "#f4f6f8",
    padding: 3,
  },
  consoleNavItem: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 11,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
  },
  consoleNavItemSelected: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#bfe8cf",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
  },
  consoleNavIcon: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "transparent",
  },
  consoleNavIconSelected: {
    backgroundColor: "#daf6e4",
  },
  consoleNavIconColor: {
    color: theme.colors.foregroundMuted,
  },
  consoleNavIconSelectedColor: {
    color: "#1f7a4d",
  },
  consoleNavText: {
    color: "#6b7280",
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  consoleNavTextSelected: {
    color: "#1f5135",
    fontWeight: theme.fontWeight.semibold,
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[8],
  },
  panel: {
    gap: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    padding: theme.spacing[4],
  },
  billingPanel: {
    flex: 1,
    minHeight: 0,
    gap: theme.spacing[3],
  },
  addDaemonButton: {
    alignSelf: "center",
  },
  workspaceShell: {
    flex: 1,
    minHeight: 0,
    flexDirection: "row",
    alignItems: "stretch",
    gap: theme.spacing[3],
    overflow: "hidden",
  },
  daemonListPane: {
    width: 360,
    maxWidth: "100%",
    alignSelf: "stretch",
    gap: theme.spacing[3],
    borderWidth: 1,
    borderColor: "#e6e7eb",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: "#ffffff",
    padding: theme.spacing[3],
    elevation: 4,
  },
  paneHeader: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  sourceListTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
  },
  sourceListTitleBlock: {
    minWidth: 0,
    flex: 1,
  },
  daemonList: {
    flex: 1,
    minHeight: 0,
  },
  daemonListContent: {
    gap: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  daemonListItem: {
    gap: theme.spacing[2],
    borderWidth: 1,
    borderColor: "#edf0f4",
    borderRadius: theme.borderRadius.md,
    backgroundColor: "#ffffff",
    padding: theme.spacing[3],
  },
  daemonListItemSelected: {
    gap: theme.spacing[2],
    borderWidth: 1,
    borderColor: "#c7d7ff",
    borderRadius: theme.borderRadius.md,
    backgroundColor: "#f2f6ff",
    padding: theme.spacing[3],
  },
  daemonListItemHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  daemonListItemTitle: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  daemonListItemName: {
    minWidth: 0,
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    lineHeight: 20,
  },
  daemonListItemStats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    paddingTop: theme.spacing[1],
  },
  listUsageGrid: {
    gap: theme.spacing[1],
  },
  listUsageItem: {
    gap: 2,
  },
  listUsageLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  statPill: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: "#eef0f4",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    lineHeight: 14,
  },
  statusDotOnline: {
    width: 8,
    height: 8,
    borderRadius: 8,
    backgroundColor: "#30d158",
  },
  statusDotDraining: {
    width: 8,
    height: 8,
    borderRadius: 8,
    backgroundColor: "#64d2ff",
  },
  statusDotMuted: {
    width: 8,
    height: 8,
    borderRadius: 8,
    backgroundColor: theme.colors.foregroundMuted,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    borderWidth: 1,
    borderColor: "#dfe3ea",
    borderRadius: theme.borderRadius.md,
    backgroundColor: "#ffffff",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  compactBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
    backgroundColor: "rgba(255, 255, 255, 0.72)",
    paddingHorizontal: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    flexShrink: 0,
  },
  deletedBadge: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: theme.borderRadius.sm,
    backgroundColor: "#fff1f1",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    flexShrink: 0,
  },
  deletedBadgeText: {
    color: "#b91c1c",
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  usageTrack: {
    flex: 1,
    height: 5,
    overflow: "hidden",
    borderRadius: 7,
    backgroundColor: "#e8eaef",
  },
  usageFill: {
    height: 5,
    borderRadius: 7,
    backgroundColor: "#30d158",
  },
  usageFillHot: {
    height: 5,
    borderRadius: 7,
    backgroundColor: "#ffb340",
  },
  detailPanel: {
    flex: 1,
    flexBasis: 640,
    maxWidth: "100%",
    alignSelf: "stretch",
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    gap: theme.spacing[3],
    borderWidth: 1,
    borderColor: "#e6e7eb",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: "#ffffff",
    padding: theme.spacing[3],
    elevation: 4,
  },
  daemonHero: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    borderLeftWidth: 4,
    borderLeftColor: "#30d158",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: "#f7f8fa",
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  daemonHeroMain: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  daemonHeroActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  daemonAvatar: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
    backgroundColor: "#eef0f4",
  },
  daemonTitleBlock: {
    minWidth: 0,
    flex: 1,
    gap: theme.spacing[1],
  },
  subtlePath: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  topologyStrip: {
    flexDirection: "row",
    gap: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: "#f7f8fa",
    padding: theme.spacing[2],
  },
  detailTabs: {
    alignSelf: "flex-start",
  },
  detailTabBody: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  },
  overviewTab: {
    flex: 1,
    minHeight: 0,
    gap: theme.spacing[3],
  },
  metricTile: {
    flex: 1,
    minWidth: 0,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: "transparent",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
  },
  metricTileValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  metricTileLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  visualGrid: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  visualPanel: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[3],
    borderWidth: 1,
    borderColor: "#eef0f4",
    borderRadius: theme.borderRadius.md,
    backgroundColor: "#fbfbfc",
    padding: theme.spacing[4],
  },
  visualHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  visualTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  visualValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
  },
  resourceBars: {
    gap: theme.spacing[1],
  },
  resourceRow: {
    gap: theme.spacing[1],
  },
  resourceLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  resourceMeter: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  resourceValue: {
    width: 42,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    textAlign: "right",
  },
  runtimeChart: {
    gap: theme.spacing[2],
  },
  runtimeBar: {
    height: 12,
    overflow: "hidden",
    flexDirection: "row",
    borderRadius: theme.borderRadius.sm,
    backgroundColor: "#e8eaef",
  },
  runtimeSegment: {
    minWidth: 2,
  },
  runtimeSegmentRunning: {
    backgroundColor: "#34c759",
  },
  runtimeSegmentStarting: {
    backgroundColor: "#64d2ff",
  },
  runtimeSegmentStopped: {
    backgroundColor: "#c9cdd5",
  },
  runtimeSegmentLost: {
    backgroundColor: "#d7dae1",
  },
  runtimeLegend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  runtimeLegendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  runtimeLegendDot: {
    width: 7,
    height: 7,
    borderRadius: 7,
  },
  runtimeLegendText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  panelHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  panelTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  muted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  daemonTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 1,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface3,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  badgeText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  statusText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  metricValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    textAlign: "right",
    flexShrink: 1,
  },
  controlDock: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  controlDockGroup: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[3],
    borderWidth: 1,
    borderColor: "#eef0f4",
    borderRadius: theme.borderRadius.md,
    backgroundColor: "#fbfbfc",
    padding: theme.spacing[4],
  },
  controlDockTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  compactActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1],
  },
  configRows: {
    gap: theme.spacing[2],
  },
  providerDock: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  },
  configRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
    backgroundColor: "#ffffff",
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  configRowContent: {
    flex: 1,
    gap: theme.spacing[1],
  },
  configRowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  promptActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  modelLockFields: {
    gap: theme.spacing[3],
  },
  workspaceList: {
    flex: 1,
    minHeight: 0,
    gap: theme.spacing[3],
    borderWidth: 1,
    borderColor: "#eef0f4",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: "#fbfbfc",
    padding: theme.spacing[4],
  },
  workspaceToolbar: {
    minHeight: 32,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  workspaceToolbarTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  cleanupHint: {
    color: "#b45309",
    fontSize: theme.fontSize.xs,
  },
  selectionBadge: {
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  selectionBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  workspaceSplit: {
    flex: 1,
    minHeight: 0,
    flexDirection: "row",
    gap: 0,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#e6e7eb",
    borderRadius: theme.borderRadius.md,
    backgroundColor: "#ffffff",
  },
  workspaceIndex: {
    width: 300,
    maxWidth: "100%",
    alignSelf: "stretch",
    gap: 0,
    borderRightWidth: 1,
    borderRightColor: "#e6e7eb",
    paddingVertical: theme.spacing[1],
  },
  dangerDock: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    borderWidth: 1,
    borderColor: "#f4d2d2",
    borderRadius: theme.borderRadius.md,
    backgroundColor: "#fff7f7",
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
  },
  dangerText: {
    color: "#b91c1c",
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  workspaceIndexItem: {
    minHeight: 46,
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
    backgroundColor: "transparent",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    marginHorizontal: theme.spacing[1],
  },
  workspaceIndexItemSelected: {
    minHeight: 46,
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
    backgroundColor: "#f2f6ff",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    marginHorizontal: theme.spacing[1],
  },
  workspaceHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  workspaceIdentity: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  workspaceAvatar: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
    backgroundColor: "transparent",
  },
  workspaceNameBlock: {
    minWidth: 0,
    flex: 1,
    gap: theme.spacing[1],
  },
  workspaceTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  workspaceMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  workspaceCount: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  workspaceSessionPanel: {
    flex: 1,
    flexBasis: 520,
    maxWidth: "100%",
    alignSelf: "stretch",
    minHeight: 0,
    gap: theme.spacing[1],
    backgroundColor: "#ffffff",
    padding: theme.spacing[3],
  },
  workspaceSessionHeader: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  workspaceSessionTitleGroup: {
    minWidth: 0,
    flex: 1,
    gap: theme.spacing[1],
  },
  workspaceSessionPath: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  workspaceStatusGroup: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  sessionCanvas: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    borderRadius: theme.borderRadius.md,
    backgroundColor: "#ffffff",
  },
  sessionRows: {
    flex: 1,
    minHeight: 0,
  },
  sessionRowsContent: {
    paddingVertical: theme.spacing[1],
  },
  emptySessionStrip: {
    minHeight: 42,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface0,
    paddingHorizontal: theme.spacing[3],
  },
  sessionRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: "#edf0f4",
    backgroundColor: "transparent",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
  },
  sessionRowSelected: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: "#edf0f4",
    backgroundColor: "#f2f6ff",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
  },
  sessionSelectColumn: {
    width: 24,
    alignItems: "center",
  },
  sessionCheck: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#dfe3ea",
    borderRadius: theme.borderRadius.sm,
    backgroundColor: "#ffffff",
  },
  sessionCheckSelected: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.accent,
  },
  sessionMainColumn: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
  },
  sessionTitleLine: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  sessionTitle: {
    minWidth: 0,
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  sessionMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  sessionStatusText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  sessionPills: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: theme.spacing[1],
  },
  sessionPill: {
    borderRadius: theme.borderRadius.sm,
    backgroundColor: "#f2f3f6",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  sessionDotRunning: {
    width: 7,
    height: 7,
    borderRadius: 7,
    backgroundColor: "#22c55e",
  },
  sessionDotDone: {
    width: 7,
    height: 7,
    borderRadius: 7,
    backgroundColor: theme.colors.foregroundMuted,
  },
  sessionDotError: {
    width: 7,
    height: 7,
    borderRadius: 7,
    backgroundColor: "#ef4444",
  },
  sessionDotIdle: {
    width: 7,
    height: 7,
    borderRadius: 7,
    backgroundColor: "#38bdf8",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  spinnerColor: {
    color: theme.colors.foregroundMuted,
  },
  iconColor: {
    color: theme.colors.foregroundMuted,
  },
}));

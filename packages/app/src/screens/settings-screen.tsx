import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ComponentType, ReactNode } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Buffer } from "buffer";
import {
  ArrowLeft,
  ChevronDown,
  Settings,
  Palette,
  Server,
  Network,
  Workflow,
  Boxes,
  Keyboard,
  Stethoscope,
  Info,
  Shield,
  Puzzle,
  FolderGit2,
} from "lucide-react-native";
import { ScreenTitle } from "@/components/headers/screen-title";
import { HeaderIconBadge } from "@/components/headers/header-icon-badge";
import { SettingsSection } from "@/screens/settings/settings-section";
import { AppearanceSection } from "@/screens/settings/appearance/appearance-section";
import {
  useAppSettings,
  useSettings,
  parseTerminalScrollbackLines,
  type AppSettings,
  type SendBehavior,
  type ServiceUrlBehavior,
  type Settings as EffectiveSettings,
} from "@/hooks/use-settings";
import {
  getHostRuntimeStore,
  isHostRuntimeConnected,
  useHostRuntimeIsConnected,
  useHosts,
} from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { HostProfile } from "@/types/host-connection";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { useWindowControlsPadding } from "@/utils/desktop-window";
import { confirmDialog } from "@/utils/confirm-dialog";
import { BackHeader } from "@/components/headers/back-header";
import { ScreenHeader } from "@/components/headers/screen-header";
import { AddHostMethodModal } from "@/components/add-host-method-modal";
import { AddHostModal } from "@/components/add-host-modal";
import { PairLinkModal } from "@/components/pair-link-modal";
import { KeyboardShortcutsSection } from "@/screens/settings/keyboard-shortcuts-section";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DesktopPermissionsSection } from "@/desktop/components/desktop-permissions-section";
import { IntegrationsSection } from "@/desktop/components/integrations-section";
import { isElectronRuntime } from "@/desktop/host";
import { useDesktopAppUpdater } from "@/desktop/updates/use-desktop-app-updater";
import { formatVersionWithPrefix } from "@/desktop/updates/desktop-updates";
import { resolveAppVersion } from "@/utils/app-version";
import { settingsStyles } from "@/styles/settings";
import { THINKING_TONE_NATIVE_PCM_BASE64 } from "@/utils/thinking-tone.native-pcm";
import { useVoiceAudioEngineOptional } from "@/contexts/voice-context";
import {
  HostConnectionsPage,
  HostDaemonPage,
  HostOrchestrationPage,
  HostProvidersPage,
} from "@/screens/settings/host-page";
import ProjectsScreen from "@/screens/projects-screen";
import ProjectSettingsScreen from "@/screens/project-settings-screen";
import { useProjects } from "@/hooks/use-projects";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useWebScrollbarStyle } from "@/hooks/use-web-scrollbar-style";
import { useI18n, translateNow } from "@/i18n/i18n";
import {
  buildHostHomeRoute,
  buildProjectsSettingsRoute,
  buildSettingsHostSectionRoute,
  buildSettingsSectionRoute,
  type HostSectionSlug,
  type SettingsSectionSlug,
} from "@/utils/host-routes";
import { navigateToLastWorkspace } from "@/stores/navigation-active-workspace-store";
import { projectDisplayNameFromProjectId } from "@/utils/project-display-name";

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

export type SettingsView =
  | { kind: "root" }
  | { kind: "section"; section: SettingsSectionSlug }
  | { kind: "host"; serverId: string; section: HostSectionSlug }
  | { kind: "projects" }
  | { kind: "project"; projectKey: string };

interface SidebarSectionItem {
  id: SettingsSectionSlug;
  icon: ComponentType<{ size: number; color: string }>;
  desktopOnly?: boolean;
}

const SIDEBAR_SECTION_ITEMS: SidebarSectionItem[] = [
  { id: "general", icon: Settings },
  { id: "appearance", icon: Palette },
  { id: "shortcuts", icon: Keyboard, desktopOnly: true },
  { id: "integrations", icon: Puzzle, desktopOnly: true },
  { id: "permissions", icon: Shield, desktopOnly: true },
  { id: "diagnostics", icon: Stethoscope },
  { id: "about", icon: Info },
];

const VISIBLE_SETTINGS_SIDEBAR_SECTIONS: ReadonlySet<SettingsSectionSlug> = new Set([
  "appearance",
  "diagnostics",
  "about",
]);

interface HostSectionItem {
  id: HostSectionSlug;
  icon: ComponentType<{ size: number; color: string }>;
}

const HOST_SECTION_ITEMS: HostSectionItem[] = [
  { id: "connections", icon: Network },
  { id: "orchestration", icon: Workflow },
  { id: "providers", icon: Boxes },
  { id: "daemon", icon: Server },
];

function settingsSectionLabel(
  section: SettingsSectionSlug,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (section === "general") return t("settings.section.general");
  if (section === "appearance") return t("settings.section.appearance");
  if (section === "shortcuts") return t("settings.section.shortcuts");
  if (section === "integrations") return t("settings.section.integrations");
  if (section === "permissions") return t("settings.section.permissions");
  if (section === "diagnostics") return t("settings.section.diagnostics");
  return t("settings.section.about");
}

function hostSectionLabel(section: HostSectionSlug, t: ReturnType<typeof useI18n>["t"]): string {
  if (section === "connections") return t("settings.host.connections");
  if (section === "orchestration") return t("settings.host.orchestration");
  if (section === "providers") return t("settings.host.providers");
  return t("settings.host.daemon");
}

// ---------------------------------------------------------------------------
// Trigger + sidebar style helpers
// ---------------------------------------------------------------------------

function themeTriggerStyle({ pressed }: PressableStateCallbackType) {
  return [styles.themeTrigger, pressed && { opacity: 0.85 }];
}

function sidebarItemStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return [sidebarStyles.item, Boolean(hovered) && sidebarStyles.itemHovered];
}

function selectedSidebarItemStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    sidebarStyles.item,
    Boolean(hovered) && sidebarStyles.itemHovered,
    sidebarStyles.itemSelected,
  ];
}

const ROW_WITH_BORDER_STYLE = [settingsStyles.row, settingsStyles.rowBorder];

const RELEASE_CHANNEL_OPTIONS = [
  { value: "stable" as const, label: translateNow("ui.stable.154asm3") },
  { value: "beta" as const, label: translateNow("ui.beta.18avk") },
];

const SERVICE_URL_BEHAVIOR_VALUES: ServiceUrlBehavior[] = ["ask", "in-app", "external"];

// ---------------------------------------------------------------------------
// Section components
// ---------------------------------------------------------------------------

interface GeneralSectionProps {
  settings: AppSettings;
  isDesktopApp: boolean;
  handleSendBehaviorChange: (behavior: SendBehavior) => void;
  handleServiceUrlBehaviorChange: (behavior: ServiceUrlBehavior) => void;
  handleTerminalScrollbackLinesChange: (lines: number) => void;
}

interface ServiceUrlBehaviorMenuItemProps {
  value: ServiceUrlBehavior;
  selected: boolean;
  onChange: (value: ServiceUrlBehavior) => void;
}

function ServiceUrlBehaviorMenuItem({
  value,
  selected,
  onChange,
}: ServiceUrlBehaviorMenuItemProps) {
  const { t } = useI18n();
  const handleSelect = useCallback(() => {
    onChange(value);
  }, [onChange, value]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {serviceUrlBehaviorLabel(value, t)}
    </DropdownMenuItem>
  );
}

function serviceUrlBehaviorLabel(
  value: ServiceUrlBehavior,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (value === "ask") return t("settings.option.ask");
  if (value === "in-app") return t("settings.option.inDoya");
  return t("settings.option.externalBrowser");
}

function GeneralSection({
  settings,
  isDesktopApp,
  handleSendBehaviorChange,
  handleServiceUrlBehaviorChange,
  handleTerminalScrollbackLinesChange,
}: GeneralSectionProps) {
  const { theme } = useUnistyles();
  const { t } = useI18n();
  const iconColor = theme.colors.foregroundMuted;
  const sendBehaviorOptions = useMemo(
    () => [
      { value: "interrupt" as const, label: t("settings.option.interrupt") },
      { value: "queue" as const, label: t("settings.option.queue") },
    ],
    [t],
  );
  const [terminalScrollbackValue, setTerminalScrollbackValue] = useState(
    String(settings.terminalScrollbackLines),
  );

  const handleTerminalScrollbackChangeText = useCallback((value: string) => {
    setTerminalScrollbackValue(value.replace(/[^\d]/g, ""));
  }, []);

  const commitTerminalScrollback = useCallback(() => {
    const parsed = parseTerminalScrollbackLines(terminalScrollbackValue);
    const nextValue = parsed ?? settings.terminalScrollbackLines;
    setTerminalScrollbackValue(String(nextValue));
    if (nextValue !== settings.terminalScrollbackLines) {
      handleTerminalScrollbackLinesChange(nextValue);
    }
  }, [
    handleTerminalScrollbackLinesChange,
    settings.terminalScrollbackLines,
    terminalScrollbackValue,
  ]);

  useEffect(() => {
    setTerminalScrollbackValue(String(settings.terminalScrollbackLines));
  }, [settings.terminalScrollbackLines]);

  return (
    <SettingsSection title={t("settings.section.general")}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.general.defaultSend")}</Text>
            <Text style={settingsStyles.rowHint}>{t("settings.general.defaultSendHint")}</Text>
          </View>
          <SegmentedControl
            size="sm"
            value={settings.sendBehavior}
            onValueChange={handleSendBehaviorChange}
            options={sendBehaviorOptions}
          />
        </View>
        {isDesktopApp ? (
          <View style={ROW_WITH_BORDER_STYLE}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.general.serviceUrls")}</Text>
              <Text style={settingsStyles.rowHint}>{t("settings.general.serviceUrlsHint")}</Text>
            </View>
            <DropdownMenu>
              <DropdownMenuTrigger style={themeTriggerStyle}>
                <Text style={styles.themeTriggerText}>
                  {serviceUrlBehaviorLabel(settings.serviceUrlBehavior, t)}
                </Text>
                <ChevronDown size={theme.iconSize.sm} color={iconColor} />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="bottom" align="end" width={200}>
                {SERVICE_URL_BEHAVIOR_VALUES.map((value) => (
                  <ServiceUrlBehaviorMenuItem
                    key={value}
                    value={value}
                    selected={settings.serviceUrlBehavior === value}
                    onChange={handleServiceUrlBehaviorChange}
                  />
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </View>
        ) : null}
        <View style={ROW_WITH_BORDER_STYLE}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.general.terminalScrollback")}</Text>
            <Text style={settingsStyles.rowHint}>
              {t("settings.general.terminalScrollbackHint")}
            </Text>
          </View>
          <TextInput
            value={terminalScrollbackValue}
            onChangeText={handleTerminalScrollbackChangeText}
            onBlur={commitTerminalScrollback}
            onSubmitEditing={commitTerminalScrollback}
            keyboardType="number-pad"
            inputMode="numeric"
            selectTextOnFocus
            style={styles.terminalScrollbackInput}
            accessibilityLabel={t("settings.general.terminalScrollback")}
          />
        </View>
      </View>
    </SettingsSection>
  );
}

interface DiagnosticsSectionProps {
  voiceAudioEngine: ReturnType<typeof useVoiceAudioEngineOptional>;
  isPlaybackTestRunning: boolean;
  playbackTestResult: string | null;
  handlePlaybackTest: () => Promise<void>;
}

function DiagnosticsSection({
  voiceAudioEngine,
  isPlaybackTestRunning,
  playbackTestResult,
  handlePlaybackTest,
}: DiagnosticsSectionProps) {
  const { t } = useI18n();
  const handlePlayPress = useCallback(() => {
    void handlePlaybackTest();
  }, [handlePlaybackTest]);
  return (
    <View style={styles.detailSection}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.diagnostics.testAudio")}</Text>
            {playbackTestResult ? (
              <Text style={settingsStyles.rowHint}>{playbackTestResult}</Text>
            ) : null}
          </View>
          <Button
            variant="secondary"
            size="sm"
            onPress={handlePlayPress}
            disabled={!voiceAudioEngine || isPlaybackTestRunning}
          >
            {isPlaybackTestRunning
              ? t("settings.diagnostics.playing")
              : t("settings.diagnostics.playTest")}
          </Button>
        </View>
      </View>
    </View>
  );
}

interface AboutSectionProps {
  appVersion: string | null;
  appVersionText: string;
  isDesktopApp: boolean;
}

function AboutSection({ appVersion, appVersionText, isDesktopApp }: AboutSectionProps) {
  const { t } = useI18n();
  return (
    <>
      <View style={styles.detailSection}>
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.about.appVersion")}</Text>
              <Text style={settingsStyles.rowHint}>{t("settings.about.thisDevice")}</Text>
            </View>
            <Text style={styles.aboutValue}>{appVersionText}</Text>
          </View>
          {isDesktopApp ? <DesktopAppUpdateRow /> : null}
        </View>
      </View>
      <ConnectedHostsSection clientVersion={appVersion} />
    </>
  );
}

function normalizeVersion(version: string | null | undefined): string | null {
  const trimmed = version?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^v/i, "");
}

function ConnectedHostsSection({ clientVersion }: { clientVersion: string | null }) {
  const { t } = useI18n();
  const hosts = useHosts();
  if (hosts.length === 0) {
    return null;
  }
  return (
    <SettingsSection title={t("settings.about.connectedHosts")}>
      <View style={settingsStyles.card}>
        {hosts.map((host, index) => (
          <HostVersionRow
            key={host.serverId}
            host={host}
            showBorder={index > 0}
            clientVersion={clientVersion}
          />
        ))}
      </View>
    </SettingsSection>
  );
}

function HostVersionRow({
  host,
  showBorder,
  clientVersion,
}: {
  host: HostProfile;
  showBorder: boolean;
  clientVersion: string | null;
}) {
  const isConnected = useHostRuntimeIsConnected(host.serverId);
  const daemonVersion = useSessionStore(
    (state) => state.sessions[host.serverId]?.serverInfo?.version ?? null,
  );

  const rowStyle = useMemo(
    () => [settingsStyles.row, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );

  const normalizedHost = normalizeVersion(daemonVersion);
  const normalizedClient = normalizeVersion(clientVersion);
  const isMismatch =
    normalizedHost !== null && normalizedClient !== null && normalizedHost !== normalizedClient;

  let valueText: string;
  if (!isConnected) {
    valueText = "Offline";
  } else if (normalizedHost) {
    valueText = formatVersionWithPrefix(normalizedHost);
  } else {
    valueText = "—";
  }

  const valueStyle = useMemo(
    () => [styles.aboutValue, isMismatch && styles.aboutVersionMismatch],
    [isMismatch],
  );

  return (
    <View style={rowStyle}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {host.label}
        </Text>
        {isMismatch ? (
          <Text style={settingsStyles.rowHint}>
            {translateNow("ui.version.differs.from.this.device.xrcqh5")}
          </Text>
        ) : null}
      </View>
      <Text style={valueStyle}>{valueText}</Text>
    </View>
  );
}

function getUpdateButtonLabel(
  isInstalling: boolean,
  latestVersion: string | null | undefined,
): string {
  if (isInstalling) return "Installing...";
  if (latestVersion) return `Update to ${formatVersionWithPrefix(latestVersion)}`;
  return "Update";
}

function DesktopAppUpdateRow() {
  const { settings, updateSettings } = useSettings();
  const {
    isDesktopApp,
    statusText,
    availableUpdate,
    errorMessage,
    isChecking,
    isInstalling,
    checkForUpdates,
    installUpdate,
  } = useDesktopAppUpdater();

  useFocusEffect(
    useCallback(() => {
      if (!isDesktopApp) {
        return undefined;
      }
      void checkForUpdates({ silent: true });
      return undefined;
    }, [checkForUpdates, isDesktopApp]),
  );

  const handleCheckForUpdates = useCallback(() => {
    if (!isDesktopApp) {
      return;
    }
    void checkForUpdates();
  }, [checkForUpdates, isDesktopApp]);

  const handleReleaseChannelChange = useCallback(
    (releaseChannel: EffectiveSettings["releaseChannel"]) => {
      void updateSettings({ releaseChannel });
    },
    [updateSettings],
  );

  const handleInstallUpdate = useCallback(() => {
    if (!isDesktopApp) {
      return;
    }

    void confirmDialog({
      title: translateNow("ui.install.desktop.update.1jy18cy"),
      message: translateNow("ui.this.updates.doya.on.this.computer.1ywfp1k"),
      confirmLabel: translateNow("ui.install.update.c1ztvy"),
      cancelLabel: translateNow("ui.cancel.x9d2fu"),
    })
      .then((confirmed) => {
        if (!confirmed) {
          return;
        }
        void installUpdate();
        return;
      })
      .catch((error) => {
        console.error("[Settings] Failed to open app update confirmation", error);
        Alert.alert(
          translateNow("ui.error.1410q0"),
          translateNow("ui.unable.to.open.the.update.confirmation.dialog.rncv9"),
        );
      });
  }, [installUpdate, isDesktopApp]);

  if (!isDesktopApp) {
    return null;
  }

  return (
    <>
      <View style={ROW_WITH_BORDER_STYLE}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{translateNow("ui.release.channel.pit1ai")}</Text>
          <Text style={settingsStyles.rowHint}>
            {translateNow("ui.switch.to.beta.to.get.updates.sooner.1c9nmrr")}
          </Text>
        </View>
        <SegmentedControl
          size="sm"
          value={settings.releaseChannel}
          onValueChange={handleReleaseChannelChange}
          options={RELEASE_CHANNEL_OPTIONS}
        />
      </View>
      <View style={ROW_WITH_BORDER_STYLE}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{translateNow("ui.app.updates.xxqqi3")}</Text>
          <Text style={settingsStyles.rowHint}>{statusText}</Text>
          {availableUpdate?.latestVersion ? (
            <Text style={settingsStyles.rowHint}>
              {translateNow("ui.ready.to.install.1ordasn")}
              {formatVersionWithPrefix(availableUpdate.latestVersion)}
            </Text>
          ) : null}
          {errorMessage ? <Text style={styles.aboutErrorText}>{errorMessage}</Text> : null}
        </View>
        <View style={styles.aboutUpdateActions}>
          <Button
            variant="outline"
            size="sm"
            onPress={handleCheckForUpdates}
            disabled={isChecking || isInstalling}
          >
            {isChecking ? "Checking..." : "Check"}
          </Button>
          <Button
            variant="default"
            size="sm"
            onPress={handleInstallUpdate}
            disabled={isChecking || isInstalling || !availableUpdate}
          >
            {getUpdateButtonLabel(isInstalling, availableUpdate?.latestVersion)}
          </Button>
        </View>
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function useAnyOnlineHostServerId(serverIds: string[]): string | null {
  const runtime = getHostRuntimeStore();
  return useSyncExternalStore(
    (onStoreChange) => runtime.subscribeAll(onStoreChange),
    () => {
      let firstOnlineServerId: string | null = null;
      let firstOnlineAt: string | null = null;
      for (const serverId of serverIds) {
        const snapshot = runtime.getSnapshot(serverId);
        const lastOnlineAt = snapshot?.lastOnlineAt ?? null;
        if (!isHostRuntimeConnected(snapshot) || !lastOnlineAt) {
          continue;
        }
        if (!firstOnlineAt || lastOnlineAt < firstOnlineAt) {
          firstOnlineAt = lastOnlineAt;
          firstOnlineServerId = serverId;
        }
      }
      return firstOnlineServerId;
    },
    () => null,
  );
}

/**
 * Local daemon first, then remaining hosts in their existing order. Lets the
 * picker and the active-host resolver agree on a stable "first" host.
 */
function useSortedHosts(hosts: HostProfile[], localServerId: string | null): HostProfile[] {
  return useMemo(() => {
    if (!localServerId) {
      return hosts;
    }
    const localIndex = hosts.findIndex((host) => host.serverId === localServerId);
    if (localIndex <= 0) {
      return hosts;
    }
    const next = hosts.slice();
    const [local] = next.splice(localIndex, 1);
    next.unshift(local);
    return next;
  }, [hosts, localServerId]);
}

interface SidebarSectionButtonProps {
  itemId: SettingsSectionSlug;
  label: string;
  icon: ComponentType<{ size: number; color: string }>;
  isSelected: boolean;
  onSelect: (section: SettingsSectionSlug) => void;
}

function SidebarSectionButton({
  itemId,
  label,
  icon: IconComponent,
  isSelected,
  onSelect,
}: SidebarSectionButtonProps) {
  const { theme } = useUnistyles();
  const handlePress = useCallback(() => {
    onSelect(itemId);
  }, [onSelect, itemId]);
  const accessibilityState = useMemo(() => ({ selected: isSelected }), [isSelected]);
  const labelStyle = sidebarStyles.label;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={handlePress}
      style={isSelected ? selectedSidebarItemStyle : sidebarItemStyle}
    >
      <IconComponent size={22} color={theme.colors.foregroundMuted} />
      <Text style={labelStyle} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

interface SidebarBackButtonProps {
  label: string;
  onPress: () => void;
}

function SidebarBackButton({ label, onPress }: SidebarBackButtonProps) {
  const { theme } = useUnistyles();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={sidebarItemStyle}
      testID="settings-back-to-workspace"
    >
      <ArrowLeft size={22} color={theme.colors.foregroundMuted} />
      <Text style={sidebarStyles.label} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

interface SettingsDetailPageTitleProps {
  title: string;
  icon: ComponentType<{ size: number; color: string }>;
}

function SettingsDetailPageTitle({ title, icon: IconComponent }: SettingsDetailPageTitleProps) {
  const { theme } = useUnistyles();
  return (
    <View style={styles.detailPageTitle}>
      <IconComponent size={32} color={theme.colors.foregroundMuted} />
      <Text style={styles.detailPageTitleText}>{title}</Text>
    </View>
  );
}

interface SettingsSidebarProps {
  view: SettingsView;
  onSelectSection: (section: SettingsSectionSlug) => void;
  onSelectHostSection: (section: HostSectionSlug) => void;
  onSelectHost: (serverId: string) => void;
  onSelectProjects: () => void;
  onAddHost: () => void;
  onBackToWorkspace: () => void;
  activeHostServerId: string | null;
  layout: "desktop" | "mobile";
}

function SettingsSidebar({
  view,
  onSelectSection,
  onBackToWorkspace,
  layout,
}: SettingsSidebarProps) {
  const { t } = useI18n();
  const isDesktopApp = isElectronRuntime();
  const items = SIDEBAR_SECTION_ITEMS.filter(
    (item) => VISIBLE_SETTINGS_SIDEBAR_SECTIONS.has(item.id) && (!item.desktopOnly || isDesktopApp),
  );
  const insets = useSafeAreaInsets();
  const padding = useWindowControlsPadding("sidebar");
  const isDesktop = layout === "desktop";
  const containerStyle = useMemo(
    () => [
      isDesktop ? sidebarStyles.desktopContainer : sidebarStyles.mobileContainer,
      isDesktop ? { paddingTop: insets.top } : null,
    ],
    [insets.top, isDesktop],
  );
  const selectedSectionId = view.kind === "section" ? view.section : null;
  const paddingTopStyle = useMemo(() => ({ height: padding.top }), [padding.top]);

  return (
    <View style={containerStyle} testID="settings-sidebar">
      {isDesktop ? (
        <>
          <TitlebarDragRegion />
          {padding.top > 0 ? <View style={paddingTopStyle} /> : null}
        </>
      ) : null}
      <View style={sidebarStyles.list}>
        {items.map((item) => (
          <SidebarSectionButton
            key={item.id}
            itemId={item.id}
            label={settingsSectionLabel(item.id, t)}
            icon={item.icon}
            isSelected={selectedSectionId === item.id}
            onSelect={onSelectSection}
          />
        ))}
      </View>
      <View style={sidebarStyles.footer}>
        <SidebarBackButton label={t("settings.back")} onPress={onBackToWorkspace} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export interface SettingsScreenProps {
  view: SettingsView;
}

export default function SettingsScreen({ view }: SettingsScreenProps) {
  const router = useRouter();
  const { theme } = useUnistyles();
  const { t } = useI18n();
  const voiceAudioEngine = useVoiceAudioEngineOptional();
  const { settings, isLoading: settingsLoading, updateSettings } = useAppSettings();
  const [isAddHostMethodVisible, setIsAddHostMethodVisible] = useState(false);
  const [isDirectHostVisible, setIsDirectHostVisible] = useState(false);
  const [isPasteLinkVisible, setIsPasteLinkVisible] = useState(false);
  const [isPlaybackTestRunning, setIsPlaybackTestRunning] = useState(false);
  const [playbackTestResult, setPlaybackTestResult] = useState<string | null>(null);
  const isDesktopApp = isElectronRuntime();
  const appVersion = resolveAppVersion();
  const appVersionText = formatVersionWithPrefix(appVersion);
  const isCompactLayout = useIsCompactFormFactor();
  const insets = useSafeAreaInsets();
  const insetBottomStyle = useMemo(() => ({ paddingBottom: insets.bottom }), [insets.bottom]);
  const webScrollbarStyle = useWebScrollbarStyle();
  const scrollViewStyle = useMemo(
    () => [styles.scrollView, webScrollbarStyle],
    [webScrollbarStyle],
  );
  const desktopScrollViewStyle = useMemo(
    () => [styles.scrollView, webScrollbarStyle, desktopStyles.detailScrollView],
    [webScrollbarStyle],
  );
  const hosts = useHosts();
  const { projects } = useProjects();
  const localServerId = useLocalDaemonServerId();
  const sortedHosts = useSortedHosts(hosts, localServerId);
  const hostServerIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const anyOnlineServerId = useAnyOnlineHostServerId(hostServerIds);

  // The host the four sections scope to: the host on the active view, otherwise
  // the local daemon, otherwise the first available host.
  const activeHostServerId = useMemo(() => {
    if (view.kind === "host") return view.serverId;
    return localServerId ?? sortedHosts[0]?.serverId ?? null;
  }, [view, localServerId, sortedHosts]);

  const handleSendBehaviorChange = useCallback(
    (behavior: SendBehavior) => {
      void updateSettings({ sendBehavior: behavior });
    },
    [updateSettings],
  );

  const handleServiceUrlBehaviorChange = useCallback(
    (behavior: ServiceUrlBehavior) => {
      void updateSettings({ serviceUrlBehavior: behavior });
    },
    [updateSettings],
  );

  const handleTerminalScrollbackLinesChange = useCallback(
    (terminalScrollbackLines: number) => {
      void updateSettings({ terminalScrollbackLines });
    },
    [updateSettings],
  );

  const handlePlaybackTest = useCallback(async () => {
    if (!voiceAudioEngine || isPlaybackTestRunning) {
      return;
    }

    setIsPlaybackTestRunning(true);
    setPlaybackTestResult(null);

    try {
      const bytes = Buffer.from(THINKING_TONE_NATIVE_PCM_BASE64, "base64");
      await voiceAudioEngine.initialize();
      voiceAudioEngine.stop();
      await voiceAudioEngine.play({
        type: "audio/pcm;rate=16000;bits=16",
        size: bytes.byteLength,
        async arrayBuffer() {
          return Uint8Array.from(bytes).buffer;
        },
      });
      setPlaybackTestResult(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Settings] Playback test failed", error);
      setPlaybackTestResult(`Playback failed: ${message}`);
    } finally {
      setIsPlaybackTestRunning(false);
    }
  }, [isPlaybackTestRunning, voiceAudioEngine]);

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

  const handleAddHost = useCallback(() => {
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

  const handleHostAdded = useCallback(
    ({ serverId }: { serverId: string }) => {
      const target = buildSettingsHostSectionRoute(serverId, "connections");
      if (isCompactLayout) {
        router.push(target);
      } else {
        router.replace(target);
      }
    },
    [isCompactLayout, router],
  );

  const handleSelectSection = useCallback(
    (section: SettingsSectionSlug) => {
      const target = buildSettingsSectionRoute(section);
      if (isCompactLayout) {
        router.push(target);
      } else {
        router.replace(target);
      }
    },
    [isCompactLayout, router],
  );

  // Picker: swap the host but keep the section the user is already looking at.
  const handleSelectHost = useCallback(
    (serverId: string) => {
      const section: HostSectionSlug = view.kind === "host" ? view.section : "connections";
      const target = buildSettingsHostSectionRoute(serverId, section);
      if (isCompactLayout) {
        router.push(target);
      } else {
        router.replace(target);
      }
    },
    [isCompactLayout, router, view],
  );

  const handleSelectHostSection = useCallback(
    (section: HostSectionSlug) => {
      if (!activeHostServerId) {
        handleAddHost();
        return;
      }
      const target = buildSettingsHostSectionRoute(activeHostServerId, section);
      if (isCompactLayout) {
        router.push(target);
      } else {
        router.replace(target);
      }
    },
    [activeHostServerId, handleAddHost, isCompactLayout, router],
  );

  const handleSelectProjects = useCallback(() => {
    const target = buildProjectsSettingsRoute();
    if (isCompactLayout) {
      router.push(target);
    } else {
      router.replace(target);
    }
  }, [isCompactLayout, router]);

  const handleScanQr = useCallback(() => {
    closeAddConnectionFlow();
    router.push({
      pathname: "/pair-scan",
      params: { source: "settings" },
    });
  }, [closeAddConnectionFlow, router]);

  const handleHostRemoved = useCallback(() => {
    const fallback = buildSettingsSectionRoute("general");
    if (isCompactLayout) {
      router.replace("/settings");
    } else {
      router.replace(fallback);
    }
  }, [isCompactLayout, router]);

  const handleBackToRoot = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/settings");
    }
  }, [router]);

  const handleBackToWorkspace = useCallback(() => {
    if (navigateToLastWorkspace()) {
      return;
    }
    if (anyOnlineServerId) {
      router.replace(buildHostHomeRoute(anyOnlineServerId));
      return;
    }
    router.replace("/");
  }, [anyOnlineServerId, router]);

  const detailHeader = ((): {
    title: string;
    Icon: ComponentType<{ size: number; color: string }>;
    titleAccessory?: ReactNode;
  } | null => {
    if (view.kind === "host") {
      const item = HOST_SECTION_ITEMS.find((s) => s.id === view.section);
      if (!item) return null;
      return { title: hostSectionLabel(item.id, t), Icon: item.icon };
    }
    if (view.kind === "section") {
      const item = SIDEBAR_SECTION_ITEMS.find((s) => s.id === view.section);
      if (!item) return null;
      return { title: settingsSectionLabel(item.id, t), Icon: item.icon };
    }
    if (view.kind === "project") {
      const project = projects.find((entry) => entry.projectKey === view.projectKey);
      return {
        title: project?.projectName ?? projectDisplayNameFromProjectId(view.projectKey),
        Icon: FolderGit2,
      };
    }
    if (view.kind === "projects") {
      return { title: t("openProject.projects.title"), Icon: FolderGit2 };
    }
    return null;
  })();

  const content = (() => {
    if (view.kind === "host") {
      switch (view.section) {
        case "connections":
          return <HostConnectionsPage serverId={view.serverId} />;
        case "orchestration":
          return <HostOrchestrationPage serverId={view.serverId} />;
        case "providers":
          return <HostProvidersPage serverId={view.serverId} />;
        case "daemon":
          return <HostDaemonPage serverId={view.serverId} onHostRemoved={handleHostRemoved} />;
      }
    }
    if (view.kind === "projects") {
      return <ProjectsScreen view={view} />;
    }
    if (view.kind === "project") {
      return <ProjectSettingsScreen projectKey={view.projectKey} />;
    }
    if (view.kind === "section") {
      switch (view.section) {
        case "general":
          return (
            <GeneralSection
              settings={settings}
              isDesktopApp={isDesktopApp}
              handleSendBehaviorChange={handleSendBehaviorChange}
              handleServiceUrlBehaviorChange={handleServiceUrlBehaviorChange}
              handleTerminalScrollbackLinesChange={handleTerminalScrollbackLinesChange}
            />
          );
        case "appearance":
          return <AppearanceSection />;
        case "shortcuts":
          return isDesktopApp ? <KeyboardShortcutsSection /> : null;
        case "integrations":
          return isDesktopApp ? <IntegrationsSection /> : null;
        case "permissions":
          return isDesktopApp ? <DesktopPermissionsSection /> : null;
        case "diagnostics":
          return (
            <DiagnosticsSection
              voiceAudioEngine={voiceAudioEngine}
              isPlaybackTestRunning={isPlaybackTestRunning}
              playbackTestResult={playbackTestResult}
              handlePlaybackTest={handlePlaybackTest}
            />
          );
        case "about":
          return (
            <AboutSection
              appVersion={appVersion}
              appVersionText={appVersionText}
              isDesktopApp={isDesktopApp}
            />
          );
      }
    }
    return null;
  })();

  if (settingsLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>{translateNow("ui.loading.settings.1ipemhz")}</Text>
      </View>
    );
  }

  const addHostModals = (
    <>
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
    </>
  );

  // Mobile root: full-screen sidebar-as-list.
  if (isCompactLayout && view.kind === "root") {
    return (
      <View style={styles.container}>
        <BackHeader title={translateNow("ui.settings.osmo8z")} onBack={handleBackToWorkspace} />
        <ScrollView style={scrollViewStyle} contentContainerStyle={insetBottomStyle}>
          <SettingsSidebar
            view={view}
            onSelectSection={handleSelectSection}
            onSelectHostSection={handleSelectHostSection}
            onSelectHost={handleSelectHost}
            onSelectProjects={handleSelectProjects}
            onAddHost={handleAddHost}
            onBackToWorkspace={handleBackToWorkspace}
            activeHostServerId={activeHostServerId}
            layout="mobile"
          />
        </ScrollView>
        {addHostModals}
      </View>
    );
  }

  // Mobile detail: full-screen content with a back header. Project detail uses
  // an app-level back (out of settings, to the workspace) since the in-body
  // "Back to projects" ghost button handles list-level back; other detail views
  // step back to the settings root.
  const detailBackHandler = view.kind === "project" ? handleBackToWorkspace : handleBackToRoot;
  if (isCompactLayout) {
    return (
      <View style={styles.container}>
        <BackHeader
          title={detailHeader?.title}
          titleAccessory={detailHeader?.titleAccessory}
          onBack={detailBackHandler}
        />
        <ScrollView style={scrollViewStyle} contentContainerStyle={insetBottomStyle}>
          <View style={styles.content}>{content}</View>
        </ScrollView>
        {addHostModals}
      </View>
    );
  }

  // Desktop split view — mirrors AppContainer: sidebar owns the titlebar drag
  // region + traffic-light padding; detail pane renders whatever header the
  // selected section provides.
  return (
    <View style={styles.container}>
      <View style={desktopStyles.row}>
        <SettingsSidebar
          view={view}
          onSelectSection={handleSelectSection}
          onSelectHostSection={handleSelectHostSection}
          onSelectHost={handleSelectHost}
          onSelectProjects={handleSelectProjects}
          onAddHost={handleAddHost}
          onBackToWorkspace={handleBackToWorkspace}
          activeHostServerId={activeHostServerId}
          layout="desktop"
        />
        <View style={desktopStyles.contentPane}>
          <ScreenHeader
            style={desktopStyles.detailHeader}
            borderless={!detailHeader}
            windowControlsPaddingRole="detailHeader"
            left={
              detailHeader ? (
                <>
                  <HeaderIconBadge>
                    <detailHeader.Icon
                      size={theme.iconSize.md}
                      color={theme.colors.foregroundMuted}
                    />
                  </HeaderIconBadge>
                  <ScreenTitle testID="settings-detail-header-title">
                    {detailHeader.title}
                  </ScreenTitle>
                  {detailHeader.titleAccessory}
                </>
              ) : null
            }
            leftStyle={desktopStyles.detailLeft}
          />
          <ScrollView style={desktopScrollViewStyle} contentContainerStyle={insetBottomStyle}>
            <View style={styles.content}>{content}</View>
          </ScrollView>
        </View>
      </View>
      {addHostModals}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create((theme) => ({
  loadingContainer: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
  },
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: theme.spacing[4],
    paddingTop: theme.spacing[6],
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  },
  aboutValue: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  aboutVersionMismatch: {
    color: theme.colors.palette.amber[500],
  },
  aboutErrorText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.xs,
    marginTop: theme.spacing[1],
  },
  aboutUpdateActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  themeTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  themeTriggerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  terminalScrollbackInput: {
    width: 112,
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textAlign: "right",
  },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[8],
  },
  placeholderText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));

const desktopStyles = StyleSheet.create((theme) => ({
  row: {
    flex: 1,
    flexDirection: "row",
  },
  contentPane: {
    flex: 1,
    backgroundColor: "#fcfcfc",
  },
  detailHeader: {
    backgroundColor: "#fcfcfc",
  },
  detailScrollView: {
    backgroundColor: "#fcfcfc",
  },
  detailLeft: {
    gap: theme.spacing[2],
  },
}));

const sidebarStyles = StyleSheet.create((theme) => ({
  desktopContainer: {
    width: 280,
    flexDirection: "column",
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    backgroundColor: "#f9f9f9",
    paddingHorizontal: theme.spacing[3],
  },
  mobileContainer: {
    flex: 1,
    flexDirection: "column",
    backgroundColor: "#f9f9f9",
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
  },
  list: {
    paddingTop: theme.spacing[3],
    gap: 3,
  },
  footer: {
    marginTop: "auto",
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: "rgba(0, 0, 0, 0.1)",
  },
  groupLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    gap: theme.spacing[2],
    height: 36,
    paddingHorizontal: theme.spacing[2],
    borderRadius: 10,
  },
  itemHovered: {
    backgroundColor: theme.colors.surface2,
  },
  itemSelected: {
    backgroundColor: theme.colors.surface0,
    ...theme.shadow.sm,
  },
  label: {
    fontSize: theme.fontSize.sm,
    lineHeight: 22,
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.medium,
    flex: 1,
  },
  localMarker: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    marginLeft: theme.spacing[1],
  },
  pickerTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  pickerTriggerHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  pickerTriggerLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.normal,
  },
}));

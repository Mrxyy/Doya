import { router, usePathname } from "expo-router";
import {
  ChevronRight,
  CreditCard,
  LogOut,
  MessagesSquare,
  Palette,
  Settings,
  Sparkles,
  UserRound,
  X,
} from "lucide-react-native";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet as RNStyleSheet,
  Text,
  useWindowDimensions,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { BillingPanel } from "@/app/billing";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { DoyaLogo } from "@/components/icons/doya-logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  useDropdownMenuClose,
} from "@/components/ui/dropdown-menu";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useSidebarAnimation } from "@/contexts/sidebar-animation-context";
import { useToast } from "@/contexts/toast-context";
import { clearAccountBootstrapSession, type AccountBootstrapSession } from "@/account/account-api";
import { useAccountWorkspaceMetadata } from "@/account/use-account-workspace-metadata";
import {
  getControlBillingSummary,
  isControlApiConfigured,
  type ControlPlanId,
} from "@/control/control-api";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useSidebarShortcutModel } from "@/hooks/use-sidebar-shortcut-model";
import {
  type SidebarProjectEntry,
  useSidebarWorkspacesList,
} from "@/hooks/use-sidebar-workspaces-list";
import { useI18n, translateNow } from "@/i18n/i18n";
import { type HostRuntimeConnectionStatus, useHosts } from "@/runtime/host-runtime";
import {
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  selectIsAgentListOpen,
  usePanelStore,
} from "@/stores/panel-store";
import { resolveActiveHost } from "@/utils/active-host";
import { useWindowControlsPadding } from "@/utils/desktop-window";
import { buildHostAiCreationRoute, buildHostHomeRoute } from "@/utils/host-routes";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { useAccountLoginModalStore } from "@/stores/account-login-modal-store";
import { useBillingUpgradeModalStore } from "@/stores/billing-upgrade-modal-store";
import SettingsScreen from "@/screens/settings-screen";
import type { SettingsView } from "@/screens/settings-screen";
import { SidebarAgentListSkeleton } from "./sidebar-agent-list-skeleton";
import { SidebarCalloutSlot } from "./sidebar-callout-slot";
import { SidebarWorkspaceList } from "./sidebar-workspace-list";

const MIN_CHAT_WIDTH = 400;
const BILLING_SHEET_SNAP_POINTS = ["90%"];
type AccountSettingsSection = "general" | "appearance";

type SidebarShortcutModel = ReturnType<typeof useSidebarShortcutModel>;
type SidebarTheme = ReturnType<typeof useUnistyles>["theme"];

interface LeftSidebarProps {
  selectedAgentId?: string;
}

interface SidebarSharedProps {
  theme: SidebarTheme;
  activeServerId: string | null;
  accountSession: AccountBootstrapSession | null;
  projects: SidebarProjectEntry[];
  connectionStatus: HostRuntimeConnectionStatus;
  agents: AggregatedAgent[];
  isAgentHistoryInitialLoad: boolean;
  isInitialLoad: boolean;
  isRevalidating: boolean;
  isManualRefresh: boolean;
  collapsedProjectKeys: SidebarShortcutModel["collapsedProjectKeys"];
  shortcutIndexByWorkspaceKey: SidebarShortcutModel["shortcutIndexByWorkspaceKey"];
  toggleProjectCollapsed: SidebarShortcutModel["toggleProjectCollapsed"];
  handleRefresh: () => void;
  handleOpenProject: () => void;
  handleAiCreation: () => void;
  handleAccountLogin: () => void;
  handleAccountLogout: () => void;
  handleAccountBilling: () => void;
  handleAccountGeneralSettings: () => void;
  handleAccountAppearanceSettings: () => void;
  addProjectLabel: string;
  aiCreationLabel: string;
  emptyProjectHint: string;
}

interface MobileSidebarProps extends SidebarSharedProps {
  insetsTop: number;
  insetsBottom: number;
  isOpen: boolean;
  closeToAgent: () => void;
  handleViewMoreNavigate: () => void;
}

interface DesktopSidebarProps extends SidebarSharedProps {
  insetsTop: number;
  isOpen: boolean;
  handleViewMore: () => void;
}

export const LeftSidebar = memo(function LeftSidebar({
  selectedAgentId: _selectedAgentId,
}: LeftSidebarProps) {
  void _selectedAgentId;

  const { theme } = useUnistyles();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const isCompactLayout = useIsCompactFormFactor();
  const isOpen = usePanelStore((state) =>
    selectIsAgentListOpen(state, { isCompact: isCompactLayout }),
  );
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);
  const openAccountLogin = useAccountLoginModalStore((state) => state.open);
  const [isBillingVisible, setIsBillingVisible] = useState(false);
  const [selectedSettingsSection, setSelectedSettingsSection] =
    useState<AccountSettingsSection | null>(null);
  const pathname = usePathname();
  const daemons = useHosts();
  const activeDaemon = useMemo(
    () => resolveActiveHost({ hosts: daemons, pathname }),
    [daemons, pathname],
  );
  const activeServerId = activeDaemon?.serverId ?? null;
  const accountSession = useAccountWorkspaceMetadata(activeServerId);

  const { projects, connectionStatus, isInitialLoad, isRevalidating, refreshAll } =
    useSidebarWorkspacesList({
      serverId: activeServerId,
      enabled: isCompactLayout || isOpen,
      accountSession,
      requireAccount: true,
    });
  const { collapsedProjectKeys, shortcutIndexByWorkspaceKey, toggleProjectCollapsed } =
    useSidebarShortcutModel({ projects, isInitialLoad });
  const addProjectLabel = t("sidebar.addProject");
  const aiCreationLabel = t("sidebar.aiCreation");
  const emptyProjectHint = t("sidebar.addProject.empty");

  const [isManualRefresh, setIsManualRefresh] = useState(false);

  const handleRefresh = useCallback(() => {
    setIsManualRefresh(true);
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!isRevalidating && isManualRefresh) {
      setIsManualRefresh(false);
    }
  }, [isRevalidating, isManualRefresh]);

  const handleOpenProjectMobile = useCallback(() => {
    if (!activeServerId) return;
    showMobileAgent();
    router.push(buildHostHomeRoute(activeServerId));
  }, [activeServerId, showMobileAgent]);

  const handleOpenProjectDesktop = useCallback(() => {
    if (!activeServerId) return;
    router.push(buildHostHomeRoute(activeServerId));
  }, [activeServerId]);

  const handleAiCreationMobile = useCallback(() => {
    if (!activeServerId) return;
    showMobileAgent();
    router.push(buildHostAiCreationRoute(activeServerId));
  }, [activeServerId, showMobileAgent]);

  const handleAiCreationDesktop = useCallback(() => {
    if (!activeServerId) return;
    router.push(buildHostAiCreationRoute(activeServerId));
  }, [activeServerId]);

  const handleAccountLoginMobile = useCallback(() => {
    if (!activeServerId) return;
    showMobileAgent();
    openAccountLogin(activeServerId);
  }, [activeServerId, openAccountLogin, showMobileAgent]);

  const handleAccountLoginDesktop = useCallback(() => {
    if (!activeServerId) return;
    openAccountLogin(activeServerId);
  }, [activeServerId, openAccountLogin]);

  const handleAccountLogoutMobile = useCallback(() => {
    if (!activeServerId) return;
    void (async () => {
      await clearAccountBootstrapSession();
      showMobileAgent();
      router.push(buildHostHomeRoute(activeServerId));
    })();
  }, [activeServerId, showMobileAgent]);

  const handleAccountLogoutDesktop = useCallback(() => {
    if (!activeServerId) return;
    void (async () => {
      await clearAccountBootstrapSession();
      router.push(buildHostHomeRoute(activeServerId));
    })();
  }, [activeServerId]);

  const handleAccountBillingMobile = useCallback(() => {
    setIsBillingVisible(true);
  }, []);

  const handleAccountBillingDesktop = useCallback(() => {
    setIsBillingVisible(true);
  }, []);

  const handleCloseBilling = useCallback(() => {
    setIsBillingVisible(false);
  }, []);

  const billingSheetHeader = useMemo(() => ({ title: t("billing.title") }), [t]);
  const settingsSheetHeader = useMemo(
    () => ({
      title:
        selectedSettingsSection === "appearance"
          ? t("settings.section.appearance")
          : t("settings.section.general"),
    }),
    [selectedSettingsSection, t],
  );
  const settingsSheetView = useMemo<SettingsView | null>(
    () =>
      selectedSettingsSection
        ? {
            kind: "section",
            section: selectedSettingsSection,
          }
        : null,
    [selectedSettingsSection],
  );
  const handleCloseSettingsSheet = useCallback(() => {
    setSelectedSettingsSection(null);
  }, []);
  const handleAccountGeneralSettings = useCallback(() => {
    setSelectedSettingsSection("general");
  }, []);
  const handleAccountAppearanceSettings = useCallback(() => {
    setSelectedSettingsSection("appearance");
  }, []);

  const handleViewMoreNavigate = useCallback(() => {
    if (!activeServerId) {
      return;
    }
    router.push(buildHostHomeRoute(activeServerId));
  }, [activeServerId]);

  const sharedProps = {
    theme,
    activeServerId,
    accountSession,
    projects,
    connectionStatus,
    agents: [],
    isAgentHistoryInitialLoad: false,
    isInitialLoad,
    isRevalidating,
    isManualRefresh,
    collapsedProjectKeys,
    shortcutIndexByWorkspaceKey,
    toggleProjectCollapsed,
    handleRefresh,
    addProjectLabel,
    aiCreationLabel,
    emptyProjectHint,
  };

  if (isCompactLayout) {
    return (
      <>
        <MobileSidebar
          {...sharedProps}
          insetsTop={insets.top}
          insetsBottom={insets.bottom}
          isOpen={isOpen}
          closeToAgent={showMobileAgent}
          handleOpenProject={handleOpenProjectMobile}
          handleAiCreation={handleAiCreationMobile}
          handleAccountLogin={handleAccountLoginMobile}
          handleAccountLogout={handleAccountLogoutMobile}
          handleAccountBilling={handleAccountBillingMobile}
          handleAccountGeneralSettings={handleAccountGeneralSettings}
          handleAccountAppearanceSettings={handleAccountAppearanceSettings}
          handleViewMoreNavigate={handleViewMoreNavigate}
        />
        <AdaptiveModalSheet
          header={billingSheetHeader}
          visible={isBillingVisible}
          onClose={handleCloseBilling}
          desktopMaxWidth={920}
          desktopHeight={760}
          snapPoints={BILLING_SHEET_SNAP_POINTS}
          scrollable={false}
        >
          <BillingPanel showHeader={false} />
        </AdaptiveModalSheet>
        {settingsSheetView ? (
          <AdaptiveModalSheet
            header={settingsSheetHeader}
            visible={true}
            onClose={handleCloseSettingsSheet}
            desktopMaxWidth={920}
            desktopHeight={760}
            snapPoints={BILLING_SHEET_SNAP_POINTS}
            scrollable={false}
          >
            <SettingsScreen view={settingsSheetView} embedded />
          </AdaptiveModalSheet>
        ) : null}
      </>
    );
  }

  return (
    <>
      <DesktopSidebar
        {...sharedProps}
        insetsTop={insets.top}
        isOpen={isOpen}
        handleOpenProject={handleOpenProjectDesktop}
        handleAiCreation={handleAiCreationDesktop}
        handleAccountLogin={handleAccountLoginDesktop}
        handleAccountLogout={handleAccountLogoutDesktop}
        handleAccountBilling={handleAccountBillingDesktop}
        handleAccountGeneralSettings={handleAccountGeneralSettings}
        handleAccountAppearanceSettings={handleAccountAppearanceSettings}
        handleViewMore={handleViewMoreNavigate}
      />
      <AdaptiveModalSheet
        header={billingSheetHeader}
        visible={isBillingVisible}
        onClose={handleCloseBilling}
        desktopMaxWidth={920}
        desktopHeight={760}
        snapPoints={BILLING_SHEET_SNAP_POINTS}
        scrollable={false}
      >
        <BillingPanel showHeader={false} />
      </AdaptiveModalSheet>
      {settingsSheetView ? (
        <AdaptiveModalSheet
          header={settingsSheetHeader}
          visible={true}
          onClose={handleCloseSettingsSheet}
          desktopMaxWidth={920}
          desktopHeight={760}
          snapPoints={BILLING_SHEET_SNAP_POINTS}
          scrollable={false}
        >
          <SettingsScreen view={settingsSheetView} embedded />
        </AdaptiveModalSheet>
      ) : null}
    </>
  );
});

function AccountMenuTrigger({
  accountSession,
  onLogin,
  onLogout,
  onBilling,
  onGeneralSettings,
  onAppearanceSettings,
}: {
  accountSession: AccountBootstrapSession | null;
  onLogin: () => void;
  onLogout: () => void;
  onBilling: () => void;
  onGeneralSettings: () => void;
  onAppearanceSettings: () => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useI18n();
  const openUpgrade = useBillingUpgradeModalStore((state) => state.open);
  const [planId, setPlanId] = useState<ControlPlanId | null>(null);
  const [planName, setPlanName] = useState<string | null>(null);
  const label = accountSession?.user.email ?? t("common.login");
  const avatarLabel = accountSession?.user.email.trim().charAt(0).toUpperCase() || null;
  const planBadgeStyle = useMemo(
    () =>
      RNStyleSheet.compose(
        styles.accountPlanBadge,
        planId === "pro" ? styles.accountPlanBadgePro : undefined,
      ),
    [planId],
  );
  const planBadgeTextStyle = useMemo(
    () =>
      RNStyleSheet.compose(
        styles.accountPlanText,
        planId === "pro" ? styles.accountPlanTextPro : undefined,
      ),
    [planId],
  );
  const accountLogoutLeadingIcon = useMemo(
    () => <LogOut size={14} color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );
  const accountBillingLeadingIcon = useMemo(
    () => <CreditCard size={14} color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );
  const accountGeneralLeadingIcon = useMemo(
    () => <Settings size={14} color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );
  const accountAppearanceLeadingIcon = useMemo(
    () => <Palette size={14} color={theme.colors.foregroundMuted} />,
    [theme.colors.foregroundMuted],
  );
  const handleAccountUpgrade = useCallback(() => {
    openUpgrade("account");
  }, [openUpgrade]);
  const triggerStyle = useCallback(
    ({ hovered, open }: { hovered: boolean; open: boolean; pressed: boolean }) => [
      styles.accountTrigger,
      (hovered || open) && styles.accountTriggerHovered,
    ],
    [],
  );

  const loginStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType) => [
      styles.accountTrigger,
      (hovered || pressed) && styles.accountTriggerHovered,
    ],
    [],
  );

  useEffect(() => {
    if (!accountSession || !isControlApiConfigured()) {
      setPlanId(null);
      setPlanName(null);
      return;
    }
    let disposed = false;
    void getControlBillingSummary({ accountSession })
      .then((summary) => {
        if (disposed) {
          return undefined;
        }
        setPlanId(summary.plan.id);
        setPlanName(summary.plan.name);
        return undefined;
      })
      .catch(() => {
        if (disposed) {
          return undefined;
        }
        setPlanId(null);
        setPlanName(null);
        return undefined;
      });
    return () => {
      disposed = true;
    };
  }, [accountSession]);

  if (!accountSession) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("common.login")}
        onPress={onLogin}
        style={loginStyle}
        testID="sidebar-account-login"
      >
        <View style={styles.accountAvatarEmpty}>
          <UserRound size={16} color={styles.accountAvatarIcon.color} />
        </View>
        <Text style={styles.accountLabel} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={t("sidebar.account.menu")}
        testID="sidebar-account-menu"
      >
        <View style={styles.accountAvatar}>
          {avatarLabel ? (
            <Text style={styles.accountAvatarText}>{avatarLabel}</Text>
          ) : (
            <UserRound size={16} color={styles.accountAvatarIcon.color} />
          )}
        </View>
        <Text style={styles.accountLabel} numberOfLines={1}>
          {label}
        </Text>
        {planName ? (
          <View style={planBadgeStyle}>
            <Text style={planBadgeTextStyle} numberOfLines={1}>
              {planName}
            </Text>
          </View>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" width={300}>
        <AccountUpgradeMenuCard onUpgrade={handleAccountUpgrade} />
        <DropdownMenuItem
          testID="sidebar-account-billing"
          leading={accountBillingLeadingIcon}
          onSelect={onBilling}
        >
          {t("billing.title")}
        </DropdownMenuItem>
        <DropdownMenuItem
          testID="sidebar-account-general"
          leading={accountGeneralLeadingIcon}
          onSelect={onGeneralSettings}
        >
          {t("settings.section.general")}
        </DropdownMenuItem>
        <DropdownMenuItem
          testID="sidebar-account-appearance"
          leading={accountAppearanceLeadingIcon}
          onSelect={onAppearanceSettings}
        >
          {t("settings.section.appearance")}
        </DropdownMenuItem>
        <DropdownMenuItem
          testID="sidebar-account-logout"
          leading={accountLogoutLeadingIcon}
          onSelect={onLogout}
        >
          {t("common.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AccountUpgradeMenuCard({ onUpgrade }: { onUpgrade: () => void }) {
  const { t } = useI18n();
  const closeDropdown = useDropdownMenuClose();
  const handlePress = useCallback(() => {
    closeDropdown();
    onUpgrade();
  }, [closeDropdown, onUpgrade]);
  const cardStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.accountUpgradeCard,
      hovered && styles.accountUpgradeCardHovered,
      pressed && styles.accountUpgradeCardPressed,
    ],
    [],
  );

  return (
    <Pressable
      accessibilityRole="button"
      onPress={handlePress}
      style={cardStyle}
      testID="sidebar-account-upgrade"
    >
      <View style={styles.accountUpgradeCopy}>
        <View style={styles.accountUpgradeEyebrowRow}>
          <View style={styles.accountUpgradeSparkIcon}>
            <Sparkles size={14} color={styles.accountUpgradeSparkIconGlyph.color} />
          </View>
          <Text style={styles.accountUpgradeEyebrow}>{t("billing.accountMenu.upgradePro")}</Text>
        </View>
        <Text style={styles.accountUpgradeSubtitle} numberOfLines={1}>
          {t("billing.accountMenu.upgradeSubtitle")}
        </Text>
      </View>
      <View style={styles.accountUpgradeArt} pointerEvents="none">
        <View style={styles.accountUpgradeArtHalo} />
        <View style={styles.accountUpgradeArtCardBack} />
        <View style={styles.accountUpgradeArtCardFront}>
          <View style={styles.accountUpgradeArtLinePrimary} />
          <View style={styles.accountUpgradeArtLineSecondary} />
        </View>
        <View style={styles.accountUpgradeArtCoin}>
          <CreditCard size={12} color={styles.accountUpgradeArtCoinGlyph.color} />
        </View>
      </View>
      <View style={styles.accountUpgradeChevron}>
        <ChevronRight size={14} color={styles.accountUpgradeChevronGlyph.color} />
      </View>
    </Pressable>
  );
}

function ConversationBrandHeader({ onPress }: { onPress: () => void }) {
  const { t } = useI18n();
  const brandName = t("brand.name");

  return (
    <View style={styles.conversationBrandHeader}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={brandName}
        onPress={onPress}
        style={styles.conversationBrandButton}
        testID="sidebar-brand"
      >
        <View style={styles.conversationBrandLogo}>
          <DoyaLogo size={24} />
        </View>
        <Text style={styles.conversationBrandText} numberOfLines={1}>
          {brandName}
        </Text>
      </Pressable>
    </View>
  );
}

function SidebarFooter({
  accountSession,
  handleAccountLogin,
  handleAccountLogout,
  handleAccountBilling,
  handleAccountGeneralSettings,
  handleAccountAppearanceSettings,
}: {
  accountSession: AccountBootstrapSession | null;
  handleAccountLogin: () => void;
  handleAccountLogout: () => void;
  handleAccountBilling: () => void;
  handleAccountGeneralSettings: () => void;
  handleAccountAppearanceSettings: () => void;
}) {
  return (
    <View style={styles.sidebarFooter}>
      <View style={styles.footerHostSlot}>
        <AccountMenuTrigger
          accountSession={accountSession}
          onLogin={handleAccountLogin}
          onLogout={handleAccountLogout}
          onBilling={handleAccountBilling}
          onGeneralSettings={handleAccountGeneralSettings}
          onAppearanceSettings={handleAccountAppearanceSettings}
        />
      </View>
    </View>
  );
}

function AnonymousConversationList({
  agents,
  connectionStatus,
  onAddProject,
  onAiCreation,
  addProjectLabel,
  aiCreationLabel,
  emptyProjectHint,
  onConversationPress,
}: {
  agents: AggregatedAgent[];
  connectionStatus: HostRuntimeConnectionStatus;
  onAddProject: () => void;
  onAiCreation: () => void;
  addProjectLabel: string;
  aiCreationLabel: string;
  emptyProjectHint: string;
  onConversationPress?: () => void;
}) {
  return (
    <View style={styles.anonymousConversationContainer}>
      <View style={styles.anonymousConversationHeader}>
        <AnonymousSidebarAction
          icon={MessagesSquare}
          label={addProjectLabel}
          onPress={onAddProject}
        />
        <AnonymousSidebarAction icon={UserRound} label={aiCreationLabel} onPress={onAiCreation} />
        <Text style={styles.anonymousHistoryLabel}>
          {translateNow("sidebar.historyConversations")}
        </Text>
      </View>
      <ScrollView
        style={styles.anonymousConversationScroll}
        contentContainerStyle={styles.anonymousConversationScrollContent}
        showsVerticalScrollIndicator={false}
      >
        {agents.length === 0 ? (
          <View style={styles.anonymousEmptyContainer}>
            <Text style={styles.anonymousEmptyTitle}>{translateNow("account.project.empty")}</Text>
            <Text style={styles.anonymousEmptyText}>{emptyProjectHint}</Text>
          </View>
        ) : (
          agents.map((agent) => (
            <AnonymousConversationRow
              key={`${agent.serverId}:${agent.id}`}
              agent={agent}
              connectionStatus={connectionStatus}
              onConversationPress={onConversationPress}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function AnonymousSidebarAction({
  icon: Icon,
  label,
  onPress,
}: {
  icon: ComponentType<{ size: number; color: string }>;
  label: string;
  onPress: () => void;
}) {
  const { theme } = useUnistyles();
  const actionStyle = useCallback(
    ({ hovered = false, pressed }: { hovered?: boolean; pressed: boolean }) => [
      styles.anonymousAction,
      (hovered || pressed) && styles.anonymousActionActive,
    ],
    [],
  );

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={actionStyle}>
      <Icon size={theme.iconSize.md} color={theme.colors.foreground} />
      <Text style={styles.anonymousActionText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function AnonymousConversationRow({
  agent,
  connectionStatus,
  onConversationPress,
}: {
  agent: AggregatedAgent;
  connectionStatus: HostRuntimeConnectionStatus;
  onConversationPress?: () => void;
}) {
  const { theme } = useUnistyles();
  const toast = useToast();
  const title = agent.title?.trim() || translateNow("account.project.defaultName");
  const handlePress = useCallback(() => {
    if (connectionStatus !== "online") {
      toast.error(translateNow("ui.host.is.not.connected.n90cm6"));
      return;
    }
    onConversationPress?.();
    navigateToAgent({
      serverId: agent.serverId,
      agentId: agent.id,
      pin: Boolean(agent.archivedAt),
    });
  }, [agent.archivedAt, agent.id, agent.serverId, connectionStatus, onConversationPress, toast]);
  const rowStyle = useCallback(
    ({ hovered = false, pressed }: { hovered?: boolean; pressed: boolean }) => [
      styles.anonymousConversationRow,
      (hovered || pressed) && styles.anonymousConversationRowActive,
    ],
    [],
  );

  return (
    <Pressable accessibilityRole="button" onPress={handlePress} style={rowStyle}>
      <View style={styles.anonymousConversationIcon}>
        <MessagesSquare size={14} color={theme.colors.foregroundMuted} />
      </View>
      <Text style={styles.anonymousConversationTitle} numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  );
}

function MobileSidebar({
  theme,
  activeServerId,
  accountSession,
  projects,
  connectionStatus,
  isInitialLoad,
  isRevalidating,
  isManualRefresh,
  collapsedProjectKeys,
  shortcutIndexByWorkspaceKey,
  toggleProjectCollapsed,
  handleRefresh,
  handleOpenProject,
  handleAiCreation,
  addProjectLabel,
  aiCreationLabel,
  emptyProjectHint,
  agents,
  isAgentHistoryInitialLoad,
  handleAccountLogin,
  handleAccountLogout,
  handleAccountBilling,
  handleAccountGeneralSettings,
  handleAccountAppearanceSettings,
  insetsTop,
  insetsBottom,
  isOpen,
  closeToAgent,
  handleViewMoreNavigate,
}: MobileSidebarProps) {
  const {
    translateX,
    backdropOpacity,
    windowWidth,
    animateToOpen,
    animateToClose,
    isGesturing,
    gestureAnimatingRef,
    closeGestureRef,
  } = useSidebarAnimation();
  const closeTouchStartX = useSharedValue(0);
  const closeTouchStartY = useSharedValue(0);

  const handleWorkspacePress = useCallback(() => {
    closeToAgent();
  }, [closeToAgent]);

  let conversationListContent;
  if (accountSession && isInitialLoad) {
    conversationListContent = <SidebarAgentListSkeleton />;
  } else if (accountSession) {
    conversationListContent = (
      <SidebarWorkspaceList
        serverId={activeServerId}
        accountSession={accountSession}
        collapsedProjectKeys={collapsedProjectKeys}
        connectionStatus={connectionStatus}
        onToggleProjectCollapsed={toggleProjectCollapsed}
        shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
        projects={projects}
        isRefreshing={isManualRefresh && isRevalidating}
        onRefresh={handleRefresh}
        onWorkspacePress={handleWorkspacePress}
        onAddProject={handleOpenProject}
        onAiCreation={handleAiCreation}
        addProjectLabel={addProjectLabel}
        aiCreationLabel={aiCreationLabel}
        emptyProjectHint={emptyProjectHint}
        parentGestureRef={closeGestureRef}
      />
    );
  } else if (isAgentHistoryInitialLoad) {
    conversationListContent = <SidebarAgentListSkeleton />;
  } else {
    conversationListContent = (
      <AnonymousConversationList
        agents={agents}
        connectionStatus={connectionStatus}
        onAddProject={handleOpenProject}
        onAiCreation={handleAiCreation}
        addProjectLabel={addProjectLabel}
        aiCreationLabel={aiCreationLabel}
        emptyProjectHint={emptyProjectHint}
        onConversationPress={handleWorkspacePress}
      />
    );
  }

  const handleCloseFromGesture = useCallback(() => {
    gestureAnimatingRef.current = true;
    closeToAgent();
  }, [closeToAgent, gestureAnimatingRef]);

  const handleViewMore = useCallback(() => {
    if (!activeServerId) {
      return;
    }
    translateX.value = -windowWidth;
    backdropOpacity.value = 0;
    closeToAgent();
    handleViewMoreNavigate();
  }, [
    activeServerId,
    backdropOpacity,
    closeToAgent,
    handleViewMoreNavigate,
    translateX,
    windowWidth,
  ]);

  const closeGesture = useMemo(
    () =>
      Gesture.Pan()
        .withRef(closeGestureRef)
        .enabled(isOpen)
        .manualActivation(true)
        .onTouchesDown((event) => {
          const touch = event.changedTouches[0];
          if (!touch) {
            return;
          }
          closeTouchStartX.value = touch.absoluteX;
          closeTouchStartY.value = touch.absoluteY;
        })
        .onTouchesMove((event, stateManager) => {
          const touch = event.changedTouches[0];
          if (!touch || event.numberOfTouches !== 1) {
            stateManager.fail();
            return;
          }

          const deltaX = touch.absoluteX - closeTouchStartX.value;
          const deltaY = touch.absoluteY - closeTouchStartY.value;
          const absDeltaX = Math.abs(deltaX);
          const absDeltaY = Math.abs(deltaY);

          if (deltaX >= 10) {
            stateManager.fail();
            return;
          }
          if (absDeltaY > 10 && absDeltaY > absDeltaX) {
            stateManager.fail();
            return;
          }
          if (deltaX <= -15 && absDeltaX > absDeltaY) {
            stateManager.activate();
          }
        })
        .onStart(() => {
          isGesturing.value = true;
        })
        .onUpdate((event) => {
          const newTranslateX = Math.min(0, Math.max(-windowWidth, event.translationX));
          translateX.value = newTranslateX;
          backdropOpacity.value = interpolate(
            newTranslateX,
            [-windowWidth, 0],
            [0, 1],
            Extrapolation.CLAMP,
          );
        })
        .onEnd((event) => {
          isGesturing.value = false;
          const shouldClose = event.translationX < -windowWidth / 3 || event.velocityX < -500;
          if (shouldClose) {
            animateToClose();
            runOnJS(handleCloseFromGesture)();
          } else {
            animateToOpen();
          }
        })
        .onFinalize(() => {
          isGesturing.value = false;
        }),
    [
      isOpen,
      closeGestureRef,
      closeTouchStartX,
      closeTouchStartY,
      isGesturing,
      windowWidth,
      translateX,
      backdropOpacity,
      animateToClose,
      animateToOpen,
      handleCloseFromGesture,
    ],
  );

  const mobileSidebarInsetStyle = useMemo(
    () => ({ width: windowWidth, paddingTop: insetsTop, paddingBottom: insetsBottom }),
    [windowWidth, insetsTop, insetsBottom],
  );

  const sidebarAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
    pointerEvents: backdropOpacity.value > 0.01 ? "auto" : "none",
  }));

  let overlayPointerEvents: "auto" | "none" | "box-none";
  if (!isWeb) overlayPointerEvents = "box-none";
  else if (isOpen) overlayPointerEvents = "auto";
  else overlayPointerEvents = "none";

  const backdropStyle = useMemo(
    () => [staticStyles.backdrop, backdropAnimatedStyle],
    [backdropAnimatedStyle],
  );
  const mobileSidebarStyle = useMemo(
    () => [
      staticStyles.mobileSidebar,
      mobileSidebarInsetStyle,
      sidebarAnimatedStyle,
      { backgroundColor: accountSession ? theme.colors.surface1 : theme.colors.surfaceSidebar },
    ],
    [
      accountSession,
      mobileSidebarInsetStyle,
      sidebarAnimatedStyle,
      theme.colors.surface1,
      theme.colors.surfaceSidebar,
    ],
  );

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents={overlayPointerEvents}>
      <Animated.View style={backdropStyle} />

      <GestureDetector gesture={closeGesture} touchAction="pan-y">
        <Animated.View style={mobileSidebarStyle} pointerEvents="auto">
          <View style={styles.sidebarContent} pointerEvents="auto">
            <ConversationBrandHeader onPress={handleViewMore} />
            <Pressable
              style={styles.mobileCloseButton}
              onPress={closeToAgent}
              testID="sidebar-close"
              nativeID="sidebar-close"
              accessible
              accessibilityRole="button"
              accessibilityLabel={translateNow("ui.close.sidebar.1u9k2z8")}
              hitSlop={8}
            >
              {({ hovered, pressed }) => (
                <X
                  size={theme.iconSize.md}
                  color={
                    hovered || pressed ? theme.colors.foreground : theme.colors.foregroundMuted
                  }
                />
              )}
            </Pressable>

            {conversationListContent}

            <SidebarFooter
              accountSession={accountSession}
              handleAccountLogin={handleAccountLogin}
              handleAccountLogout={handleAccountLogout}
              handleAccountBilling={handleAccountBilling}
              handleAccountGeneralSettings={handleAccountGeneralSettings}
              handleAccountAppearanceSettings={handleAccountAppearanceSettings}
            />
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function DesktopSidebar({
  activeServerId,
  accountSession,
  projects,
  connectionStatus,
  isInitialLoad,
  isRevalidating,
  isManualRefresh,
  collapsedProjectKeys,
  shortcutIndexByWorkspaceKey,
  toggleProjectCollapsed,
  handleRefresh,
  handleOpenProject,
  handleAiCreation,
  addProjectLabel,
  aiCreationLabel,
  emptyProjectHint,
  agents,
  isAgentHistoryInitialLoad,
  handleAccountLogin,
  handleAccountLogout,
  handleAccountBilling,
  handleAccountGeneralSettings,
  handleAccountAppearanceSettings,
  insetsTop,
  isOpen,
  handleViewMore,
}: DesktopSidebarProps) {
  let conversationListContent;
  if (accountSession && isInitialLoad) {
    conversationListContent = <SidebarAgentListSkeleton />;
  } else if (accountSession) {
    conversationListContent = (
      <SidebarWorkspaceList
        serverId={activeServerId}
        accountSession={accountSession}
        collapsedProjectKeys={collapsedProjectKeys}
        connectionStatus={connectionStatus}
        onToggleProjectCollapsed={toggleProjectCollapsed}
        shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
        projects={projects}
        isRefreshing={isManualRefresh && isRevalidating}
        onRefresh={handleRefresh}
        onAddProject={handleOpenProject}
        onAiCreation={handleAiCreation}
        addProjectLabel={addProjectLabel}
        aiCreationLabel={aiCreationLabel}
        emptyProjectHint={emptyProjectHint}
      />
    );
  } else if (isAgentHistoryInitialLoad) {
    conversationListContent = <SidebarAgentListSkeleton />;
  } else {
    conversationListContent = (
      <AnonymousConversationList
        agents={agents}
        connectionStatus={connectionStatus}
        onAddProject={handleOpenProject}
        onAiCreation={handleAiCreation}
        addProjectLabel={addProjectLabel}
        aiCreationLabel={aiCreationLabel}
        emptyProjectHint={emptyProjectHint}
      />
    );
  }
  const padding = useWindowControlsPadding("sidebar");
  const sidebarWidth = usePanelStore((state) => state.sidebarWidth);
  const setSidebarWidth = usePanelStore((state) => state.setSidebarWidth);
  const { width: viewportWidth } = useWindowDimensions();

  const startWidthRef = useRef(sidebarWidth);
  const resizeWidth = useSharedValue(sidebarWidth);

  useEffect(() => {
    resizeWidth.value = sidebarWidth;
  }, [sidebarWidth, resizeWidth]);

  const resizeGesture = useMemo(
    () =>
      Gesture.Pan()
        .hitSlop({ left: 8, right: 8, top: 0, bottom: 0 })
        .onStart(() => {
          startWidthRef.current = sidebarWidth;
          resizeWidth.value = sidebarWidth;
        })
        .onUpdate((event) => {
          // Dragging right (positive translationX) increases width
          const newWidth = startWidthRef.current + event.translationX;
          const maxWidth = Math.max(
            MIN_SIDEBAR_WIDTH,
            Math.min(MAX_SIDEBAR_WIDTH, viewportWidth - MIN_CHAT_WIDTH),
          );
          const clampedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxWidth, newWidth));
          resizeWidth.value = clampedWidth;
        })
        .onEnd(() => {
          runOnJS(setSidebarWidth)(resizeWidth.value);
        }),
    [sidebarWidth, resizeWidth, setSidebarWidth, viewportWidth],
  );

  const resizeAnimatedStyle = useAnimatedStyle(() => ({
    width: resizeWidth.value,
  }));

  const paddingTopSpacerStyle = useMemo(() => ({ height: padding.top }), [padding.top]);
  const desktopSidebarStyle = useMemo(
    () => [staticStyles.desktopSidebar, resizeAnimatedStyle],
    [resizeAnimatedStyle],
  );
  const desktopSidebarBorderStyle = useMemo(
    () => [
      styles.desktopSidebarBorder,
      accountSession && styles.conversationSidebarSurface,
      { flex: 1, paddingTop: insetsTop },
    ],
    [accountSession, insetsTop],
  );
  const resizeHandleStyle = useMemo(
    () => [styles.resizeHandle, isWeb && ({ cursor: "col-resize" } as object)],
    [],
  );

  if (!isOpen) {
    return null;
  }

  return (
    <Animated.View style={desktopSidebarStyle}>
      <View style={desktopSidebarBorderStyle}>
        <View style={styles.sidebarDragArea}>
          <TitlebarDragRegion />
          {padding.top > 0 ? <View style={paddingTopSpacerStyle} /> : null}
          <ConversationBrandHeader onPress={handleViewMore} />
        </View>

        {conversationListContent}

        <SidebarCalloutSlot />

        <SidebarFooter
          accountSession={accountSession}
          handleAccountLogin={handleAccountLogin}
          handleAccountLogout={handleAccountLogout}
          handleAccountBilling={handleAccountBilling}
          handleAccountGeneralSettings={handleAccountGeneralSettings}
          handleAccountAppearanceSettings={handleAccountAppearanceSettings}
        />

        {/* Resize handle - absolutely positioned over right border */}
        <GestureDetector gesture={resizeGesture}>
          <View style={resizeHandleStyle} />
        </GestureDetector>
      </View>
    </Animated.View>
  );
}

// Static styles for Animated.Views — must NOT use Unistyles dynamic theme to
// avoid the "Unable to find node on an unmounted component" crash when Unistyles
// tries to patch the native node that Reanimated also manages.
const staticStyles = RNStyleSheet.create({
  backdrop: {
    ...RNStyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  mobileSidebar: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    bottom: 0,
    overflow: "hidden" as const,
  },
  desktopSidebar: {
    position: "relative" as const,
  },
});

const styles = StyleSheet.create((theme) => ({
  sidebarContent: {
    flex: 1,
    minHeight: 0,
  },
  mobileCloseButton: {
    position: "absolute",
    top: theme.spacing[3],
    right: theme.spacing[4],
    zIndex: 2,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  anonymousConversationContainer: {
    flex: 1,
    minHeight: 0,
  },
  anonymousConversationHeader: {
    gap: 3,
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[3],
  },
  anonymousAction: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[2],
    borderRadius: 10,
  },
  anonymousActionActive: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  anonymousActionText: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "500",
    lineHeight: 22,
  },
  anonymousHistoryLabel: {
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[3],
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: "500",
    lineHeight: 18,
  },
  anonymousConversationScroll: {
    flex: 1,
  },
  anonymousConversationScrollContent: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[4],
  },
  anonymousConversationRow: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[2],
    borderRadius: 10,
  },
  anonymousConversationRowActive: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  anonymousConversationIcon: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  anonymousConversationTitle: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: "500",
    lineHeight: 22,
  },
  anonymousEmptyContainer: {
    marginHorizontal: theme.spacing[2],
    marginTop: theme.spacing[4],
    paddingTop: theme.spacing[6],
    paddingBottom: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface0,
    alignItems: "center",
    gap: theme.spacing[3],
  },
  anonymousEmptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    textAlign: "center",
  },
  anonymousEmptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  desktopSidebarBorder: {
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  conversationSidebarSurface: {
    backgroundColor: theme.colors.surface1,
  },
  resizeHandle: {
    position: "absolute",
    right: -5,
    top: 0,
    bottom: 0,
    width: 10,
    zIndex: 10,
  },
  sidebarDragArea: {
    position: "relative",
  },
  conversationBrandHeader: {
    height: 52,
    paddingHorizontal: theme.spacing[3],
    justifyContent: "center",
    userSelect: "none",
  },
  conversationBrandButton: {
    height: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  conversationBrandLogo: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  conversationBrandText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "500",
    lineHeight: 22,
  },
  sidebarFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  footerHostSlot: {
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
    marginRight: theme.spacing[2],
  },
  accountTrigger: {
    height: 36,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  accountTriggerHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  accountAvatar: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.accent,
  },
  accountAvatarEmpty: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  accountAvatarText: {
    color: theme.colors.accentForeground,
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
  },
  accountAvatarIcon: {
    color: theme.colors.foregroundMuted,
  },
  accountLabel: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  accountPlanBadge: {
    flexShrink: 0,
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[1.5],
    paddingVertical: 2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  accountPlanBadgePro: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surface2,
  },
  accountPlanText: {
    color: theme.colors.foregroundMuted,
    fontSize: 10,
    fontWeight: "600",
    lineHeight: 14,
  },
  accountPlanTextPro: {
    color: theme.colors.accent,
  },
  accountUpgradeCard: {
    minHeight: 74,
    marginHorizontal: 6,
    marginBottom: theme.spacing[1],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.palette.green[200],
    backgroundColor: theme.colors.surface0,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: theme.spacing[3],
    paddingRight: 34,
    ...theme.shadow.sm,
  },
  accountUpgradeCardHovered: {
    borderColor: theme.colors.palette.green[300],
    backgroundColor: theme.colors.palette.green[100],
  },
  accountUpgradeCardPressed: {
    opacity: 0.86,
  },
  accountUpgradeCopy: {
    minWidth: 0,
    flex: 1,
    gap: 5,
    zIndex: 2,
  },
  accountUpgradeEyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  accountUpgradeSparkIcon: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface0,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.palette.green[200],
  },
  accountUpgradeSparkIconGlyph: {
    color: theme.colors.accent,
  },
  accountUpgradeEyebrow: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    lineHeight: 20,
  },
  accountUpgradeSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
  },
  accountUpgradeArt: {
    position: "absolute",
    top: 8,
    right: 30,
    width: 84,
    height: 58,
  },
  accountUpgradeArtHalo: {
    position: "absolute",
    top: -28,
    right: -24,
    width: 86,
    height: 86,
    borderRadius: 43,
    backgroundColor: theme.colors.palette.blue[100],
    opacity: 0.82,
  },
  accountUpgradeArtCardBack: {
    position: "absolute",
    top: 3,
    right: 0,
    width: 46,
    height: 30,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.palette.blue[200],
    backgroundColor: theme.colors.surface0,
    opacity: 0.76,
  },
  accountUpgradeArtCardFront: {
    position: "absolute",
    top: 17,
    right: 18,
    width: 54,
    height: 34,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    justifyContent: "center",
    paddingHorizontal: 9,
    gap: 5,
  },
  accountUpgradeArtLinePrimary: {
    width: 31,
    height: 5,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.palette.blue[100],
  },
  accountUpgradeArtLineSecondary: {
    width: 22,
    height: 5,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.palette.yellow[400],
    opacity: 0.24,
  },
  accountUpgradeArtCoin: {
    position: "absolute",
    right: 8,
    bottom: 2,
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.palette.yellow[400],
    ...theme.shadow.sm,
  },
  accountUpgradeArtCoinGlyph: {
    color: theme.colors.surface0,
  },
  accountUpgradeChevron: {
    position: "absolute",
    right: theme.spacing[3],
    top: "50%",
    marginTop: -12,
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface0,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.palette.green[200],
    zIndex: 3,
  },
  accountUpgradeChevronGlyph: {
    color: theme.colors.accent,
  },
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.popoverForeground,
  },
}));

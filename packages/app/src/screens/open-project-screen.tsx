import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useRouter } from "expo-router";
import { MessagesSquare, Plug, Smartphone } from "lucide-react-native";
import { AdaptiveModalSheet, AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { PaseoLogo } from "@/components/icons/paseo-logo";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { usePanelStore } from "@/stores/panel-store";
import {
  useIsCompactFormFactor,
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  HEADER_TOP_PADDING_MOBILE,
} from "@/constants/layout";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { PairDeviceModal } from "@/desktop/components/pair-device-modal";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import {
  createAccountProject,
  loadAccountBootstrapSession,
  loginAccountUserWithSms,
  refreshAccountBootstrapSession,
  saveAccountBootstrapSession,
  sendAccountSmsCode,
  type AccountBootstrapSession,
  type AccountProjectRecord,
} from "@/account/account-api";
import {
  accountProjectDisplayName,
  applyAccountProjectDisplay,
} from "@/account/account-workspace-display";
import { useOpenProject } from "@/hooks/use-open-project";
import { useI18n, translateNow } from "@/i18n/i18n";

const FULL_WIDTH_STYLE = { width: "100%" } as const;

export function OpenProjectScreen({ serverId }: { serverId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const openDesktopAgentList = usePanelStore((s) => s.openDesktopAgentList);
  const isLocalDaemon = useIsLocalDaemon(serverId);
  const openProject = useOpenProject(serverId);
  const [isPairDeviceOpen, setIsPairDeviceOpen] = useState(false);
  const [accountSession, setAccountSession] = useState<AccountBootstrapSession | null>(null);
  const [isAccountProjectOpen, setIsAccountProjectOpen] = useState(false);
  const [hasLoadedAccount, setHasLoadedAccount] = useState(false);
  const [accountPhone, setAccountPhone] = useState("");
  const [accountSmsCode, setAccountSmsCode] = useState("");
  const [isSendingSmsCode, setIsSendingSmsCode] = useState(false);
  const accountWorkspaceName = t("account.workspace.defaultName");
  const [accountProjectName, setAccountProjectName] = useState(() =>
    t("account.project.defaultName"),
  );
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const accountProjectHeader = useMemo(() => ({ title: t("account.project.modalTitle") }), [t]);
  const accountProjects = useMemo(
    () =>
      accountSession
        ? accountSession.projects.filter(
            (project) => project.workspaceId === accountSession.workspace.workspaceId,
          )
        : [],
    [accountSession],
  );

  const isCompactLayout = useIsCompactFormFactor();

  useEffect(() => {
    if (!isCompactLayout) {
      openDesktopAgentList();
    }
  }, [isCompactLayout, openDesktopAgentList]);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const stored = await loadAccountBootstrapSession();
      if (!disposed) {
        try {
          const refreshed = stored ? await refreshAccountBootstrapSession(stored) : null;
          if (refreshed) {
            await saveAccountBootstrapSession(refreshed);
          }
          setAccountSession(refreshed);
          setAccountPhone(refreshed?.user.phone ?? stored?.user.phone ?? "");
        } catch {
          setAccountSession(stored ? { ...stored, projects: [] } : null);
          setAccountPhone(stored?.user.phone ?? "");
          if (stored) {
            setAccountError(t("openProject.error.sessionKept"));
          }
        }
        setHasLoadedAccount(true);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [t]);

  const handleOpenPairDevice = useCallback(() => setIsPairDeviceOpen(true), []);
  const handleClosePairDevice = useCallback(() => setIsPairDeviceOpen(false), []);

  const handleOpenProviders = useCallback(() => {
    router.push(buildSettingsHostSectionRoute(serverId, "providers"));
  }, [router, serverId]);

  const handleOpenAccountProject = useCallback(() => {
    setAccountError(null);
    setIsAccountProjectOpen(true);
  }, []);

  const handleCloseAccountProject = useCallback(() => {
    if (accountBusy) return;
    setIsAccountProjectOpen(false);
    setAccountError(null);
  }, [accountBusy]);

  const handleSaveAccountSession = useCallback(async (session: AccountBootstrapSession) => {
    await saveAccountBootstrapSession(session);
    setAccountSession(session);
    setAccountPhone(session.user.phone ?? "");
  }, []);

  const handleSendAccountSmsCode = useCallback(() => {
    setIsSendingSmsCode(true);
    setAccountError(null);
    void (async () => {
      try {
        await sendAccountSmsCode({ phone: accountPhone });
      } catch (caught) {
        setAccountError(caught instanceof Error ? caught.message : t("openProject.error.sendCode"));
      } finally {
        setIsSendingSmsCode(false);
      }
    })();
  }, [accountPhone, t]);

  const handleLoginAccount = useCallback(() => {
    setAccountBusy(true);
    setAccountError(null);
    void (async () => {
      try {
        const session = await loginAccountUserWithSms({
          phone: accountPhone,
          code: accountSmsCode,
          displayName: accountWorkspaceName,
        });
        await handleSaveAccountSession(session);
      } catch (caught) {
        setAccountError(caught instanceof Error ? caught.message : t("openProject.error.login"));
      } finally {
        setAccountBusy(false);
      }
    })();
  }, [handleSaveAccountSession, accountPhone, accountSmsCode, accountWorkspaceName, t]);

  const handleCreateAccountProject = useCallback(() => {
    if (!accountSession) return;
    setAccountBusy(true);
    setAccountError(null);
    void (async () => {
      try {
        const project = await createAccountProject({
          userId: accountSession.user.userId,
          workspaceId: accountSession.workspace.workspaceId,
          accessToken: accountSession.accessToken,
          displayName: accountProjectName,
        });
        const nextSession = {
          ...accountSession,
          projects: [
            ...accountSession.projects.filter((item) => item.projectId !== project.projectId),
            project,
          ],
        };
        await handleSaveAccountSession(nextSession);
        const opened = await openProject(project.cwd, {
          transformWorkspace: (workspace) =>
            applyAccountProjectDisplay({
              workspace,
              session: nextSession,
              project,
            }),
        });
        if (!opened) {
          throw new Error(t("openProject.error.openProjectDaemon"));
        }
        setIsAccountProjectOpen(false);
      } catch (caught) {
        setAccountError(
          caught instanceof Error ? caught.message : t("openProject.error.createProject"),
        );
      } finally {
        setAccountBusy(false);
      }
    })();
  }, [handleSaveAccountSession, accountProjectName, accountSession, openProject, t]);

  const handleOpenAccountProjectRecord = useCallback(
    (project: AccountProjectRecord) => {
      if (!accountSession) return;
      setAccountBusy(true);
      setAccountError(null);
      void (async () => {
        try {
          const opened = await openProject(project.cwd, {
            transformWorkspace: (workspace) =>
              applyAccountProjectDisplay({
                workspace,
                session: accountSession,
                project,
              }),
          });
          if (!opened) {
            throw new Error(t("openProject.error.openProjectDaemon"));
          }
        } catch (caught) {
          setAccountError(
            caught instanceof Error ? caught.message : t("openProject.error.openProject"),
          );
        } finally {
          setAccountBusy(false);
        }
      })();
    },
    [accountSession, openProject, t],
  );

  if (!hasLoadedAccount) {
    return (
      <View style={styles.container}>
        <MenuHeader borderless />
        <View style={styles.content}>
          <TitlebarDragRegion />
          <PaseoLogo size={52} />
        </View>
      </View>
    );
  }

  if (!accountSession) {
    return (
      <View style={styles.container}>
        <MenuHeader borderless />
        <View style={styles.authContent}>
          <TitlebarDragRegion />
          <View style={styles.authPanel}>
            <PaseoLogo size={52} />
            <View style={styles.authTitleGroup}>
              <Text style={styles.authTitle}>{t("openProject.accountAuth.title")}</Text>
              <Text style={styles.authSubtitle}>{t("openProject.accountAuth.subtitle")}</Text>
            </View>
            <View style={styles.sheetStack}>
              <Text style={styles.fieldLabel}>{t("openProject.accountAuth.phone")}</Text>
              <AdaptiveTextInput
                testID="workspace-auth-phone"
                accessibilityLabel={t("openProject.accountAuth.phone")}
                value={accountPhone}
                onChangeText={setAccountPhone}
                placeholder={translateNow("openProject.accountAuth.phonePlaceholder")}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="phone-pad"
                style={styles.sheetInput}
              />
              <Text style={styles.fieldLabel}>{t("openProject.accountAuth.code")}</Text>
              <AdaptiveTextInput
                testID="workspace-auth-code"
                accessibilityLabel={t("openProject.accountAuth.code")}
                value={accountSmsCode}
                onChangeText={setAccountSmsCode}
                placeholder={translateNow("openProject.accountAuth.codePlaceholder")}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="number-pad"
                style={styles.sheetInput}
              />
              {accountError ? <Text style={styles.errorText}>{accountError}</Text> : null}
              <View style={styles.sheetActions}>
                <Button
                  variant="secondary"
                  style={FULL_WIDTH_STYLE}
                  loading={isSendingSmsCode}
                  disabled={accountBusy || isSendingSmsCode || !accountPhone.trim()}
                  onPress={handleSendAccountSmsCode}
                >
                  {t("openProject.accountAuth.sendCode")}
                </Button>
                <Button
                  style={FULL_WIDTH_STYLE}
                  loading={accountBusy}
                  disabled={
                    accountBusy ||
                    isSendingSmsCode ||
                    !accountPhone.trim() ||
                    !accountSmsCode.trim()
                  }
                  onPress={handleLoginAccount}
                >
                  {t("openProject.accountAuth.loginOrRegister")}
                </Button>
              </View>
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MenuHeader borderless />
      <View style={styles.content}>
        <TitlebarDragRegion />
        <View style={styles.logo}>
          <PaseoLogo size={52} />
        </View>
        <View style={styles.tiles}>
          <HomeTile
            icon={MessagesSquare}
            title={t("openProject.newProject.title")}
            description={t("openProject.newProject.description")}
            status={accountError ?? accountSession.user.phone ?? accountSession.user.email}
            onPress={handleOpenAccountProject}
            testID="open-project-account-workspace"
            accent
            disabled={accountBusy}
          />
          <HomeTile
            icon={Plug}
            title={t("common.setupProviders")}
            description={t("common.setupProviders.description")}
            onPress={handleOpenProviders}
            testID="open-project-setup-providers"
          />
          {isLocalDaemon ? (
            <HomeTile
              icon={Smartphone}
              title={t("openProject.pairDevice")}
              description={t("openProject.pairDevice.description")}
              onPress={handleOpenPairDevice}
              testID="open-project-pair-device"
            />
          ) : null}
        </View>
        <View style={styles.projectSection}>
          <Text style={styles.sectionTitle}>{t("openProject.projects.title")}</Text>
          {accountProjects.length === 0 ? (
            <Text style={styles.emptyProjectText}>{t("account.project.empty")}</Text>
          ) : (
            <View style={styles.projectList}>
              {accountProjects.map((project) => (
                <AccountProjectTile
                  key={project.projectId}
                  project={project}
                  onOpen={handleOpenAccountProjectRecord}
                  disabled={accountBusy}
                />
              ))}
            </View>
          )}
        </View>
      </View>
      <PairDeviceModal
        visible={isPairDeviceOpen}
        onClose={handleClosePairDevice}
        testID="open-project-pair-device-modal"
      />
      <AdaptiveModalSheet
        header={accountProjectHeader}
        visible={isAccountProjectOpen}
        onClose={handleCloseAccountProject}
        desktopMaxWidth={420}
        testID="account-project-modal"
      >
        <View style={styles.sheetStack}>
          <Text style={styles.fieldLabel}>{t("account.project.fieldName")}</Text>
          <AdaptiveTextInput
            testID="account-project-name"
            accessibilityLabel={t("account.project.fieldName")}
            value={accountProjectName}
            onChangeText={setAccountProjectName}
            placeholder={t("account.project.defaultName")}
            style={styles.sheetInput}
          />
          {accountError ? <Text style={styles.errorText}>{accountError}</Text> : null}
          <View style={styles.sheetActions}>
            <Button
              variant="secondary"
              style={FULL_WIDTH_STYLE}
              onPress={handleCloseAccountProject}
            >
              {t("common.cancel")}
            </Button>
            <Button
              style={FULL_WIDTH_STYLE}
              loading={accountBusy}
              disabled={accountBusy || !accountProjectName.trim()}
              onPress={handleCreateAccountProject}
            >
              {t("common.createAndOpen")}
            </Button>
          </View>
        </View>
      </AdaptiveModalSheet>
    </View>
  );
}

function AccountProjectTile({
  project,
  onOpen,
  disabled,
}: {
  project: AccountProjectRecord;
  onOpen: (project: AccountProjectRecord) => void;
  disabled?: boolean;
}) {
  const handlePress = useCallback(() => {
    onOpen(project);
  }, [onOpen, project]);
  const { t } = useI18n();

  return (
    <HomeTile
      icon={MessagesSquare}
      title={accountProjectDisplayName(project.displayName)}
      description={t("account.project.description")}
      onPress={handlePress}
      disabled={disabled}
      testID={`account-project-${project.projectId}`}
    />
  );
}

interface HomeTileProps {
  icon: ComponentType<{ size: number; color: string }>;
  title: string;
  description: string;
  onPress: () => void;
  testID?: string;
  accent?: boolean;
  disabled?: boolean;
  status?: string | null;
}

function HomeTile({
  icon: Icon,
  title,
  description,
  onPress,
  testID,
  accent,
  disabled,
  status,
}: HomeTileProps) {
  // useUnistyles is acceptable here: leaf component, off the hot path (home screen renders once).
  const { theme } = useUnistyles();
  const [hovered, setHovered] = useState(false);
  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);

  const iconColor = accent ? theme.colors.accent : theme.colors.foregroundMuted;

  const pressableStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.tile,
      hovered && styles.tileHovered,
      pressed && styles.tilePressed,
      disabled && styles.tileDisabled,
    ],
    [disabled, hovered],
  );

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      testID={testID}
      disabled={disabled}
      style={pressableStyle}
    >
      <Icon size={20} color={iconColor} />
      <View style={styles.tileText}>
        <View style={styles.tileTitleRow}>
          <Text style={styles.tileTitle}>{title}</Text>
          {status ? <Text style={styles.tileStatus}>{status}</Text> : null}
        </View>
        <Text style={styles.tileDescription}>{description}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
    userSelect: "none",
  },
  content: {
    position: "relative",
    flex: 1,
    justifyContent: { xs: "flex-start", md: "center" },
    alignItems: "center",
    gap: 0,
    padding: theme.spacing[6],
    paddingTop: { xs: theme.spacing[12], md: theme.spacing[6] },
    paddingBottom: {
      xs: HEADER_INNER_HEIGHT_MOBILE + HEADER_TOP_PADDING_MOBILE + theme.spacing[6],
      md: HEADER_INNER_HEIGHT + theme.spacing[6],
    },
  },
  authContent: {
    position: "relative",
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: theme.spacing[6],
    paddingBottom: {
      xs: HEADER_INNER_HEIGHT_MOBILE + HEADER_TOP_PADDING_MOBILE + theme.spacing[6],
      md: HEADER_INNER_HEIGHT + theme.spacing[6],
    },
  },
  authPanel: {
    width: "100%",
    maxWidth: 420,
    gap: theme.spacing[6],
  },
  authTitleGroup: {
    gap: theme.spacing[2],
  },
  authTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.semibold,
  },
  authSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  logo: {
    marginBottom: theme.spacing[8],
  },
  tiles: {
    marginTop: { xs: theme.spacing[6], md: theme.spacing[12] },
    width: "100%",
    maxWidth: 452,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    gap: theme.spacing[3],
  },
  projectSection: {
    width: "100%",
    maxWidth: 452,
    marginTop: theme.spacing[6],
    gap: theme.spacing[3],
  },
  sectionTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  emptyProjectText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  projectList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  tile: {
    width: { xs: "100%", md: 220 },
    minHeight: { xs: 0, md: 132 },
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.xl,
    gap: theme.spacing[3],
  },
  tileHovered: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.borderAccent,
  },
  tilePressed: {
    opacity: 0.85,
  },
  tileDisabled: {
    opacity: theme.opacity[50],
  },
  tileText: {
    gap: theme.spacing[1],
  },
  tileTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  tileTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  tileStatus: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  tileDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
  },
  sheetStack: {
    gap: theme.spacing[3],
  },
  fieldLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  sheetInput: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
  sheetHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  sheetActions: {
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
  },
}));

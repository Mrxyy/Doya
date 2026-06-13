import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { ActivityIndicator, View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useRouter } from "expo-router";
import { ArrowRight, MessagesSquare, Plug, Smartphone, Sparkles } from "lucide-react-native";
import Svg, { Circle, Ellipse, Path } from "react-native-svg";
import { AdaptiveModalSheet, AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { DoyaLogo } from "@/components/icons/doya-logo";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { usePanelStore } from "@/stores/panel-store";
import {
  useIsCompactFormFactor,
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  HEADER_TOP_PADDING_MOBILE,
} from "@/constants/layout";
import { isDev, isWeb } from "@/constants/platform";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { PairDeviceModal } from "@/desktop/components/pair-device-modal";
import { buildHostHomeRoute, buildSettingsHostSectionRoute } from "@/utils/host-routes";
import {
  createAccountProject,
  loadAccountBootstrapSession,
  loginAccountUserWithSms,
  refreshAccountBootstrapSession,
  registerAccountUser,
  saveAccountBootstrapSession,
  sendAccountSmsCode,
  type AccountBootstrapSession,
} from "@/account/account-api";
import { applyAccountProjectDisplay } from "@/account/account-workspace-display";
import { useOpenProject } from "@/hooks/use-open-project";
import { useI18n, translateNow } from "@/i18n/i18n";

const FULL_WIDTH_STYLE = { width: "100%" } as const;
const AUTH_BUTTON_GRADIENT_KEYFRAME_ID = "doya-auth-button-gradient-keyframes";
const AUTH_BUTTON_GRADIENT_ANIMATION_NAME = "doya-auth-button-gradient";
const AUTH_PET_FLOAT_ANIMATION_NAME = "doya-auth-pet-float";
const AUTH_BUTTON_GRADIENT_KEYFRAME_CSS = `
  @keyframes ${AUTH_BUTTON_GRADIENT_ANIMATION_NAME} {
    0% {
      background-position: 0% 50%;
    }
    50% {
      background-position: 100% 50%;
    }
    100% {
      background-position: 0% 50%;
    }
  }
  @keyframes ${AUTH_PET_FLOAT_ANIMATION_NAME} {
    0%, 100% {
      transform: translateY(0px) rotate(-2deg);
    }
    50% {
      transform: translateY(-8px) rotate(2deg);
    }
  }
`;
type AccountAuthMode = "sms" | "email";

function ensureAuthButtonGradientKeyframes() {
  if (!isWeb || typeof document === "undefined") {
    return;
  }
  const existing = document.getElementById(AUTH_BUTTON_GRADIENT_KEYFRAME_ID);
  if (existing) {
    if (existing.textContent !== AUTH_BUTTON_GRADIENT_KEYFRAME_CSS) {
      existing.textContent = AUTH_BUTTON_GRADIENT_KEYFRAME_CSS;
    }
    return;
  }
  const styleElement = document.createElement("style");
  styleElement.id = AUTH_BUTTON_GRADIENT_KEYFRAME_ID;
  styleElement.textContent = AUTH_BUTTON_GRADIENT_KEYFRAME_CSS;
  document.head.appendChild(styleElement);
}

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
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPhone, setAccountPhone] = useState("");
  const [accountSmsCode, setAccountSmsCode] = useState("");
  const [accountAuthMode, setAccountAuthMode] = useState<AccountAuthMode>(() =>
    isDev ? "email" : "sms",
  );
  const [isSendingSmsCode, setIsSendingSmsCode] = useState(false);
  const accountWorkspaceName = t("account.workspace.defaultName");
  const [accountProjectName, setAccountProjectName] = useState(() =>
    t("account.project.defaultName"),
  );
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const accountProjectHeader = useMemo(() => ({ title: t("account.project.modalTitle") }), [t]);

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
          setAccountEmail(refreshed?.user.email ?? stored?.user.email ?? "");
          setAccountPhone(refreshed?.user.phone ?? stored?.user.phone ?? "");
        } catch {
          setAccountSession(stored ? { ...stored, projects: [] } : null);
          setAccountEmail(stored?.user.email ?? "");
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
    setAccountEmail(session.user.email);
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
        router.replace(buildHostHomeRoute(serverId));
      } catch (caught) {
        setAccountError(caught instanceof Error ? caught.message : t("openProject.error.login"));
      } finally {
        setAccountBusy(false);
      }
    })();
  }, [
    handleSaveAccountSession,
    accountPhone,
    accountSmsCode,
    accountWorkspaceName,
    router,
    serverId,
    t,
  ]);

  const handleDevEmailLoginAccount = useCallback(() => {
    setAccountBusy(true);
    setAccountError(null);
    void (async () => {
      try {
        const session = await registerAccountUser({
          email: accountEmail,
          displayName: accountWorkspaceName,
        });
        await handleSaveAccountSession(session);
        router.replace(buildHostHomeRoute(serverId));
      } catch (caught) {
        setAccountError(caught instanceof Error ? caught.message : t("openProject.error.login"));
      } finally {
        setAccountBusy(false);
      }
    })();
  }, [handleSaveAccountSession, accountEmail, accountWorkspaceName, router, serverId, t]);

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

  if (!hasLoadedAccount) {
    return (
      <View style={styles.container}>
        <MenuHeader borderless />
        <View style={styles.content}>
          <TitlebarDragRegion />
          <DoyaLogo size={52} />
        </View>
      </View>
    );
  }

  if (!accountSession) {
    return (
      <View style={styles.container}>
        <MenuHeader style={styles.authHeaderBar} />
        <AuthLoginScreen
          accountAuthMode={accountAuthMode}
          accountBusy={accountBusy}
          accountEmail={accountEmail}
          accountError={accountError}
          accountPhone={accountPhone}
          accountSmsCode={accountSmsCode}
          isSendingSmsCode={isSendingSmsCode}
          onAuthModeChange={setAccountAuthMode}
          onEmailChange={setAccountEmail}
          onEmailLogin={handleDevEmailLoginAccount}
          onPhoneChange={setAccountPhone}
          onSmsCodeChange={setAccountSmsCode}
          onSmsCodeSend={handleSendAccountSmsCode}
          onSmsLogin={handleLoginAccount}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MenuHeader borderless />
      <View style={styles.content}>
        <TitlebarDragRegion />
        <View style={styles.logo}>
          <DoyaLogo size={52} />
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

interface AuthLoginScreenProps {
  accountAuthMode: AccountAuthMode;
  accountBusy: boolean;
  accountEmail: string;
  accountError: string | null;
  accountPhone: string;
  accountSmsCode: string;
  isSendingSmsCode: boolean;
  onAuthModeChange: (mode: AccountAuthMode) => void;
  onEmailChange: (email: string) => void;
  onEmailLogin: () => void;
  onPhoneChange: (phone: string) => void;
  onSmsCodeChange: (code: string) => void;
  onSmsCodeSend: () => void;
  onSmsLogin: () => void;
}

function AuthLoginScreen(props: AuthLoginScreenProps) {
  return (
    <View style={styles.authContent}>
      <TitlebarDragRegion />
      <View style={styles.authCard}>
        <View style={styles.authHeader}>
          <View style={styles.authHeaderTop}>
            <View style={styles.authLogoBadge}>
              <DoyaLogo size={64} />
            </View>
            <AuthHeroArt />
          </View>
          <View style={styles.authTitleGroup}>
            <Text style={styles.authTitle}>{translateNow("openProject.accountAuth.title")}</Text>
            <Text style={styles.authSubtitle}>
              {translateNow("openProject.accountAuth.subtitle")}
            </Text>
          </View>
        </View>
        <LoginFormPanel {...props} />
        <AuthPetIllustration />
      </View>
    </View>
  );
}

function LoginFormPanel({
  accountAuthMode,
  accountBusy,
  accountEmail,
  accountError,
  accountPhone,
  accountSmsCode,
  isSendingSmsCode,
  onAuthModeChange,
  onEmailChange,
  onEmailLogin,
  onPhoneChange,
  onSmsCodeChange,
  onSmsCodeSend,
  onSmsLogin,
}: AuthLoginScreenProps) {
  const shouldUseEmail = accountAuthMode === "email" && isDev;
  const formContent = shouldUseEmail ? (
    <EmailLoginForm
      accountEmail={accountEmail}
      accountError={accountError}
      onEmailChange={onEmailChange}
    />
  ) : (
    <SmsLoginForm
      accountError={accountError}
      accountPhone={accountPhone}
      accountSmsCode={accountSmsCode}
      isSendingSmsCode={isSendingSmsCode}
      onPhoneChange={onPhoneChange}
      onSmsCodeChange={onSmsCodeChange}
      onSmsCodeSend={onSmsCodeSend}
    />
  );
  const canSubmitEmail = Boolean(accountEmail.trim());
  const canSubmitSms = Boolean(accountPhone.trim()) && Boolean(accountSmsCode.trim());
  const isSubmitDisabled =
    accountBusy ||
    (!shouldUseEmail && isSendingSmsCode) ||
    (shouldUseEmail ? !canSubmitEmail : !canSubmitSms);
  const handleSubmit = shouldUseEmail ? onEmailLogin : onSmsLogin;

  return (
    <View style={styles.authFormShell}>
      <AuthModeTabs accountAuthMode={accountAuthMode} onAuthModeChange={onAuthModeChange} />
      <View style={styles.authFieldsBlock}>{formContent}</View>
      <View style={styles.sheetActions}>
        <AuthPrimaryButton loading={accountBusy} disabled={isSubmitDisabled} onPress={handleSubmit}>
          {translateNow("openProject.accountAuth.loginOrRegister")}
        </AuthPrimaryButton>
      </View>
    </View>
  );
}

function AuthHeroArt() {
  const { theme } = useUnistyles();

  return (
    <View style={styles.authHeroArt} pointerEvents="none">
      <View style={styles.authHeroBackCard} />
      <View style={styles.authHeroFrontCard}>
        <MessagesSquare size={18} color={theme.colors.palette.blue[500]} />
        <View style={styles.authHeroLines}>
          <View style={styles.authHeroLineLong} />
          <View style={styles.authHeroLineShort} />
        </View>
      </View>
      <View style={styles.authHeroSpark}>
        <Sparkles size={14} color={theme.colors.palette.purple[500]} />
      </View>
    </View>
  );
}

function AuthPetIllustration() {
  return (
    <View style={styles.authPetIllustration} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 170 150">
        <Ellipse cx="102" cy="125" rx="42" ry="9" fill="#e5e7eb" opacity={0.42} />
        <Path
          d="M74 40 C90 6 130 12 140 47 C167 58 160 101 125 106 C107 134 63 121 63 88 C38 71 45 46 74 40 Z"
          fill="#e7d9ff"
        />
        <Path
          d="M73 43 C88 16 124 18 134 49 C154 60 149 91 122 96 C105 119 72 110 72 84 C52 70 55 50 73 43 Z"
          fill="#f1eaff"
        />
        <Circle cx="95" cy="67" r="5" fill="#111827" />
        <Circle cx="123" cy="67" r="5" fill="#111827" />
        <Path
          d="M105 82 C110 87 116 87 121 82"
          stroke="#8b5cf6"
          strokeLinecap="round"
          strokeWidth="3"
          fill="none"
        />
        <Path d="M68 50 L43 38 L57 64 Z" fill="#ddc8ff" />
        <Path d="M134 50 L157 35 L147 64 Z" fill="#ddc8ff" />
        <Path
          d="M124 30 C135 29 145 37 148 49"
          stroke="#ffffff"
          strokeLinecap="round"
          strokeWidth="6"
          opacity={0.74}
          fill="none"
        />
        <Path
          d="M35 83 C45 63 72 67 78 89 C95 96 92 122 71 126 C59 143 31 134 31 112 C14 101 18 87 35 83 Z"
          fill="#fff2b8"
        />
        <Path
          d="M39 86 C48 72 67 75 72 91 C84 98 81 115 67 118 C58 130 39 124 39 110 C27 101 29 90 39 86 Z"
          fill="#fff8d8"
        />
        <Circle cx="51" cy="97" r="3.8" fill="#111827" />
        <Circle cx="66" cy="96" r="3.8" fill="#111827" />
        <Path
          d="M55 107 C58 110 62 110 65 107"
          stroke="#d97706"
          strokeLinecap="round"
          strokeWidth="2"
          fill="none"
        />
        <Path d="M34 90 L20 83 L28 99 Z" fill="#fde68a" />
        <Path d="M70 90 L84 81 L78 100 Z" fill="#fde68a" />
        <Path
          d="M31 37 L35 46 L44 50 L35 54 L31 63 L27 54 L18 50 L27 46 Z"
          fill="#bfdbfe"
          opacity={0.86}
        />
        <Path
          d="M145 111 L148 118 L155 121 L148 124 L145 131 L142 124 L135 121 L142 118 Z"
          fill="#c4b5fd"
          opacity={0.82}
        />
      </Svg>
    </View>
  );
}

function AuthPrimaryButton({
  children,
  disabled,
  loading,
  onPress,
}: {
  children: string;
  disabled: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  const { theme } = useUnistyles();
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    ensureAuthButtonGradientKeyframes();
  }, []);
  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);
  const accessibilityState = useMemo(() => ({ disabled, busy: loading }), [disabled, loading]);
  const textStyle = useMemo(
    () => [styles.authPrimaryButtonText, disabled ? styles.authPrimaryButtonTextDisabled : null],
    [disabled],
  );
  const iconColor = disabled ? theme.colors.foregroundMuted : theme.colors.palette.white;
  const buttonStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.authPrimaryButton,
      hovered && !disabled ? styles.authPrimaryButtonHovered : null,
      pressed && !disabled ? styles.authPrimaryButtonPressed : null,
      disabled ? styles.authPrimaryButtonDisabled : null,
    ],
    [hovered, disabled],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      disabled={disabled || loading}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      onPress={onPress}
      style={buttonStyle}
    >
      {disabled ? (
        <View style={styles.authPrimaryButtonDisabledBackground} />
      ) : (
        <View style={styles.authPrimaryButtonGradient} />
      )}
      <View style={styles.authPrimaryButtonContent}>
        {loading ? (
          <ActivityIndicator size="small" color={iconColor} />
        ) : (
          <>
            <Text style={textStyle}>{children}</Text>
            <ArrowRight size={17} color={iconColor} />
          </>
        )}
      </View>
    </Pressable>
  );
}

function AuthModeTabs({
  accountAuthMode,
  onAuthModeChange,
}: {
  accountAuthMode: AccountAuthMode;
  onAuthModeChange: (mode: AccountAuthMode) => void;
}) {
  const handleSmsPress = useCallback(() => onAuthModeChange("sms"), [onAuthModeChange]);
  const handleEmailPress = useCallback(() => onAuthModeChange("email"), [onAuthModeChange]);

  return (
    <View style={styles.authTabs}>
      {isDev ? (
        <>
          <AuthModeTab
            active={accountAuthMode === "email"}
            label={translateNow("openProject.accountAuth.emailTab")}
            onPress={handleEmailPress}
          />
          <View style={styles.authTabDividerWrap}>
            <View style={styles.authTabDivider} />
          </View>
        </>
      ) : null}
      <AuthModeTab
        active={accountAuthMode === "sms"}
        label={translateNow("openProject.accountAuth.smsTab")}
        onPress={handleSmsPress}
      />
    </View>
  );
}

function AuthModeTab({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const textStyle = useMemo(
    () => [styles.authTabText, active ? styles.authTabTextActive : null],
    [active],
  );

  return (
    <Pressable onPress={onPress} style={styles.authTab}>
      <Text style={textStyle}>{label}</Text>
      {active ? <View style={styles.authTabIndicator} /> : null}
    </Pressable>
  );
}

function RequiredFieldLabel({ label }: { label: string }) {
  return (
    <Text style={styles.fieldLabel}>
      <Text style={styles.fieldRequired}>* </Text>
      {label}
    </Text>
  );
}

function EmailLoginForm({
  accountEmail,
  accountError,
  onEmailChange,
}: {
  accountEmail: string;
  accountError: string | null;
  onEmailChange: (email: string) => void;
}) {
  const { t } = useI18n();

  return (
    <View style={styles.sheetStack}>
      <RequiredFieldLabel label={t("openProject.accountAuth.email")} />
      <AdaptiveTextInput
        testID="workspace-auth-email"
        accessibilityLabel={t("openProject.accountAuth.email")}
        value={accountEmail}
        onChangeText={onEmailChange}
        placeholder="you@example.com"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        style={styles.sheetInput}
      />
      {accountError ? <Text style={styles.errorText}>{accountError}</Text> : null}
    </View>
  );
}

function SmsLoginForm({
  accountError,
  accountPhone,
  accountSmsCode,
  isSendingSmsCode,
  onPhoneChange,
  onSmsCodeChange,
  onSmsCodeSend,
}: {
  accountError: string | null;
  accountPhone: string;
  accountSmsCode: string;
  isSendingSmsCode: boolean;
  onPhoneChange: (phone: string) => void;
  onSmsCodeChange: (code: string) => void;
  onSmsCodeSend: () => void;
}) {
  const { t } = useI18n();
  const codeInputStyle = useMemo(() => [styles.sheetInput, styles.codeInput], []);

  return (
    <View style={styles.sheetStack}>
      <RequiredFieldLabel label={t("openProject.accountAuth.phone")} />
      <AdaptiveTextInput
        testID="workspace-auth-phone"
        accessibilityLabel={t("openProject.accountAuth.phone")}
        value={accountPhone}
        onChangeText={onPhoneChange}
        placeholder={translateNow("openProject.accountAuth.phonePlaceholder")}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="phone-pad"
        style={styles.sheetInput}
      />
      <RequiredFieldLabel label={t("openProject.accountAuth.code")} />
      <View style={styles.codeRow}>
        <AdaptiveTextInput
          testID="workspace-auth-code"
          accessibilityLabel={t("openProject.accountAuth.code")}
          value={accountSmsCode}
          onChangeText={onSmsCodeChange}
          placeholder={translateNow("openProject.accountAuth.codePlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="number-pad"
          style={codeInputStyle}
        />
        <Button
          variant="secondary"
          loading={isSendingSmsCode}
          disabled={isSendingSmsCode || !accountPhone.trim()}
          onPress={onSmsCodeSend}
        >
          {t("openProject.accountAuth.sendCode")}
        </Button>
      </View>
      {accountError ? <Text style={styles.errorText}>{accountError}</Text> : null}
    </View>
  );
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
    backgroundColor: "#fcfcfc",
    padding: theme.spacing[6],
    paddingBottom: {
      xs: HEADER_INNER_HEIGHT_MOBILE + HEADER_TOP_PADDING_MOBILE + theme.spacing[6],
      md: HEADER_INNER_HEIGHT + theme.spacing[6],
    },
  },
  authHeaderBar: {
    backgroundColor: "#fcfcfc",
  },
  authCard: {
    position: "relative",
    width: "100%",
    maxWidth: 480,
    height: { xs: "auto", md: 628 },
    paddingTop: 48,
    paddingRight: 40,
    paddingBottom: 40,
    paddingLeft: 40,
    alignItems: "flex-start",
    borderRadius: 16,
    backgroundColor: theme.colors.surface0,
    borderWidth: 0,
    ...(isWeb
      ? {
          boxShadow: "0 8px 20px 0 rgba(0, 0, 0, 0.05)",
        }
      : {
          shadowColor: theme.colors.palette.black,
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.05,
          shadowRadius: 20,
          elevation: 2,
        }),
    gap: theme.spacing[6],
    overflow: "hidden",
  },
  authHeader: {
    gap: theme.spacing[5],
    alignSelf: "stretch",
    zIndex: 1,
  },
  authHeaderTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    alignSelf: "stretch",
  },
  authLogoBadge: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  authHeroArt: {
    position: "relative",
    width: 124,
    height: 78,
  },
  authHeroBackCard: {
    position: "absolute",
    top: 8,
    right: 4,
    width: 86,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#f4edff",
    transform: [{ rotate: "6deg" }],
  },
  authHeroFrontCard: {
    position: "absolute",
    top: 18,
    right: 18,
    width: 92,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#eef6ff",
    borderWidth: 1,
    borderColor: "#d7e8ff",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  authHeroLines: {
    flex: 1,
    gap: 5,
  },
  authHeroLineLong: {
    width: "100%",
    height: 5,
    borderRadius: 5,
    backgroundColor: "#bdd8ff",
  },
  authHeroLineShort: {
    width: "62%",
    height: 5,
    borderRadius: 5,
    backgroundColor: "#d9c8ff",
  },
  authHeroSpark: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#eadfff",
    ...(isWeb
      ? {
          boxShadow: "0 8px 18px 0 rgba(123, 88, 255, 0.12)",
        }
      : {
          shadowColor: theme.colors.palette.purple[500],
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.12,
          shadowRadius: 18,
        }),
  },
  authFormShell: {
    flex: { xs: 0, md: 1 },
    alignSelf: "stretch",
    gap: theme.spacing[6],
    zIndex: 1,
  },
  authPetIllustration: {
    position: "absolute",
    left: -16,
    bottom: -14,
    width: 150,
    height: 132,
    opacity: 0.9,
    zIndex: 0,
    ...(isWeb
      ? {
          animation: `${AUTH_PET_FLOAT_ANIMATION_NAME} 5.5s ease-in-out infinite`,
          transformOrigin: "50% 80%",
        }
      : null),
  },
  authFieldsBlock: {
    gap: theme.spacing[4],
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
  authTabs: {
    flexDirection: "row",
    alignItems: "center",
  },
  authTab: {
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    flexShrink: 0,
  },
  authTabText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    flexShrink: 0,
  },
  authTabTextActive: {
    color: theme.colors.foreground,
  },
  authTabIndicator: {
    width: 16,
    height: 2,
    borderRadius: 2,
    backgroundColor: theme.colors.palette.blue[500],
  },
  authTabDivider: {
    width: 1,
    height: 20,
    backgroundColor: theme.colors.foregroundMuted,
    opacity: theme.opacity[40],
  },
  authTabDividerWrap: {
    width: 42,
    alignItems: "center",
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
  fieldRequired: {
    color: theme.colors.palette.red[500],
  },
  sheetInput: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
  codeRow: {
    flexDirection: { xs: "column", md: "row" },
    gap: theme.spacing[1],
    alignItems: "stretch",
  },
  codeInput: {
    flex: 1,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  sheetActions: {
    gap: theme.spacing[2],
    marginTop: theme.spacing[1],
  },
  authPrimaryButton: {
    position: "relative",
    height: 48,
    width: "100%",
    borderRadius: 12,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.palette.blue[600],
    transform: [{ scale: 1 }],
    ...(isWeb
      ? {
          boxShadow: "0 10px 22px 0 rgba(89, 117, 255, 0.16)",
          transition: "transform 160ms ease, box-shadow 160ms ease",
        }
      : {
          shadowColor: theme.colors.palette.blue[500],
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: 0.16,
          shadowRadius: 22,
        }),
  },
  authPrimaryButtonHovered: {
    transform: [{ translateY: -1 }, { scale: 1.01 }],
    ...(isWeb
      ? {
          boxShadow: "0 14px 28px 0 rgba(89, 117, 255, 0.24)",
        }
      : null),
  },
  authPrimaryButtonPressed: {
    transform: [{ translateY: 1 }, { scale: 0.99 }],
    ...(isWeb
      ? {
          boxShadow: "0 6px 14px 0 rgba(89, 117, 255, 0.16)",
        }
      : null),
  },
  authPrimaryButtonDisabled: {
    transform: [{ scale: 1 }],
    ...(isWeb
      ? {
          boxShadow: "none",
        }
      : {
          shadowOpacity: 0,
          elevation: 0,
        }),
  },
  authPrimaryButtonDisabledBackground: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 12,
    backgroundColor: theme.colors.surface3,
  },
  authPrimaryButtonGradient: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 12,
    backgroundColor: "#1769ff",
    ...(isWeb
      ? {
          backgroundImage: "linear-gradient(96deg, #1769ff 0%, #4f8dff 56%, #a76dff 100%)",
          backgroundSize: "220% 100%",
          backgroundPosition: "0% 50%",
          animation: `${AUTH_BUTTON_GRADIENT_ANIMATION_NAME} 4.8s ease-in-out infinite`,
        }
      : null),
  },
  authPrimaryButtonContent: {
    position: "relative",
    zIndex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
  },
  authPrimaryButtonText: {
    color: theme.colors.palette.white,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  authPrimaryButtonTextDisabled: {
    color: theme.colors.foregroundMuted,
  },
}));

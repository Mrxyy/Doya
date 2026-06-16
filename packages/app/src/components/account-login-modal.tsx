import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  loginAccountUserWithSms,
  registerAccountUser,
  saveAccountBootstrapSession,
  sendAccountSmsCode,
} from "@/account/account-api";
import { AccountLoginCard, type AccountAuthMode } from "@/screens/open-project-screen";
import { isDev, isWeb } from "@/constants/platform";
import { useI18n } from "@/i18n/i18n";
import { getOverlayRoot, OVERLAY_Z } from "@/lib/overlay-root";
import { useAccountLoginModalStore } from "@/stores/account-login-modal-store";

export function AccountLoginModalHost() {
  const { t } = useI18n();
  const serverId = useAccountLoginModalStore((state) => state.serverId);
  const close = useAccountLoginModalStore((state) => state.close);
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPhone, setAccountPhone] = useState("");
  const [accountSmsCode, setAccountSmsCode] = useState("");
  const [accountAuthMode, setAccountAuthMode] = useState<AccountAuthMode>(() =>
    isDev ? "email" : "sms",
  );
  const [isSendingSmsCode, setIsSendingSmsCode] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const accountWorkspaceName = t("account.workspace.defaultName");

  useEffect(() => {
    if (!serverId) return;
    setAccountError(null);
    setAccountBusy(false);
    setIsSendingSmsCode(false);
  }, [serverId]);

  const handleClose = useCallback(() => {
    if (accountBusy) return;
    close();
  }, [accountBusy, close]);

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
        await saveAccountBootstrapSession(session);
        close();
      } catch (caught) {
        setAccountError(caught instanceof Error ? caught.message : t("openProject.error.login"));
      } finally {
        setAccountBusy(false);
      }
    })();
  }, [accountPhone, accountSmsCode, accountWorkspaceName, close, t]);

  const handleDevEmailLoginAccount = useCallback(() => {
    setAccountBusy(true);
    setAccountError(null);
    void (async () => {
      try {
        const session = await registerAccountUser({
          email: accountEmail,
          displayName: accountWorkspaceName,
        });
        await saveAccountBootstrapSession(session);
        close();
      } catch (caught) {
        setAccountError(caught instanceof Error ? caught.message : t("openProject.error.login"));
      } finally {
        setAccountBusy(false);
      }
    })();
  }, [accountEmail, accountWorkspaceName, close, t]);

  const content = useMemo(
    () => (
      <View style={styles.overlay} testID="account-login-modal">
        <Pressable
          accessibilityLabel={t("ui.dismiss.1j6d1ey")}
          style={ABSOLUTE_FILL_STYLE}
          onPress={handleClose}
        />
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <AccountLoginCard
            accountAuthMode={accountAuthMode}
            accountBusy={accountBusy}
            accountEmail={accountEmail}
            accountError={accountError}
            accountPhone={accountPhone}
            accountSmsCode={accountSmsCode}
            isSendingSmsCode={isSendingSmsCode}
            presentation="modal"
            onAuthModeChange={setAccountAuthMode}
            onEmailChange={setAccountEmail}
            onEmailLogin={handleDevEmailLoginAccount}
            onPhoneChange={setAccountPhone}
            onSmsCodeChange={setAccountSmsCode}
            onSmsCodeSend={handleSendAccountSmsCode}
            onSmsLogin={handleLoginAccount}
          />
        </ScrollView>
      </View>
    ),
    [
      accountAuthMode,
      accountBusy,
      accountEmail,
      accountError,
      accountPhone,
      accountSmsCode,
      handleClose,
      handleDevEmailLoginAccount,
      handleLoginAccount,
      handleSendAccountSmsCode,
      isSendingSmsCode,
      t,
    ],
  );

  if (!serverId) {
    return null;
  }

  if (isWeb && typeof document !== "undefined") {
    return createPortal(content, getOverlayRoot());
  }

  return (
    <Modal
      transparent
      animationType="fade"
      visible
      onRequestClose={handleClose}
      hardwareAccelerated
    >
      {content}
    </Modal>
  );
}

const ABSOLUTE_FILL_STYLE = { ...StyleSheet.absoluteFillObject };

const styles = StyleSheet.create((theme) => ({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.48)",
    zIndex: OVERLAY_Z.modal,
    pointerEvents: "auto" as const,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: theme.spacing[6],
  },
}));

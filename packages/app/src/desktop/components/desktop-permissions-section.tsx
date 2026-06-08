import { useCallback, useMemo } from "react";
import { View, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { RotateCw } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { DesktopPermissionRow } from "@/desktop/components/desktop-permission-row";
import { useDesktopPermissions } from "@/desktop/permissions/use-desktop-permissions";
import { settingsStyles } from "@/styles/settings";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useI18n, translateNow } from "@/i18n/i18n";

export function DesktopPermissionsSection() {
  const { t } = useI18n();
  const { theme } = useUnistyles();
  const {
    isDesktopApp,
    snapshot,
    isRefreshing,
    requestingPermission,
    isSendingTestNotification,
    testNotificationError,
    refreshPermissions,
    requestPermission,
    sendTestNotification,
  } = useDesktopPermissions();

  const errorTextStyle = useMemo(
    () => [styles.errorText, { color: theme.colors.destructive }],
    [theme.colors.destructive],
  );

  const handleRefreshPress = useCallback(() => {
    void refreshPermissions();
  }, [refreshPermissions]);

  const handleRequestNotifications = useCallback(() => {
    void requestPermission("notifications");
  }, [requestPermission]);

  const handleRequestMicrophone = useCallback(() => {
    void requestPermission("microphone");
  }, [requestPermission]);

  const handleSendTestNotification = useCallback(() => {
    void sendTestNotification();
  }, [sendTestNotification]);

  const isBusy = isRefreshing || requestingPermission !== null;
  const notificationsGranted = snapshot?.notifications.state === "granted";

  const refreshIcon = useMemo(
    () => <RotateCw size={theme.iconSize.md} color={theme.colors.foregroundMuted} />,
    [theme.iconSize.md, theme.colors.foregroundMuted],
  );

  const refreshButton = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        leftIcon={refreshIcon}
        onPress={handleRefreshPress}
        disabled={isBusy}
        accessibilityLabel={translateNow("ui.refresh.desktop.permissions.re8k2j")}
      >
        {isRefreshing ? "Refreshing..." : "Refresh"}
      </Button>
    ),
    [refreshIcon, handleRefreshPress, isBusy, isRefreshing],
  );

  if (!isDesktopApp) {
    return null;
  }

  return (
    <SettingsSection title={t("settings.section.permissions")} trailing={refreshButton}>
      <View style={settingsStyles.card}>
        <DesktopPermissionRow
          title={translateNow("ui.notifications.y97he0")}
          status={snapshot?.notifications ?? null}
          isRequesting={requestingPermission === "notifications"}
          onRequest={handleRequestNotifications}
          extraActionLabel="Test"
          isExtraActionBusy={isSendingTestNotification}
          isExtraActionDisabled={!notificationsGranted || isBusy}
          onExtraAction={handleSendTestNotification}
        />
        {testNotificationError ? <Text style={errorTextStyle}>{testNotificationError}</Text> : null}
        <DesktopPermissionRow
          title={translateNow("ui.microphone.1jn2gy2")}
          showBorder
          status={snapshot?.microphone ?? null}
          isRequesting={requestingPermission === "microphone"}
          onRequest={handleRequestMicrophone}
        />
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  errorText: {
    fontSize: theme.fontSize.xs,
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[2],
  },
}));

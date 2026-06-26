import { useCallback } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { DoyaLoadingMark } from "@/components/doya-loading-mark";
import { Button } from "@/components/ui/button";
import {
  getHostRuntimeStore,
  isHostRuntimeConnected,
  useEnsureHostRuntimeStarted,
  useHostRuntimeSnapshot,
  useHosts,
} from "@/runtime/host-runtime";
import { useI18n } from "@/i18n/i18n";
import type { ReactNode } from "react";
import { RotateCw } from "@/components/icons/lucide";

export function HostRuntimeStartupGate({
  serverId,
  children,
}: {
  serverId: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const hosts = useHosts();
  const snapshot = useHostRuntimeSnapshot(serverId);
  const host = hosts.find((entry) => entry.serverId === serverId) ?? null;
  const status = snapshot?.connectionStatus ?? "idle";
  const isConnected = isHostRuntimeConnected(snapshot);
  const isFailed = status === "offline" || status === "error";

  useEnsureHostRuntimeStarted(serverId);

  const handleRetry = useCallback(() => {
    void getHostRuntimeStore().ensureStarted(serverId);
  }, [serverId]);

  if (isConnected) {
    return children;
  }

  return (
    <View style={styles.container}>
      <DoyaLoadingMark />
      <View style={styles.textStack}>
        <Text style={styles.title}>
          {isFailed
            ? t("hostRuntimeStartup.unreachableTitle")
            : t("hostRuntimeStartup.connectingTitle")}
        </Text>
        <Text style={styles.description} numberOfLines={2}>
          {isFailed
            ? t("hostRuntimeStartup.unreachableDescription")
            : t("hostRuntimeStartup.connectingDescription", {
                host: host?.label ?? serverId,
              })}
        </Text>
      </View>
      {isFailed ? (
        <Button size="sm" variant="outline" leftIcon={RotateCw} onPress={handleRetry}>
          {t("hostRuntimeStartup.retry")}
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[6],
  },
  textStack: {
    alignItems: "center",
    gap: theme.spacing[1],
    maxWidth: 360,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    textAlign: "center",
  },
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: Math.round(theme.fontSize.sm * 1.4),
    textAlign: "center",
  },
}));

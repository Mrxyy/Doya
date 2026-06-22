import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet as RNStyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MicVocal } from "lucide-react-native";
import { loadAccountBootstrapSession, type AccountBootstrapSession } from "@/account/account-api";
import {
  getControlSession,
  listControlSessionArtifacts,
  listControlSessionMessages,
  updateControlSession,
  type ControlArtifactRecord,
  type ControlSessionMessageRecord,
  type ControlSessionRecord,
} from "@/control/control-api";
import { getControlSessionDisplayTitle } from "@/control/control-session-display-title";
import { restoreControlSessionToAgent } from "@/control/control-session-restore";
import { MenuHeader } from "@/components/headers/menu-header";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useI18n } from "@/i18n/i18n";
import { useHostMutations, useHosts } from "@/runtime/host-runtime";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";

function getParamValue(value: string | string[] | undefined): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const firstValue = value[0];
    return typeof firstValue === "string" ? firstValue.trim() : "";
  }
  return "";
}

export default function ControlSessionRoute() {
  const params = useLocalSearchParams<{ sessionId?: string | string[] }>();
  const sessionId = getParamValue(params.sessionId);
  const { t } = useI18n();
  const hosts = useHosts();
  const { upsertDirectConnection } = useHostMutations();
  const [session, setSession] = useState<ControlSessionRecord | null>(null);
  const [messages, setMessages] = useState<ControlSessionMessageRecord[]>([]);
  const [, setArtifacts] = useState<ControlArtifactRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const restoreStartedRef = useRef(false);
  const headerTitle = useMemo(() => {
    if (!session) {
      return t("common.sessions");
    }
    return getControlSessionDisplayTitle({ session, agentTitle: null });
  }, [session, t]);

  useEffect(() => {
    if (restoreStartedRef.current) {
      return;
    }
    restoreStartedRef.current = true;
    let disposed = false;
    let storedForStatus: AccountBootstrapSession | null = null;
    void (async () => {
      try {
        const stored = await loadAccountBootstrapSession();
        if (!stored || !stored.workspace.workspaceId.startsWith("control:")) {
          throw new Error(t("session.error.loginRequired"));
        }
        storedForStatus = stored;
        const [nextSession, nextMessages, nextArtifacts] = await Promise.all([
          getControlSession({ accountSession: stored, sessionId }),
          listControlSessionMessages({ accountSession: stored, sessionId }),
          listControlSessionArtifacts({ accountSession: stored, sessionId }),
        ]);
        const restored = await restoreControlSessionToAgent({
          accountSession: stored,
          sessionId,
          hosts,
          upsertDirectConnection,
        });
        if (!disposed) {
          setSession(nextSession);
          setMessages(nextMessages);
          setArtifacts(nextArtifacts);
          setError(null);
        }
        router.replace(buildHostAgentDetailRoute(restored.nodeId, restored.agentId) as Href);
      } catch (caught) {
        if (storedForStatus) {
          void updateControlSession({
            accountSession: storedForStatus,
            sessionId,
            status: "error",
          }).catch(() => undefined);
        }
        if (!disposed) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      } finally {
        if (!disposed) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      disposed = true;
    };
  }, [hosts, sessionId, t, upsertDirectConnection]);

  return (
    <View style={styles.container}>
      <MenuHeader title={headerTitle} />
      {isLoading ? (
        <View style={styles.centered}>
          <LoadingSpinner size="large" color={styles.spinnerColor.color} />
        </View>
      ) : null}
      {!isLoading && error ? (
        <View style={styles.centered}>
          <Text style={styles.muted}>{error}</Text>
        </View>
      ) : null}
      {!isLoading && !error ? (
        <ScrollView contentContainerStyle={styles.content}>
          {visibleMessages(messages).length === 0 ? (
            <Text style={styles.muted}>{t("session.empty")}</Text>
          ) : (
            visibleMessages(messages).map((message) => (
              <View key={message.id} style={styles.messageRow}>
                <Text style={styles.messageRole}>{message.role}</Text>
                <MessageContent content={message.content} />
              </View>
            ))
          )}
        </ScrollView>
      ) : null}
    </View>
  );
}

interface FormattedMessageContent {
  kind: "plain" | "spoken";
  text: string;
}

function MessageContent({ content }: { content: unknown }) {
  const { t } = useI18n();
  const formatted = formatMessageContent(content);
  if (formatted.kind === "spoken") {
    return (
      <View style={styles.spokenCard}>
        <View style={styles.spokenHeader}>
          <View style={styles.spokenIcon}>
            <ThemedMicVocal size={14} uniProps={iconColorMapping} />
          </View>
          <Text style={styles.spokenLabel}>{t("session.message.spokenInput")}</Text>
        </View>
        <Text style={styles.spokenText}>{formatted.text}</Text>
      </View>
    );
  }
  return <Text style={styles.messageText}>{formatted.text}</Text>;
}

function getTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (content && typeof content === "object" && "text" in content) {
    const text = (content as { text?: unknown }).text;
    return typeof text === "string" ? text : JSON.stringify(content);
  }
  return JSON.stringify(content);
}

function formatMessageContent(content: unknown): FormattedMessageContent {
  const text = getTextContent(content);
  const spokenMatch = text.match(/<spoken-input>\s*([\s\S]*?)\s*<\/spoken-input>/);
  if (spokenMatch) {
    return {
      kind: "spoken",
      text: spokenMatch[1]?.trim() ?? "",
    };
  }
  return {
    kind: "plain",
    text: text.replace(/<instruction>[\s\S]*?<\/instruction>/g, "").trim(),
  };
}

function visibleMessages(messages: ControlSessionMessageRecord[]): ControlSessionMessageRecord[] {
  return messages.filter((message) => message.role !== "system");
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
  },
  content: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  messageRow: {
    gap: theme.spacing[1],
    borderBottomWidth: RNStyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
    paddingBottom: theme.spacing[3],
  },
  messageRole: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  messageText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  spokenCard: {
    alignSelf: "flex-start",
    gap: theme.spacing[2],
    maxWidth: "100%",
    backgroundColor: theme.colors.surface1,
    borderColor: theme.colors.border,
    borderWidth: RNStyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
  spokenHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  spokenIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
  },
  spokenLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  spokenText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: 22,
  },
  muted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  spinnerColor: {
    color: theme.colors.foregroundMuted,
  },
}));

const ThemedMicVocal = withUnistyles(MicVocal);
const iconColorMapping = StyleSheet.create((theme) => ({
  color: theme.colors.accent,
}));

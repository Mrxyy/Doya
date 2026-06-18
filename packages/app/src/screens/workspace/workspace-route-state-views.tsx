import { Text, View } from "react-native";
import { ArrowLeftToLine, RotateCw, Settings } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { DoyaLoadingMark } from "@/components/doya-loading-mark";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isDev } from "@/constants/platform";
import { formatConnectionStatus } from "@/utils/daemons";
import type { WorkspaceRouteState } from "@/screens/workspace/workspace-route-state";
import { translateNow } from "@/i18n/i18n";

interface WorkspaceRouteStateActions {
  onRetryHost: () => void;
  onManageHost: () => void;
  onDismissMissingWorkspace: () => void;
}

export function renderWorkspaceRouteGate(input: {
  state: WorkspaceRouteState;
  actions: WorkspaceRouteStateActions;
}): React.ReactNode {
  switch (input.state.kind) {
    case "loading":
      return (
        <WorkspaceConnecting
          hostName={input.state.hostName}
          hostAddress={input.state.hostAddress}
        />
      );
    case "unreachable":
      return (
        <WorkspaceUnreachable
          state={input.state}
          onRetry={input.actions.onRetryHost}
          onManageHost={input.actions.onManageHost}
        />
      );
    case "missing":
      return (
        <WorkspaceMissing
          hostName={input.state.hostName}
          onDismiss={input.actions.onDismissMissingWorkspace}
        />
      );
    case "ready":
    case "reconnecting":
      return null;
  }
}

function getWorkspaceHostStateTitle(
  state: Extract<WorkspaceRouteState, { kind: "unreachable" }>,
): string {
  if (state.connectionStatus === "connecting" || state.connectionStatus === "idle") {
    return "Connecting";
  }
  if (state.connectionStatus === "offline") {
    return `${state.hostName} is offline`;
  }
  return `Cannot reach ${state.hostName}`;
}

function WorkspaceConnecting({
  hostName,
  hostAddress,
}: {
  hostName: string;
  hostAddress?: string;
}) {
  const developmentLabel = hostAddress ?? hostName;

  return (
    <View style={styles.emptyState}>
      <DoyaLoadingMark />
      <View style={styles.textStack}>
        <Text style={styles.title}>Connecting</Text>
        {isDev ? <Text style={styles.description}>{developmentLabel}</Text> : null}
      </View>
    </View>
  );
}

function WorkspaceUnreachable({
  state,
  onRetry,
  onManageHost,
}: {
  state: Extract<WorkspaceRouteState, { kind: "unreachable" }>;
  onRetry: () => void;
  onManageHost: () => void;
}) {
  const isConnecting = state.connectionStatus === "connecting" || state.connectionStatus === "idle";
  const canRetry = state.connectionStatus === "offline" || state.connectionStatus === "error";

  return (
    <View style={styles.emptyState}>
      {isConnecting ? <DoyaLoadingMark /> : null}
      <View style={styles.textStack}>
        <Text style={styles.title}>{getWorkspaceHostStateTitle(state)}</Text>
        {isConnecting && isDev ? (
          <Text style={styles.description}>{state.hostAddress ?? state.hostName}</Text>
        ) : null}
        {!isConnecting ? (
          <Text style={styles.description}>
            Host status: {formatConnectionStatus(state.connectionStatus)}
          </Text>
        ) : null}
        {state.lastError ? (
          <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
            <TooltipTrigger asChild>
              <Text style={styles.error} numberOfLines={3}>
                {state.lastError}
              </Text>
            </TooltipTrigger>
            <TooltipContent side="top" align="center" offset={8}>
              <Text style={styles.errorTooltip}>{state.lastError}</Text>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </View>
      {canRetry ? (
        <View style={styles.actions}>
          <Button size="sm" variant="default" leftIcon={RotateCw} onPress={onRetry}>
            {translateNow("ui.retry.1ay360")}
          </Button>
          <Button size="sm" variant="outline" leftIcon={Settings} onPress={onManageHost}>
            {translateNow("ui.manage.host.qznomb")}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

function WorkspaceMissing({ hostName, onDismiss }: { hostName: string; onDismiss: () => void }) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.textStack}>
        <Text style={styles.title}>{translateNow("ui.workspace.not.found.6mtbm2")}</Text>
        <Text style={styles.description}>{hostName}</Text>
      </View>
      <View style={styles.actions}>
        <Button size="sm" variant="default" leftIcon={ArrowLeftToLine} onPress={onDismiss}>
          {translateNow("ui.back.187if")}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[6],
  },
  textStack: {
    alignItems: "center",
    gap: theme.spacing[2],
    maxWidth: 520,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    textAlign: "center",
  },
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    lineHeight: Math.round(theme.fontSize.sm * 1.4),
    textAlign: "center",
  },
  errorTooltip: {
    color: theme.colors.popoverForeground,
    fontSize: theme.fontSize.sm,
    maxWidth: 420,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
}));

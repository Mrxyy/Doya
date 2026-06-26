import { Suspense, lazy, useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import {
  loadAccountBootstrapSession,
  subscribeAccountSessionChanges,
  type AccountBootstrapSession,
} from "@/account/account-api";
import { selectAccountSessionForDirectHost } from "@/account/account-workspace-display";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { HostRuntimeStartupGate } from "@/components/host-runtime-startup-gate";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";

const NewSessionDraftScreen = lazy(() =>
  import("@/screens/new-session-draft-screen").then((module) => ({
    default: module.NewSessionDraftScreen,
  })),
);

export default function HostHomeRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <HostHomeRouteContent />
    </HostRouteBootstrapBoundary>
  );
}

function HostHomeRouteContent() {
  const params = useLocalSearchParams<{ serverId?: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const snapshot = useHostRuntimeSnapshot(serverId);
  const directHostEndpoint =
    snapshot?.activeConnection?.type === "directTcp" ? snapshot.activeConnection.endpoint : null;
  const [accountSession, setAccountSession] = useState<AccountBootstrapSession | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      void (async () => {
        const stored = await loadAccountBootstrapSession();
        if (!disposed) {
          setAccountSession(
            stored?.workspace.workspaceId.startsWith("control:") === true
              ? stored
              : selectAccountSessionForDirectHost({
                  session: stored,
                  endpoint: directHostEndpoint,
                }),
          );
        }
      })();
    };
    refresh();
    const unsubscribe = subscribeAccountSessionChanges(refresh);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [directHostEndpoint]);

  if (accountSession === undefined) {
    return null;
  }

  return (
    <HostRuntimeStartupGate serverId={serverId}>
      <Suspense fallback={null}>
        <NewSessionDraftScreen serverId={serverId} accountSession={accountSession} />
      </Suspense>
    </HostRuntimeStartupGate>
  );
}

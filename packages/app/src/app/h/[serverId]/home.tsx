import { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import {
  loadAccountBootstrapSession,
  subscribeAccountSessionChanges,
  type AccountBootstrapSession,
} from "@/account/account-api";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { NewSessionDraftScreen } from "@/screens/new-session-draft-screen";

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
  const [accountSession, setAccountSession] = useState<AccountBootstrapSession | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      void (async () => {
        const stored = await loadAccountBootstrapSession();
        if (!disposed) {
          setAccountSession(stored);
        }
      })();
    };
    refresh();
    const unsubscribe = subscribeAccountSessionChanges(refresh);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  if (accountSession === undefined) {
    return null;
  }

  return <NewSessionDraftScreen serverId={serverId} accountSession={accountSession} />;
}

import { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { OpenProjectScreen } from "@/screens/open-project-screen";
import { loadAccountBootstrapSession, type AccountBootstrapSession } from "@/account/account-api";
import { NewSessionDraftScreen } from "@/screens/new-session-draft-screen";

export default function HostOpenProjectRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <HostOpenProjectRouteContent />
    </HostRouteBootstrapBoundary>
  );
}

function HostOpenProjectRouteContent() {
  const params = useLocalSearchParams<{ serverId?: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const [accountSession, setAccountSession] = useState<AccountBootstrapSession | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const stored = await loadAccountBootstrapSession();
      if (!disposed) {
        setAccountSession(stored);
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);

  if (accountSession === undefined) {
    return null;
  }
  if (accountSession) {
    return <NewSessionDraftScreen serverId={serverId} accountSession={accountSession} />;
  }

  return <OpenProjectScreen serverId={serverId} />;
}

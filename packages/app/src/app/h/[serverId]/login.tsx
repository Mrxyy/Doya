import { useEffect, useState } from "react";
import { Redirect, useLocalSearchParams } from "expo-router";
import { loadAccountBootstrapSession, type AccountBootstrapSession } from "@/account/account-api";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { OpenProjectScreen } from "@/screens/open-project-screen";
import { buildHostHomeRoute } from "@/utils/host-routes";

export default function HostLoginRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <HostLoginRouteContent />
    </HostRouteBootstrapBoundary>
  );
}

function HostLoginRouteContent() {
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
    return <Redirect href={buildHostHomeRoute(serverId)} />;
  }

  return <OpenProjectScreen serverId={serverId} />;
}

import { Redirect, useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { buildHostHomeRoute } from "@/utils/host-routes";

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
  return <Redirect href={buildHostHomeRoute(serverId)} />;
}

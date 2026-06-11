import { useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { AiCreationScreen } from "@/screens/ai-creation-screen";

export default function HostAiCreationRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <HostAiCreationRouteContent />
    </HostRouteBootstrapBoundary>
  );
}

function HostAiCreationRouteContent() {
  const params = useLocalSearchParams<{ serverId?: string; edit?: string | string[] }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  const restoreEditSource = params.edit === "result";

  return <AiCreationScreen serverId={serverId} restoreEditSource={restoreEditSource} />;
}

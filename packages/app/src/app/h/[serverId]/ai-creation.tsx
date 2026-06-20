import { useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { HostRuntimeStartupGate } from "@/components/host-runtime-startup-gate";
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

  return (
    <HostRuntimeStartupGate serverId={serverId}>
      <AiCreationScreen serverId={serverId} restoreEditSource={restoreEditSource} />
    </HostRuntimeStartupGate>
  );
}

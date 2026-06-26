import { Suspense, lazy } from "react";
import { useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { HostRuntimeStartupGate } from "@/components/host-runtime-startup-gate";

const AiCreationScreen = lazy(() =>
  import("@/screens/ai-creation-screen").then((module) => ({
    default: module.AiCreationScreen,
  })),
);

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
      <Suspense fallback={null}>
        <AiCreationScreen serverId={serverId} restoreEditSource={restoreEditSource} />
      </Suspense>
    </HostRuntimeStartupGate>
  );
}

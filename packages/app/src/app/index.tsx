import { Redirect, usePathname } from "expo-router";
import { StartupSplashScreen } from "@/screens/startup-splash-screen";
import { useEarliestOnlineHostServerId, useHostRuntimeBootstrapState } from "@/app/_layout";
import { resolveStartupRedirectRoute } from "@/app/host-runtime-bootstrap";
import { useHosts } from "@/runtime/host-runtime";
import {
  useIsLastWorkspaceSelectionHydrated,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { shouldUseDesktopDaemon } from "@/desktop/daemon/desktop-daemon";
import { buildHostHomeRoute } from "@/utils/host-routes";

const isDesktop = shouldUseDesktopDaemon();

export default function Index() {
  const pathname = usePathname();
  const bootstrapState = useHostRuntimeBootstrapState();
  const hosts = useHosts();
  const startupHostServerId = hosts[0]?.serverId ?? null;
  const anyOnlineHostServerId = useEarliestOnlineHostServerId();
  const workspaceSelection = useLastWorkspaceSelection();
  const isWorkspaceSelectionLoaded = useIsLastWorkspaceSelectionHydrated();

  const redirectRoute = resolveStartupRedirectRoute({
    pathname,
    anyOnlineHostServerId,
    workspaceSelection,
    isWorkspaceSelectionLoaded,
    hasGivenUpWaitingForHost: bootstrapState.hasGivenUpWaitingForHost,
  });

  if (redirectRoute) {
    return <Redirect href={redirectRoute} />;
  }

  if (anyOnlineHostServerId) {
    return <Redirect href={buildHostHomeRoute(anyOnlineHostServerId)} />;
  }

  if (startupHostServerId) {
    return <Redirect href={buildHostHomeRoute(startupHostServerId)} />;
  }

  return <StartupSplashScreen bootstrapState={isDesktop ? bootstrapState : undefined} />;
}

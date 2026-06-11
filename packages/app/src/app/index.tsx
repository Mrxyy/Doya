import { Redirect, usePathname } from "expo-router";
import { StartupSplashScreen } from "@/screens/startup-splash-screen";
import { useEarliestOnlineHostServerId, useHostRuntimeBootstrapState } from "@/app/_layout";
import { resolveStartupRedirectRoute } from "@/app/host-runtime-bootstrap";
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

  return <StartupSplashScreen bootstrapState={isDesktop ? bootstrapState : undefined} />;
}

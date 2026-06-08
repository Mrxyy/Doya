import React, { useEffect, useState } from "react";
import { Redirect, usePathname } from "expo-router";
import { StartupSplashScreen } from "@/screens/startup-splash-screen";
import { useEarliestOnlineHostServerId, useHostRuntimeBootstrapState } from "@/app/_layout";
import {
  resolveStartupRedirectRoute,
  resolveStartupWorkspaceSelection,
} from "@/app/host-runtime-bootstrap";
import {
  useIsLastWorkspaceSelectionHydrated,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { shouldUseDesktopDaemon } from "@/desktop/daemon/desktop-daemon";
import { loadAccountBootstrapSession, type AccountBootstrapSession } from "@/account/account-api";
import { doesAccountSessionOwnWorkspace } from "@/account/account-workspace-display";
import { useWorkspace } from "@/stores/session-store-hooks";
import { buildHostOpenProjectRoute, buildHostWorkspaceRoute } from "@/utils/host-routes";

const isDesktop = shouldUseDesktopDaemon();

export default function Index() {
  const pathname = usePathname();
  const bootstrapState = useHostRuntimeBootstrapState();
  const anyOnlineHostServerId = useEarliestOnlineHostServerId();
  const workspaceSelection = useLastWorkspaceSelection();
  const isWorkspaceSelectionLoaded = useIsLastWorkspaceSelectionHydrated();
  const [accountSession, setAccountSession] = useState<AccountBootstrapSession | null>(null);
  const [hasLoadedAccount, setHasLoadedAccount] = useState(false);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const stored = await loadAccountBootstrapSession();
      if (!disposed) {
        setAccountSession(stored);
        setHasLoadedAccount(true);
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);

  const redirectRoute = resolveStartupRedirectRoute({
    pathname,
    anyOnlineHostServerId,
    workspaceSelection,
    isWorkspaceSelectionLoaded,
    hasGivenUpWaitingForHost: bootstrapState.hasGivenUpWaitingForHost,
  });
  const startupWorkspaceSelection = resolveStartupWorkspaceSelection({
    pathname,
    anyOnlineHostServerId,
    workspaceSelection,
    isWorkspaceSelectionLoaded,
    hasGivenUpWaitingForHost: bootstrapState.hasGivenUpWaitingForHost,
  });
  const startupWorkspace = useWorkspace(
    startupWorkspaceSelection?.serverId ?? null,
    startupWorkspaceSelection?.workspaceId ?? null,
  );
  const canOpenStartupWorkspace =
    !startupWorkspaceSelection ||
    doesAccountSessionOwnWorkspace({
      session: accountSession,
      workspaceDirectory: startupWorkspace?.workspaceDirectory,
    });

  if (anyOnlineHostServerId && !hasLoadedAccount) {
    return <StartupSplashScreen bootstrapState={isDesktop ? bootstrapState : undefined} />;
  }

  if (anyOnlineHostServerId && !accountSession) {
    return <Redirect href={buildHostOpenProjectRoute(anyOnlineHostServerId)} />;
  }

  if (startupWorkspaceSelection && !canOpenStartupWorkspace && anyOnlineHostServerId) {
    return <Redirect href={buildHostOpenProjectRoute(anyOnlineHostServerId)} />;
  }

  if (startupWorkspaceSelection && canOpenStartupWorkspace) {
    return (
      <Redirect
        href={buildHostWorkspaceRoute(
          startupWorkspaceSelection.serverId,
          startupWorkspaceSelection.workspaceId,
        )}
      />
    );
  }

  if (redirectRoute) {
    return <Redirect href={redirectRoute} />;
  }

  return <StartupSplashScreen bootstrapState={isDesktop ? bootstrapState : undefined} />;
}

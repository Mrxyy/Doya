import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadAccountBootstrapSession,
  subscribeAccountSessionChanges,
  type AccountBootstrapSession,
} from "@/account/account-api";
import {
  getControlAgentBinding,
  isControlApiConfigured,
  listControlSessions,
  type ControlSessionRecord,
} from "@/control/control-api";
import { subscribeControlSessionChanges } from "@/control/control-session-events";

const BINDING_CACHE_TTL_MS = 5_000;
const CONTROL_SESSION_RELOAD_DEBOUNCE_MS = 120;

export interface ControlSessionAgentBindingSummary {
  nodeId: string;
  agentId: string;
  workspaceId: string | null;
  cwd: string | null;
}

export interface UseControlSessionsResult {
  accountSession: AccountBootstrapSession | null;
  sessions: ControlSessionRecord[];
  agentBindingsBySessionId: Map<string, ControlSessionAgentBindingSummary>;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

interface CachedControlSessionAgentBinding {
  expiresAt: number;
  value: [string, ControlSessionAgentBindingSummary] | null;
}

const bindingCache = new Map<string, CachedControlSessionAgentBinding>();
const bindingInflight = new Map<
  string,
  Promise<[string, ControlSessionAgentBindingSummary] | null>
>();

export function useControlSessions(): UseControlSessionsResult {
  const [accountSession, setAccountSession] = useState<AccountBootstrapSession | null>(null);
  const [sessions, setSessions] = useState<ControlSessionRecord[]>([]);
  const [agentBindingsBySessionId, setAgentBindingsBySessionId] = useState<
    Map<string, ControlSessionAgentBindingSummary>
  >(new Map());
  const [isLoading, setIsLoading] = useState(isControlApiConfigured());
  const [error, setError] = useState<string | null>(null);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback((isDisposed?: () => boolean) => {
    if (!isControlApiConfigured()) {
      setAccountSession(null);
      setSessions([]);
      setAgentBindingsBySessionId(new Map());
      setIsLoading(false);
      setError(null);
      return;
    }
    setIsLoading(true);
    void (async () => {
      const stored = await loadAccountBootstrapSession();
      if (!stored || !stored.workspace.workspaceId.startsWith("control:")) {
        if (!isDisposed?.()) {
          setAccountSession(null);
          setSessions([]);
          setAgentBindingsBySessionId(new Map());
          setError(null);
          setIsLoading(false);
        }
        return;
      }
      try {
        const nextSessions = await listControlSessions({ accountSession: stored, limit: 200 });
        const nextAgentBindingsBySessionId = await loadControlSessionAgentBindings({
          accountSession: stored,
          sessions: nextSessions,
        });
        if (!isDisposed?.()) {
          setAccountSession(stored);
          setSessions(nextSessions);
          setAgentBindingsBySessionId(nextAgentBindingsBySessionId);
          setError(null);
        }
      } catch (caught) {
        if (!isDisposed?.()) {
          setAccountSession(stored);
          setSessions([]);
          setAgentBindingsBySessionId(new Map());
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      } finally {
        if (!isDisposed?.()) {
          setIsLoading(false);
        }
      }
    })();
  }, []);

  useEffect(() => {
    let disposed = false;
    const isDisposed = () => disposed;
    const scheduleReload = () => {
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
      }
      reloadTimerRef.current = setTimeout(() => {
        reloadTimerRef.current = null;
        reload(isDisposed);
      }, CONTROL_SESSION_RELOAD_DEBOUNCE_MS);
    };
    reload(isDisposed);
    const unsubscribeAccount = subscribeAccountSessionChanges(() => reload(isDisposed));
    const unsubscribeSessions = subscribeControlSessionChanges(scheduleReload);
    return () => {
      disposed = true;
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
      unsubscribeAccount();
      unsubscribeSessions();
    };
  }, [reload]);

  return {
    accountSession,
    sessions,
    agentBindingsBySessionId,
    isLoading,
    error,
    refetch: () => reload(),
  };
}

async function loadControlSessionAgentBindings(input: {
  accountSession: AccountBootstrapSession;
  sessions: ControlSessionRecord[];
}): Promise<Map<string, ControlSessionAgentBindingSummary>> {
  const entries = await Promise.all(
    input.sessions.map((session) =>
      loadControlSessionAgentBinding({
        accountSession: input.accountSession,
        sessionId: session.id,
      }),
    ),
  );
  return new Map(
    entries.filter((entry): entry is [string, ControlSessionAgentBindingSummary] => Boolean(entry)),
  );
}

async function loadControlSessionAgentBinding(input: {
  accountSession: AccountBootstrapSession;
  sessionId: string;
}): Promise<[string, ControlSessionAgentBindingSummary] | null> {
  const cacheKey = `${input.accountSession.apiBaseUrl}:${input.accountSession.user.userId}:${input.sessionId}`;
  const cached = bindingCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const inflight = bindingInflight.get(cacheKey);
  if (inflight) {
    return await inflight;
  }
  const request = fetchControlSessionAgentBinding(input).finally(() => {
    bindingInflight.delete(cacheKey);
  });
  bindingInflight.set(cacheKey, request);
  const value = await request;
  bindingCache.set(cacheKey, {
    expiresAt: Date.now() + BINDING_CACHE_TTL_MS,
    value,
  });
  return value;
}

async function fetchControlSessionAgentBinding(input: {
  accountSession: AccountBootstrapSession;
  sessionId: string;
}): Promise<[string, ControlSessionAgentBindingSummary] | null> {
  try {
    const response = await getControlAgentBinding(input);
    const binding = response.binding;
    if (!binding || binding.status !== "active") {
      return null;
    }
    return [
      input.sessionId,
      {
        nodeId: binding.nodeId,
        agentId: binding.agentId,
        workspaceId: binding.workspaceId,
        cwd: binding.cwd,
      },
    ];
  } catch {
    return null;
  }
}

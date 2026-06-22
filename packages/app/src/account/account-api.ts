import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  controlApiBaseUrl,
  isControlApiConfigured,
  loginControlAccount,
  loginControlAccountWithSms,
  refreshControlAccountSession,
  registerControlAccount,
  sendControlAccountSmsCode,
} from "@/control/control-api";
import { isWeb } from "@/constants/platform";
import { translateNow } from "@/i18n/i18n";

const ACCOUNT_SESSION_STORAGE_KEY = "doya.account.session.v1";
const LEGACY_BRAND_STORAGE_PREFIX = "pa" + "seo";
const LEGACY_ACCOUNT_SESSION_STORAGE_KEY = `${LEGACY_BRAND_STORAGE_PREFIX}.account.session.v1`;
const LEGACY_HOSTED_SESSION_STORAGE_KEY = `${LEGACY_BRAND_STORAGE_PREFIX}.hosted.session.v1`;
const LEGACY_ACCOUNT_SESSION_STORAGE_KEYS = [
  LEGACY_ACCOUNT_SESSION_STORAGE_KEY,
  LEGACY_HOSTED_SESSION_STORAGE_KEY,
].filter((key) => key !== ACCOUNT_SESSION_STORAGE_KEY);
const accountSessionListeners = new Set<() => void>();

export interface AccountUserRecord {
  userId: string;
  email: string;
  phone?: string | null;
}

export interface AccountWorkspaceRecord {
  workspaceId: string;
  displayName: string;
  runtime: {
    cwd: string;
  } | null;
}

export interface AccountProjectRecord {
  projectId: string;
  workspaceId: string;
  displayName: string;
  cwd: string;
}

export interface AccountBootstrapSession {
  user: AccountUserRecord;
  workspace: AccountWorkspaceRecord;
  projects: AccountProjectRecord[];
  accessToken: string;
  apiBaseUrl: string;
}

interface AccountAuthResponse {
  user: AccountUserRecord;
  workspace: AccountWorkspaceRecord;
  projects: AccountProjectRecord[];
  accessToken: string;
}

interface AccountErrorPayload {
  error?: string;
}

export function accountApiBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_ACCOUNT_API_URL;
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }

  const localDaemon = process.env.EXPO_PUBLIC_LOCAL_DAEMON;
  if (!localDaemon) {
    const webHost = getCurrentWebHost();
    if (webHost) {
      if (webHost.protocol === "https:") {
        return `${webHost.origin}`;
      }
      return `${webHost.protocol}//${webHost.hostname}:6767`;
    }
    return "http://127.0.0.1:6767";
  }

  const trimmed = localDaemon.trim().replace(/\/$/, "");
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  if (trimmed.startsWith("ws://")) {
    return `http://${trimmed.slice("ws://".length)}`;
  }
  if (trimmed.startsWith("wss://")) {
    return `https://${trimmed.slice("wss://".length)}`;
  }
  return `http://${trimmed}`;
}

function getCurrentWebHost(): {
  origin: string;
  protocol: "http:" | "https:";
  hostname: string;
} | null {
  if (!isWeb) {
    return null;
  }
  const location = globalThis.location;
  if (!location.hostname || (location.protocol !== "http:" && location.protocol !== "https:")) {
    return null;
  }
  return { origin: location.origin, protocol: location.protocol, hostname: location.hostname };
}

export async function loadAccountBootstrapSession(): Promise<AccountBootstrapSession | null> {
  const currentRaw = await AsyncStorage.getItem(ACCOUNT_SESSION_STORAGE_KEY);
  const legacyRaw = currentRaw ? null : await loadLegacyAccountBootstrapSessionRaw();
  const raw = currentRaw ?? legacyRaw;
  if (!raw) {
    return null;
  }
  try {
    const session = normalizeStoredAccountBootstrapSession(JSON.parse(raw));
    if (!session.accessToken) {
      await removeAccountSessionStorageItems([
        ACCOUNT_SESSION_STORAGE_KEY,
        ...LEGACY_ACCOUNT_SESSION_STORAGE_KEYS,
      ]);
      return null;
    }
    if (isControlApiConfigured() && !isControlBootstrapSession(session)) {
      await removeAccountSessionStorageItems([
        ACCOUNT_SESSION_STORAGE_KEY,
        ...LEGACY_ACCOUNT_SESSION_STORAGE_KEYS,
      ]);
      return null;
    }
    const migratedSession = {
      ...session,
      projects: Array.isArray(session.projects) ? session.projects : [],
      apiBaseUrl: resolveAccountSessionApiBaseUrl(session),
    };
    await persistAccountBootstrapSession(migratedSession);
    return migratedSession;
  } catch {
    await removeAccountSessionStorageItems([
      ACCOUNT_SESSION_STORAGE_KEY,
      ...LEGACY_ACCOUNT_SESSION_STORAGE_KEYS,
    ]);
    return null;
  }
}

export async function saveAccountBootstrapSession(session: AccountBootstrapSession): Promise<void> {
  await persistAccountBootstrapSession(session);
  notifyAccountSessionChanged();
}

async function persistAccountBootstrapSession(session: AccountBootstrapSession): Promise<void> {
  await AsyncStorage.setItem(ACCOUNT_SESSION_STORAGE_KEY, JSON.stringify(session));
  await removeAccountSessionStorageItems(LEGACY_ACCOUNT_SESSION_STORAGE_KEYS);
}

export async function clearAccountBootstrapSession(): Promise<void> {
  await removeAccountSessionStorageItems([
    ACCOUNT_SESSION_STORAGE_KEY,
    ...LEGACY_ACCOUNT_SESSION_STORAGE_KEYS,
  ]);
  notifyAccountSessionChanged();
}

async function loadLegacyAccountBootstrapSessionRaw(): Promise<string | null> {
  for (const key of LEGACY_ACCOUNT_SESSION_STORAGE_KEYS) {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      return raw;
    }
  }
  return null;
}

async function removeAccountSessionStorageItems(keys: string[]): Promise<void> {
  await Promise.all([...new Set(keys)].map((key) => AsyncStorage.removeItem(key)));
}

export function subscribeAccountSessionChanges(listener: () => void): () => void {
  accountSessionListeners.add(listener);
  return () => {
    accountSessionListeners.delete(listener);
  };
}

export async function refreshAccountBootstrapSession(
  session: AccountBootstrapSession,
): Promise<AccountBootstrapSession> {
  if (isControlApiConfigured() && isControlBootstrapSession(session)) {
    return refreshControlAccountSession(session);
  }
  const payload = await postLegacyAccountApi<AccountAuthResponse>("/api/account/session", {
    userId: session.user.userId,
    accessToken: session.accessToken,
  });
  return {
    ...payload,
    projects: payload.projects ?? [],
    apiBaseUrl: accountApiBaseUrl(),
  };
}

export async function registerAccountUser(input: {
  email: string;
  displayName: string;
}): Promise<AccountBootstrapSession> {
  if (isControlApiConfigured()) {
    return registerControlAccount({ email: input.email });
  }
  const payload = await postLegacyAccountApi<AccountAuthResponse>("/api/account/register", input);
  return {
    ...payload,
    projects: payload.projects ?? [],
    apiBaseUrl: accountApiBaseUrl(),
  };
}

export async function loginAccountUser(input: { email: string }): Promise<AccountBootstrapSession> {
  if (isControlApiConfigured()) {
    return loginControlAccount(input);
  }
  const payload = await postLegacyAccountApi<AccountAuthResponse>("/api/account/login", input);
  return {
    ...payload,
    projects: payload.projects ?? [],
    apiBaseUrl: accountApiBaseUrl(),
  };
}

export async function sendAccountSmsCode(input: { phone: string }): Promise<void> {
  await sendControlAccountSmsCode(input);
}

export async function loginAccountUserWithSms(input: {
  phone: string;
  code: string;
  displayName: string;
}): Promise<AccountBootstrapSession> {
  return loginControlAccountWithSms(input);
}

export async function postLegacyAccountApi<T extends object>(
  path: string,
  input: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${accountApiBaseUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error(translateNow("account.error.connectDaemon"));
  }

  let payload: T | AccountErrorPayload;
  try {
    payload = (await response.json()) as T | AccountErrorPayload;
  } catch {
    if (!response.ok) {
      throw new Error(`${translateNow("account.error.requestFailed")} (${response.status})`);
    }
    throw new Error(translateNow("account.error.invalidDaemonResponse"));
  }

  if (!response.ok) {
    throw new Error(
      "error" in payload && payload.error
        ? payload.error
        : translateNow("account.error.requestFailed"),
    );
  }
  return payload as T;
}

function notifyAccountSessionChanged(): void {
  for (const listener of accountSessionListeners) {
    listener();
  }
}

function isControlBootstrapSession(session: AccountBootstrapSession): boolean {
  return session.workspace?.workspaceId.startsWith("control:") === true;
}

function resolveAccountSessionApiBaseUrl(session: AccountBootstrapSession): string {
  if (isControlBootstrapSession(session)) {
    return controlApiBaseUrl() ?? session.apiBaseUrl;
  }
  return accountApiBaseUrl();
}

function normalizeStoredAccountBootstrapSession(value: unknown): AccountBootstrapSession {
  const session = value as Partial<AccountBootstrapSession>;
  const user = session.user;
  const workspace =
    session.workspace ??
    (user?.userId
      ? {
          workspaceId: `control:${user.userId}`,
          displayName: "Doya",
          runtime: null,
        }
      : undefined);
  return {
    user: user as AccountBootstrapSession["user"],
    workspace: workspace as AccountBootstrapSession["workspace"],
    projects: Array.isArray(session.projects) ? session.projects : [],
    accessToken: typeof session.accessToken === "string" ? session.accessToken : "",
    apiBaseUrl: accountApiBaseUrl(),
  };
}

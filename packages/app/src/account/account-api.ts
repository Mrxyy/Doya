import AsyncStorage from "@react-native-async-storage/async-storage";
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

interface AccountSmsSendResponse {
  ok: boolean;
}

interface AccountCreateProjectResponse {
  project: AccountProjectRecord;
}

interface AccountDeleteProjectResponse {
  projects: AccountProjectRecord[];
}

interface AccountRenameProjectResponse {
  projects: AccountProjectRecord[];
}

interface AccountErrorPayload {
  error?: string;
}

function accountApiBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_ACCOUNT_API_URL;
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }

  const localDaemon = process.env.EXPO_PUBLIC_LOCAL_DAEMON;
  if (!localDaemon) {
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

export async function loadAccountBootstrapSession(): Promise<AccountBootstrapSession | null> {
  const currentRaw = await AsyncStorage.getItem(ACCOUNT_SESSION_STORAGE_KEY);
  const legacyRaw = currentRaw ? null : await loadLegacyAccountBootstrapSessionRaw();
  const raw = currentRaw ?? legacyRaw;
  if (!raw) {
    return null;
  }
  try {
    const session = JSON.parse(raw) as AccountBootstrapSession;
    if (!session.accessToken) {
      await removeAccountSessionStorageItems([
        ACCOUNT_SESSION_STORAGE_KEY,
        ...LEGACY_ACCOUNT_SESSION_STORAGE_KEYS,
      ]);
      return null;
    }
    const migratedSession = {
      ...session,
      projects: Array.isArray(session.projects) ? session.projects : [],
      apiBaseUrl: accountApiBaseUrl(),
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
  const payload = await postAccountApi<AccountAuthResponse>("/api/account/session", {
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
  const payload = await postAccountApi<AccountAuthResponse>("/api/account/register", input);
  return {
    ...payload,
    projects: payload.projects ?? [],
    apiBaseUrl: accountApiBaseUrl(),
  };
}

export async function loginAccountUser(input: { email: string }): Promise<AccountBootstrapSession> {
  const payload = await postAccountApi<AccountAuthResponse>("/api/account/login", input);
  return {
    ...payload,
    projects: payload.projects ?? [],
    apiBaseUrl: accountApiBaseUrl(),
  };
}

export async function sendAccountSmsCode(input: { phone: string }): Promise<void> {
  await postAccountApi<AccountSmsSendResponse>("/api/account/sms/send", input);
}

export async function loginAccountUserWithSms(input: {
  phone: string;
  code: string;
  displayName: string;
}): Promise<AccountBootstrapSession> {
  const payload = await postAccountApi<AccountAuthResponse>("/api/account/sms/login", input);
  return {
    ...payload,
    projects: payload.projects ?? [],
    apiBaseUrl: accountApiBaseUrl(),
  };
}

export async function createAccountProject(input: {
  userId: string;
  workspaceId: string;
  accessToken: string;
  displayName: string;
}): Promise<AccountProjectRecord> {
  const payload = await postAccountApi<AccountCreateProjectResponse>(
    "/api/account/projects",
    input,
  );
  return payload.project;
}

export async function deleteAccountProject(input: {
  userId: string;
  workspaceId: string;
  projectId: string;
  accessToken: string;
}): Promise<AccountProjectRecord[]> {
  const payload = await postAccountApi<AccountDeleteProjectResponse>(
    "/api/account/projects/delete",
    input,
  );
  return payload.projects ?? [];
}

export async function renameAccountProject(input: {
  userId: string;
  workspaceId: string;
  projectId: string;
  accessToken: string;
  displayName: string;
}): Promise<AccountProjectRecord[]> {
  const payload = await postAccountApi<AccountRenameProjectResponse>(
    "/api/account/projects/rename",
    input,
  );
  return payload.projects ?? [];
}

async function postAccountApi<T extends object>(path: string, input: unknown): Promise<T> {
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

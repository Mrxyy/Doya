import AsyncStorage from "@react-native-async-storage/async-storage";
import { translateNow } from "@/i18n/i18n";

const ACCOUNT_SESSION_STORAGE_KEY = "paseo.account.session.v1";
const LEGACY_HOSTED_SESSION_STORAGE_KEY = "paseo.hosted.session.v1";
const accountSessionListeners = new Set<() => void>();

export interface AccountUserRecord {
  userId: string;
  email: string;
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

interface AccountCreateProjectResponse {
  project: AccountProjectRecord;
}

interface AccountDeleteProjectResponse {
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
  const legacyRaw = currentRaw
    ? null
    : await AsyncStorage.getItem(LEGACY_HOSTED_SESSION_STORAGE_KEY);
  const raw = currentRaw ?? legacyRaw;
  if (!raw) {
    return null;
  }
  try {
    const session = JSON.parse(raw) as AccountBootstrapSession;
    if (!session.accessToken) {
      await AsyncStorage.removeItem(ACCOUNT_SESSION_STORAGE_KEY);
      await AsyncStorage.removeItem(LEGACY_HOSTED_SESSION_STORAGE_KEY);
      return null;
    }
    const migratedSession = {
      ...session,
      projects: Array.isArray(session.projects) ? session.projects : [],
      apiBaseUrl: accountApiBaseUrl(),
    };
    await persistAccountBootstrapSession(migratedSession);
    await AsyncStorage.removeItem(LEGACY_HOSTED_SESSION_STORAGE_KEY);
    return migratedSession;
  } catch {
    await AsyncStorage.removeItem(ACCOUNT_SESSION_STORAGE_KEY);
    await AsyncStorage.removeItem(LEGACY_HOSTED_SESSION_STORAGE_KEY);
    return null;
  }
}

export async function saveAccountBootstrapSession(session: AccountBootstrapSession): Promise<void> {
  await persistAccountBootstrapSession(session);
  notifyAccountSessionChanged();
}

async function persistAccountBootstrapSession(session: AccountBootstrapSession): Promise<void> {
  await AsyncStorage.setItem(ACCOUNT_SESSION_STORAGE_KEY, JSON.stringify(session));
  await AsyncStorage.removeItem(LEGACY_HOSTED_SESSION_STORAGE_KEY);
}

export async function clearAccountBootstrapSession(): Promise<void> {
  await AsyncStorage.removeItem(ACCOUNT_SESSION_STORAGE_KEY);
  await AsyncStorage.removeItem(LEGACY_HOSTED_SESSION_STORAGE_KEY);
  notifyAccountSessionChanged();
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

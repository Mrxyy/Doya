import AsyncStorage from "@react-native-async-storage/async-storage";

const RUNTIME_NODE_PREFERENCE_STORAGE_KEY = "doya.control.runtime-node-preference.v1";

export type RuntimeNodePreference = { mode: "cloud" } | { mode: "fixed"; nodeId: string };

export async function loadRuntimeNodePreference(): Promise<RuntimeNodePreference> {
  const raw = await AsyncStorage.getItem(RUNTIME_NODE_PREFERENCE_STORAGE_KEY);
  if (!raw) {
    return { mode: "cloud" };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { mode: "cloud" };
    }
    const record = parsed as Record<string, unknown>;
    if (record.mode === "fixed" && typeof record.nodeId === "string" && record.nodeId.trim()) {
      return { mode: "fixed", nodeId: record.nodeId.trim() };
    }
    return { mode: "cloud" };
  } catch {
    return { mode: "cloud" };
  }
}

export async function saveRuntimeNodePreference(
  preference: RuntimeNodePreference,
): Promise<RuntimeNodePreference> {
  const normalized =
    preference.mode === "fixed" && preference.nodeId.trim()
      ? ({ mode: "fixed", nodeId: preference.nodeId.trim() } as const)
      : ({ mode: "cloud" } as const);
  await AsyncStorage.setItem(RUNTIME_NODE_PREFERENCE_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function preferredRuntimeNodeId(preference: RuntimeNodePreference): string | null {
  return preference.mode === "fixed" ? preference.nodeId : null;
}

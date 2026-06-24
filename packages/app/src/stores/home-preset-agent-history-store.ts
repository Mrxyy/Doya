import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { StreamItem } from "@/types/stream";

const HOME_PRESET_AGENT_HISTORY_STORAGE_KEY = "doya:home-preset-agent-history:v1";

interface HomePresetAgentHistoryState {
  historiesByKey: Record<string, StreamItem[]>;
  setHistory: (input: { serverId: string; agentId: string; items: StreamItem[] }) => void;
}

function buildHistoryKey(input: { serverId: string; agentId: string }): string {
  return `${input.serverId}:${input.agentId}`;
}

void AsyncStorage.removeItem(HOME_PRESET_AGENT_HISTORY_STORAGE_KEY);

export const useHomePresetAgentHistoryStore = create<HomePresetAgentHistoryState>()((set) => ({
  historiesByKey: {},
  setHistory: (input) =>
    set((state) => ({
      historiesByKey: {
        ...state.historiesByKey,
        [buildHistoryKey(input)]: input.items,
      },
    })),
}));

export function selectHomePresetAgentHistory(
  state: HomePresetAgentHistoryState,
  input: { serverId: string; agentId: string | undefined },
): StreamItem[] | undefined {
  if (!input.agentId) {
    return undefined;
  }
  return state.historiesByKey[
    buildHistoryKey({ serverId: input.serverId, agentId: input.agentId })
  ];
}

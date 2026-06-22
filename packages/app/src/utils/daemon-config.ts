import type { MutableDaemonConfig } from "@getdoya/protocol/messages";

export interface LockedProviderModel {
  provider: string;
  model: string;
  modeId?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
}

export function getLockedProviderModel(
  config: MutableDaemonConfig | null | undefined,
): LockedProviderModel | null {
  const lockedProviderModel = config?.agents?.lockedProviderModel;
  if (!lockedProviderModel) {
    return null;
  }
  return lockedProviderModel;
}

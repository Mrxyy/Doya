import { create } from "zustand";

export type BillingUpgradeReason = "account" | "balance" | "storage";

interface BillingUpgradeModalState {
  reason: BillingUpgradeReason | null;
  open: (reason?: BillingUpgradeReason) => void;
  close: () => void;
}

export const useBillingUpgradeModalStore = create<BillingUpgradeModalState>((set) => ({
  reason: null,
  open: (reason = "account") => set({ reason }),
  close: () => set({ reason: null }),
}));

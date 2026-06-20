import { create } from "zustand";

interface AccountLoginModalState {
  serverId: string | null;
  referralCode: string | null;
  open: (serverId: string, options?: { referralCode?: string | null }) => void;
  close: () => void;
}

export const useAccountLoginModalStore = create<AccountLoginModalState>((set) => ({
  serverId: null,
  referralCode: null,
  open: (serverId, options) => set({ serverId, referralCode: options?.referralCode ?? null }),
  close: () => set({ serverId: null, referralCode: null }),
}));

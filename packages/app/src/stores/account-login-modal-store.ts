import { create } from "zustand";

interface AccountLoginModalState {
  serverId: string | null;
  open: (serverId: string) => void;
  close: () => void;
}

export const useAccountLoginModalStore = create<AccountLoginModalState>((set) => ({
  serverId: null,
  open: (serverId) => set({ serverId }),
  close: () => set({ serverId: null }),
}));

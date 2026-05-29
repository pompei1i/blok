import { create } from "zustand";

interface BaitStore {
  isTabOpen: boolean;
  isActive: boolean;
  openTab: () => void;
  closeTab: () => void;
  activate: () => void;
  deactivate: () => void;
}

export const useBaitStore = create<BaitStore>((set) => ({
  isTabOpen: false,
  isActive: false,
  openTab: () => set({ isTabOpen: true, isActive: true }),
  closeTab: () => set({ isTabOpen: false, isActive: false }),
  activate: () => set({ isActive: true }),
  deactivate: () => set({ isActive: false }),
}));

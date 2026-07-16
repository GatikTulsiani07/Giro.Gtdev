import { create } from "zustand";

interface UiState {
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  setSidebarOpen(open: boolean): void;
  setInspectorOpen(open: boolean): void;
  toggleInspector(): void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: false,
  inspectorOpen: true,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
}));

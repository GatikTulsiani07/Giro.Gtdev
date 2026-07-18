import { create } from "zustand";

interface UiState {
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  inspectorOpen: boolean;
  historyOpen: boolean;
  chatView: "sessions" | "conversation" | "inspector";
  setSidebarOpen(open: boolean): void;
  setSidebarCollapsed(collapsed: boolean): void;
  toggleSidebarCollapsed(): void;
  setInspectorOpen(open: boolean): void;
  toggleInspector(): void;
  setHistoryOpen(open: boolean): void;
  setChatView(view: "sessions" | "conversation" | "inspector"): void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: false,
  sidebarCollapsed: false,
  inspectorOpen: true,
  historyOpen: false,
  chatView: "conversation",
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  toggleSidebarCollapsed: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
  setHistoryOpen: (historyOpen) => set({ historyOpen }),
  setChatView: (chatView) => set({ chatView }),
}));

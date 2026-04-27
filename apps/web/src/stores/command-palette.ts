import { create } from 'zustand';

/**
 * Tiny zustand store that controls the global Cmd+K palette open state.
 *
 * Lives separately from `ui-preferences` (which is persisted) — palette
 * open-state is purely transient. Anywhere in the app you can call
 * `useCommandPaletteStore.getState().open()` to surface the palette,
 * which is handy from "More actions" menus or empty-state CTAs.
 */
interface CommandPaletteState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  set: (open: boolean) => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  set: (isOpen) => set({ isOpen }),
}));

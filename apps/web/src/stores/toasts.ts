import { create } from 'zustand';

export interface Toast {
  id: string;
  title: string;
  body?: string;
  /** ms until auto-dismissed. Default 5000. */
  duration?: number;
}

interface ToastStore {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: string) => void;
}

let seq = 0;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (t) => {
    const id = String(++seq);
    const duration = t.duration ?? 5000;
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
    }, duration);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

/** Convenience helper — import and call directly in event handlers. */
export function toast(title: string, body?: string, duration?: number): void {
  useToastStore.getState().push({ title, body, duration });
}

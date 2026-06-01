import { create } from 'zustand';
import type {
  CaptureDescriptor,
  ContextSnapshot,
  OpenedCaptureState,
} from '@shared/types/session';

interface CaptureState {
  captures: CaptureDescriptor[];
  contextSnapshot: ContextSnapshot | null;
  openedCapture: OpenedCaptureState | null;

  setContextSnapshot: (snapshot: ContextSnapshot | null) => void;
  setCaptures: (captures: CaptureDescriptor[]) => void;
  addCapture: (capture: CaptureDescriptor) => void;
  updateCapture: (captureId: string, patch: Partial<CaptureDescriptor>) => void;
  removeCapture: (captureId: string) => void;
  setOpenedCapture: (openedCapture: OpenedCaptureState | null) => void;
  reset: () => void;
}

export const useCaptureStore = create<CaptureState>((set) => ({
  captures: [],
  contextSnapshot: null,
  openedCapture: null,

  setContextSnapshot: (snapshot) => set({ contextSnapshot: snapshot }),
  setCaptures: (captures) => set({ captures }),
  addCapture: (capture) => set((state) => ({
    captures: state.captures.some((entry) => entry.id === capture.id)
      ? state.captures.map((entry) => entry.id === capture.id ? { ...entry, ...capture } : entry)
      : [...state.captures, capture],
  })),
  updateCapture: (captureId, patch) => set((state) => ({
    captures: state.captures.map((entry) => entry.id === captureId ? { ...entry, ...patch } : entry),
  })),
  removeCapture: (captureId) => set((state) => ({
    captures: state.captures.filter((entry) => entry.id !== captureId),
  })),
  setOpenedCapture: (openedCapture) => set({ openedCapture }),
  reset: () => set({
    contextSnapshot: null,
    captures: [],
    openedCapture: null,
  }),
}));

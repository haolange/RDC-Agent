import type { ResolvedTheme } from '@shared/types/settings';
import { useCatalogBootstrap } from './useCatalogBootstrap';
import { useProjectInputsBootstrap } from './useProjectInputsBootstrap';
import { useSessionRestoreBootstrap } from './useSessionRestoreBootstrap';
import { useSessionSurfaceBootstrap } from './useSessionSurfaceBootstrap';
import { useShellBootstrap } from './useShellBootstrap';

export function useAppBootstrap(options: {
  setIsLoading: (loading: boolean) => void;
  setConnectionStatus: (status: 'connected' | 'degraded' | 'offline') => void;
  shellReady: boolean;
  setShellReady: (ready: boolean) => void;
  setWindowMaximized: (maximized: boolean) => void;
  resolvedTheme: ResolvedTheme;
}): void {
  useShellBootstrap(options);
  useSessionSurfaceBootstrap(options.shellReady);
  useCatalogBootstrap();
  useProjectInputsBootstrap(options.shellReady);
  useSessionRestoreBootstrap(options.shellReady);
}

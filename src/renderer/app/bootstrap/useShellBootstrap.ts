import { useEffect } from 'react';
import type { ResolvedTheme } from '@shared/types/settings';
import { applyChromeTheme } from '../theme/applyChromeTheme';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { useLayoutStore } from '../../stores/layoutStore';

export function useShellBootstrap(options: {
  setIsLoading: (loading: boolean) => void;
  setConnectionStatus: (status: 'connected' | 'degraded' | 'offline') => void;
  setShellReady: (ready: boolean) => void;
  setWindowMaximized: (maximized: boolean) => void;
  resolvedTheme: ResolvedTheme;
}): void {
  const { setIsLoading, setConnectionStatus, setShellReady, setWindowMaximized, resolvedTheme } = options;
  const settings = useAppSettingsStore((state) => state.settings);
  const hydrateSettings = useAppSettingsStore((state) => state.hydrate);
  const hydrateLayout = useLayoutStore((state) => state.hydrateFromSettings);

  useEffect(() => {
    document.documentElement.lang = settings.appearance.language;
    applyChromeTheme(settings.appearance, resolvedTheme);
  }, [resolvedTheme, settings.appearance]);

  useEffect(() => {
    const initApp = async () => {
      try {
        const electronAPI = window.electronAPI;
        if (!electronAPI) {
          setConnectionStatus('offline');
          return;
        }
        const [appSettings, appMeta, isMaximized] = await Promise.all([
          electronAPI.settings.get(),
          electronAPI.appMeta.get(),
          electronAPI.windowControls.isMaximized().catch(() => false),
        ]);
        hydrateSettings(appSettings, appMeta.systemTheme);
        hydrateLayout(appSettings);
        setShellReady(true);
        setWindowMaximized(isMaximized);
        setConnectionStatus('connected');
      } catch (error) {
        console.error('Failed to initialize app shell:', error);
        setConnectionStatus('degraded');
      } finally {
        setIsLoading(false);
      }
    };
    void initApp();
  }, [hydrateLayout, hydrateSettings, setConnectionStatus, setIsLoading, setShellReady, setWindowMaximized]);
}

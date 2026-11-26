import { useEffect } from 'react';
import { applyChromeTheme } from '../theme/applyChromeTheme';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { localizedTranslator } from '../../i18n/messages';
import { announcePreviousInstance } from './previousInstanceNotice';
import type { ResolvedTheme } from '@shared/types/settings';

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
        // The one startup read of the settings view; the catalog's static provider facts come once with it.
        const [view, providerCatalog, appMeta, isMaximized] = await Promise.all([
          electronAPI.settings.get(),
          electronAPI.settings.getProviderCatalog(),
          electronAPI.appMeta.get(),
          electronAPI.windowControls.isMaximized().catch(() => false),
        ]);
        hydrateSettings(view, providerCatalog, appMeta.systemTheme);
        hydrateLayout(useAppSettingsStore.getState().settings);
        if (appMeta.previousInstance) {
          const { language } = useAppSettingsStore.getState().settings.appearance;
          announcePreviousInstance(appMeta.previousInstance, localizedTranslator(language));
        }
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

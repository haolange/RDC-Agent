import { useEffect, useMemo, useState } from 'react';
import type { CommandListResult } from '@shared/types/command';
import { useI18n } from '../i18n';
import { localizeCommands } from '../lib/commandLabels';
import { useElectronApi } from './useElectronApi';
export function useCommandCatalog(enabled = true) {
  const api = useElectronApi();
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commands, setCommands] = useState<CommandListResult['commands']>([]);
  useEffect(() => {
    if (!enabled || !api) return;
    let active = true;
    setLoading(true); setError(null);
    void api.command.list().then(result => { if (active) setCommands(result.commands); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, enabled]);
  const localized = useMemo(() => localizeCommands(commands, t), [commands, t]);
  return { commands: localized, loading, error };
}

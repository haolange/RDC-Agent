import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import { localizeCommands } from '../lib/commandLabels';
import { useAsyncValue } from '../lib/useAsyncValue';
import { useElectronApi } from './useElectronApi';
import type { CommandListResult } from '@shared/types/command';
export function useCommandCatalog(enabled = true) {
  const api = useElectronApi();
  const { t } = useI18n();
  const read = useAsyncValue(enabled && api ? 'commands' : null, async () => (await api!.command.list()).commands);
  // A failed read keeps the last list it had: the failure shows beside it instead of an empty catalog.
  const [commands, setCommands] = useState<CommandListResult['commands']>([]);
  useEffect(() => { if (read.status === 'ready') setCommands(read.value); }, [read]);
  const localized = useMemo(() => localizeCommands(commands, t), [commands, t]);
  const error = read.status === 'error'
    ? (read.error instanceof Error ? read.error.message : String(read.error))
    : null;
  return { commands: localized, loading: read.status === 'loading', error };
}

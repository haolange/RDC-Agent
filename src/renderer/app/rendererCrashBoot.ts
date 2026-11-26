import type { DiagnosticFact } from '../patterns/CopyDiagnostics';
import type { AppLanguage } from '@shared/types/settings';

/** What main put in the entry URL when it booted this renderer into its failure page after repeated crashes. */
export interface RendererCrashBoot {
  language: AppLanguage;
  facts: DiagnosticFact[];
  /** The entry without the crash facts: the workbench, with the boot theme kept. */
  reloadUrl: string;
}

export function readRendererCrashBoot(location: Location): RendererCrashBoot | null {
  const params = new URLSearchParams(location.search);
  const reason = params.get('rendererCrash');
  if (!reason) return null;
  const crashedAt = Number(params.get('crashedAt'));
  const reload = new URL(location.href);
  for (const key of ['rendererCrash', 'exitCode', 'crashedAt', 'lang']) reload.searchParams.delete(key);
  return {
    language: params.get('lang') === 'zh-CN' ? 'zh-CN' : 'en',
    facts: [
      { label: 'Failure', value: 'renderer-process-gone' },
      { label: 'Reason', value: reason },
      { label: 'Exit code', value: params.get('exitCode') },
      {
        label: 'Crashed at',
        value: Number.isFinite(crashedAt) && crashedAt > 0 ? new Date(crashedAt).toISOString() : null,
      },
    ],
    reloadUrl: reload.href,
  };
}

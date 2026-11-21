import { cn } from '../../../../lib/cn';
import { useUiLabels } from '../../../../lib/useUiLabels';
import { Details } from '../../../../ui/Details';
import type { ReactNode } from 'react';

export interface SettingsDiagnosticsRow {
  label: string;
  value: ReactNode;
}

/**
 * The one 「诊断」 entry at the foot of a settings detail. Ids, paths, protocols, fingerprints and hashes live here,
 * never on the surface; extra technical tools (probes, raw summaries) go in as children.
 */
export function SettingsDiagnostics({ rows, children, testId, className }: {
  rows: SettingsDiagnosticsRow[];
  children?: ReactNode;
  testId?: string;
  className?: string;
}) {
  const labels = useUiLabels();
  return (
    <Details className={cn('settings-diagnostics', className)} data-testid={testId} summary={labels.diagnostics}>
      <div className="settings-diagnostics-body">
        {rows.length > 0 ? (
          <dl className="settings-diagnostics-grid">
            {rows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {children}
      </div>
    </Details>
  );
}

import { useEffect, useRef, useState } from 'react';
import {
  detectRdcInstallations,
  resolveRdcInstallation,
  selectRdcInstallation,
  validateRdcInstallation,
} from '../../../../platform/rdcInstallation';
import { useAppSettingsStore } from '../../../../stores/appSettingsStore';
import type { RdcCliInvokerSettings } from '@shared/types/settings';
import type { RdcInstallationCandidate } from '@shared/types/rdcInstallation';
import type { ToolRuntimeSummary } from '@shared/types/tool';

export function useRdcInstallation(draft: RdcCliInvokerSettings, onApplied: (settings: RdcCliInvokerSettings) => void) {
  const revision = useRef(0);
  const [root, setRoot] = useState(draft.workingDirectory);
  const [candidates, setCandidates] = useState<RdcInstallationCandidate[]>([]);
  const [operation, setOperation] = useState<'detect' | 'select' | 'apply' | null>(null);
  const [summary, setSummary] = useState<ToolRuntimeSummary | null>(null);
  const [error, setError] = useState('');
  const [detected, setDetected] = useState(false);
  useEffect(() => {
    const id = revision.current;
    if (draft.command && !draft.workingDirectory) {
      void detectRdcInstallations()
        .then((found) => {
          const configured = found.find((candidate) => candidate.source === 'configured');
          if (revision.current === id && configured) setRoot(configured.root);
        })
        .catch((cause: unknown) => {
          // Explicit detection reports errors in the panel; existing invalid bindings remain visible.
          console.warn('[settings] could not detect RenderDoc installations', cause);
        });
    }
    return () => {
      revision.current += 1;
    };
    // The modal owns one draft lifetime. Later selections must not be replaced by persisted settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const run = async (name: NonNullable<typeof operation>, action: (current: () => boolean) => Promise<void>) => {
    const id = ++revision.current;
    setOperation(name);
    setError('');
    setSummary(null);
    const current = () => revision.current === id;
    try {
      await action(current);
    } catch (failure) {
      if (current()) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (current()) setOperation(null);
    }
  };
  const invalidate = () => {
    revision.current += 1;
    setOperation(null);
    setError('');
    setSummary(null);
  };
  return {
    root,
    candidates,
    busy: operation !== null,
    operation,
    summary,
    error,
    detected,
    invalidate,
    choose: (value: string) =>
      run('select', async (current) => {
        const result = await resolveRdcInstallation({ root: value, timeoutMs: draft.timeoutMs, env: draft.env });
        if (current()) setRoot(result.workingDirectory);
      }),
    detect: () =>
      run('detect', async (current) => {
        const result = await detectRdcInstallations();
        if (current()) {
          setCandidates(result);
          setDetected(true);
        }
      }),
    select: () =>
      run('select', async (current) => {
        const selected = await selectRdcInstallation();
        if (!selected || !current()) return;
        const resolved = await resolveRdcInstallation({ root: selected, timeoutMs: draft.timeoutMs, env: draft.env });
        if (current()) setRoot(resolved.workingDirectory);
      }),
    apply: () =>
      run('apply', async (current) => {
        const result = await validateRdcInstallation({ root, timeoutMs: draft.timeoutMs, env: draft.env });
        if (!current()) return;
        const saved = await useAppSettingsStore
          .getState()
          .patchSettings([{ op: 'tooling', value: { rdcCli: result.settings } }]);
        if (!current()) return;
        onApplied(saved.tooling.rdcCli);
        setSummary(result.summary);
      }),
  };
}

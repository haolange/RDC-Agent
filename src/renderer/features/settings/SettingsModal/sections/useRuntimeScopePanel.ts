import { useMemo, useState } from 'react';
import { useI18n } from '../../../../i18n';
import { humanizeError } from '../../../../i18n/humanizeError';
import { errorDetail } from '../../../../lib/errorDetail';
import { formFromContent } from './scopedResourceForm';
import { useScopedResourceForm } from './useScopedResourceForm';
import { deleteScopedResource } from './runtimeScopeActions';
import { importScopedResourceFromPicker, saveScopedResource } from './runtimeScopeMutations';
import type { RdcRuntimeOverview, ScopedResourceDocument, ScopedResourceKind } from '@shared/types/rdcRuntime';

export interface RuntimeScopePanelOptions {
  overview: RdcRuntimeOverview | null;
  scope: 'user' | 'project';
  kind: ScopedResourceKind;
  kinds: ScopedResourceKind[];
  onChanged?: (overview: RdcRuntimeOverview) => void;
}

export function useRuntimeScopePanel({
  overview,
  scope,
  kind,
  kinds,
  onChanged,
}: RuntimeScopePanelOptions) {
  const { t } = useI18n();
  const resources = useMemo(
    () => overview?.resources.filter((entry) => entry.scope === scope && kinds.includes(entry.kind)) ?? [],
    [overview, scope, kinds],
  );
  const { setNotice, showForm, reset, setDialogEditing, ...editor } = useScopedResourceForm(kind, scope, resources);
  const { form, creating } = editor;
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ScopedResourceDocument | null>(null);

  /** One main-process call at a time; a failure reads in product copy and keeps its reason for "Copy details". */
  const runBusy = async (contextKey: 'app.error.saveFailed' | 'app.error.actionFailed', task: () => Promise<void>,
    options: { keepNotice?: boolean; settle?: () => void } = {}) => {
    setBusy(true);
    if (!options.keepNotice) setNotice(null);
    try {
      await task();
    } catch (error) {
      setNotice({ tone: 'error', message: humanizeError(error, t, contextKey), detail: errorDetail(error) });
    } finally {
      setBusy(false);
      options.settle?.();
    }
  };

  const save = () => runBusy('app.error.saveFailed', async () => {
    const outcome = await saveScopedResource({
      kind,
      scope,
      form,
      creating,
      existingIds: resources.map((resource) => resource.id),
      ...(overview?.projectRoot ? { projectRoot: overview.projectRoot } : {}),
    });
    if (!outcome.ok) {
      setNotice(outcome.messageKey
        ? { tone: 'error', message: t(`settings.${outcome.messageKey}` as const) }
        : { tone: 'error', message: t('settings.resourceInvalid'), detail: outcome.message });
      return;
    }
    onChanged?.(outcome.overview);
    const saved = outcome.overview.resources.find(
      (entry) => entry.scope === scope && entry.kind === kind && entry.id === outcome.id,
    );
    showForm(saved ? formFromContent(saved.kind, saved.id, saved.content) : form, outcome.id);
    setDialogEditing(false);
    setNotice({ tone: 'success', message: t('settings.scopeSaved') });
  });

  const remove = async () => {
    const target = pendingDelete;
    if (!target) return;
    await runBusy('app.error.actionFailed', async () => {
      const next = await deleteScopedResource(target.kind, target.scope, target.id, overview?.projectRoot);
      if (next) onChanged?.(next);
      reset();
    }, { keepNotice: true, settle: () => setPendingDelete(null) });
  };

  const importResource = () => runBusy('app.error.actionFailed', async () => {
    const result = await importScopedResourceFromPicker({
      kind,
      scope,
      ...(overview?.projectRoot ? { projectRoot: overview.projectRoot } : {}),
    });
    if (!result) return;
    onChanged?.(result.overview);
    const { imported } = result;
    if (imported) showForm(formFromContent(imported.kind, imported.id, imported.content), imported.id);
    setNotice({ tone: 'success', message: t('settings.scopeImported') });
  });
  return {
    resources, ...editor, busy, pendingDelete, setPendingDelete, save, remove,
    importResource: () => editor.guard(() => void importResource()),
  };
}

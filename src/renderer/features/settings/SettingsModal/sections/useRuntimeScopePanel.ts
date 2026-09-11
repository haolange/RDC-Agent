import { useEffect, useMemo, useState } from 'react';
import type { RdxRuntimeOverview, ScopedResourceDocument, ScopedResourceKind } from '@shared/types/rdxRuntime';
import { useI18n } from '../../../../i18n';
import { selectFiles } from '../../../../hooks/appShellBridge';
import { emptyForm, formFromContent, type ResourceFormState } from './scopedResourceForm';
import { uniqueResourceId } from './uniqueResourceId';
import { deleteScopedResource, importScopedResource } from './runtimeScopeActions';
import { saveScopedResource, templateResourceId } from './runtimeScopeMutations';

export { normalizeResourceId, templateResourceId } from './runtimeScopeMutations';

export interface RuntimeScopePanelOptions {
  overview: RdxRuntimeOverview | null;
  scope: 'user' | 'project';
  kind: ScopedResourceKind;
  kinds: ScopedResourceKind[];
  onChanged?: (overview: RdxRuntimeOverview) => void;
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ResourceFormState>(() => emptyForm(kind, templateResourceId(kind)));
  const [baseline, setBaseline] = useState<ResourceFormState>(form);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ScopedResourceDocument | null>(null);
  const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(null);

  const reset = () => {
    const next = emptyForm(kind, templateResourceId(kind));
    setSelectedId(null);
    setCreating(false);
    setForm(next);
    setBaseline(next);
    setMessage('');
  };

  useEffect(reset, [scope, kind]);

  const selected = resources.find((entry) => entry.id === selectedId) ?? null;
  const editing = creating || Boolean(selected);
  const dirty = editing && JSON.stringify(form) !== JSON.stringify(baseline);

  /** Routes an action through the unsaved guard when the form has a live draft. */
  const guard = (action: () => void) => {
    if (!dirty) {
      action();
      return;
    }
    setPendingDiscard(() => action);
  };

  const openResource = (resource: ScopedResourceDocument) => guard(() => {
    const next = formFromContent(resource.kind, resource.id, resource.content);
    setCreating(false);
    setSelectedId(resource.id);
    setForm(next);
    setBaseline(next);
    setMessage('');
  });

  const startNew = () => guard(() => {
    const nextId = uniqueResourceId(templateResourceId(kind), resources.map((resource) => resource.id));
    const next = emptyForm(kind, nextId);
    setCreating(true);
    setSelectedId(null);
    setForm(next);
    setBaseline(next);
    setMessage('');
  });

  const closeEditor = () => guard(reset);

  const patchForm = (patch: Partial<ResourceFormState>) =>
    setForm((current) => ({ ...current, ...patch }));

  const save = async () => {
    setBusy(true);
    setMessage('');
    try {
      const outcome = await saveScopedResource({
        kind,
        scope,
        form,
        creating,
        existingIds: resources.map((resource) => resource.id),
        ...(overview?.projectRoot ? { projectRoot: overview.projectRoot } : {}),
      });
      if (!outcome.ok) {
        setMessage(outcome.messageKey
          ? t(`settings.${outcome.messageKey}` as const)
          : outcome.message);
        return;
      }
      onChanged?.(outcome.overview);
      setCreating(false);
      setSelectedId(outcome.id);
      const saved = outcome.overview.resources.find(
        (entry) => entry.scope === scope && entry.kind === kind && entry.id === outcome.id,
      );
      const savedForm = saved ? formFromContent(saved.kind, saved.id, saved.content) : form;
      setForm(savedForm);
      setBaseline(savedForm);
      setMessage(t('settings.scopeSaved'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const target = pendingDelete;
    if (!target) return;
    setBusy(true);
    try {
      const next = await deleteScopedResource(target.kind, target.scope, target.id, overview?.projectRoot);
      if (next) onChanged?.(next);
      reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setPendingDelete(null);
    }
  };

  const importResource = async () => {
    setBusy(true);
    setMessage('');
    try {
      const paths = await selectFiles();
      const filePath = paths?.[0];
      if (!filePath) return;
      const result = await importScopedResource({
        kind,
        scope,
        filePath,
        ...(overview?.projectRoot ? { projectRoot: overview.projectRoot } : {}),
      });
      if (!result) return;
      onChanged?.(result.overview);
      const imported = result.overview.resources.find(
        (entry) => entry.scope === scope && entry.kind === kind && entry.id === result.id,
      );
      if (imported) {
        const next = formFromContent(imported.kind, imported.id, imported.content);
        setCreating(false);
        setSelectedId(imported.id);
        setForm(next);
        setBaseline(next);
      }
      setMessage(t('settings.scopeImported'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return {
    resources,
    selected,
    selectedId,
    creating,
    editing,
    dirty,
    form,
    message,
    busy,
    pendingDelete,
    pendingDiscard,
    setPendingDelete,
    resolveDiscard: (accept: boolean) => {
      const action = pendingDiscard;
      setPendingDiscard(null);
      if (accept) action?.();
    },
    openResource,
    startNew,
    closeEditor,
    patchForm,
    save,
    remove,
    importResource,
  };
}

import { useEffect, useMemo, useState } from 'react';
import type { RdcRuntimeOverview, ScopedResourceDocument, ScopedResourceKind } from '@shared/types/rdcRuntime';
import { useI18n } from '../../../../i18n';
import { emptyForm, formFromContent, type ResourceFormState } from './scopedResourceForm';
import { uniqueResourceId } from './uniqueResourceId';
import { deleteScopedResource } from './runtimeScopeActions';
import { importScopedResourceFromPicker, saveScopedResource, templateResourceId } from './runtimeScopeMutations';

export { normalizeResourceId, templateResourceId } from './runtimeScopeMutations';

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ResourceFormState>(() => emptyForm(kind, templateResourceId(kind)));
  const [baseline, setBaseline] = useState<ResourceFormState>(form);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ScopedResourceDocument | null>(null);
  const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(null);
  /** Dialog presentation: the selection drives a read-only detail; the editor opens only on explicit edit. */
  const [dialogEditing, setDialogEditing] = useState(false);

  const reset = () => {
    const next = emptyForm(kind, templateResourceId(kind));
    setSelectedId(null);
    setCreating(false);
    setDialogEditing(false);
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

  const openDialogEditor = () => {
    setMessage('');
    setDialogEditing(true);
  };

  /** Closes the dialog but keeps the selection so the read-only detail stays put. */
  const closeDialogEditor = () => guard(() => {
    setForm(baseline);
    setCreating(false);
    setDialogEditing(false);
    setMessage('');
    if (creating) setSelectedId(null);
  });

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
      setDialogEditing(false);
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
      const result = await importScopedResourceFromPicker({
        kind,
        scope,
        ...(overview?.projectRoot ? { projectRoot: overview.projectRoot } : {}),
      });
      if (!result) return;
      onChanged?.(result.overview);
      if (result.imported) {
        const next = formFromContent(result.imported.kind, result.imported.id, result.imported.content);
        setCreating(false);
        setSelectedId(result.imported.id);
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
    resources, selected, selectedId, creating, editing, dirty, form, message, busy,
    pendingDelete, pendingDiscard, setPendingDelete,
    resolveDiscard: (accept: boolean) => {
      const action = pendingDiscard;
      setPendingDiscard(null);
      if (accept) action?.();
    },
    openResource, startNew, closeEditor, dialogEditing, openDialogEditor, closeDialogEditor,
    patchForm, save, remove, guard, importResource: () => guard(() => void importResource()),
  };
}

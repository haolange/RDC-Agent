import { useEffect, useState } from 'react';
import { emptyForm, formFromContent, type ResourceFormState } from './scopedResourceForm';
import type { ScopedResourceDocument, ScopedResourceKind } from '@shared/types/rdcRuntime';

/** The editor's last outcome: a confirmation, or a failure in product copy whose technical reason only "Copy details" carries. */
export type ScopeNotice = { tone: 'success'; message: string } | { tone: 'error'; message: string; detail?: string };

/**
 * The resource editor's form: which resource it shows or creates, the draft against its saved baseline, the unsaved
 * guard in front of anything that would drop the draft, and the outcome notice.
 */
export function useScopedResourceForm(
  kind: ScopedResourceKind,
  scope: 'user' | 'project',
  resources: ScopedResourceDocument[],
) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ResourceFormState>(() => emptyForm(kind, ''));
  const [baseline, setBaseline] = useState<ResourceFormState>(form);
  const [notice, setNotice] = useState<ScopeNotice | null>(null);
  const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(null);
  /** Dialog presentation: the selection drives a read-only detail; the editor opens only on explicit edit. */
  const [dialogEditing, setDialogEditing] = useState(false);

  /** Shows a form as saved (no unsaved changes) for the given selection. */
  const showForm = (next: ResourceFormState, id: string | null, creatingNew = false) => {
    setCreating(creatingNew);
    setSelectedId(id);
    setForm(next);
    setBaseline(next);
  };
  const reset = () => {
    showForm(emptyForm(kind, ''), null);
    setDialogEditing(false);
    setNotice(null);
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

  const openResource = (resource: ScopedResourceDocument) =>
    guard(() => {
      showForm(formFromContent(resource.kind, resource.id, resource.content), resource.id);
      setNotice(null);
    });

  const startNew = () =>
    guard(() => {
      showForm(emptyForm(kind, ''), null, true);
      setNotice(null);
    });

  const closeEditor = () => guard(reset);

  const openDialogEditor = () => {
    setNotice(null);
    setDialogEditing(true);
  };

  /** Closes the dialog but keeps the selection so the read-only detail stays put. */
  const closeDialogEditor = () =>
    guard(() => {
      setForm(baseline);
      setCreating(false);
      setDialogEditing(false);
      setNotice(null);
      if (creating) setSelectedId(null);
    });

  const patchForm = (patch: Partial<ResourceFormState>) => {
    setForm((current) => ({ ...current, ...patch }));
    setNotice((current) => (current?.tone === 'success' ? null : current));
  };

  return {
    selectedId,
    selected,
    creating,
    editing,
    dirty,
    form,
    notice,
    setNotice,
    pendingDiscard,
    dialogEditing,
    setDialogEditing,
    showForm,
    reset,
    guard,
    openResource,
    startNew,
    closeEditor,
    openDialogEditor,
    closeDialogEditor,
    patchForm,
    resolveDiscard: (accept: boolean) => {
      const action = pendingDiscard;
      setPendingDiscard(null);
      if (accept) action?.();
    },
  };
}

import { errorDetail } from '../../../../lib/errorDetail';
import { contentFromForm, type ResourceFormState } from './scopedResourceForm';
import { importScopedResource, upsertScopedResource, validateScopedResource } from './runtimeScopeActions';
import type { RdcRuntimeOverview, ScopedResourceDocument, ScopedResourceKind } from '@shared/types/rdcRuntime';

export const templateResourceId = (kind: ScopedResourceKind): string => `new-${kind}`;

export const normalizeResourceId = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || value;

export type SaveScopedResourceOutcome =
  | { ok: true; overview: RdcRuntimeOverview; id: string }
  | { ok: false; messageKey: 'resourceArgsInvalid' | 'resourceIdExists' | 'resourceIdRequired'; message?: string }
  /** `message` is the technical reason (parser or validator text); it only leaves through "Copy details". */
  | { ok: false; messageKey: null; message: string };

/**
 * Serializes, checks for an id clash, validates through main, then writes.
 * Returns a discriminated outcome so the hook owns all copy and state.
 */
export async function saveScopedResource(input: {
  kind: ScopedResourceKind;
  scope: 'user' | 'project';
  form: ResourceFormState;
  creating: boolean;
  existingIds: string[];
  projectRoot?: string;
}): Promise<SaveScopedResourceOutcome> {
  let content: string;
  try {
    content = contentFromForm(input.kind, input.form);
  } catch (error) {
    return input.kind === 'mcp'
      ? { ok: false, messageKey: 'resourceArgsInvalid' }
      : { ok: false, messageKey: null, message: errorDetail(error) };
  }

  const nextId = normalizeResourceId(input.form.id);
  if (!nextId) return { ok: false, messageKey: 'resourceIdRequired' };
  if (input.creating && input.existingIds.includes(nextId)) {
    return { ok: false, messageKey: 'resourceIdExists' };
  }

  const request = {
    kind: input.kind,
    scope: input.scope,
    id: input.form.id,
    content,
    ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
  };

  const validation = await validateScopedResource(request);
  if (!validation?.valid) {
    const diagnostics = validation?.diagnostics.join('\n');
    return diagnostics
      ? { ok: false, messageKey: null, message: diagnostics }
      : { ok: false, messageKey: 'resourceArgsInvalid' };
  }

  const overview = await upsertScopedResource(request);
  if (!overview) return { ok: false, messageKey: 'resourceArgsInvalid' };
  return { ok: true, overview, id: nextId };
}

/** Picks a file through the real dialog and imports it into the scope; `null` when the user cancelled. */
export async function importScopedResourceFromPicker(input: {
  kind: ScopedResourceKind;
  scope: 'user' | 'project';
  projectRoot?: string;
}): Promise<{ overview: RdcRuntimeOverview; imported: ScopedResourceDocument | null } | null> {
  const result = await importScopedResource({
    kind: input.kind,
    scope: input.scope,
    ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
  });
  if (!result) return null;
  const imported = result.overview.resources.find(
    (entry) => entry.scope === input.scope && entry.kind === input.kind && entry.id === result.id,
  ) ?? null;
  return { overview: result.overview, imported };
}

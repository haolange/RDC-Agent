import type { RdxRuntimeOverview, ScopedResourceKind } from '@shared/types/rdxRuntime';
import { contentFromForm, type ResourceFormState } from './scopedResourceForm';
import { upsertScopedResource, validateScopedResource } from './runtimeScopeActions';

export const templateResourceId = (kind: ScopedResourceKind): string => `new-${kind}`;

export const normalizeResourceId = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || value;

export type SaveScopedResourceOutcome =
  | { ok: true; overview: RdxRuntimeOverview; id: string }
  | { ok: false; messageKey: 'resourceArgsInvalid' | 'resourceIdExists'; message?: string }
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
      : { ok: false, messageKey: null, message: String(error) };
  }

  const nextId = normalizeResourceId(input.form.id);
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

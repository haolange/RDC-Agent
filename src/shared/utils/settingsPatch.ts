import { mergeUiPreferences } from '../theme/uiPreferences';
import type {
  AgentModelBinding,
  AgentModelChanges,
  AgentModelSettings,
  AgentRuntimeSettings,
  LayoutPreferences,
  ProfileSettings,
  SettingsPatchOp,
  ToolingSettings,
  UiPreferences,
} from '../types/settings';

/**
 * The settings `settings:patch` can change, as one view. Main reduces it and then sanitizes each section against the
 * committed one; the renderer reduces it for its optimistic state. Both use these functions, so an op means the same
 * thing on either side.
 */
export interface SettingsPatchView {
  appearance: UiPreferences;
  layout: LayoutPreferences;
  profile: ProfileSettings;
  tooling: ToolingSettings;
  agentRuntime: AgentRuntimeSettings;
  agentModels: AgentModelSettings;
  globalInstructions: string;
}

type OpOf<K extends SettingsPatchOp['op']> = Extract<SettingsPatchOp, { op: K }>;
export type AgentModelPatchOp = OpOf<
  'agentModels.setDefault' | 'agentModels.setAgentField' | 'agentModels.clearAgentField'
>;

export const isAgentModelPatchOp = (op: SettingsPatchOp): op is AgentModelPatchOp => op.op.startsWith('agentModels.');

/** A section's sub-object with the patched fields; an untouched one stays the same object. */
const mergeIn = <T extends object>(current: T, patch: Partial<T> | undefined): T =>
  patch ? { ...current, ...patch } : current;

export const mergeLayoutPatch = (current: LayoutPreferences, value: OpOf<'layout'>['value']): LayoutPreferences => ({
  leftSidebar: mergeIn(current.leftSidebar, value.leftSidebar),
  rightPanel: mergeIn(current.rightPanel, value.rightPanel),
  terminal: mergeIn(current.terminal, value.terminal),
  window: mergeIn(current.window, value.window),
});

export const mergeToolingPatch = (current: ToolingSettings, value: OpOf<'tooling'>['value']): ToolingSettings => ({
  rdcCli: mergeIn(current.rdcCli, value.rdcCli),
  codeInterpreter: mergeIn(current.codeInterpreter, value.codeInterpreter),
  shell: mergeIn(current.shell, value.shell),
});

export const mergeAgentRuntimePatch = (
  current: AgentRuntimeSettings,
  value: OpOf<'agentRuntime'>['value'],
): AgentRuntimeSettings => ({
  permissions: mergeIn(current.permissions, value.permissions),
  context: mergeIn(current.context, value.context),
});

/** The stored form of the global instructions. */
export const normalizeGlobalInstructions = (text: string): string => text.trim();

function withField(
  binding: AgentModelBinding,
  field: keyof AgentModelBinding,
  value: string | null,
): AgentModelBinding {
  const next: AgentModelBinding = { ...binding };
  if (value === null) delete next[field];
  else Object.assign(next, { [field]: value });
  return next;
}

/** One field of one binding; an Agent binding left without fields is removed, so the default applies again. */
export function applyAgentModelOp(settings: AgentModelSettings, op: AgentModelPatchOp): AgentModelSettings {
  if (op.op === 'agentModels.setDefault') {
    return { ...settings, default: withField(settings.default, op.field, op.value) };
  }
  const value = op.op === 'agentModels.setAgentField' ? op.value : null;
  const binding = withField(settings.byAgent[op.agentId] ?? {}, op.field, value);
  const byAgent = { ...settings.byAgent };
  if (binding.model || binding.reasoningLevel) byAgent[op.agentId] = binding;
  else delete byAgent[op.agentId];
  return { ...settings, byAgent };
}

export function applySettingsPatchOp(view: SettingsPatchView, op: SettingsPatchOp): SettingsPatchView {
  switch (op.op) {
    case 'appearance':
      return { ...view, appearance: mergeUiPreferences(view.appearance, op.value) };
    case 'layout':
      return { ...view, layout: mergeLayoutPatch(view.layout, op.value) };
    case 'profile':
      return { ...view, profile: { ...view.profile, ...op.value } };
    case 'tooling':
      return { ...view, tooling: mergeToolingPatch(view.tooling, op.value) };
    case 'agentRuntime':
      return { ...view, agentRuntime: mergeAgentRuntimePatch(view.agentRuntime, op.value) };
    case 'globalInstructions':
      return { ...view, globalInstructions: normalizeGlobalInstructions(op.value) };
    default:
      return { ...view, agentModels: applyAgentModelOp(view.agentModels, op) };
  }
}

export const applySettingsPatchOps = (view: SettingsPatchView, ops: readonly SettingsPatchOp[]): SettingsPatchView =>
  ops.reduce(applySettingsPatchOp, view);

const sameBinding = (left: AgentModelBinding | undefined, right: AgentModelBinding | undefined): boolean =>
  left?.model === right?.model && left?.reasoningLevel === right?.reasoningLevel;

/** The bindings that differ between two Agent model settings; undefined when none do. */
export function diffAgentModels(before: AgentModelSettings, after: AgentModelSettings): AgentModelChanges | undefined {
  const changes: AgentModelChanges = {};
  if (!sameBinding(before.default, after.default)) changes.default = after.default;
  for (const agentId of new Set([...Object.keys(before.byAgent), ...Object.keys(after.byAgent)])) {
    if (sameBinding(before.byAgent[agentId], after.byAgent[agentId])) continue;
    (changes.byAgent ??= {})[agentId] = after.byAgent[agentId] ?? null;
  }
  return changes.default || changes.byAgent ? changes : undefined;
}

/** Applies committed binding changes to Agent model settings. */
export function applyAgentModelChanges(settings: AgentModelSettings, changes: AgentModelChanges): AgentModelSettings {
  const byAgent = { ...settings.byAgent };
  for (const [agentId, binding] of Object.entries(changes.byAgent ?? {})) {
    if (binding) byAgent[agentId] = binding;
    else delete byAgent[agentId];
  }
  return { default: changes.default ?? settings.default, byAgent };
}

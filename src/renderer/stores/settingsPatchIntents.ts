import { applyAgentModelChanges, applySettingsPatchOps, type SettingsPatchView } from '@shared/utils/settingsPatch';
import type { AppSettings, SettingsPatchChanges, SettingsPatchOp } from '@shared/types/settings';

const patchViewOf = (settings: AppSettings): SettingsPatchView => ({
  appearance: settings.appearance,
  layout: settings.layout,
  profile: settings.profile,
  tooling: settings.tooling,
  agentRuntime: settings.agentRuntime,
  agentModels: settings.agentModels,
  globalInstructions: settings.agents.globalInstructions,
});

const withPatchView = (settings: AppSettings, view: SettingsPatchView): AppSettings => ({
  ...settings,
  appearance: view.appearance,
  layout: view.layout,
  profile: view.profile,
  tooling: view.tooling,
  agentRuntime: view.agentRuntime,
  agentModels: view.agentModels,
  agents: { ...settings.agents, globalInstructions: view.globalInstructions },
});

function applyChanges(view: SettingsPatchView, changed: SettingsPatchChanges, ops: readonly SettingsPatchOp[]): SettingsPatchView {
  const instructions = [...ops].reverse().find((op) => op.op === 'globalInstructions');
  return {
    appearance: changed.appearance ?? view.appearance,
    layout: changed.layout ?? view.layout,
    profile: changed.profile ?? view.profile,
    tooling: changed.tooling ?? view.tooling,
    agentRuntime: changed.agentRuntime ?? view.agentRuntime,
    agentModels: changed.agentModels ? applyAgentModelChanges(view.agentModels, changed.agentModels) : view.agentModels,
    // Main stores the instructions as sent (normalized); the committed text is the one the op carried.
    globalInstructions: changed.globalInstructions && instructions
      ? applySettingsPatchOps(view, [instructions]).globalInstructions
      : view.globalInstructions,
  };
}

/**
 * The renderer's side of `settings:patch`: the sections main confirmed, plus the ops still in flight. What the store
 * shows is the confirmed view with every pending op replayed on top, in order. A commit moves its changes into the
 * confirmed view; a failure drops its ops, which rolls back exactly what that intent changed while later intents —
 * and other fields of the same section — stay as the user set them.
 */
export class SettingsPatchIntents {
  private confirmed: SettingsPatchView | null = null;
  private readonly pending = new Map<number, readonly SettingsPatchOp[]>();
  private sequence = 0;

  get hasPending(): boolean {
    return this.pending.size > 0;
  }

  /** Adopts sections main sent whole (startup, a reload); ops in flight stay on top of them. */
  rebase(settings: AppSettings): AppSettings {
    this.confirmed = patchViewOf(settings);
    return this.project(settings);
  }

  /** Changes main confirmed through another command (the permission mode). */
  confirm(settings: AppSettings, update: (view: SettingsPatchView) => SettingsPatchView): AppSettings {
    this.confirmed = update(this.baseline(settings));
    return this.project(settings);
  }

  begin(settings: AppSettings, ops: readonly SettingsPatchOp[]): { id: number; settings: AppSettings } {
    this.confirmed = this.baseline(settings);
    const id = ++this.sequence;
    this.pending.set(id, ops);
    return { id, settings: this.project(settings) };
  }

  settle(settings: AppSettings, id: number, changed: SettingsPatchChanges): AppSettings {
    const ops = this.pending.get(id) ?? [];
    this.pending.delete(id);
    this.confirmed = applyChanges(this.baseline(settings), changed, ops);
    return this.project(settings);
  }

  fail(settings: AppSettings, id: number): AppSettings {
    this.pending.delete(id);
    return this.project(settings);
  }

  /** With nothing in flight the store shows exactly what main confirmed. */
  private baseline(settings: AppSettings): SettingsPatchView {
    return this.confirmed ?? patchViewOf(settings);
  }

  private project(settings: AppSettings): AppSettings {
    return withPatchView(settings, applySettingsPatchOps(this.baseline(settings), [...this.pending.values()].flat()));
  }
}

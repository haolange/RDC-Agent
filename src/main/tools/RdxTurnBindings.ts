import { createHash } from 'node:crypto';
import type { RdxActionSettingsMap, RdxCliInvokerSettings } from '@shared/types/settings';

export interface RdxTurnBinding {
  cli: RdxCliInvokerSettings;
  actions: RdxActionSettingsMap;
}

/** Private turn leases: executable environment is never serialized into Prompt/IPC/Trace. */
const bindings = new WeakMap<object, RdxTurnBinding>();
export function freezeRdxTurnBinding(cli: RdxCliInvokerSettings, actions: RdxActionSettingsMap): RdxTurnBinding {
  const copy = structuredClone({ cli, actions });
  Object.freeze(copy.cli.argsPrefix);
  Object.freeze(copy.cli.env);
  Object.freeze(copy.cli);
  for (const action of Object.values(copy.actions)) {
    Object.freeze(action.args);
    Object.freeze(action.env);
    Object.freeze(action);
  }
  Object.freeze(copy.actions);
  return Object.freeze(copy);
}
export function rdxBindingFingerprint(binding: RdxTurnBinding): string {
  return createHash('sha256').update(JSON.stringify(binding)).digest('hex');
}
export function bindRdxTurn(plan: object, binding: RdxTurnBinding): void { bindings.set(plan, binding); }
export function getRdxTurnBinding(plan: object): RdxTurnBinding | undefined { return bindings.get(plan); }

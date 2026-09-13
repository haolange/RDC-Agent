import { createHash } from 'node:crypto';
import type { RdxOperationDefinition } from '@shared/types/tool';

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value);
}
export function operationFingerprint(definitions: readonly unknown[]): string {
  return createHash('sha256').update(canonicalJson(definitions)).digest('hex');
}
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
const effects = new Set(['replay_position', 'replay_position_temporary', 'artifact_write', 'remote_control', 'lifecycle', 'global_config', 'desktop_window', 'context_metadata', 'shader_debug', 'shader_replacement', 'artifact_delete']);
export function validateDefinitions(value: unknown, count: unknown, fingerprint: unknown): RdxOperationDefinition[] {
  if (!Array.isArray(value) || !value.length || count !== value.length || typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('RDX_UPGRADE_REQUIRED: incomplete operation catalog. Use a CLI providing the complete current operation contract.');
  const names = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || !/^rd\.[a-z_]+\.[a-z_]+$/.test(raw.name) || names.has(raw.name)
      || raw.namespace !== raw.name.split('.')[1] || !['global', 'context', 'replay', 'capture'].includes(raw.scope)
      || !Array.isArray(raw.effects) || raw.effects.some((effect: unknown) => typeof effect !== 'string' || !effects.has(effect))
      || ![null, 'measurement', 'intervention', 'rollback'].includes(raw.evidence_kind)
      || raw.input_schema?.type !== 'object' || raw.input_schema?.additionalProperties !== false
      || !raw.input_schema.properties || typeof raw.input_schema.properties !== 'object'
      || !Array.isArray(raw.path_inputs) || raw.path_inputs.some((entry: Record<string, unknown>) => !entry || typeof entry.name !== 'string' || !Object.hasOwn(raw.input_schema.properties, entry.name) || !['read', 'write', 'read_directory'].includes(String(entry.access)))) {
      throw new Error('RDX_UPGRADE_REQUIRED: unrecognized operation contract. Update RDX Tools and RDC-Agent together.');
    }
    names.add(raw.name);
  }
  if (operationFingerprint(value) !== fingerprint) throw new Error('RDX_CATALOG_FINGERPRINT: operation definitions do not match their content fingerprint.');
  return value as RdxOperationDefinition[];
}

/** Only application-owned integration points are fixed here; model tools are discovered. */
export const RDX_APPLICATION_OPERATIONS: Record<string, { scope: string; effects: string[]; parameters: Record<string, string>; supplied: string[] }> = {
  'rd.capture.open_file': { scope: 'global', effects: ['lifecycle'], parameters: { file_path: 'string', read_only: 'boolean' }, supplied: ['file_path', 'read_only'] },
  'rd.capture.open_replay': { scope: 'global', effects: ['lifecycle'], parameters: { capture_file_id: 'string', options: 'object' }, supplied: ['capture_file_id', 'options'] },
  'rd.remote.connect': { scope: 'global', effects: ['remote_control'], parameters: { options: 'object' }, supplied: ['options'] },
  'rd.session.get_context': { scope: 'context', effects: [], parameters: {}, supplied: [] },
  'rd.session.clear_context': { scope: 'context', effects: ['lifecycle'], parameters: {}, supplied: [] },
  'rd.session.get_replay_events': { scope: 'context', effects: [], parameters: {}, supplied: [] },
  'rd.session.observe': { scope: 'context', effects: ['replay_position', 'artifact_write'], parameters: { out_path: 'string', event_id: 'integer', final_output: 'boolean', target: 'object' }, supplied: ['out_path'] },
};
export function validateApplicationOperations(definitions: RdxOperationDefinition[]): void {
  for (const [name, expected] of Object.entries(RDX_APPLICATION_OPERATIONS)) {
    const definition = definitions.find(value => value.name === name);
    const schema = definition?.input_schema as { properties?: Record<string, { type?: string }>; required?: string[] } | undefined;
    if (!definition || definition.scope !== expected.scope
      || canonicalJson([...definition.effects].sort()) !== canonicalJson([...expected.effects].sort())
      || Object.entries(expected.parameters).some(([key, type]) => schema?.properties?.[key]?.type !== type)
      || (schema?.required ?? []).some(key => !expected.supplied.includes(key))) {
      throw new Error(`RDX_UPGRADE_REQUIRED: application operation ${name} is missing or has an incompatible contract. Update RDX Tools and RDC-Agent together.`);
    }
  }
}

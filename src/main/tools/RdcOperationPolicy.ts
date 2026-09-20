import fs from 'node:fs';
import path from 'node:path';
import type { RdcOperationDefinition } from '@shared/types/tool';
import type { ToolExecutionContext } from '../agent-runtime/agent/AgentTool';
import { safeResolvePath } from '../agent-runtime/tools/primitives/_shared';
import { operationFingerprint } from './RdcOperationCatalog';

const allowedEffects = new Set(['replay_position', 'replay_position_temporary', 'artifact_write', 'context_metadata', 'shader_debug', 'shader_replacement']);
const scopes = new Set(['global', 'context', 'replay', 'capture']);
const identityKey = /^(session_?id|context_?id|daemon_?context|target_?context_?id|owner_?session_?id|owner_?lease_?id|runtime_?owner|remote_?id|capture_?file_?id)$/i;
function denied(message: string): never { throw new Error('RDC_EXECUTION_DENIED: ' + message); }

export function validateRdcArguments(value: unknown, schema: Record<string, unknown>, location = 'args'): void {
  const satisfies = (candidate: unknown): boolean => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) denied('invalid argument constraint');
    try { validateRdcArguments(value, candidate as Record<string, unknown>, location); return true; }
    catch { return false; }
  };
  if (Array.isArray(schema.oneOf) && schema.oneOf.filter(satisfies).length !== 1) denied(`${location} must match exactly one alternative`);
  if (schema.not && satisfies(schema.not)) denied(`${location} contains conflicting parameters`);
  if (typeof value === 'string' && ((typeof schema.minLength === 'number' && value.length < schema.minLength) || (typeof schema.maxLength === 'number' && value.length > schema.maxLength))) denied(`${location} has invalid length`);
  if (Array.isArray(value) && ((typeof schema.minItems === 'number' && value.length < schema.minItems) || (typeof schema.maxItems === 'number' && value.length > schema.maxItems))) denied(`${location} has invalid item count`);
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const matches = (type: unknown) => type === 'null' ? value === null : type === 'array' ? Array.isArray(value)
    : type === 'object' ? !!value && typeof value === 'object' && !Array.isArray(value)
    : type === 'integer' ? typeof value === 'number' && Number.isSafeInteger(value)
    : type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === type;
  if (types.length && !types.some(matches)) denied(`${location} has an invalid type`);
  if (Array.isArray(schema.enum) && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) denied(`${location} is not an allowed value`);
  if (typeof value === 'number' && (!Number.isFinite(value) || (typeof schema.minimum === 'number' && value < schema.minimum) || (typeof schema.maximum === 'number' && value > schema.maximum))) denied(`${location} is outside its bounds`);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    if (Array.isArray(schema.required) && schema.required.some(key => typeof key !== 'string' || !Object.hasOwn(record, key))) denied(`${location} is missing required parameters`);
    for (const [key, item] of Object.entries(record)) {
      if (schema.additionalProperties === false && !Object.hasOwn(properties, key)) denied(`${location}.${key} is unknown`);
      if (properties[key]) validateRdcArguments(item, properties[key], `${location}.${key}`);
    }
  }
  if (Array.isArray(value)) for (const [index, item] of value.entries()) validateRdcArguments(item, (schema.items ?? {}) as Record<string, unknown>, `${location}[${index}]`);
}
function rejectIdentityOverrides(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (identityKey.test(key)) denied('replay identity is main-owned');
    rejectIdentityOverrides(child);
  }
}
export function authorizeRdcOperation(operation: string, input: Record<string, unknown>, context: ToolExecutionContext, replaySessionId: string, captureFileId?: string): { definition: RdcOperationDefinition; args: Record<string, unknown> } {
  const binding = context.rdcBinding;
  if (!binding || operationFingerprint(binding.definitions) !== binding.definitionsFingerprint) denied('frozen catalog fingerprint is invalid');
  const definition = binding.definitions.find(item => item.name === operation) as RdcOperationDefinition | undefined;
  if (!definition || !scopes.has(definition.scope) || !Array.isArray(definition.effects) || definition.effects.some(effect => !allowedEffects.has(effect))) denied('operation capability is unavailable to General');
  if (!Array.isArray(definition.prerequisites) || definition.prerequisites.some((item: unknown) => !item || typeof item !== 'object' || !((item as { requires?: unknown }).requires === 'session_id' && definition.scope === 'replay') && !((item as { requires?: unknown }).requires === 'capture_file_id' && definition.scope === 'capture'))) denied('unknown prerequisite');
  rejectIdentityOverrides(input);
  const args = structuredClone(input);
  if (definition.scope === 'replay') args.session_id = replaySessionId;
  if (definition.scope === 'capture') {
    if (!captureFileId) denied('owning capture identity is missing');
    args.capture_file_id = captureFileId;
  }
  validateRdcArguments(args, definition.input_schema);
  if (definition.effects.includes('context_metadata') && !['focus_pixel', 'focus_resource_id', 'focus_shader_id', 'notes'].includes(String(args.key))) denied('context field is application-owned');
  // VFS paths select nodes within this daemon, never filesystem paths or foreign contexts.
  if (definition.namespace === 'vfs') {
    if (typeof args.path !== 'string' || !args.path.startsWith('/') || args.path.includes('\\') || args.path.split('/').some(part => part === '..' || part === '.')
      || !['', 'context', 'artifacts', 'draws', 'passes', 'resources', 'textures', 'buffers', 'pipeline', 'shaders', 'debug'].includes(args.path.split('/')[1])) denied('invalid virtual path');
  }
  for (const entry of definition.path_inputs) {
    const value = args[entry.name]; if (value === undefined || value === null) continue;
    const check = (item: unknown): string => {
      if (typeof item !== 'string') denied('invalid filesystem input');
      const resolved = safeResolvePath(item, undefined, context);
      if (entry.access !== 'write') {
        const stat = fs.statSync(resolved);
        if (entry.access === 'read_directory' ? !stat.isDirectory() : !stat.isFile()) denied('filesystem input has the wrong kind');
      }
      return resolved;
    };
    args[entry.name] = Array.isArray(value) ? value.map(check) : check(value);
  }
  // Compiler escape hatches are not granted by a descriptive catalog.
  if (args.additional_args !== undefined && (!Array.isArray(args.additional_args) || args.additional_args.some(flag => !['-Od', '-O0', '-O1', '-O2', '-O3', '-Zi', '-WX', '-Ges', '-Gis', '-Zpr', '-Zpc'].includes(String(flag))))) denied('compiler flags require a dedicated host entry point');
  if (typeof args.source_text === 'string' || typeof args.source_path === 'string') {
    const includes = Array.isArray(args.include_dirs) ? args.include_dirs as string[] : [];
    const visited = new Set<string>();
    const inspect = (source: string, directory: string, depth: number): void => {
      if (depth > 16 || source.length > 1024 * 1024 || visited.size > 64) denied('shader include budget exceeded');
      for (const match of source.matchAll(/^\s*#\s*include\s*["<]([^">]+)[">]/gm)) {
        const name = match[1];
        if (path.isAbsolute(name) || name.includes(':') || name.split(/[\\/]/).includes('..')) denied('shader include escapes its allowed directories');
        const file = [directory, ...includes].map(root => safeResolvePath(path.join(root, name), undefined, context)).find(candidate => fs.existsSync(candidate));
        if (!file) denied('shader include cannot be resolved inside the allowed directories');
        if (visited.has(file)) continue;
        visited.add(file); inspect(fs.readFileSync(file, 'utf8'), path.dirname(file), depth + 1);
      }
    };
    const sourcePath = typeof args.source_path === 'string' ? args.source_path : undefined;
    if (sourcePath && fs.statSync(sourcePath).size > 1024 * 1024) denied('shader source budget exceeded');
    inspect(sourcePath ? fs.readFileSync(sourcePath, 'utf8') : String(args.source_text), sourcePath ? path.dirname(sourcePath) : context.projectRootPath ?? context.workspaceRoot, 0);
  }
  return { definition, args };
}

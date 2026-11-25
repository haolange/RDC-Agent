import { toolValidator } from '../core/ToolValidator';
import type { JsonSchema } from '../core/types';

/** Keywords that describe a value without constraining it; they are dropped before validation. */
const ANNOTATION_KEYS = new Set([
  '$schema', '$id', '$comment', '$anchor', '$defs', 'definitions', 'examples', 'format', 'deprecated',
  'readOnly', 'writeOnly', 'contentEncoding', 'contentMediaType',
]);

const MAX_REF_DEPTH = 8;

export type McpInputSchemaResult =
  | { ok: true; schema: JsonSchema }
  | { ok: false; reason: string };

/**
 * Turns the JSON Schema an MCP server declares into the schema the tool validator enforces: annotation keywords are
 * removed and local `$ref`s into `$defs` / `definitions` are inlined. The result is compiled once here, so a tool
 * whose constraints the validator cannot enforce is reported at connect time instead of failing every call.
 */
export function compileMcpInputSchema(raw: unknown, toolName: string): McpInputSchemaResult {
  if (raw === undefined || raw === null) return { ok: true, schema: { type: 'object', properties: {} } };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'inputSchema is not an object' };
  const root = raw as Record<string, unknown>;
  const definitions = {
    ...(isRecord(root.definitions) ? root.definitions : {}),
    ...(isRecord(root.$defs) ? root.$defs : {}),
  };
  try {
    const schema = normalize(root, definitions, 0) as JsonSchema;
    toolValidator.assertCompilable(schema, toolName);
    return { ok: true, schema };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function normalize(value: unknown, definitions: Record<string, unknown>, refDepth: number): unknown {
  if (Array.isArray(value)) return value.map((item) => normalize(item, definitions, refDepth));
  if (!isRecord(value)) return value;
  if (typeof value.$ref === 'string') {
    if (refDepth >= MAX_REF_DEPTH) throw new Error(`$ref nesting deeper than ${MAX_REF_DEPTH}`);
    const match = /^#\/(?:\$defs|definitions)\/([^/]+)$/u.exec(value.$ref);
    const target = match ? definitions[decodeURIComponent(match[1])] : undefined;
    if (!isRecord(target)) throw new Error(`unresolvable $ref ${value.$ref}`);
    const { $ref: _ref, ...siblings } = value;
    return normalize({ ...target, ...siblings }, definitions, refDepth + 1);
  }
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (ANNOTATION_KEYS.has(key)) continue;
    output[key] = key === 'properties' && isRecord(child)
      ? Object.fromEntries(Object.entries(child).map(([name, property]) => [name, normalize(property, definitions, refDepth)]))
      : normalize(child, definitions, refDepth);
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

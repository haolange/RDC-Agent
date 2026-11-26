import { toolValidator } from '../core/ToolValidator';
import type { JsonSchema } from '../core/types';

/**
 * Keywords dropped from the schema sent to providers: annotations, dialect metadata and `format`, which several
 * provider wire formats reject. Arguments are still validated against the server's declared schema, `format` included.
 */
const ANNOTATION_KEYS = new Set([
  '$schema',
  '$id',
  '$comment',
  '$anchor',
  '$defs',
  'definitions',
  'examples',
  'format',
  'deprecated',
  'readOnly',
  'writeOnly',
  'contentEncoding',
  'contentMediaType',
]);

const MAX_REF_DEPTH = 8;

export type McpInputSchemaResult =
  { ok: true; schema: JsonSchema; argumentSchema: JsonSchema } | { ok: false; reason: string };

/**
 * Compiles the JSON Schema an MCP server declares for a tool at connect time, so a tool whose schema the validator
 * cannot compile is reported then instead of failing every call. `argumentSchema` is the declared schema arguments
 * are validated against; `schema` is its provider projection, with annotation keywords removed and local `$ref`s into
 * `$defs` / `definitions` inlined.
 */
export function compileMcpInputSchema(raw: unknown, toolName: string): McpInputSchemaResult {
  if (raw === undefined || raw === null) raw = { type: 'object', properties: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'inputSchema is not an object' };
  const root = raw as JsonSchema;
  const definitions = {
    ...(isRecord(root.definitions) ? root.definitions : {}),
    ...(isRecord(root.$defs) ? root.$defs : {}),
  };
  try {
    toolValidator.compileExternal(root, toolName);
    return { ok: true, schema: normalize(root, definitions, 0) as JsonSchema, argumentSchema: root };
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
    output[key] =
      key === 'properties' && isRecord(child)
        ? Object.fromEntries(
            Object.entries(child).map(([name, property]) => [name, normalize(property, definitions, refDepth)]),
          )
        : normalize(child, definitions, refDepth);
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

import { createHash } from 'node:crypto';
import Ajv, { type ErrorObject, type Options, type ValidateFunction } from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { canonicalJson } from '../../rdc/RdcOperationCatalog';
import type AjvCore from 'ajv/dist/core';
import type { JsonSchema, ToolDefinition } from './types';

/**
 * 工具参数验证错误。
 *
 * 携带 `path` 以便定位失败字段，例如 `args.options.format`。
 */
export class ToolValidationError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly toolName?: string,
  ) {
    super(toolName ? `[${toolName}] ${path}: ${message}` : `${path}: ${message}`);
    this.name = 'ToolValidationError';
  }
}

const DRAFT_07 = /^https?:\/\/json-schema\.org\/draft-07\/schema#?$/u;
const DRAFT_2020_12 = /^https?:\/\/json-schema\.org\/draft\/2020-12\/schema#?$/u;

/** Arguments arrive parsed from model JSON; validation fills declared defaults and reports the first failure. */
const VALIDATION_OPTIONS: Options = { allErrors: false, useDefaults: true, coerceTypes: false, logger: false };

/**
 * Built-in schemas are ours, so they compile under Ajv strict mode. `strictRequired` stays off: the
 * `oneOf: [{ required: [a], not: { required: [b] } }]` mode-exclusion idiom names properties declared one level up.
 */
const BUILTIN_OPTIONS: Options = { ...VALIDATION_OPTIONS, strict: true, strictRequired: false };

/**
 * An MCP server's schema is external. Unknown keywords and formats still fail the compile, because a constraint the
 * validator cannot enforce must not pass silently; the strict-mode style checks (types, tuples, required) do not,
 * because they reject valid JSON Schema that third-party generators commonly emit.
 */
const EXTERNAL_OPTIONS: Options = {
  ...VALIDATION_OPTIONS,
  strictSchema: true,
  strictNumbers: true,
  strictTypes: false,
  strictTuples: false,
  strictRequired: false,
};

function withFormats<T extends AjvCore>(ajv: T): T {
  addFormats(ajv);
  return ajv;
}

/** Path, command and URL arguments keep their exact JSON type; the model's mild type slips are coerced elsewhere. */
const SAFE_PARAM_KEY =
  /^(?:path|.*_?path|cwd|command|url|uri|source|destination|notebook_path|file|filename|dir|directory)$/i;

/** Keywords whose value is a subschema, a list of subschemas, or a map of subschemas. */
const SUBSCHEMA_KEYS = new Set([
  'items',
  'additionalProperties',
  'not',
  'if',
  'then',
  'else',
  'contains',
  'propertyNames',
  'unevaluatedItems',
  'unevaluatedProperties',
  'additionalItems',
]);
const SUBSCHEMA_LIST_KEYS = new Set(['anyOf', 'oneOf', 'allOf', 'prefixItems']);
const SUBSCHEMA_MAP_KEYS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);

interface CompiledSchema {
  validate: ValidateFunction;
  strict: boolean;
}

/**
 * 工具调用参数 JSON Schema 验证器（Ajv，JSON Schema 2020-12，`ajv-formats` 校验 `format`）。
 *
 * - Built-in tool schemas compile strictly when the runtime tool set is assembled (`assertCompilable`); MCP tool
 *   schemas compile at connect (`compileExternal`), in the dialect their `$schema` names (2020-12 or draft-07).
 * - An object schema that declares `properties` without `additionalProperties` / `unevaluatedProperties` rejects
 *   undeclared fields; an object schema without `properties` is an opaque bag.
 * - Missing fields take their declared `default`.
 * - Before validation, scalar arguments whose JSON type the schema does not allow are coerced along plain
 *   `properties` / `items` / `additionalProperties` paths (numeric strings and booleans to numbers, `"true"` /
 *   `"false"` and 1 / 0 to booleans, numbers and booleans to strings), except path, command and URL arguments.
 *   Combinator branches are matched as sent.
 *
 * Compiled validators are cached by the hash of the schema's canonical JSON, so equal schemas share one validator
 * whatever object carries them.
 */
export class ToolValidator {
  private readonly compiled = new Map<string, CompiledSchema>();
  private readonly builtin = withFormats(new Ajv2020(BUILTIN_OPTIONS));
  private readonly external = withFormats(new Ajv2020(EXTERNAL_OPTIONS));
  private readonly externalDraft07 = withFormats(new Ajv(EXTERNAL_OPTIONS));

  /**
   * 校验并强转一组参数。
   *
   * @returns 经过强转、补齐默认值后的参数对象。
   * @throws {ToolValidationError} 任一字段不符合 schema。
   */
  validate(toolDef: ToolDefinition, args: Record<string, unknown>): Record<string, unknown> {
    const schema = toolDef.parameters;
    const { validate } = this.compiled.get(schemaHash(schema)) ?? this.compileBuiltin(schema, toolDef.name);
    const data = coerceArguments(structuredClone(args), schema, schema, undefined);
    if (!validate(data)) throw validationError(validate.errors ?? [], data, toolDef.name);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new ToolValidationError('参数必须是对象', 'args', toolDef.name);
    }
    return data as Record<string, unknown>;
  }

  /** Compiles a built-in tool's schema strictly, once per distinct schema; a schema Ajv rejects fails here. */
  assertCompilable(schema: JsonSchema, toolName: string): void {
    if (this.compiled.get(schemaHash(schema))?.strict) return;
    this.compileBuiltin(schema, toolName);
  }

  /** Compiles an MCP server's declared input schema, once per distinct schema; a schema Ajv rejects fails here. */
  compileExternal(schema: JsonSchema, toolName: string): void {
    const hash = schemaHash(schema);
    if (this.compiled.has(hash)) return;
    const dialect = schema.$schema;
    const ajv =
      dialect === undefined || (typeof dialect === 'string' && DRAFT_2020_12.test(dialect))
        ? this.external
        : typeof dialect === 'string' && DRAFT_07.test(dialect)
          ? this.externalDraft07
          : null;
    if (!ajv) throw new ToolValidationError(`不支持的 $schema 方言 ${JSON.stringify(dialect)}`, 'parameters', toolName);
    this.compiled.set(hash, { validate: compileWith(ajv, schema, toolName), strict: false });
  }

  private compileBuiltin(schema: JsonSchema, toolName: string): CompiledSchema {
    const entry = { validate: compileWith(this.builtin, schema, toolName), strict: true };
    this.compiled.set(schemaHash(schema), entry);
    return entry;
  }
}

export const toolValidator = new ToolValidator();

function schemaHash(schema: JsonSchema): string {
  return createHash('sha256').update(canonicalJson(schema)).digest('hex');
}

/**
 * Compiles the schema with undeclared fields closed. The compiled schema is removed from Ajv's registry right away:
 * the validator cache above owns reuse, and two tools may declare different schemas under the same `$id`.
 */
function compileWith(ajv: AjvCore, schema: JsonSchema, toolName: string): ValidateFunction {
  const closed = closeDeclaredObjects(schema) as JsonSchema;
  try {
    return ajv.compile(closed);
  } catch (error) {
    throw new ToolValidationError(
      `schema 无法编译: ${error instanceof Error ? error.message : String(error)}`,
      'parameters',
      toolName,
    );
  } finally {
    ajv.removeSchema(closed);
  }
}

/** Adds `additionalProperties: false` to every object schema that declares `properties` and leaves extras open. */
function closeDeclaredObjects(node: unknown): unknown {
  if (!isRecord(node)) return node;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (SUBSCHEMA_KEYS.has(key))
      output[key] = Array.isArray(value) ? value.map(closeDeclaredObjects) : closeDeclaredObjects(value);
    else if (SUBSCHEMA_LIST_KEYS.has(key) && Array.isArray(value)) output[key] = value.map(closeDeclaredObjects);
    else if (SUBSCHEMA_MAP_KEYS.has(key) && isRecord(value))
      output[key] = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [name, closeDeclaredObjects(child)]),
      );
    else output[key] = value;
  }
  const declaresObject = node.type === 'object' || (Array.isArray(node.type) && node.type.includes('object'));
  if (
    declaresObject &&
    isRecord(node.properties) &&
    node.additionalProperties === undefined &&
    node.unevaluatedProperties === undefined
  ) {
    output.additionalProperties = false;
  }
  return output;
}

// ---------------------------------------------------------------------------------------------------------------
// Argument coercion
// ---------------------------------------------------------------------------------------------------------------

function isSafeParamKey(key: string | undefined): boolean {
  return key !== undefined && SAFE_PARAM_KEY.test(key);
}

/** Follows local `#/$defs/...` and `#/definitions/...` references, the only kind an argument path walks through. */
function resolveLocalRef(schema: JsonSchema, root: JsonSchema): JsonSchema {
  let current = schema;
  for (let hops = 0; hops < 8 && typeof current.$ref === 'string'; hops += 1) {
    const groups = /^#\/(?<table>\$defs|definitions)\/(?<name>[^/]+)$/u.exec(current.$ref)?.groups;
    const table = groups?.table === undefined ? undefined : root[groups.table];
    const target = groups?.name !== undefined && isRecord(table) ? table[decodeURIComponent(groups.name)] : undefined;
    if (!isRecord(target)) return current;
    current = target as JsonSchema;
  }
  return current;
}

function coerceArguments(value: unknown, rawSchema: JsonSchema, root: JsonSchema, key: string | undefined): unknown {
  const schema = resolveLocalRef(rawSchema, root);
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length > 0 && !types.some((type) => hasJsonType(value, type)) && !isSafeParamKey(key)) {
    for (const type of types) {
      const coerced = coerceScalar(value, type);
      if (coerced !== undefined) return coerced;
    }
  }
  if (Array.isArray(value)) {
    const items = schema.items;
    return isRecord(items) ? value.map((item) => coerceArguments(item, items as JsonSchema, root, key)) : value;
  }
  if (!isRecord(value)) return value;
  const properties = schema.properties;
  const additional = schema.additionalProperties;
  for (const [name, child] of Object.entries(value)) {
    const childSchema = properties?.[name] ?? (isRecord(additional) ? additional : undefined);
    if (childSchema) value[name] = coerceArguments(child, childSchema, root, name);
  }
  return value;
}

function coerceScalar(value: unknown, type: string): unknown {
  switch (type) {
    case 'string':
      return typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined;
    case 'number':
    case 'integer': {
      const numeric =
        typeof value === 'boolean'
          ? Number(value)
          : typeof value === 'string' && value.trim() !== ''
            ? Number(value)
            : undefined;
      return numeric !== undefined && hasJsonType(numeric, type) ? numeric : undefined;
    }
    case 'boolean': {
      const text = typeof value === 'string' ? value.trim().toLowerCase() : value;
      return text === 'true' || text === 1 ? true : text === 'false' || text === 0 ? false : undefined;
    }
    default:
      return undefined;
  }
}

function hasJsonType(value: unknown, type: string): boolean {
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return describeType(value) === type;
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// ---------------------------------------------------------------------------------------------------------------
// Error reporting
// ---------------------------------------------------------------------------------------------------------------

/** Reports the last Ajv error; a failed `anyOf` / `oneOf` also lists why each branch failed. */
function validationError(errors: ErrorObject[], data: unknown, toolName: string): ToolValidationError {
  const primary = errors.at(-1);
  if (!primary) return new ToolValidationError('参数不符合 schema', 'args', toolName);
  let message = describeError(primary, data);
  if (primary.keyword === 'anyOf' || primary.keyword === 'oneOf') {
    const branches = [
      ...new Set(errors.slice(0, -1).map((error) => `${argumentPath(error)}: ${describeError(error, data)}`)),
    ];
    if (branches.length > 0) message += `（分支：${branches.slice(0, 4).join('；')}）`;
  }
  return new ToolValidationError(message, argumentPath(primary), toolName);
}

function argumentPath(error: ErrorObject): string {
  const segments = error.instancePath
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/gu, '/').replace(/~0/gu, '~'));
  const named = error.params as { missingProperty?: string; additionalProperty?: string };
  const leaf = named.missingProperty ?? named.additionalProperty;
  if (leaf !== undefined) segments.push(leaf);
  return segments.reduce(
    (path, segment) => (/^\d+$/u.test(segment) ? `${path}[${segment}]` : `${path}.${segment}`),
    'args',
  );
}

function valueAt(data: unknown, instancePath: string): unknown {
  let current = data;
  for (const segment of instancePath.split('/').slice(1)) {
    const name = segment.replace(/~1/gu, '/').replace(/~0/gu, '~');
    current = Array.isArray(current) ? current[Number(name)] : isRecord(current) ? current[name] : undefined;
  }
  return current;
}

function describeError(error: ErrorObject, data: unknown): string {
  const params = error.params as Record<string, unknown>;
  const actual = valueAt(data, error.instancePath);
  const limit = String(params.limit);
  switch (error.keyword) {
    case 'type':
      return Array.isArray(params.type)
        ? `期望类型之一 ${params.type.join(' | ')}，实际为 ${describeType(actual)}`
        : `期望 ${String(params.type)}，实际为 ${describeType(actual)}`;
    case 'required':
      return `缺少必填字段 "${String(params.missingProperty)}"`;
    case 'additionalProperties':
      return `未声明字段 "${String(params.additionalProperty)}" 被拒绝`;
    case 'enum':
      return `值必须是以下枚举之一: ${(params.allowedValues as unknown[]).map((value) => JSON.stringify(value)).join(', ')}（实际: ${JSON.stringify(actual)}）`;
    case 'const':
      return `值必须等于 const ${JSON.stringify(params.allowedValue)}（实际: ${JSON.stringify(actual)}）`;
    case 'format':
      return `值不符合 format "${String(params.format)}"（实际: ${JSON.stringify(actual)}）`;
    case 'pattern':
      return `值不匹配 pattern ${String(params.pattern)}（实际: ${JSON.stringify(actual)}）`;
    case 'minLength':
      return `字符串长度不得小于 ${limit}`;
    case 'maxLength':
      return `字符串长度不得大于 ${limit}`;
    case 'minimum':
      return `数值不得小于 ${limit}（实际: ${JSON.stringify(actual)}）`;
    case 'maximum':
      return `数值不得大于 ${limit}（实际: ${JSON.stringify(actual)}）`;
    case 'exclusiveMinimum':
      return `数值必须大于 ${limit}（实际: ${JSON.stringify(actual)}）`;
    case 'exclusiveMaximum':
      return `数值必须小于 ${limit}（实际: ${JSON.stringify(actual)}）`;
    case 'multipleOf':
      return `数值必须是 ${String(params.multipleOf)} 的倍数（实际: ${JSON.stringify(actual)}）`;
    case 'minItems':
      return `数组元素数不得小于 ${limit}`;
    case 'maxItems':
      return `数组元素数不得大于 ${limit}`;
    case 'uniqueItems':
      return '数组元素必须互不相同';
    case 'minProperties':
      return `对象字段数不得小于 ${limit}`;
    case 'maxProperties':
      return `对象字段数不得大于 ${limit}`;
    case 'anyOf':
      return 'anyOf 要求至少匹配一个 schema';
    case 'oneOf':
      return 'oneOf 要求恰好匹配一个 schema';
    case 'not':
      return 'not schema 匹配了被禁止的输入';
    default:
      return `${error.keyword}: ${error.message ?? '不符合 schema'}`;
  }
}

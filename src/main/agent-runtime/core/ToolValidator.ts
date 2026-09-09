import type { JsonSchema, ToolCall, ToolDefinition } from './types';

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

/** Closed supported JSON Schema subset — unknown keywords fail-closed. */
const SUPPORTED_SCHEMA_KEYS = new Set([
  'type',
  'oneOf',
  'not',
  'enum',
  'const',
  'default',
  'required',
  'properties',
  'items',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'pattern',
  'minItems',
  'maxItems',
  'additionalProperties',
  'description',
  'title',
]);

const MAX_SCHEMA_DEPTH = 12;
const MAX_SCHEMA_NODES = 256;
const MAX_OBJECT_KEYS = 64;
const MAX_ARRAY_ITEMS_HARD = 256;

/** 安全敏感字段：禁止 number/boolean → string 等模糊 coercion。 */
const SAFE_PARAM_KEY = /^(?:path|.*_?path|cwd|command|url|uri|source|destination|notebook_path|file|filename|dir|directory)$/i;

function isSafeParamKey(key: string): boolean {
  const leaf = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1) : key;
  const withoutIndex = leaf.replace(/\[\d+\]$/u, '');
  return SAFE_PARAM_KEY.test(withoutIndex);
}

function schemaNumber(schema: JsonSchema, key: string): number | undefined {
  const raw = schema[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

function schemaString(schema: JsonSchema, key: string): string | undefined {
  const raw = schema[key];
  return typeof raw === 'string' ? raw : undefined;
}

function assertSupportedSchema(
  schema: JsonSchema,
  path: string,
  toolName: string,
  depth = 0,
  counters = { nodes: 0 },
): void {
  counters.nodes += 1;
  if (depth > MAX_SCHEMA_DEPTH) {
    throw new ToolValidationError(
      `schema 递归深度超过上限 ${MAX_SCHEMA_DEPTH}`,
      path,
      toolName,
    );
  }
  if (counters.nodes > MAX_SCHEMA_NODES) {
    throw new ToolValidationError(
      `schema 节点数超过上限 ${MAX_SCHEMA_NODES}`,
      path,
      toolName,
    );
  }
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYS.has(key)) {
      throw new ToolValidationError(
        `不支持的 schema 关键字 "${key}"（严格子集 fail-closed）`,
        path,
        toolName,
      );
    }
  }
  if (schema.oneOf !== undefined) {
    if (!Array.isArray(schema.oneOf) || schema.oneOf.length < 1 || schema.oneOf.length > 16) {
      throw new ToolValidationError('oneOf must contain 1-16 schemas', path, toolName);
    }
    for (const [index, branch] of schema.oneOf.entries()) {
      if (!branch || typeof branch !== 'object' || Array.isArray(branch)) throw new ToolValidationError('invalid oneOf branch', path, toolName);
      assertSupportedSchema(branch as JsonSchema, path + '.oneOf.' + index, toolName, depth + 1, counters);
    }
  }
  if (schema.not !== undefined) {
    if (!schema.not || typeof schema.not !== 'object' || Array.isArray(schema.not)) throw new ToolValidationError('invalid not schema', path, toolName);
    assertSupportedSchema(schema.not as JsonSchema, path + '.not', toolName, depth + 1, counters);
  }
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
    throw new ToolValidationError(
      'additionalProperties 仅允许省略或 false（默认拒绝未声明字段）',
      path,
      toolName,
    );
  }
  if (schema.properties) {
    for (const [key, child] of Object.entries(schema.properties)) {
      assertSupportedSchema(child, `${path}.properties.${key}`, toolName, depth + 1, counters);
    }
  }
  if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
    assertSupportedSchema(schema.items as JsonSchema, `${path}.items`, toolName, depth + 1, counters);
  }
}

/**
 * 工具调用参数 JSON Schema 验证器。
 *
 * 设计原则：
 * - 不引入第三方依赖（如 AJV），实现轻量自包含。
 * - Strict subset: type/required/properties/items/enum/const/min-max/pattern; undeclared fields rejected by default.
 * - Compile-time reject any keyword outside SUPPORTED_SCHEMA_KEYS.
 * - Non-safe fields may coerce mildly; path/command/URL stay fail-closed exact types.
 */
export class ToolValidator {
  /**
   * 校验并强转一组参数。
   *
   * @returns 经过强转、补齐默认值后的参数对象。
   * @throws {ToolValidationError} 任一字段不符合 schema。
   */
  validate(
    toolDef: ToolDefinition,
    args: Record<string, unknown>,
  ): Record<string, unknown> {
    const schema = toolDef.parameters;
    assertSupportedSchema(schema, 'parameters', toolDef.name);
    const value = args ?? {};
    const validated = this.validateValue(value, schema, 'args', toolDef.name, false, 0);
    if (validated === null || typeof validated !== 'object' || Array.isArray(validated)) {
      throw new ToolValidationError('参数必须是对象', 'args', toolDef.name);
    }
    return validated as Record<string, unknown>;
  }

  /**
   * 在 `tools` 列表中查找对应工具并校验调用参数。
   */
  validateToolCall(
    tools: ToolDefinition[],
    toolCall: ToolCall,
  ): Record<string, unknown> {
    const def = tools.find((t) => t.name === toolCall.name);
    if (!def) {
      throw new ToolValidationError(
        `未找到工具定义 "${toolCall.name}"`,
        'toolCall.name',
        toolCall.name,
      );
    }
    return this.validate(def, toolCall.arguments ?? {});
  }

  private validateValue(
    value: unknown,
    schema: JsonSchema,
    path: string,
    toolName: string,
    safeParam: boolean,
    depth: number,
  ): unknown {
    if (depth > MAX_SCHEMA_DEPTH) {
      throw new ToolValidationError(
        `值递归深度超过上限 ${MAX_SCHEMA_DEPTH}`,
        path,
        toolName,
      );
    }

    if (value === undefined && schema.default !== undefined) {
      value = schema.default;
    }

    const matches = (candidate: JsonSchema): boolean => {
      try { this.validateValue(value, candidate, path, toolName, true, depth + 1); return true; }
      catch (error) { if (error instanceof ToolValidationError) return false; throw error; }
    };
    if (Array.isArray(schema.oneOf) && schema.oneOf.filter((branch) => matches(branch as JsonSchema)).length !== 1) {
      throw new ToolValidationError('oneOf requires exactly one matching input mode', path, toolName);
    }
    if (schema.not && matches(schema.not as JsonSchema)) throw new ToolValidationError('not schema matched a forbidden input', path, toolName);
    if (!schema.type && Array.isArray(schema.required) && value && typeof value === 'object' && !Array.isArray(value)) {
      for (const key of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) throw new ToolValidationError('missing required ' + key, path, toolName);
      }
    }

    if (Object.prototype.hasOwnProperty.call(schema, 'const')) {
      if (!Object.is(value, schema.const) && JSON.stringify(value) !== JSON.stringify(schema.const)) {
        throw new ToolValidationError(
          `值必须等于 const ${JSON.stringify(schema.const)}（实际: ${JSON.stringify(value)}）`,
          path,
          toolName,
        );
      }
      return value;
    }

    const expectedType = schema.type;

    switch (expectedType) {
      case 'string':
        return this.validateString(value, schema, path, toolName, safeParam);
      case 'number':
      case 'integer':
        return this.validateNumber(value, schema, path, toolName, expectedType === 'integer', safeParam);
      case 'boolean':
        return this.validateBoolean(value, path, toolName, safeParam);
      case 'array':
        return this.validateArray(value, schema, path, toolName, safeParam, depth);
      case 'object':
        return this.validateObject(value, schema, path, toolName, depth);
      case 'null':
        if (value !== null) {
          throw new ToolValidationError(`期望 null，实际为 ${typeof value}`, path, toolName);
        }
        return null;
      default:
        if (schema.enum && Array.isArray(schema.enum) && !schema.enum.includes(value as never)) {
          throw new ToolValidationError(
            `值必须是以下枚举之一: ${schema.enum.join(', ')}`,
            path,
            toolName,
          );
        }
        return value;
    }
  }

  private validateString(
    value: unknown,
    schema: JsonSchema,
    path: string,
    toolName: string,
    safeParam: boolean,
  ): string {
    let coerced: string;
    if (typeof value === 'string') {
      coerced = value;
    } else if (!safeParam && (typeof value === 'number' || typeof value === 'boolean')) {
      coerced = String(value);
    } else {
      throw new ToolValidationError(
        `期望 string，实际为 ${describeType(value)}`,
        path,
        toolName,
      );
    }

    const minLength = schemaNumber(schema, 'minLength');
    if (minLength !== undefined && coerced.length < minLength) {
      throw new ToolValidationError(
        `字符串长度不得小于 ${minLength}（实际: ${coerced.length}）`,
        path,
        toolName,
      );
    }
    const maxLength = schemaNumber(schema, 'maxLength');
    if (maxLength !== undefined && coerced.length > maxLength) {
      throw new ToolValidationError(
        `字符串长度不得大于 ${maxLength}（实际: ${coerced.length}）`,
        path,
        toolName,
      );
    }
    const pattern = schemaString(schema, 'pattern');
    if (pattern) {
      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch {
        throw new ToolValidationError(`无效的 pattern: ${pattern}`, path, toolName);
      }
      if (!regex.test(coerced)) {
        throw new ToolValidationError(
          `值不匹配 pattern ${pattern}（实际: "${coerced}"）`,
          path,
          toolName,
        );
      }
    }

    if (schema.enum && Array.isArray(schema.enum) && !schema.enum.includes(coerced)) {
      throw new ToolValidationError(
        `值必须是以下枚举之一: ${schema.enum.join(', ')}（实际: "${coerced}"）`,
        path,
        toolName,
      );
    }
    return coerced;
  }

  private validateNumber(
    value: unknown,
    schema: JsonSchema,
    path: string,
    toolName: string,
    integerOnly: boolean,
    safeParam: boolean,
  ): number {
    let coerced: number;
    if (typeof value === 'number') {
      coerced = value;
    } else if (
      !safeParam
      && typeof value === 'string'
      && value.trim() !== ''
      && !isNaN(Number(value))
    ) {
      coerced = Number(value);
    } else if (!safeParam && typeof value === 'boolean') {
      coerced = value ? 1 : 0;
    } else {
      throw new ToolValidationError(
        `期望 ${integerOnly ? 'integer' : 'number'}，实际为 ${describeType(value)}`,
        path,
        toolName,
      );
    }

    if (!Number.isFinite(coerced)) {
      throw new ToolValidationError(
        `数值必须是有限数（实际: ${coerced}）`,
        path,
        toolName,
      );
    }
    if (integerOnly && !Number.isInteger(coerced)) {
      throw new ToolValidationError(
        `期望 integer，实际为非整数 ${coerced}`,
        path,
        toolName,
      );
    }

    const minimum = schemaNumber(schema, 'minimum');
    if (minimum !== undefined && coerced < minimum) {
      throw new ToolValidationError(
        `数值不得小于 ${minimum}（实际: ${coerced}）`,
        path,
        toolName,
      );
    }
    const maximum = schemaNumber(schema, 'maximum');
    if (maximum !== undefined && coerced > maximum) {
      throw new ToolValidationError(
        `数值不得大于 ${maximum}（实际: ${coerced}）`,
        path,
        toolName,
      );
    }

    if (schema.enum && Array.isArray(schema.enum) && !schema.enum.includes(String(coerced))) {
      const numericEnum = schema.enum.map((e) => Number(e));
      if (!numericEnum.includes(coerced)) {
        throw new ToolValidationError(
          `值必须是以下枚举之一: ${schema.enum.join(', ')}（实际: ${coerced}）`,
          path,
          toolName,
        );
      }
    }
    return coerced;
  }

  private validateBoolean(
    value: unknown,
    path: string,
    toolName: string,
    safeParam: boolean,
  ): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (!safeParam && typeof value === 'string') {
      const v = value.trim().toLowerCase();
      if (v === 'true') return true;
      if (v === 'false') return false;
    }
    if (!safeParam && typeof value === 'number') {
      if (value === 1) return true;
      if (value === 0) return false;
    }
    throw new ToolValidationError(
      `期望 boolean，实际为 ${describeType(value)}`,
      path,
      toolName,
    );
  }

  private validateArray(
    value: unknown,
    schema: JsonSchema,
    path: string,
    toolName: string,
    safeParam: boolean,
    depth: number,
  ): unknown[] {
    if (!Array.isArray(value)) {
      throw new ToolValidationError(
        `期望 array，实际为 ${describeType(value)}`,
        path,
        toolName,
      );
    }
    if (value.length > MAX_ARRAY_ITEMS_HARD) {
      throw new ToolValidationError(
        `数组元素数超过硬上限 ${MAX_ARRAY_ITEMS_HARD}`,
        path,
        toolName,
      );
    }
    const minItems = schemaNumber(schema, 'minItems');
    if (minItems !== undefined && value.length < minItems) {
      throw new ToolValidationError(
        `数组元素数不得小于 ${minItems}（实际: ${value.length}）`,
        path,
        toolName,
      );
    }
    const maxItems = schemaNumber(schema, 'maxItems');
    if (maxItems !== undefined && value.length > maxItems) {
      throw new ToolValidationError(
        `数组元素数不得大于 ${maxItems}（实际: ${value.length}）`,
        path,
        toolName,
      );
    }
    if (!schema.items) {
      return value;
    }
    return value.map((item, idx) =>
      this.validateValue(
        item,
        schema.items as JsonSchema,
        `${path}[${idx}]`,
        toolName,
        safeParam,
        depth + 1,
      ),
    );
  }

  private validateObject(
    value: unknown,
    schema: JsonSchema,
    path: string,
    toolName: string,
    depth: number,
  ): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new ToolValidationError(
        `期望 object，实际为 ${describeType(value)}`,
        path,
        toolName,
      );
    }
    const input = value as Record<string, unknown>;
    const keys = Object.keys(input);
    if (keys.length > MAX_OBJECT_KEYS) {
      throw new ToolValidationError(
        `对象字段数超过上限 ${MAX_OBJECT_KEYS}`,
        path,
        toolName,
      );
    }
    // Omit `properties` = opaque bag (same as arrays without `items`).
    // Kind-specific bodies such as investigation_write.record are enforced
    // by the tool's own Zod schema, not by inventing a second field list here.
    // An explicit empty `properties: {}` still rejects every key.
    if (schema.properties === undefined) {
      return { ...input };
    }
    const output: Record<string, unknown> = {};

    if (schema.required && Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!(key in input) || input[key] === undefined || input[key] === null) {
          const propSchema = schema.properties?.[key];
          if (!propSchema || propSchema.default === undefined) {
            throw new ToolValidationError(
              `缺少必填字段 "${key}"`,
              `${path}.${key}`,
              toolName,
            );
          }
        }
      }
    }

    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        const childPath = `${path}.${key}`;
        const has = key in input && input[key] !== undefined;
        if (!has) {
          if (propSchema.default !== undefined) {
            output[key] = propSchema.default;
          }
          continue;
        }
        output[key] = this.validateValue(
          input[key],
          propSchema,
          childPath,
          toolName,
          isSafeParamKey(key),
          depth + 1,
        );
      }
    }

    for (const key of keys) {
      if (!(schema.properties && key in schema.properties)) {
        throw new ToolValidationError(
          `未声明字段 "${key}" 被拒绝（默认 additionalProperties=false）`,
          `${path}.${key}`,
          toolName,
        );
      }
    }

    return output;
  }
}

export const toolValidator = new ToolValidator();

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

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

/**
 * 工具调用参数 JSON Schema 验证器。
 *
 * 设计原则：
 * - 不引入第三方依赖（如 AJV），实现轻量自包含。
 * - 支持基础类型、required、enum、items、min/maxItems、min/maxLength、pattern。
 * - 非安全字段允许温和强转；path/command/URL 等安全参数 fail-closed 要求精确类型。
 * - 验证失败时抛出 `ToolValidationError`，附带字段路径和工具名。
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
    const value = args ?? {};
    const validated = this.validateValue(value, schema, 'args', toolDef.name, false);
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

  // -------------------------------------------------------------------
  // 内部实现
  // -------------------------------------------------------------------

  private validateValue(
    value: unknown,
    schema: JsonSchema,
    path: string,
    toolName: string,
    safeParam: boolean,
  ): unknown {
    // 缺省值：若 value 为 undefined 且 schema 提供 default，则使用 default。
    if (value === undefined && schema.default !== undefined) {
      value = schema.default;
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
        return this.validateArray(value, schema, path, toolName, safeParam);
      case 'object':
        return this.validateObject(value, schema, path, toolName);
      case 'null':
        if (value !== null) {
          throw new ToolValidationError(`期望 null，实际为 ${typeof value}`, path, toolName);
        }
        return null;
      default:
        // 未指定 type 或非标准 type：放行原值。
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
    if (schema.enum && Array.isArray(schema.enum) && !schema.enum.includes(String(coerced))) {
      // enum 在 schema 中以 string 数组形式描述时退化为字符串比较。
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
  ): unknown[] {
    if (!Array.isArray(value)) {
      throw new ToolValidationError(
        `期望 array，实际为 ${describeType(value)}`,
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
      ),
    );
  }

  private validateObject(
    value: unknown,
    schema: JsonSchema,
    path: string,
    toolName: string,
  ): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new ToolValidationError(
        `期望 object，实际为 ${describeType(value)}`,
        path,
        toolName,
      );
    }
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    // required 字段检查
    if (schema.required && Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!(key in input) || input[key] === undefined || input[key] === null) {
          // 允许 default 兜底
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
        );
      }
    }

    // 透传未在 properties 中声明的字段（保持工具入参的扩展能力）。
    for (const [key, raw] of Object.entries(input)) {
      if (!(key in output) && !(schema.properties && key in schema.properties)) {
        output[key] = raw;
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

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

/**
 * 工具调用参数 JSON Schema 验证器。
 *
 * 设计原则：
 * - 不引入第三方依赖（如 AJV），实现轻量自包含。
 * - 支持基础类型校验、`required` 字段、`enum` 枚举、`items` 数组元素。
 * - 支持温和的类型强转（字符串 `"42"` → number `42`，`"true"` → boolean）。
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
    const validated = this.validateValue(value, schema, 'args', toolDef.name);
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
  ): unknown {
    // 缺省值：若 value 为 undefined 且 schema 提供 default，则使用 default。
    if (value === undefined && schema.default !== undefined) {
      value = schema.default;
    }

    const expectedType = schema.type;

    switch (expectedType) {
      case 'string':
        return this.validateString(value, schema, path, toolName);
      case 'number':
      case 'integer':
        return this.validateNumber(value, schema, path, toolName, expectedType === 'integer');
      case 'boolean':
        return this.validateBoolean(value, path, toolName);
      case 'array':
        return this.validateArray(value, schema, path, toolName);
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
  ): string {
    let coerced: string;
    if (typeof value === 'string') {
      coerced = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      coerced = String(value);
    } else {
      throw new ToolValidationError(
        `期望 string，实际为 ${describeType(value)}`,
        path,
        toolName,
      );
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
  ): number {
    let coerced: number;
    if (typeof value === 'number') {
      coerced = value;
    } else if (typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value))) {
      coerced = Number(value);
    } else if (typeof value === 'boolean') {
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

  private validateBoolean(value: unknown, path: string, toolName: string): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const v = value.trim().toLowerCase();
      if (v === 'true') return true;
      if (v === 'false') return false;
    }
    if (typeof value === 'number') {
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
  ): unknown[] {
    if (!Array.isArray(value)) {
      throw new ToolValidationError(
        `期望 array，实际为 ${describeType(value)}`,
        path,
        toolName,
      );
    }
    if (!schema.items) {
      return value;
    }
    return value.map((item, idx) =>
      this.validateValue(item, schema.items as JsonSchema, `${path}[${idx}]`, toolName),
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
        output[key] = this.validateValue(input[key], propSchema, childPath, toolName);
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

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

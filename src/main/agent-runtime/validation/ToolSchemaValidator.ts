import { z, type ZodTypeAny } from 'zod';
import type { JsonSchema } from '../core/types';

/**
 * 将 JSON Schema 子集转换为 Zod schema，用于运行时参数验证。
 * 支持：object、string、number、integer、boolean、array、enum、required。
 */
export function jsonSchemaToZod(schema: JsonSchema): ZodTypeAny {
  if (!schema || typeof schema !== 'object') {
    return z.any();
  }
  switch (schema.type) {
    case 'string': {
      if (schema.enum && Array.isArray(schema.enum)) {
        return z.enum(schema.enum as [string, ...string[]]);
      }
      return z.string();
    }
    case 'number':
      return z.number();
    case 'integer':
      return z.number().int();
    case 'boolean':
      return z.boolean();
    case 'array': {
      const itemSchema = schema.items ? jsonSchemaToZod(schema.items) : z.any();
      return z.array(itemSchema);
    }
    case 'object': {
      const shape: Record<string, ZodTypeAny> = {};
      const props = schema.properties ?? {};
      for (const [key, prop] of Object.entries(props)) {
        shape[key] = jsonSchemaToZod(prop as JsonSchema);
      }
      let obj = z.object(shape);
      const required = schema.required;
      if (Array.isArray(required)) {
        const partial: Record<string, ZodTypeAny> = {};
        for (const [key, val] of Object.entries(shape)) {
          partial[key] = required.includes(key) ? val : val.optional();
        }
        obj = z.object(partial);
      }
      return obj;
    }
    default:
      return z.any();
  }
}

export class ToolSchemaValidator {
  private cache = new Map<string, ZodTypeAny>();

  validate(toolName: string, schema: JsonSchema, args: unknown): Record<string, unknown> {
    let zodSchema = this.cache.get(toolName);
    if (!zodSchema) {
      zodSchema = jsonSchemaToZod(schema);
      this.cache.set(toolName, zodSchema);
    }
    const result = zodSchema.safeParse(args);
    if (!result.success) {
      throw new Error(`Tool "${toolName}" parameter validation failed: ${result.error.message}`);
    }
    return result.data as Record<string, unknown>;
  }

  clearCache(): void {
    this.cache.clear();
  }
}

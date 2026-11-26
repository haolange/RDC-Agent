import { z } from 'zod';

/** A value JSON can carry. JSON.parse returns `any`; code that keeps parsed JSON types it with these instead. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const JsonPrimitiveSchema: z.ZodType<JsonPrimitive> = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([JsonPrimitiveSchema, z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema)]),
);

export const JsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), JsonValueSchema);

/** Parses JSON text into a typed JSON value; malformed text throws the SyntaxError JSON.parse raises. */
export function parseJsonValue(text: string): JsonValue {
  return JsonValueSchema.parse(JSON.parse(text));
}

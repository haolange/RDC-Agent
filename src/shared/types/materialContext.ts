import { z } from 'zod';

/** User supplied locations and comparison conditions, never verified observations or authorization. */
export const MaterialContextSchema = z.object({
  intent: z.string().trim().max(2000).optional(),
  region: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).strict()
    .refine(r => r.x + r.width <= 1.000001 && r.y + r.height <= 1.000001, 'Region must remain inside the original image').optional(),
  documentLocation: z.string().trim().max(1000).optional(),
  timeRange: z.object({ startSeconds: z.number().nonnegative(), endSeconds: z.number().positive() }).strict()
    .refine(r => r.endSeconds > r.startSeconds, 'End must follow start').optional(),
  comparison: z.object({ group: z.string().trim().min(1).max(120), role: z.enum(['baseline', 'reference', 'after', 'diff']), conditions: z.string().trim().min(1).max(2000) }).strict().optional(),
}).strict();
export type MaterialContext = z.infer<typeof MaterialContextSchema>;
export function describeMaterialContext(context: MaterialContext): string {
  return `User-supplied material context (not verified observations or authorization): ${JSON.stringify(context)}. Region coordinates are fractions of the original image; preserve the original. Comparison conditions must be verified before conclusions.`;
}

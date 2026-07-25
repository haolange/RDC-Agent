import type { Model, Usage } from '../../core/types';

/**
 * Calculate the dollar cost for a provider usage snapshot using the model's
 * published per-million-token pricing.
 *
 * Returns `undefined` when the model has no pricing information.
 */
export function calculateUsageCost(
  model: Pick<Model, 'cost'>,
  usage: Omit<Usage, 'cost'>,
): Usage['cost'] | undefined {
  if (!model.cost) return undefined;

  const input = (model.cost.input / 1_000_000) * usage.inputTokens;
  const output = (model.cost.output / 1_000_000) * usage.outputTokens;

  const cacheRead = model.cost.cacheRead
    ? (model.cost.cacheRead / 1_000_000) * (usage.cacheReadTokens ?? 0)
    : 0;

  // Anthropic 1h cache write costs 2x input price; short-lived (5m) uses the
  // explicit cacheWrite rate when available.
  const longWrite = usage.cacheWriteLongTokens ?? 0;
  const shortWrite = (usage.cacheWriteTokens ?? 0) - longWrite;
  const cacheWrite = model.cost.cacheWrite
    ? (model.cost.cacheWrite / 1_000_000) * Math.max(shortWrite, 0)
      + (model.cost.input * 2 / 1_000_000) * longWrite
    : 0;

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total: input + output + cacheRead + cacheWrite,
  };
}

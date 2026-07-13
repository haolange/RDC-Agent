/** 字符数到 token 数的粗略估算（约 4 字符 / token），仅用于预算与压缩阈值估算。 */
export const charsToTokens = (chars: number): number => Math.ceil(chars / 4);

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return Number.isInteger(millions) ? `${millions}M` : `${millions.toFixed(1)}M`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return Number.isInteger(thousands) ? `${thousands}k` : `${thousands.toFixed(1)}k`;
  }
  return `${value}`;
}

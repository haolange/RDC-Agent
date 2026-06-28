/** 字符数→token 数的粗略估算（约 4 字符 / token），用于上下文占用与压缩阈值估算。 */
export const charsToTokens = (chars: number): number => Math.ceil(chars / 4);

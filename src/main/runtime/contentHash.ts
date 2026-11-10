import { createHash } from 'crypto';

export function sha256Hex(bytes: Buffer | string): string {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'utf8');
  return createHash('sha256').update(buffer).digest('hex');
}

export function normalizeSha256(value: string): string {
  return value.trim().toLowerCase().replace(/^sha256:/, '');
}

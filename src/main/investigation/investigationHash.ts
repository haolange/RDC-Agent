import * as crypto from 'crypto';
import { bareInvestigationHash, formatInvestigationContentHash } from '@shared/types/renderdocInvestigation';

export function sha256Hex(bytes: Buffer | string): string {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'utf8');
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function sha256Prefixed(bytes: Buffer | string): string {
  return formatInvestigationContentHash(sha256Hex(bytes));
}

export function hashesEqual(left: string, right: string): boolean {
  return bareInvestigationHash(left) === bareInvestigationHash(right);
}

export function serializeInvestigationJson(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

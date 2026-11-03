import { bareInvestigationHash, formatInvestigationContentHash } from '@shared/types/renderdocInvestigation';
import { sha256Hex } from '../runtime/contentHash';

export { sha256Hex };

export function sha256Prefixed(bytes: Buffer | string): string {
  return formatInvestigationContentHash(sha256Hex(bytes));
}

export function hashesEqual(left: string, right: string): boolean {
  return bareInvestigationHash(left) === bareInvestigationHash(right);
}

export function serializeInvestigationJson(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

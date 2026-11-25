import { bareInvestigationHash } from '@shared/types/renderdocInvestigation';
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

export function formatInvestigationContentHash(hex: string): string {
  const bare = hex.trim().toLowerCase().replace(/^sha256:/, '');
  return `sha256:${bare}`;
}

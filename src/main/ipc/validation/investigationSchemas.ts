import { z } from 'zod';
import { ipcNonEmptyString } from './IpcPayloadGuard';

const INVESTIGATION_HASH_RE = /^sha256:[a-fA-F0-9]{64}$/;
const INVESTIGATION_OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function investigationOpaqueId(maxLength: number, label: string) {
  return ipcNonEmptyString(maxLength, label).regex(
    INVESTIGATION_OPAQUE_ID_RE,
    `${label} must be an opaque investigation id`,
  );
}

export const InvestigationReadArgsSchema = z.tuple([
  z.object({
    sessionId: investigationOpaqueId(128, 'sessionId'),
    artifactId: investigationOpaqueId(128, 'artifactId'),
    expectedHash: ipcNonEmptyString(80, 'expectedHash').regex(
      INVESTIGATION_HASH_RE,
      'expectedHash must be sha256:<64 hex>',
    ),
  }).strict(),
]);

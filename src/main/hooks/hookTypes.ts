import type { HookEvent } from '@shared/types/rdcRuntime';

export interface HookDefinition {
  id: string;
  enabled: boolean;
  event: HookEvent;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs: number;
  failurePolicy: 'block' | 'warn';
  matcher?: { agents?: string[]; tools?: string[] };
}

export interface HookTrustState {
  trusted: boolean;
  needsRetrust: boolean;
  projectRoot?: string;
  sourceHash: string;
  trustFingerprint: string;
  trustedAt?: string;
}

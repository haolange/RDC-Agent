import { confirmInMainProcess } from './mainConfirmation';
import { nativeMessage } from './nativeI18n';

export type TrustedResourceKind = 'hook' | 'mcp' | 'agent';

const MESSAGE_KEY = { hook: 'trustHook', mcp: 'trustMcp', agent: 'trustAgent' } as const;

/**
 * Trusting a project resource lets it run commands or steer the Agent, so the person confirms in a
 * native dialog; a renderer request alone never grants trust.
 */
export function confirmResourceTrust(kind: TrustedResourceKind, id: string, detail: string): Promise<boolean> {
  return confirmInMainProcess({
    action: `trust.${kind}`,
    title: nativeMessage('trustTitle'),
    message: nativeMessage(MESSAGE_KEY[kind], { id }),
    detail,
    confirmLabel: nativeMessage('trust'),
    cancelLabel: nativeMessage('cancel'),
  });
}

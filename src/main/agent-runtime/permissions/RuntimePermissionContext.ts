import type { RuntimePermissionState } from '@shared/types/runtimePermission';
import type { Context } from '../core/types';
import { hashScopedResource } from '../../runtime/ScopedResourceResolver';
import { charsToTokens } from '@shared/utils/tokens';

export const RUNTIME_PERMISSION_TOKEN_RESERVE = 128;

/** Request-local context; neither the frozen PromptPlan nor history is mutated. */
export function appendRuntimePermissionContext(context: Context, state: RuntimePermissionState): Pick<Context, 'systemPrompt' | 'systemPromptSegments'> {
  const content = `# Current Runtime Permission\nMode: ${state.mode}\nRevision: ${state.revision}\nThe host applies this mode at each future tool admission. Frozen constraints and hard denies remain in force. Already admitted operations continue under their original authorization.`;
  const segment = {
    id: 'runtime:permission', kind: 'runtime-fact' as const, scope: 'runtime' as const,
    sourcePath: 'runtime://permission', sourceHash: hashScopedResource(content),
    precedence: Number.MAX_SAFE_INTEGER, content, stability: 'volatile' as const,
    tokenEstimate: charsToTokens(content.length),
  };
  return {
    systemPrompt: [context.systemPrompt, content].filter(Boolean).join('\n\n'),
    systemPromptSegments: [...(context.systemPromptSegments ?? []), segment],
  };
}

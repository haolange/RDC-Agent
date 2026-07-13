import { generateEventId } from '@shared/utils/id';
import type { PromptPlan, RequestEnvelopeSnapshot } from '@shared/types/rdxRuntime';
import type { RequestPlan } from '@shared/types/providerCapability';
import { hashScopedResource } from '../../runtime/ScopedResourceResolver';

const SECRET_KEY = /(?:api[-_]?key|authorization|password|secret|access[-_]?token|refresh[-_]?token)/i;
const PROTECTED_KEY = /^(?:encryptedContent|signature|raw)$/i;

export interface RequestEnvelopeInput {
  promptPlan: PromptPlan;
  sessionId?: string;
  turnId?: string;
  callIndex: number;
  route: { providerId: string; modelId: string; protocol: string };
  requestPlan: RequestPlan;
  messages: unknown[];
  tools: unknown[];
  controls: Record<string, unknown>;
  reasoning: RequestEnvelopeSnapshot['reasoning'];
}

export class RequestEnvelopeBuilder {
  build(input: RequestEnvelopeInput): RequestEnvelopeSnapshot {
    const redactions: RequestEnvelopeSnapshot['redactions'] = [];
    const sanitize = (value: unknown, currentPath: string, seen: WeakSet<object>): unknown => {
      if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
      if (typeof value === 'string') return value;
      if (Array.isArray(value)) return value.map((entry, index) => sanitize(entry, `${currentPath}[${index}]`, seen));
      if (typeof value !== 'object') return String(value);
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
      const record = value as Record<string, unknown>;
      if (record.type === 'thinking' && (record.kind === 'opaque' || record.visibility === 'hidden')) {
        redactions.push({ path: currentPath, reason: 'protected opaque reasoning', hash: hashScopedResource(record) });
        return { type: 'thinking', kind: record.kind, visibility: record.visibility, redacted: true };
      }
      if (record.type === 'image' || (typeof record.mimeType === 'string' && typeof record.data === 'string')) {
        redactions.push({ path: currentPath, reason: 'binary image payload', hash: hashScopedResource(record.data) });
        return { type: record.type ?? 'image', mimeType: record.mimeType, byteLength: typeof record.data === 'string' ? record.data.length : undefined, redacted: true };
      }
      const output: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(record)) {
        const entryPath = `${currentPath}.${key}`;
        if (SECRET_KEY.test(key) || PROTECTED_KEY.test(key)) {
          redactions.push({ path: entryPath, reason: SECRET_KEY.test(key) ? 'credential' : 'provider protected payload', hash: hashScopedResource(entry) });
          output[key] = '[REDACTED]';
          continue;
        }
        if (key === 'data' && typeof entry === 'string' && entry.length > 256) {
          redactions.push({ path: entryPath, reason: 'large opaque payload', hash: hashScopedResource(entry) });
          output[key] = `[REDACTED ${entry.length} chars]`;
          continue;
        }
        output[key] = sanitize(entry, entryPath, seen);
      }
      return output;
    };

    return {
      id: generateEventId('llm-call'),
      createdAt: new Date().toISOString(),
      sessionId: input.sessionId,
      turnId: input.turnId,
      callIndex: input.callIndex,
      route: input.route,
      requestPlan: sanitize(input.requestPlan, 'requestPlan', new WeakSet()) as unknown as RequestPlan,
      promptPlan: input.promptPlan,
      messages: sanitize(input.messages, 'messages', new WeakSet()) as unknown[],
      tools: sanitize(input.tools, 'tools', new WeakSet()) as unknown[],
      controls: sanitize(input.controls, 'controls', new WeakSet()) as Record<string, unknown>,
      reasoning: input.reasoning,
      redactions,
    };
  }
}

export const requestEnvelopeBuilder = new RequestEnvelopeBuilder();

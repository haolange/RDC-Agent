import { randomBytes, timingSafeEqual } from 'crypto';
import { hasRegisteredIpcChannel } from '../ipc/invokeRegistry';

/**
 * Phase 0 stop-ship: browser bridge is not a generic IPC proxy.
 * Channels must be registered AND match the explicit allowlist, and must not
 * match the hard deny list (sensitive capabilities stay desktop-only).
 *
 * Non-blocking assumption vs plan wording "仅只读诊断": AGENTS.md requires the
 * browser QA surface to exercise the real workbench. We keep a curated QA
 * allowlist (not full ipcMain) while permanently denying terminal/secret/
 * memory/approval/hook/mcp/settings mutation/trust channels.
 */
const BRIDGE_DENIED_CHANNEL_PATTERNS: RegExp[] = [
  /^terminal:/,
  /^memory:/,
  /^approval:/,
  /^hook:/,
  /^mcp:/,
  /^settings:set$/,
  /^settings:getProviderSecret$/,
  /^command:execute$/,
  /^rdx-runtime:trustHook$/,
  /^rdx-runtime:revokeHook$/,
  /^rdx-runtime:testHook$/,
  /^rdx-runtime:trustMcp$/,
  /^rdx-runtime:revokeMcp$/,
  /^conversation:answerToolApproval$/,
];

/** Explicit browser-QA allow prefixes. Unknown prefixes fail closed. */
const BRIDGE_ALLOWED_CHANNEL_PATTERNS: RegExp[] = [
  /^app:/,
  /^web:resolveFavicon$/,
  /^conversation:(sendMessage|rewriteFromMessage|cancelActiveTurn|answerUserInput|getHistory|switchBranch|clearHistory|undoLastTurn|compactHistory)$/,
  /^dialog:/,
  /^workflow:/,
  /^agent:/,
  /^knowledge:/,
  /^rdx-runtime:(overview|validate|upsert|import|delete|reveal|listSnapshots|getSnapshot)$/,
  /^command:list$/,
  /^tool:/,
  /^evidence:/,
  /^llm:/,
  /^settings:(get|getProviderCatalog|getEffectiveModel|getEffectiveCatalog|hasProviderSecret|importAgentManifest|saveAgentDefinition|getAgentDefinitionCommit|saveProviderDefinition|getProviderDefinitionCommit)$/,
  /^project:/,
  /^device:/,
  /^session:/,
  /^run:/,
  /^runtimeLog:/,
  /^capture:/,
  /^context:/,
  /^trace:/,
  /^window:/,
];

export function createBridgeBearerToken(): string {
  return randomBytes(32).toString('hex');
}

export function isBridgeChannelDenied(channel: string): boolean {
  return BRIDGE_DENIED_CHANNEL_PATTERNS.some((pattern) => pattern.test(channel));
}

export function isBridgeChannelAllowlisted(channel: string): boolean {
  return BRIDGE_ALLOWED_CHANNEL_PATTERNS.some((pattern) => pattern.test(channel));
}

/** Allow only registered, allowlisted, non-denied channels. */
export function isBridgeChannelAllowed(channel: string): boolean {
  return hasRegisteredIpcChannel(channel)
    && isBridgeChannelAllowlisted(channel)
    && !isBridgeChannelDenied(channel);
}

export function extractBearerToken(authorizationHeader: string | undefined, queryToken: string | null): string | null {
  const header = authorizationHeader?.trim();
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  const fromQuery = queryToken?.trim();
  return fromQuery || null;
}

export function tokensMatch(expected: string, provided: string | null): boolean {
  if (!provided) {
    return false;
  }
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function resolveBridgeAllowedOrigins(bridgeOrigin: string, devRendererUrl: string | null): Set<string> {
  const allowed = new Set<string>([bridgeOrigin]);
  if (devRendererUrl) {
    try {
      allowed.add(new URL(devRendererUrl).origin);
    } catch {
      // Ignore invalid renderer URLs.
    }
  }
  // Vite browser-dev default; keep exact-origin only (no wildcard).
  allowed.add('http://127.0.0.1:5173');
  return allowed;
}

export function isOriginAllowed(originHeader: string | undefined, allowedOrigins: Set<string>): boolean {
  if (!originHeader) {
    // Same-origin navigations and non-browser clients may omit Origin.
    return true;
  }
  return allowedOrigins.has(originHeader);
}

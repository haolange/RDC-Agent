import { confirmInMainProcess } from './mainConfirmation';
import { nativeMessage } from './nativeI18n';
import type { AgentRuntimeMcpDescriptor } from '../settings/agent-manifests/agentRuntimeTypes';

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

const quoteArgument = (value: string): string => (/^[\w./:=@+-]+$/u.test(value) ? value : JSON.stringify(value));

/** What the person is trusting: where it is defined and exactly what it runs or connects to. Env values stay hidden. */
function mcpTrustDetail(server: AgentRuntimeMcpDescriptor): string {
  const envKeys = Object.keys(server.env ?? {});
  return [
    server.sourcePath ? nativeMessage('mcpSource', { value: server.sourcePath }) : null,
    nativeMessage('mcpTransport', { value: server.transport }),
    server.command
      ? nativeMessage('mcpCommand', { value: [server.command, ...(server.args ?? [])].map(quoteArgument).join(' ') })
      : null,
    server.url ? nativeMessage('mcpUrl', { value: server.url }) : null,
    envKeys.length ? nativeMessage('mcpEnvKeys', { value: envKeys.join(', ') }) : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

/** The trust dialog for a project MCP server, naming what it runs; Settings and `/mcp connect` both ask through it. */
export function confirmMcpTrust(server: AgentRuntimeMcpDescriptor): Promise<boolean> {
  return confirmResourceTrust('mcp', server.id, mcpTrustDetail(server));
}

import type {
  ProviderContractBundle,
  ProviderReasoningContract,
} from './modelManifestSchema';
import type { LlmProviderProtocol } from '../types/settings';

export function createFailClosedProviderContracts(
  protocol: LlmProviderProtocol,
): ProviderContractBundle {
  return {
    protocolDialect: protocol,
    protocolVersion: 'unspecified',
    compatibilityGroup: 'none',
    reasoning: {
      semantic: 'unknown',
      source: 'runtime-explicit-unknown',
      displayLabel: 'Provider reasoning',
      carrier: 'unknown',
      artifactFormat: 'unknown',
      artifactVersion: 'unknown',
      compatibilityGroup: 'none',
      continuation: 'unknown',
    },
    state: {
      supportedModes: ['local-stateless'],
      defaultMode: 'local-stateless',
      carrier: 'none',
      retention: 'request',
      crossModel: 'never',
    },
    cache: {
      mode: 'unknown',
      keyCarrier: 'unknown',
      breakpointCarrier: 'unknown',
      telemetry: [],
      ttl: 'unknown',
    },
    toolLoop: {
      artifactPolicy: 'discard',
      artifactScope: 'none',
      ordering: 'unknown',
      modelSwitch: 'pin-until-terminal',
    },
    streaming: {
      transport: 'unknown',
      outputIdentity: 'provider-output-ref',
      usage: 'unknown',
      errors: 'unknown',
    },
    semanticContext: {
      version: 'semantic-context-v1',
      history: 'canonical-messages',
      toolPairs: 'strict',
      attachments: 'fail-closed',
      overflow: 'structured-handoff',
    },
  };
}

export function createNoneReasoningContract(source: string): ProviderReasoningContract {
  return {
    semantic: 'none',
    source,
    displayLabel: 'None',
    carrier: 'none',
    artifactFormat: 'none',
    artifactVersion: 'none',
    compatibilityGroup: 'none',
    continuation: 'none',
  };
}

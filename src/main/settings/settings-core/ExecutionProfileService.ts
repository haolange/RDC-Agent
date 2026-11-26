import { isProviderExecutable } from '@shared/utils/providerExecutionAvailability';
import { agentRuntimeConfigService } from '../agent-manifests/AgentRuntimeConfigService';
import type { LlmProviderEntry, SettingsDiagnostic } from '@shared/types/settings';

export class ExecutionProfileService {
  ensureScaffold(): void {
    agentRuntimeConfigService.ensureScaffold();
  }

  getDiagnostics(providers: readonly LlmProviderEntry[]): SettingsDiagnostic[] {
    return providers.some(isProviderExecutable)
      ? []
      : [
          {
            code: 'missing_configured_provider',
            severity: 'warning',
            message: 'No configured provider is available for agent execution.',
          },
        ];
  }
}

export const executionProfileService = new ExecutionProfileService();

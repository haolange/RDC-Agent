/**
 * Zod schemas for priority IPC channels (settings / workflow / memory).
 */
import { z } from 'zod';
import { ipcId, ipcNonEmptyString, ipcString } from './IpcPayloadGuard';

export const MemoryScopeSchema = z.enum(['user', 'project']);

export const MemoryIssueApprovalTokenArgsSchema = z.tuple([
  z.object({
    action: z.enum(['memory.write', 'memory.delete']),
    scope: MemoryScopeSchema,
    name: ipcString(200, 'name').optional(),
    projectRoot: ipcString(1024, 'projectRoot').optional(),
  }),
]);

export const MemoryListArgsSchema = z.tuple([
  MemoryScopeSchema,
  ipcString(1024, 'projectRoot').optional(),
]);

export const MemoryGetArgsSchema = z.tuple([
  MemoryScopeSchema,
  ipcNonEmptyString(200, 'name'),
  ipcString(1024, 'projectRoot').optional(),
]);

export const MemoryWriteArgsSchema = z.tuple([
  z.object({
    scope: MemoryScopeSchema,
    projectRoot: ipcString(1024, 'projectRoot').optional(),
    approvalToken: ipcNonEmptyString(128, 'approvalToken'),
    name: ipcNonEmptyString(200, 'name'),
    description: ipcNonEmptyString(2000, 'description'),
    type: z.enum(['user', 'feedback', 'project', 'reference']),
    content: ipcNonEmptyString(200_000, 'content'),
    tags: z.array(ipcString(64, 'tag')).max(32).optional(),
  }).strict(),
]);

export const MemoryDeleteArgsSchema = z.tuple([
  MemoryScopeSchema,
  ipcNonEmptyString(200, 'name'),
  ipcNonEmptyString(128, 'approvalToken'),
  ipcString(1024, 'projectRoot').optional(),
]);

const settingsString = (max: number) => z.string().max(max);
const themeChromePatch = z.object({
  presetId: z.enum(['rdc', 'absolutely', 'ayu', 'catppuccin', 'dracula', 'everforest', 'github', 'gruvbox', 'linear']).optional(),
  accent: settingsString(32).optional(),
  surface: settingsString(32).optional(),
  ink: settingsString(32).optional(),
  contrast: z.number().min(0).max(100).optional(),
  fonts: z.object({
    ui: settingsString(200).nullable().optional(),
    code: settingsString(200).nullable().optional(),
  }).strict().optional(),
}).strict();
const authMode = z.enum(['none', 'api-key', 'local', 'account', 'environment']);

export const SettingsSetArgsSchema = z.tuple([
  z.object({
    appearance: z.object({
      theme: z.enum(['dark', 'light', 'system']).optional(),
      language: z.enum(['zh-CN', 'en']).optional(),
      fontScale: z.enum(['small', 'medium', 'large']).optional(),
      composerMarkdown: z.boolean().optional(),
      usePointerCursors: z.boolean().optional(),
      contextBreakdownExpanded: z.boolean().optional(),
      chromeThemes: z.object({
        light: themeChromePatch.optional(),
        dark: themeChromePatch.optional(),
      }).strict().optional(),
    }).strict().optional(),
    layout: z.object({
      leftSidebar: z.object({ collapsed: z.boolean().optional(), width: z.number().optional(), expandedWidth: z.number().optional() }).strict().optional(),
      rightPanel: z.object({ collapsed: z.boolean().optional(), width: z.number().optional(), expandedWidth: z.number().optional() }).strict().optional(),
      terminal: z.object({ height: z.number().optional() }).strict().optional(),
      window: z.object({
        width: z.number().optional(),
        height: z.number().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        isMaximized: z.boolean().optional(),
      }).strict().optional(),
    }).strict().optional(),
    profile: z.object({
      nickname: settingsString(200).optional(),
      avatarPath: settingsString(4096).optional(),
    }).strict().optional(),
    tooling: z.object({
      rdcCli: z.object({
        enabled: z.boolean().optional(),
        command: settingsString(4096).optional(),
        argsPrefix: z.array(settingsString(1024)).max(64).optional(),
        workingDirectory: settingsString(4096).optional(),
        env: z.record(settingsString(200), settingsString(4096)).optional(),
        timeoutMs: z.number().int().positive().max(3_600_000).optional(),
      }).strict().optional(),
      codeInterpreter: z.object({
        enabled: z.boolean().optional(),
        command: settingsString(4096).optional(),
        argsPrefix: z.array(settingsString(1024)).max(64).optional(),
        timeoutMs: z.number().int().positive().max(3_600_000).optional(),
        env: z.record(settingsString(200), settingsString(4096)).optional(),
        artifactsEnabled: z.boolean().optional(),
      }).strict().optional(),
      shell: z.object({ executable: settingsString(4096).optional() }).strict().optional(),
    }).strict().optional(),
    agentRuntime: z.object({
      permissions: z.object({
        mode: z.enum(['default', 'auto-review', 'full-access', 'custom']).optional(),
        readableRoots: z.array(settingsString(4096)).max(64).optional(),
        writableRoots: z.array(settingsString(4096)).max(64).optional(),
        allowedCommandPrefixes: z.array(settingsString(512)).max(128).optional(),
        deniedCommandPrefixes: z.array(settingsString(512)).max(128).optional(),
      }).strict().optional(),
      context: z.object({
        compactionThresholdPercent: z.number().min(1).max(100).optional(),
      }).strict().optional(),
    }).strict().optional(),
    llm: z.object({
      providers: z.array(z.object({
        id: settingsString(200).min(1),
        activeAccountId: settingsString(200).optional(),
        authAccountIds: z.record(authMode, settingsString(200)).optional(),
        protocol: settingsString(80).optional(),
        routeCount: z.number().int().nonnegative().optional(),
        authMode: authMode.optional(),
        authModeOptions: z.array(authMode).max(8).optional(),
        authModeAvailability: z.record(authMode, z.object({
          state: z.enum(['available', 'unavailable', 'unknown']),
          reason: settingsString(500).optional(),
        }).strict()).optional(),
        hasStoredSecretByAuthMode: z.record(authMode, z.boolean()).optional(),
        configuredAuthMode: authMode.optional(),
        lifecycleStatus: z.enum(['stable', 'beta', 'retiring', 'sunset']).optional(),
        providerAvailability: z.object({
          state: z.enum(['available', 'unavailable', 'unknown']),
          reason: settingsString(500).optional(),
        }).strict().optional(),
        category: z.enum(['login-authorization', 'official-direct', 'cloud-platform', 'coding-token-plan', 'compatible-access', 'local']).optional(),
        serviceOperator: settingsString(200).optional(),
        endpointClass: z.enum(['first-party', 'third-party-gateway', 'cloud-hosted', 'coding-plan', 'account-surface', 'local-service', 'user-endpoint']).optional(),
        catalogOwnership: z.enum(['app-managed', 'provider-managed', 'user-managed']).optional(),
        catalogProvenance: z.array(z.object({
          source: z.enum(['user-control-panel', 'live-catalog', 'runtime-observation', 'provider-control-plane', 'provider-docs', 'upstream-implementation', 'models.dev', 'opencode', 'hermes', 'rdc-agent']),
          revision: settingsString(200),
          observedAt: settingsString(80).optional(),
          refreshedAt: settingsString(80),
          identityId: settingsString(200).optional(),
          surface: settingsString(200).optional(),
          accountScope: settingsString(200).optional(),
          surfaceBuild: settingsString(200).optional(),
          plan: settingsString(200).optional(),
        }).strict()).max(50).optional(),
        label: settingsString(200).optional(),
        enabled: z.boolean().optional(),
        apiKey: settingsString(16_000).optional(),
        secretRef: settingsString(512).optional(),
        secretRefs: z.record(settingsString(200), settingsString(512)).optional(),
        connectionValues: z.record(settingsString(200), settingsString(16_000)).optional(),
        hasStoredConnectionSecrets: z.record(settingsString(200), z.boolean()).optional(),
        connectionSchema: z.object({
          fields: z.array(z.object({
            id: settingsString(200),
            label: settingsString(200),
            kind: z.enum(['secret', 'text', 'url', 'region', 'path']),
            required: z.boolean(),
            environmentVariable: settingsString(200).optional(),
            placeholder: settingsString(200).optional(),
          }).strict()).max(32),
          primarySecretFieldId: settingsString(200).optional(),
          credentialAlternatives: z.array(z.object({
            id: settingsString(200),
            fieldIds: z.array(settingsString(200)).max(16),
            label: settingsString(200).optional(),
            description: settingsString(500).optional(),
            ambient: z.boolean().optional(),
          }).strict()).max(8).optional(),
          headerMappings: z.array(z.object({
            fieldId: settingsString(200),
            header: settingsString(200),
            prefix: settingsString(200).optional(),
          }).strict()).max(16).optional(),
          endpointTemplate: settingsString(2048).optional(),
        }).strict().optional(),
        hasStoredSecret: z.boolean().optional(),
        baseUrl: settingsString(2048).optional(),
        baseUrlEditable: z.boolean().optional(),
        models: z.array(z.object({
          id: settingsString(256),
          enabled: z.boolean(),
          label: settingsString(256).optional(),
          aliases: z.array(settingsString(256)).max(32).optional(),
          availability: z.enum(['available', 'unavailable', 'unknown']).optional(),
          availabilityReason: settingsString(500).optional(),
          defaultReasoningSelection: settingsString(64).optional(),
          defaultBudgetTokens: z.number().int().positive().optional(),
          preferredRouteOptionId: settingsString(200).optional(),
        }).strict()).max(10_000).optional(),
        recommendedModels: z.array(settingsString(256)).max(64).optional(),
        docsUrl: settingsString(2048).optional(),
        status: z.enum(['unconfigured', 'verified', 'failed', 'unavailable']).optional(),
        lastTestedAt: settingsString(80).optional(),
        lastModelRefreshAt: settingsString(80).optional(),
        lastError: settingsString(2000).optional(),
        accountLoginConfigured: z.boolean().optional(),
        accountLabel: settingsString(200).optional(),
        planLabel: settingsString(200).optional(),
        oauthExpiresAt: settingsString(80).optional(),
        oauthRefreshAvailable: z.boolean().optional(),
        unavailableReason: settingsString(500).optional(),
        isConfigured: z.boolean().optional(),
        capabilities: z.array(z.enum(['chat', 'tool-calling', 'structured-output', 'reasoning', 'prompt-cache', 'vision-input', 'model-discovery'])).max(16).optional(),
      }).strict()).max(200).optional(),
    }).strict().optional(),
    agents: z.object({
      globalInstructions: settingsString(200_000).optional(),
    }).strict().optional(),
  }).strict(),
]);

export const SettingsAgentIdArgsSchema = z.tuple([
  ipcNonEmptyString(200, 'agentId'),
]);

export const SettingsProviderIdArgsSchema = z.tuple([
  ipcNonEmptyString(200, 'providerId'),
]);

export const SettingsHasProviderSecretArgsSchema = z.tuple([
  ipcNonEmptyString(200, 'providerId'),
]);

export const SettingsGetEffectiveCatalogArgsSchema = z.tuple([
  ipcNonEmptyString(200, 'providerId'),
  // Electron / browser bridge structured-clone turns omitted optional args into null.
  ipcString(200, 'accountId').nullish(),
]);

export const SettingsImportAgentManifestArgsSchema = z.tuple([
  ipcNonEmptyString(4096, 'filePath'),
]);

export const SettingsGetResolvedShellArgsSchema = z.tuple([
  ipcString(4096, 'executable'),
]);

export const RuntimeLogListArgsSchema = z.tuple([
  z.object({
    scope: z.enum(['app', 'session']),
    sessionId: z.union([ipcId(128, 'sessionId'), z.null()]).optional(),
  }).strict(),
]);

export const WorkflowResumeArgsSchema = z.tuple([
  ipcId(128, 'sessionId').optional(),
]);

export const WorkflowStopArgsSchema = z.tuple([
  ipcId(128, 'runId').optional(),
]);

export const WorkflowGetRunUsageArgsSchema = z.tuple([
  z.object({
    sessionId: ipcId(128, 'sessionId'),
    runId: ipcId(128, 'runId').optional(),
  }).strict(),
]);

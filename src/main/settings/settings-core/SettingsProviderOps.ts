import { providerConnectionIdentity } from '@shared/utils/providerConnectionIdentity';
import {
  createProviderEntryFromCatalog,
  getProviderDefaultBaseUrl,
  isBuiltinProviderId,
} from '../../provider-catalog/ProviderCatalogRegistry';
import { appPathService } from '../../runtime/AppPathService';
import { normalizeProviderProtocol } from '../provider-catalog/providerCatalogNormalize';
import { resolvePrimaryConnectionSecretFieldId } from '../provider-auth/ProviderConnectionSchema';
import { providerConnectionError } from '../provider-auth/providerConnectionErrors';
import { secretStorageService } from './SecretStorageService';
import {
  applyModelPreferences,
  createLocalAccountId,
  extractOAuthBundleAccountId,
  getProviderAccountSecretRef,
  isConnectionSchemaSatisfied,
  resolveProviderModels,
  resolveSelectedAuthAvailability,
  sanitizeConnectionValues,
} from './settingsProviderSanitize';
import { deleteSecretsAfterCommit, hashProviderDefinition, nowIso } from './settingsServiceHelpers';
import type { ProviderConnections } from './providerUserState';
import type {
  LlmProviderAuthMode,
  LlmProviderEntry,
  LlmProviderId,
  LlmProviderModel,
  LlmProviderModelPreference,
  ProviderDefinitionCommitSnapshot,
  ProviderDefinitionSaveRequest,
  ProviderDefinitionSaveResult,
  ProviderModelChoice,
} from '@shared/types/settings';

export interface SettingsProviderOpsHost {
  readonly providerConnections: ProviderConnections;
  /** Commits this provider's user state only and returns it composed; other providers are not rewritten. */
  commitProvider(entry: LlmProviderEntry): LlmProviderEntry;
  getProviderConnectionValues(providerId: string): Record<string, string>;
}

export class SettingsProviderOps {
  private readonly providerDefinitionRevisions = new Map<string, number>();
  private readonly providerDefinitionCommits = new Map<string, ProviderDefinitionCommitSnapshot>();

  constructor(private readonly host: SettingsProviderOpsHost) {}

  private providerSaveResult(
    request: ProviderDefinitionSaveRequest,
    status: ProviderDefinitionSaveResult['status'],
    snapshot: ProviderDefinitionCommitSnapshot | null,
    error?: string,
  ): ProviderDefinitionSaveResult {
    return {
      clientRevision: request.clientRevision,
      providerId: request.providerId,
      status,
      commitHash: snapshot?.commitHash ?? null,
      provider: snapshot?.provider ?? null,
      catalogRevision: snapshot?.catalogRevision ?? null,
      lastSuccessful: snapshot,
      ...(error ? { error } : {}),
    };
  }

  private readProviderDefinitionCommit(providerId: string): ProviderDefinitionCommitSnapshot | null {
    const provider = this.host.providerConnections.get(providerId) ?? null;
    if (!provider) return null;
    const hash = hashProviderDefinition(provider);
    const cached = this.providerDefinitionCommits.get(providerId);
    if (cached?.commitHash === hash) return cached;
    const snapshot: ProviderDefinitionCommitSnapshot = {
      clientRevision: 0,
      providerId,
      commitHash: hash,
      provider,
      catalogRevision: null,
    };
    this.providerDefinitionCommits.set(providerId, snapshot);
    return snapshot;
  }

  /**
   * Only the model choices change: a row main has takes the choices, a row it does not have yet (one the dialog
   * shows from the effective catalog) is added, and every other row and field stays as committed.
   */
  private persistModelChoices(providerId: string, choices: readonly ProviderModelChoice[]): LlmProviderEntry {
    const current = this.host.providerConnections.get(providerId);
    if (!current) throw new Error(`Unknown provider: ${providerId}`);
    const known = new Set(current.models.map((model) => model.id));
    const added = choices
      .filter((choice) => !known.has(choice.id))
      .map((choice) => ({
        id: choice.id,
        label: choice.label ?? choice.id,
        enabled: choice.enabled,
        ...(choice.aliases?.length ? { aliases: [...choice.aliases] } : {}),
      }));
    return this.host.commitProvider({
      ...current,
      models: applyModelPreferences([...current.models, ...added], choices),
    });
  }

  async getProviderDefinitionCommit(providerIdDraft: string): Promise<ProviderDefinitionCommitSnapshot | null> {
    const providerId = providerIdDraft.trim();
    if (!providerId) return null;
    return this.readProviderDefinitionCommit(providerId);
  }

  setProviderDefinitionCatalogRevision(providerId: string, catalogRevision: string | null): void {
    const snapshot = this.providerDefinitionCommits.get(providerId);
    if (snapshot) this.providerDefinitionCommits.set(providerId, { ...snapshot, catalogRevision });
  }

  async saveProviderDefinition(request: ProviderDefinitionSaveRequest): Promise<ProviderDefinitionSaveResult> {
    const providerId = request.providerId.trim();
    if (!providerId || !Number.isSafeInteger(request.clientRevision) || request.clientRevision < 1) {
      return this.providerSaveResult(
        request,
        'failed',
        this.readProviderDefinitionCommit(providerId),
        'clientRevision must be a positive safe integer.',
      );
    }
    if (request.clientRevision <= (this.providerDefinitionRevisions.get(providerId) ?? 0)) {
      return this.providerSaveResult(request, 'superseded', this.readProviderDefinitionCommit(providerId));
    }
    this.providerDefinitionRevisions.set(providerId, request.clientRevision);
    // Coalesce same-turn intents before starting the synchronous settings transaction.
    await Promise.resolve();
    const previous = this.readProviderDefinitionCommit(providerId);
    if (
      this.providerDefinitionRevisions.get(providerId) !== request.clientRevision ||
      (previous?.provider && providerConnectionIdentity(previous.provider) !== request.connectionIdentity)
    ) {
      return this.providerSaveResult(request, 'superseded', previous);
    }
    try {
      const provider = this.persistModelChoices(providerId, request.models);
      const snapshot: ProviderDefinitionCommitSnapshot = {
        clientRevision: request.clientRevision,
        providerId,
        commitHash: hashProviderDefinition(provider),
        provider,
        catalogRevision: null,
      };
      this.providerDefinitionCommits.set(providerId, snapshot);
      return this.providerSaveResult(request, 'committed', snapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.providerSaveResult(request, 'failed', previous, message);
    }
  }

  saveProviderConnection(
    providerId: LlmProviderId,
    apiKey: string,
    models: LlmProviderModel[],
    baseUrl = '',
    protocolDraft?: unknown,
    authModeDraft?: LlmProviderAuthMode,
    modelPreferences?: LlmProviderModelPreference[],
    connectionValuesDraft?: Record<string, string>,
  ): LlmProviderEntry {
    const provider = this.host.providerConnections.get(providerId);
    if (!provider || !isBuiltinProviderId(provider.id)) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    const authMode =
      authModeDraft && provider.authModeOptions?.includes(authModeDraft) ? authModeDraft : provider.authMode;
    if (authMode === 'account') {
      throw new Error(`Provider ${providerId} account mode must use its login flow.`);
    }
    const authAvailability = resolveSelectedAuthAvailability(
      provider.id,
      authMode,
      createProviderEntryFromCatalog(provider.id),
    );
    if (authAvailability.state === 'unavailable') {
      throw new Error(authAvailability.reason ?? `Provider ${providerId} ${authMode} authentication is unavailable.`);
    }
    const discoveredModels = applyModelPreferences(
      resolveProviderModels(provider.id, models),
      modelPreferences ?? provider.models,
    );
    if (discoveredModels.length === 0) {
      throw providerConnectionError('no-routable-models', 'The provider returned no usable models.');
    }

    const hasEnabledModels = discoveredModels.some((model) => model.enabled !== false);
    const protocol = normalizeProviderProtocol({ id: provider.id, protocol: protocolDraft ?? provider.protocol });
    const timestamp = nowIso();
    const defaultBaseUrl = getProviderDefaultBaseUrl(provider.id);
    const nextBaseUrl = provider.baseUrlEditable
      ? baseUrl.trim() || defaultBaseUrl || provider.baseUrl
      : defaultBaseUrl || provider.baseUrl;
    const schema = provider.connectionSchema;
    const primarySecretFieldId = resolvePrimaryConnectionSecretFieldId(schema) ?? 'apiKey';
    const existingHydratedValues = this.host.getProviderConnectionValues(provider.id);
    const draftHas = (fieldId: string): boolean =>
      Object.prototype.hasOwnProperty.call(connectionValuesDraft ?? {}, fieldId);
    const nextConnectionValues = sanitizeConnectionValues(schema, {
      ...(provider.connectionValues ?? {}),
      ...Object.fromEntries(
        (schema?.fields ?? [])
          .filter((field) => field.kind !== 'secret' && draftHas(field.id))
          .map((field) => [field.id, connectionValuesDraft?.[field.id] ?? '']),
      ),
    });
    const plannedSecrets = Object.fromEntries(
      (schema?.fields ?? [])
        .filter((field) => field.kind === 'secret')
        .map((field) => {
          const drafted =
            field.id === primarySecretFieldId
              ? apiKey.trim() || (draftHas(field.id) ? (connectionValuesDraft?.[field.id]?.trim() ?? '') : '')
              : draftHas(field.id)
                ? (connectionValuesDraft?.[field.id]?.trim() ?? '')
                : '';
          const retainExisting = !draftHas(field.id) && (field.id !== primarySecretFieldId || !apiKey.trim());
          return [field.id, drafted || (retainExisting ? (existingHydratedValues[field.id] ?? '') : '')];
        }),
    ) as Record<string, string>;
    const plannedSecretPresence = Object.fromEntries(
      Object.entries(plannedSecrets).map(([fieldId, value]) => [fieldId, Boolean(value)]),
    ) as Record<string, boolean>;
    const credentialSatisfied = schema?.fields.length
      ? isConnectionSchemaSatisfied(schema, nextConnectionValues, plannedSecretPresence)
      : Boolean(apiKey.trim() || provider.hasStoredSecretByAuthMode?.['api-key']);
    if (authMode === 'api-key' && !credentialSatisfied) {
      throw new Error('Provider connection fields are incomplete.');
    }

    const credentialChanged = (schema?.fields ?? [])
      .filter((field) => field.kind === 'secret')
      .some((field) => (plannedSecrets[field.id] ?? '') !== (existingHydratedValues[field.id] ?? ''));
    const currentAccountId = provider.authAccountIds?.['api-key'];
    const nextAccountId = credentialSatisfied
      ? !currentAccountId || credentialChanged
        ? createLocalAccountId()
        : currentAccountId
      : undefined;
    const nextAuthAccountIds = { ...(provider.authAccountIds ?? {}) };
    if (nextAccountId) {
      nextAuthAccountIds['api-key'] = nextAccountId;
    } else {
      delete nextAuthAccountIds['api-key'];
    }
    const nextPrimarySecretRef = getProviderAccountSecretRef(provider.id, nextAccountId, 'api-key');
    const nextSecretRefs: Record<string, string> = {};
    const stagedSecretRefs = new Set<string>();
    const retainedSecretRefs = new Set<string>();
    const previousSecretRefs = new Set<string>([
      ...(provider.secretRef ? [provider.secretRef] : []),
      ...Object.values(provider.secretRefs ?? {}),
    ]);

    if (nextAccountId) {
      for (const field of schema?.fields ?? []) {
        if (field.kind !== 'secret' || !plannedSecrets[field.id]) {
          continue;
        }
        const targetRef =
          field.id === primarySecretFieldId
            ? nextPrimarySecretRef
            : secretStorageService.createProviderConnectionSecretRef(provider.id, nextAccountId, field.id);
        if (!targetRef) {
          continue;
        }
        if (field.id !== primarySecretFieldId) {
          nextSecretRefs[field.id] = targetRef;
        }
        retainedSecretRefs.add(targetRef);
        if (credentialChanged || !secretStorageService.hasSecretRecord(targetRef, appPathService.getUserRdcRoot())) {
          secretStorageService.setSecret(targetRef, plannedSecrets[field.id], appPathService.getUserRdcRoot());
          stagedSecretRefs.add(targetRef);
        }
      }
    }

    const nextProvider: LlmProviderEntry = {
      ...provider,
      authMode,
      activeAccountId: authMode === 'api-key' ? nextAccountId : provider.authAccountIds?.[authMode],
      authAccountIds: nextAuthAccountIds,
      apiKey: '',
      secretRef: nextPrimarySecretRef,
      secretRefs: nextSecretRefs,
      connectionValues: nextConnectionValues,
      hasStoredConnectionSecrets: plannedSecretPresence,
      protocol,
      enabled: hasEnabledModels,
      hasStoredSecret:
        authMode === 'api-key' ? credentialSatisfied : authMode === 'local' || authMode === 'environment',
      hasStoredSecretByAuthMode: {
        ...(provider.hasStoredSecretByAuthMode ?? {}),
        [authMode]: authMode === 'api-key' ? credentialSatisfied : true,
      },
      configuredAuthMode: authMode,
      baseUrl: nextBaseUrl,
      models: discoveredModels.map((model) => ({ ...model })),
      status: 'verified',
      lastTestedAt: timestamp,
      lastModelRefreshAt: timestamp,
      lastError: undefined,
      accountLabel: undefined,
      planLabel: undefined,
      oauthExpiresAt: undefined,
      oauthRefreshAvailable: undefined,
      unavailableReason: undefined,
      isConfigured: true,
    };

    try {
      const committed = this.host.commitProvider(nextProvider);
      deleteSecretsAfterCommit(
        [...previousSecretRefs].filter((secretRef) => !retainedSecretRefs.has(secretRef)),
        appPathService.getUserRdcRoot(),
      );
      return committed;
    } catch (error) {
      deleteSecretsAfterCommit(
        [...stagedSecretRefs].filter((secretRef) => !previousSecretRefs.has(secretRef)),
        appPathService.getUserRdcRoot(),
      );
      throw error;
    }
  }

  saveProviderAccountConnection(
    providerId: LlmProviderId,
    secretPayload: string,
    models: LlmProviderModel[],
    accountSummary: Pick<
      LlmProviderEntry,
      'accountLabel' | 'planLabel' | 'oauthExpiresAt' | 'oauthRefreshAvailable'
    > = {},
  ): LlmProviderEntry {
    const provider = this.host.providerConnections.get(providerId);
    if (!provider || !isBuiltinProviderId(provider.id) || !provider.authModeOptions?.includes('account')) {
      throw new Error(`Unknown account provider: ${providerId}`);
    }

    const discoveredModels = applyModelPreferences(resolveProviderModels(provider.id, models), provider.models);
    if (discoveredModels.length === 0) {
      throw new Error('Provider returned no usable models');
    }

    const hasEnabledModels = discoveredModels.some((model) => model.enabled !== false);

    const activeAccountId =
      extractOAuthBundleAccountId(secretPayload) ?? provider.authAccountIds?.account ?? createLocalAccountId();
    const nextSecretRef = getProviderAccountSecretRef(provider.id, activeAccountId, 'oauth');
    const previousSecretRef =
      provider.authAccountIds?.account && provider.authAccountIds.account !== activeAccountId
        ? getProviderAccountSecretRef(provider.id, provider.authAccountIds.account, 'oauth')
        : undefined;
    secretStorageService.setSecret(nextSecretRef, secretPayload, appPathService.getUserRdcRoot());

    const timestamp = nowIso();
    const nextProvider: LlmProviderEntry = {
      ...provider,
      authMode: 'account',
      activeAccountId,
      authAccountIds: { ...(provider.authAccountIds ?? {}), account: activeAccountId },
      enabled: hasEnabledModels,
      hasStoredSecret: true,
      hasStoredSecretByAuthMode: { ...(provider.hasStoredSecretByAuthMode ?? {}), account: true },
      configuredAuthMode: 'account',
      models: discoveredModels.map((model) => ({ ...model })),
      status: 'verified',
      lastTestedAt: timestamp,
      lastModelRefreshAt: timestamp,
      lastError: undefined,
      accountLabel: accountSummary.accountLabel,
      planLabel: accountSummary.planLabel,
      oauthExpiresAt: accountSummary.oauthExpiresAt,
      oauthRefreshAvailable: accountSummary.oauthRefreshAvailable,
      unavailableReason: undefined,
      isConfigured: true,
    };

    const committed = this.host.commitProvider(nextProvider);
    deleteSecretsAfterCommit(previousSecretRef ? [previousSecretRef] : [], appPathService.getUserRdcRoot());
    return committed;
  }

  rotateProviderAccountCredential(
    providerId: LlmProviderId,
    secretPayload: string,
    accountSummary: Pick<
      LlmProviderEntry,
      'accountLabel' | 'planLabel' | 'oauthExpiresAt' | 'oauthRefreshAvailable'
    > = {},
  ): LlmProviderEntry {
    const provider = this.host.providerConnections.get(providerId);
    if (!provider || !isBuiltinProviderId(provider.id) || !provider.authModeOptions?.includes('account')) {
      throw new Error(`Unknown account provider: ${providerId}`);
    }
    const activeAccountId =
      extractOAuthBundleAccountId(secretPayload) ?? provider.authAccountIds?.account ?? createLocalAccountId();
    const nextSecretRef = getProviderAccountSecretRef(provider.id, activeAccountId, 'oauth');
    const previousSecretRef =
      provider.authAccountIds?.account && provider.authAccountIds.account !== activeAccountId
        ? getProviderAccountSecretRef(provider.id, provider.authAccountIds.account, 'oauth')
        : undefined;
    secretStorageService.setSecret(nextSecretRef, secretPayload, appPathService.getUserRdcRoot());
    const nextProvider: LlmProviderEntry = {
      ...provider,
      authMode: 'account',
      activeAccountId,
      authAccountIds: { ...(provider.authAccountIds ?? {}), account: activeAccountId },
      hasStoredSecret: true,
      hasStoredSecretByAuthMode: { ...(provider.hasStoredSecretByAuthMode ?? {}), account: true },
      configuredAuthMode: 'account',
      accountLabel: accountSummary.accountLabel,
      planLabel: accountSummary.planLabel,
      oauthExpiresAt: accountSummary.oauthExpiresAt,
      oauthRefreshAvailable: accountSummary.oauthRefreshAvailable,
    };
    const committed = this.host.commitProvider(nextProvider);
    deleteSecretsAfterCommit(previousSecretRef ? [previousSecretRef] : [], appPathService.getUserRdcRoot());
    return committed;
  }

  markProviderAccountRefreshFailure(providerId: LlmProviderId, message: string): void {
    const provider = this.host.providerConnections.get(providerId);
    if (!provider) return;
    this.host.commitProvider({
      ...provider,
      enabled: false,
      status: 'failed',
      isConfigured: false,
      lastError: message,
    });
  }

  disconnectProvider(providerId: LlmProviderId, authModeDraft?: LlmProviderAuthMode): LlmProviderEntry {
    const provider = this.host.providerConnections.get(providerId);
    if (!provider || !isBuiltinProviderId(provider.id)) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    const authMode =
      authModeDraft && provider.authModeOptions?.includes(authModeDraft) ? authModeDraft : provider.authMode;
    const secretRefToDelete =
      authMode === 'api-key'
        ? provider.secretRef
        : authMode === 'account'
          ? getProviderAccountSecretRef(provider.id, provider.authAccountIds?.account, 'oauth')
          : undefined;
    const authAccountIds = { ...(provider.authAccountIds ?? {}) };
    const hasStoredSecretByAuthMode = { ...(provider.hasStoredSecretByAuthMode ?? {}) };
    if (authMode === 'api-key') {
      delete authAccountIds['api-key'];
      hasStoredSecretByAuthMode['api-key'] = false;
    } else if (authMode === 'account') {
      delete authAccountIds.account;
      hasStoredSecretByAuthMode.account = false;
    }

    if (authMode !== provider.authMode) {
      const committed = this.host.commitProvider({ ...provider, authAccountIds, hasStoredSecretByAuthMode });
      deleteSecretsAfterCommit(secretRefToDelete ? [secretRefToDelete] : [], appPathService.getUserRdcRoot());
      return committed;
    }

    const fallback = createProviderEntryFromCatalog(provider.id);
    const selectedAvailability = resolveSelectedAuthAvailability(provider.id, provider.authMode, fallback);
    const nextProvider: LlmProviderEntry = {
      ...provider,
      activeAccountId: undefined,
      authAccountIds,
      apiKey: '',
      hasStoredSecret: hasStoredSecretByAuthMode[provider.authMode] === true,
      hasStoredSecretByAuthMode,
      configuredAuthMode: undefined,
      models: fallback.models,
      enabled: false,
      status: selectedAvailability.state === 'unavailable' ? 'unavailable' : 'unconfigured',
      lastError: undefined,
      accountLabel: undefined,
      planLabel: undefined,
      oauthExpiresAt: undefined,
      oauthRefreshAvailable: undefined,
      unavailableReason: selectedAvailability.state === 'unavailable' ? selectedAvailability.reason : undefined,
      isConfigured: false,
    };

    const committed = this.host.commitProvider(nextProvider);
    deleteSecretsAfterCommit(secretRefToDelete ? [secretRefToDelete] : [], appPathService.getUserRdcRoot());
    return committed;
  }
}

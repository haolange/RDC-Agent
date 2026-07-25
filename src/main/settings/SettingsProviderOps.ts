import type { AppSettings, AppSettingsPatch, LlmProviderAuthMode, LlmProviderEntry, LlmProviderId, LlmProviderModel, LlmProviderModelPreference, ProviderDefinitionCommitSnapshot, ProviderDefinitionSaveRequest, ProviderDefinitionSaveResult } from '@shared/types/settings';
import {
  createProviderEntryFromCatalog,
  getProviderDefaultBaseUrl,
  isBuiltinProviderId,
} from '../provider-catalog/ProviderCatalogRegistry';
import { appPathService } from '../runtime/AppPathService';
import { normalizeProviderProtocol } from './providerCatalogNormalize';
import { secretStorageService } from './SecretStorageService';
import { resolvePrimaryConnectionSecretFieldId } from './ProviderConnectionSchema';
import {
  SETTINGS_SCHEMA_VERSION,
  createDefaultPersistedSettings,
  type PersistedSettingsPayload,
} from './settingsDefaults';
import {
  applyModelPreferences,
  createLocalAccountId,
  extractOAuthBundleAccountId,
  getProviderAccountSecretRef,
  isConnectionSchemaSatisfied,
  normalizeUserProviders,
  resolveProviderModels,
  resolveSelectedAuthAvailability,
  sanitizeConnectionValues,
  sanitizeUserProvider,
} from './settingsProviderSanitize';
import {
  deleteSecretsAfterCommit,
  hashProviderDefinition,
  nowIso,
  normalizePersistedSettings,
  readJsonFile,
  writeSettingsAsync,
} from './settingsServiceHelpers';

export interface SettingsProviderOpsHost {
  getAll(): AppSettings;
  setAll(patch: AppSettingsPatch): AppSettings;
  getProviderConnectionValues(providerId: string, workspaceRoot?: string): Record<string, string>;
}

export class SettingsProviderOps {
  private readonly providerDefinitionRevisions = new Map<string, number>();
  private readonly providerDefinitionCommits = new Map<string, ProviderDefinitionCommitSnapshot>();
  private readonly providerDefinitionWriteTails = new Map<string, Promise<void>>();

  constructor(private readonly host: SettingsProviderOpsHost) {}

  private async withProviderDefinitionWriteLock<T>(providerId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.providerDefinitionWriteTails.get(providerId) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.providerDefinitionWriteTails.set(providerId, tail);
    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.providerDefinitionWriteTails.get(providerId) === tail) {
        this.providerDefinitionWriteTails.delete(providerId);
      }
    }
  }

  private providerSaveResult(
    request: ProviderDefinitionSaveRequest,
    status: ProviderDefinitionSaveResult['status'],
    snapshot: ProviderDefinitionCommitSnapshot | null,
    error?: string,
  ): ProviderDefinitionSaveResult {
    return {
      clientRevision: request.clientRevision,
      providerId: request.provider.id,
      status,
      commitHash: snapshot?.commitHash ?? null,
      provider: snapshot?.provider ?? null,
      catalogRevision: snapshot?.catalogRevision ?? null,
      lastSuccessful: snapshot,
      ...(error ? { error } : {}),
    };
  }

  private async readProviderDefinitionCommit(providerId: string): Promise<ProviderDefinitionCommitSnapshot | null> {
    const provider = this.host.getAll().llm.providers.find((entry) => entry.id === providerId) ?? null;
    if (!provider) return null;
    const hash = hashProviderDefinition(provider);
    const cached = this.providerDefinitionCommits.get(providerId);
    const snapshot: ProviderDefinitionCommitSnapshot = {
      clientRevision: cached?.commitHash === hash ? cached.clientRevision : 0,
      providerId,
      commitHash: hash,
      provider,
      catalogRevision: cached?.catalogRevision ?? null,
    };
    this.providerDefinitionCommits.set(providerId, snapshot);
    return snapshot;
  }

  private async persistProviderDefinition(provider: LlmProviderEntry): Promise<LlmProviderEntry> {
    const paths = appPathService.initializeRuntime();
    const currentPersisted = normalizePersistedSettings(
      readJsonFile<PersistedSettingsPayload>(paths.settingsPath) ?? createDefaultPersistedSettings(),
      paths.userRdxRoot,
      { credentialView: 'storage-metadata' },
    );
  const currentProviders = currentPersisted.llm?.providers ?? [];
  const current = currentProviders.find((entry) => entry.id === provider.id);
  if (!current) throw new Error(`Unknown provider: ${provider.id}`);
  const sanitized = sanitizeUserProvider({
    ...current,
    ...provider,
    apiKey: '',
    secretRef: current.secretRef,
    secretRefs: current.secretRefs,
    authAccountIds: current.authAccountIds,
    activeAccountId: current.activeAccountId,
    hasStoredSecretByAuthMode: current.hasStoredSecretByAuthMode,
    hasStoredConnectionSecrets: current.hasStoredConnectionSecrets,
  }, paths.userRdxRoot, { credentialView: 'storage-metadata' });
  if (!sanitized) throw new Error(`Provider ${provider.id} could not be sanitized.`);
  const nextProviders = normalizeUserProviders(
    currentProviders.map((entry) => entry.id === provider.id ? sanitized : entry),
    paths.userRdxRoot,
    { credentialView: 'storage-metadata' },
  );
  await writeSettingsAsync({
    ...currentPersisted,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    llm: { providers: nextProviders.map((entry) => ({ ...entry, apiKey: '' })) },
  });
  const committed = this.host.getAll().llm.providers.find((entry) => entry.id === provider.id);
  if (!committed) throw new Error(`Provider ${provider.id} disappeared after commit.`);
  return committed;
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
    const providerId = request.provider.id.trim();
  const previous = await this.readProviderDefinitionCommit(providerId);
  if (!providerId || !Number.isSafeInteger(request.clientRevision) || request.clientRevision < 1) {
    return this.providerSaveResult(request, 'failed', previous, 'clientRevision must be a positive safe integer.');
  }
  const latestRevision = this.providerDefinitionRevisions.get(providerId) ?? 0;
  if (request.clientRevision <= latestRevision) {
    return this.providerSaveResult(request, 'superseded', previous);
  }
  this.providerDefinitionRevisions.set(providerId, request.clientRevision);
  await Promise.resolve();
  return this.withProviderDefinitionWriteLock(providerId, async () => {
    if (this.providerDefinitionRevisions.get(providerId) !== request.clientRevision) {
      return this.providerSaveResult(request, 'superseded', previous);
    }
    try {
      const provider = await this.persistProviderDefinition(request.provider);
      if (this.providerDefinitionRevisions.get(providerId) !== request.clientRevision) {
        if (previous?.provider) await this.persistProviderDefinition(previous.provider);
        return this.providerSaveResult(request, 'superseded', previous);
      }
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
      return this.providerDefinitionRevisions.get(providerId) === request.clientRevision
        ? this.providerSaveResult(request, 'failed', previous, message)
        : this.providerSaveResult(request, 'superseded', previous);
    }
  });
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
  ): AppSettings {
  const current = this.host.getAll();
  const provider = current.llm.providers.find((entry) => entry.id === providerId);
  if (!provider || !isBuiltinProviderId(provider.id)) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  const authMode = authModeDraft && provider.authModeOptions?.includes(authModeDraft)
    ? authModeDraft
    : provider.authMode;
  if (authMode === 'account') {
    throw new Error(`Provider ${providerId} account mode must use its login flow.`);
  }
  const authAvailability = resolveSelectedAuthAvailability(provider.id, authMode, createProviderEntryFromCatalog(provider.id));
  if (authAvailability.state === 'unavailable') {
    throw new Error(authAvailability.reason ?? `Provider ${providerId} ${authMode} authentication is unavailable.`);
  }
  const discoveredModels = applyModelPreferences(
    resolveProviderModels(provider.id, models),
    modelPreferences ?? provider.models,
  );
  if (discoveredModels.length === 0) {
    throw new Error('璇?Provider 鏆傛湭杩斿洖鍙敤妯″瀷');
  }

  const hasEnabledModels = discoveredModels.some((model) => model.enabled !== false);
  const protocol = normalizeProviderProtocol({ id: provider.id, protocol: protocolDraft ?? provider.protocol });
  const timestamp = nowIso();
  const defaultBaseUrl = getProviderDefaultBaseUrl(provider.id);
  const nextBaseUrl = provider.baseUrlEditable
    ? (baseUrl.trim() || defaultBaseUrl || provider.baseUrl)
    : (defaultBaseUrl || provider.baseUrl);
  const schema = provider.connectionSchema;
  const primarySecretFieldId = resolvePrimaryConnectionSecretFieldId(schema) ?? 'apiKey';
  const existingHydratedValues = this.host.getProviderConnectionValues(provider.id, current.paths.userRdxRoot);
  const draftHas = (fieldId: string): boolean => (
    Object.prototype.hasOwnProperty.call(connectionValuesDraft ?? {}, fieldId)
  );
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
        const drafted = field.id === primarySecretFieldId
          ? apiKey.trim() || (draftHas(field.id) ? connectionValuesDraft?.[field.id]?.trim() ?? '' : '')
          : draftHas(field.id)
            ? connectionValuesDraft?.[field.id]?.trim() ?? ''
            : '';
        const retainExisting = !draftHas(field.id) && (field.id !== primarySecretFieldId || !apiKey.trim());
        return [field.id, drafted || (retainExisting ? existingHydratedValues[field.id] ?? '' : '')];
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
    ? (!currentAccountId || credentialChanged ? createLocalAccountId() : currentAccountId)
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
      const targetRef = field.id === primarySecretFieldId
        ? nextPrimarySecretRef
        : secretStorageService.createProviderConnectionSecretRef(provider.id, nextAccountId, field.id);
      if (!targetRef) {
        continue;
      }
      if (field.id !== primarySecretFieldId) {
        nextSecretRefs[field.id] = targetRef;
      }
      retainedSecretRefs.add(targetRef);
      if (credentialChanged || !secretStorageService.hasSecretRecord(targetRef, current.paths.userRdxRoot)) {
        secretStorageService.setSecret(targetRef, plannedSecrets[field.id], current.paths.userRdxRoot);
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
    hasStoredSecret: authMode === 'api-key'
      ? credentialSatisfied
      : authMode === 'local' || authMode === 'environment',
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
    isConfigured: hasEnabledModels,
  };

  try {
    const nextSettings = this.host.setAll({
      llm: {
        providers: current.llm.providers.map((entry) => entry.id === providerId ? nextProvider : entry),
      },
    });
    deleteSecretsAfterCommit(
      [...previousSecretRefs].filter((secretRef) => !retainedSecretRefs.has(secretRef)),
      current.paths.userRdxRoot,
    );
    return nextSettings;
  } catch (error) {
    deleteSecretsAfterCommit(
      [...stagedSecretRefs].filter((secretRef) => !previousSecretRefs.has(secretRef)),
      current.paths.userRdxRoot,
    );
    throw error;
  }
  }

  saveProviderAccountConnection(
    providerId: LlmProviderId,
    secretPayload: string,
    models: LlmProviderModel[],
    accountSummary: Pick<LlmProviderEntry, 'accountLabel' | 'planLabel' | 'oauthExpiresAt' | 'oauthRefreshAvailable'> = {},
  ): AppSettings {
  const current = this.host.getAll();
  const provider = current.llm.providers.find((entry) => entry.id === providerId);
  if (!provider || !isBuiltinProviderId(provider.id) || !provider.authModeOptions?.includes('account')) {
    throw new Error(`Unknown account provider: ${providerId}`);
  }

  const discoveredModels = applyModelPreferences(resolveProviderModels(provider.id, models), provider.models);
  if (discoveredModels.length === 0) {
    throw new Error('Provider returned no usable models');
  }

  const hasEnabledModels = discoveredModels.some((model) => model.enabled !== false);

  const activeAccountId = extractOAuthBundleAccountId(secretPayload)
    ?? provider.authAccountIds?.account
    ?? createLocalAccountId();
  const nextSecretRef = getProviderAccountSecretRef(provider.id, activeAccountId, 'oauth');
  const previousSecretRef = provider.authAccountIds?.account && provider.authAccountIds.account !== activeAccountId
    ? getProviderAccountSecretRef(provider.id, provider.authAccountIds.account, 'oauth')
    : undefined;
  secretStorageService.setSecret(nextSecretRef, secretPayload, current.paths.userRdxRoot);

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
    isConfigured: hasEnabledModels,
  };

  const nextSettings = this.host.setAll({
    llm: {
      providers: current.llm.providers.map((entry) => entry.id === providerId ? nextProvider : entry),
    },
  });
  deleteSecretsAfterCommit(previousSecretRef ? [previousSecretRef] : [], current.paths.userRdxRoot);
  return nextSettings;
  }

  rotateProviderAccountCredential(
    providerId: LlmProviderId,
    secretPayload: string,
    accountSummary: Pick<LlmProviderEntry, 'accountLabel' | 'planLabel' | 'oauthExpiresAt' | 'oauthRefreshAvailable'> = {},
  ): AppSettings {
  const current = this.host.getAll();
  const provider = current.llm.providers.find((entry) => entry.id === providerId);
  if (!provider || !isBuiltinProviderId(provider.id) || !provider.authModeOptions?.includes('account')) {
    throw new Error(`Unknown account provider: ${providerId}`);
  }
  const activeAccountId = extractOAuthBundleAccountId(secretPayload)
    ?? provider.authAccountIds?.account
    ?? createLocalAccountId();
  const nextSecretRef = getProviderAccountSecretRef(provider.id, activeAccountId, 'oauth');
  const previousSecretRef = provider.authAccountIds?.account && provider.authAccountIds.account !== activeAccountId
    ? getProviderAccountSecretRef(provider.id, provider.authAccountIds.account, 'oauth')
    : undefined;
  secretStorageService.setSecret(nextSecretRef, secretPayload, current.paths.userRdxRoot);
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
  const nextSettings = this.host.setAll({
    llm: {
      providers: current.llm.providers.map((entry) => entry.id === providerId ? nextProvider : entry),
    },
  });
  deleteSecretsAfterCommit(previousSecretRef ? [previousSecretRef] : [], current.paths.userRdxRoot);
  return nextSettings;
  }

  markProviderAccountRefreshFailure(providerId: LlmProviderId, message: string): AppSettings {
    const current = this.host.getAll();
    return this.host.setAll({
      llm: {
        providers: current.llm.providers.map((provider) => provider.id === providerId
          ? { ...provider, enabled: false, status: 'failed', isConfigured: false, lastError: message }
          : provider),
      },
    });
  }

  disconnectProvider(providerId: LlmProviderId, authModeDraft?: LlmProviderAuthMode): AppSettings {
  const current = this.host.getAll();
  const provider = current.llm.providers.find((entry) => entry.id === providerId);
  if (!provider || !isBuiltinProviderId(provider.id)) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  const authMode = authModeDraft && provider.authModeOptions?.includes(authModeDraft)
    ? authModeDraft
    : provider.authMode;
  const secretRefToDelete = authMode === 'api-key'
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
    const nextSettings = this.host.setAll({
      llm: {
        providers: current.llm.providers.map((entry) => entry.id === providerId
          ? { ...provider, authAccountIds, hasStoredSecretByAuthMode }
          : entry),
      },
    });
    deleteSecretsAfterCommit(secretRefToDelete ? [secretRefToDelete] : [], current.paths.userRdxRoot);
    return nextSettings;
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

  const nextSettings = this.host.setAll({
    llm: {
      providers: current.llm.providers.map((entry) => entry.id === providerId ? nextProvider : entry),
    },
  });
  deleteSecretsAfterCommit(secretRefToDelete ? [secretRefToDelete] : [], current.paths.userRdxRoot);
  return nextSettings;
  }
}

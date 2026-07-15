import { describe, expect, it } from 'vitest';
import type { LlmProviderEntry } from '@shared/types/settings';
import {
  createProviderConnectionDraft,
  getConnectionDraftSignature,
  getConnectionRequestValues,
  isConnectionDraftComplete,
  projectEndpointTemplate,
  shouldUseProviderDocsLink,
} from './providerConnectionState';

function vertexProvider(): LlmProviderEntry {
  return {
    id: 'google-vertex',
    authMode: 'api-key',
    protocol: 'GoogleVertexGemini',
    models: [],
    connectionValues: {
      GOOGLE_VERTEX_PROJECT: 'rdc-project',
      GOOGLE_VERTEX_LOCATION: 'us-central1',
    },
    hasStoredConnectionSecrets: { GOOGLE_VERTEX_ACCESS_TOKEN: true },
    connectionSchema: {
      fields: [
        { id: 'GOOGLE_VERTEX_PROJECT', label: 'Project', kind: 'text', required: true },
        { id: 'GOOGLE_VERTEX_LOCATION', label: 'Location', kind: 'region', required: true },
        { id: 'GOOGLE_APPLICATION_CREDENTIALS', label: 'ADC path', kind: 'path', required: false },
        { id: 'GOOGLE_VERTEX_ACCESS_TOKEN', label: 'Access token', kind: 'secret', required: false },
      ],
      primarySecretFieldId: 'GOOGLE_VERTEX_ACCESS_TOKEN',
      endpointTemplate: 'https://${GOOGLE_VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${GOOGLE_VERTEX_PROJECT}',
      credentialAlternatives: [
        { id: 'access-token', fieldIds: ['GOOGLE_VERTEX_ACCESS_TOKEN'] },
        { id: 'service-account', fieldIds: ['GOOGLE_APPLICATION_CREDENTIALS'] },
        { id: 'adc', fieldIds: [], ambient: true },
      ],
    },
  } as unknown as LlmProviderEntry;
}

describe('providerConnectionState', () => {
  it('hydrates typed non-secret fields while retaining main-process secret references', () => {
    const provider = vertexProvider();
    const draft = createProviderConnectionDraft(provider);
    expect(draft.connectionValues).toMatchObject({
      GOOGLE_VERTEX_PROJECT: 'rdc-project',
      GOOGLE_VERTEX_LOCATION: 'us-central1',
      GOOGLE_VERTEX_ACCESS_TOKEN: '',
    });
    expect(draft.usingStoredConnectionSecrets.GOOGLE_VERTEX_ACCESS_TOKEN).toBe(true);
    expect(getConnectionRequestValues(draft)).not.toHaveProperty('GOOGLE_VERTEX_ACCESS_TOKEN');
    expect(isConnectionDraftComplete(provider, draft)).toBe(true);
  });

  it('tracks the complete typed revision and resolves endpoint templates for the active route', () => {
    const provider = vertexProvider();
    const draft = createProviderConnectionDraft(provider);
    const before = getConnectionDraftSignature(draft);
    draft.connectionValues.GOOGLE_VERTEX_LOCATION = 'europe-west4';
    expect(getConnectionDraftSignature(draft)).not.toBe(before);
    expect(projectEndpointTemplate(draft.baseUrl, draft.connectionValues)).toBe(
      'https://europe-west4-aiplatform.googleapis.com/v1/projects/rdc-project',
    );
    draft.connectionValues.GOOGLE_VERTEX_PROJECT = '';
    expect(isConnectionDraftComplete(provider, draft)).toBe(false);
  });

  it('uses provider documentation wording for typed credentials', () => {
    expect(shouldUseProviderDocsLink(vertexProvider())).toBe(true);
    expect(shouldUseProviderDocsLink({
      ...vertexProvider(),
      connectionSchema: {
        fields: [{ id: 'apiKey', label: 'API Key', kind: 'secret', required: true }],
      },
    })).toBe(false);
  });
});

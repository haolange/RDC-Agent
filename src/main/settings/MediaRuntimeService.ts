import type { LlmProviderId } from '../../shared/types/settings';

export interface MediaGenerationRequest {
  providerId: LlmProviderId;
  modelId: string;
  prompt: string;
  options?: {
    width?: number;
    height?: number;
    style?: string;
  };
}

export type MediaGenerationStatus =
  | 'success'
  | 'adapter-not-implemented'
  | 'credential-blocked'
  | 'provider-unavailable';

export interface MediaGenerationResult {
  status: MediaGenerationStatus;
  imageUrl?: string;
  error?: string;
  diagnostics?: {
    providerId: string;
    modelId: string;
    reason: string;
  };
}

export class MediaRuntimeService {
  async generate(request: MediaGenerationRequest): Promise<MediaGenerationResult> {
    return {
      status: 'adapter-not-implemented',
      error:
        `Media generation adapter not implemented for provider "${request.providerId}" model "${request.modelId}". ` +
        'No image/video generation runtime is currently available.',
      diagnostics: {
        providerId: request.providerId,
        modelId: request.modelId,
        reason: 'No media adapter registered. This is a skeleton implementation.',
      },
    };
  }

  isMediaAdapterAvailable(_providerId: LlmProviderId): boolean {
    return false;
  }

  getRegisteredMediaProviders(): LlmProviderId[] {
    return [];
  }
}

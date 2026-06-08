import type { LlmProviderId } from '../../shared/types/settings';

/**
 * 单次媒体（图像/视频）生成请求的入参契约。
 */
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

/**
 * 媒体生成结果状态枚举。
 *
 * - `success`：成功生成媒体资源。
 * - `adapter-not-implemented`：尚未注册任何 media adapter，请求被显式拒绝。
 * - `credential-blocked`：缺少凭据或凭据被拒绝。
 * - `provider-unavailable`：provider 当前不可用（未连接、网络错误等）。
 */
export type MediaGenerationStatus =
  | 'success'
  | 'adapter-not-implemented'
  | 'credential-blocked'
  | 'provider-unavailable';

/**
 * 媒体生成结果。失败路径必须携带可诊断的 reason。
 */
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

/**
 * Media Runtime Service — 图像/视频生成运行时。
 *
 * 当前实现为 fail-closed skeleton：所有请求返回 adapter-not-implemented。
 * 设计目标是确保 media generation request 不会误入 chat runtime
 * (LLMAdapter.chat() 或 ProviderRegistry.stream())。
 */
export class MediaRuntimeService {
  /**
   * 请求图像生成。
   * 当前所有 provider 均无真实 adapter 实现，统一返回 fail-closed 响应。
   */
  async generate(request: MediaGenerationRequest): Promise<MediaGenerationResult> {
    // fail-closed: 所有请求返回明确的 adapter-not-implemented
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

  /**
   * 检查指定 provider 是否有可用的 media adapter。
   * 当前始终返回 false。
   */
  isMediaAdapterAvailable(_providerId: LlmProviderId): boolean {
    return false;
  }

  /**
   * 获取所有已注册的 media provider IDs。
   * 当前返回空数组。
   */
  getRegisteredMediaProviders(): LlmProviderId[] {
    return [];
  }
}

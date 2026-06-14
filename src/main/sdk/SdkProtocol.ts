/**
 * SdkProtocol — SDK 结构化输出模式。
 *
 * 支持:
 *  - JSON 协议模式（替代自然语言输出）
 *  - 请求/响应结构体定义
 */
export interface SdkRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface SdkResponse {
  id: string;
  result?: unknown;
  error?: { code: number; message: string; };
}

export interface SdkToolCallRequest {
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface SdkToolCallResult {
  content: Array<{ type: 'text' | 'image'; text?: string; data?: string; mimeType?: string }>;
  isError: boolean;
}

export class SdkProtocol {
  /** 将自然语言响应包装为 SDK 响应。 */
  static wrapResponse(requestId: string, text: string): SdkResponse {
    return { id: requestId, result: { message: text } };
  }

  /** 将错误包装为 SDK 错误响应。 */
  static wrapError(requestId: string, error: Error): SdkResponse {
    return { id: requestId, error: { code: -1, message: error.message } };
  }

  /** 解析 SDK 请求。 */
  static parseRequest(input: string): SdkRequest | null {
    try { return JSON.parse(input) as SdkRequest; } catch { return null; }
  }
}

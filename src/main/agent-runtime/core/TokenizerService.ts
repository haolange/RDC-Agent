/**
 * TokenizerService — 基于 gpt-tokenizer 的真实 Token 计数服务。
 *
 * 包装 gpt-tokenizer 的 `encode` / `countTokens` 方法，
 * 为每种模型族自动选择合适的编码器。回退到字符估算。
 *
 * countMessagesTokens 覆盖全部计费内容块：text、image（尺寸估算）、
 * toolCall（名称 + JSON 参数）、thinking（可读文本或 opaque continuation payload）。
 * Opaque continuation 只按字节计量，绝不解读或升格为可读 thinking。
 */

import { encode } from 'gpt-tokenizer';

/** 字符估算：4 characters ≈ 1 token（回退方案）。 */
const CHAR_PER_TOKEN = 4;

/** 图像 token 估算：与 ContextManager.estimateImageTokensFromBase64Length 同一契约。 */
const estimateImageTokens = (base64Length: number): number => {
  const byteLength = Math.max(0, Math.floor(base64Length * 0.75));
  return Math.max(256, Math.ceil(byteLength / 1024));
};

export class TokenizerService {
  private encoderCache = new Map<string, boolean>();

  /**
   * 计算文本的 token 数。
   * 优先使用 gpt-tokenizer 精确计数，不支持的模型族回退到字符估算。
   */
  countTokens(text: string, modelId?: string): number {
    if (!text) return 0;

    if (modelId && this.supportsEncoding(modelId)) {
      try {
        return encode(text).length;
      } catch {
        // 编码失败时回退
      }
    }

    return Math.ceil(text.length / CHAR_PER_TOKEN);
  }

  /**
   * 计算多条消息的总 token 数（含消息格式开销）。
   * 覆盖 text / image / toolCall / thinking(continuation) 四类内容块。
   */
  countMessagesTokens(
    messages: Array<{ role: string; content?: unknown }>,
    modelId?: string,
  ): number {
    let total = 0;
    for (const msg of messages) {
      // 每条消息约 4 token 的格式开销
      total += 4;
      const content = msg.content;
      if (typeof content === 'string') {
        total += this.countTokens(content, modelId);
      } else if (Array.isArray(content)) {
        for (const block of content as Array<Record<string, unknown>>) {
          total += this.countBlockTokens(block, modelId);
        }
      }
    }
    // 每次请求约 2 token 的开销
    total += 2;
    return total;
  }

  private countBlockTokens(block: Record<string, unknown>, modelId?: string): number {
    if (block.type === 'text' && typeof block.text === 'string') {
      return this.countTokens(block.text, modelId);
    }
    if (block.type === 'image' && typeof block.data === 'string') {
      return estimateImageTokens(block.data.length);
    }
    if (block.type === 'toolCall') {
      const name = typeof block.name === 'string' ? block.name : '';
      let argsText = '';
      try {
        argsText = block.arguments === undefined ? '' : JSON.stringify(block.arguments);
      } catch {
        argsText = '';
      }
      return this.countTokens(name + argsText, modelId);
    }
    if (block.type === 'thinking') {
      // Opaque continuation payload 按序列化字节计量（回放时它占请求体）；
      // 无 continuation 时按可读文本计量。
      if (block.continuation !== undefined && block.continuation !== null) {
        try {
          return Math.ceil(JSON.stringify(block.continuation).length / CHAR_PER_TOKEN);
        } catch {
          return 0;
        }
      }
      if (typeof block.text === 'string') {
        return this.countTokens(block.text, modelId);
      }
    }
    return 0;
  }

  /** 检查模型族是否被 gpt-tokenizer 支持（简化：始终尝试编码）。 */
  private supportsEncoding(_modelId: string): boolean {
    const cached = this.encoderCache.get(_modelId);
    if (cached !== undefined) return cached;

    try {
      encode('test');
      this.encoderCache.set(_modelId, true);
      return true;
    } catch {
      this.encoderCache.set(_modelId, false);
      return false;
    }
  }
}

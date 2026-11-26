/**
 * TokenizerService — 基于 gpt-tokenizer 的真实 Token 计数服务。
 *
 * 包装 gpt-tokenizer 的 `encode`，按文本缓存计数；没有模型或编码失败时回退到字符估算。
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

/** Texts shorter than this encode faster than a cache lookup pays back. */
const CACHE_MIN_CHARS = 256;
/** The cache keeps its keys alive, so it is bounded by the characters it holds rather than by entry count. */
const CACHE_MAX_CHARS = 16_000_000;
const CACHE_MAX_TEXT_CHARS = CACHE_MAX_CHARS / 8;

export class TokenizerService {
  /**
   * Token counts by text, least recently used first. A turn counts its whole history before every request; the
   * history is the same strings each step, so each text is encoded once and later steps cost a lookup. There is one
   * encoding (gpt-tokenizer's default), so the text alone is the key.
   */
  private readonly counts = new Map<string, number>();
  private cachedChars = 0;

  /**
   * 计算文本的 token 数。
   * 有模型时用 gpt-tokenizer 精确计数（按文本缓存），否则或编码失败时回退到字符估算。
   */
  countTokens(text: string, modelId?: string): number {
    if (!text) return 0;
    if (modelId) {
      try {
        return this.encodedLength(text);
      } catch {
        // gpt-tokenizer rejects texts that contain special tokens; those are estimated.
      }
    }
    return Math.ceil(text.length / CHAR_PER_TOKEN);
  }

  private encodedLength(text: string): number {
    if (text.length < CACHE_MIN_CHARS || text.length > CACHE_MAX_TEXT_CHARS) return encode(text).length;
    const cached = this.counts.get(text);
    if (cached !== undefined) {
      this.counts.delete(text);
      this.counts.set(text, cached);
      return cached;
    }
    const count = encode(text).length;
    this.counts.set(text, count);
    this.cachedChars += text.length;
    for (const oldest of this.counts.keys()) {
      if (this.cachedChars <= CACHE_MAX_CHARS) break;
      this.counts.delete(oldest);
      this.cachedChars -= oldest.length;
    }
    return count;
  }

  /**
   * 计算多条消息的总 token 数（含消息格式开销）。
   * 覆盖 text / image / toolCall / thinking(continuation) 四类内容块。
   */
  countMessagesTokens(messages: Array<{ role: string; content?: unknown }>, modelId?: string): number {
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
}

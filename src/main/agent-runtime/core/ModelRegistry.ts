/**
 * ModelRegistry — 模型注册与查询。
 *
 * 管理所有已知模型的元数据（context window、能力、计费等），
 * 让 Agent Runtime / 调度器能在不依赖 Provider 实现的情况下做能力筛选。
 */

import type { Model } from './types';

/**
 * 模型注册表。
 *
 * - `register` / `unregister` 维护单条模型；
 * - `getModel` 按 id 查询；
 * - `getModelsByProvider` 按 provider id 过滤；
 * - `supportsXxx` 提供常用能力的快捷断言。
 */
export class ModelRegistry {
  private readonly models = new Map<string, Model>();

  /** 注册或覆盖一个模型。 */
  register(model: Model): void {
    if (!model || typeof model.id !== 'string' || !model.id) {
      throw new Error('ModelRegistry.register requires a model with non-empty id');
    }
    this.models.set(model.id, model);
  }

  /** 注销模型；不存在时静默返回。 */
  unregister(modelId: string): void {
    this.models.delete(modelId);
  }

  /** 按 id 查询模型，未注册时返回 undefined。 */
  getModel(modelId: string): Model | undefined {
    return this.models.get(modelId);
  }

  /** 按 provider id 过滤模型。 */
  getModelsByProvider(provider: string): Model[] {
    const out: Model[] = [];
    for (const model of this.models.values()) {
      if (model.provider === provider) {
        out.push(model);
      }
    }
    return out;
  }

  /** 列出所有已注册模型（顺序与注册顺序一致）。 */
  listModels(): Model[] {
    return Array.from(this.models.values());
  }

  /** 模型是否支持视觉输入；未注册返回 false。 */
  supportsVision(modelId: string): boolean {
    return this.models.get(modelId)?.vision === true;
  }

  /** 模型是否支持 reasoning；未注册返回 false。 */
  supportsReasoning(modelId: string): boolean {
    return this.models.get(modelId)?.reasoning === true;
  }
}

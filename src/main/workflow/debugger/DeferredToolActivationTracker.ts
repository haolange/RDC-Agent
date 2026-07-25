/**
 * DeferredToolActivationTracker — 按 slotKey 持久化 deferred 工具激活集。
 *
 * toolSignature（全部可用工具名）变化时重置；turnSignature 变化不重置。
 * 激活后由调用方 COW 更新 Agent runtime revision（见 Agent.setTools / LoopRuntimeState）。
 */

import type { ToolDefinition } from '../../agent-runtime/core/types';
import {
  isDeferredToolName,
  partitionDeferredTools,
} from './deferredTools';

export interface DeferredActivationRecord {
  toolSignature: string;
  names: Set<string>;
}

export class DeferredToolActivationTracker {
  private readonly activatedBySlotKey = new Map<string, DeferredActivationRecord>();

  /**
   * 解析（或重置）slot 的 deferred 工具激活集。
   * 仅在全部可用工具 signature 变化时清空；跨 turn 复用同一 Set。
   */
  resolveActivatedSet(slotKey: string, toolSignature: string): Set<string> {
    const existing = this.activatedBySlotKey.get(slotKey);
    if (existing && existing.toolSignature === toolSignature) {
      return existing.names;
    }
    const names = new Set<string>();
    this.activatedBySlotKey.set(slotKey, { toolSignature, names });
    return names;
  }

  get(slotKey: string): DeferredActivationRecord | undefined {
    return this.activatedBySlotKey.get(slotKey);
  }

  /**
   * 激活 deferred 工具名；返回是否有变更，以及按激活集划分后的 injected 定义。
   */
  activate(input: {
    slotKey: string;
    toolNames: string[];
    allDefinitions: ToolDefinition[];
    activatedSet: Set<string>;
  }): { changed: boolean; injected: ToolDefinition[] } {
    const available = new Set(input.allDefinitions.map((def) => def.name));
    let changed = false;
    for (const name of input.toolNames) {
      if (!isDeferredToolName(name) || !available.has(name)) {
        continue;
      }
      if (!input.activatedSet.has(name)) {
        input.activatedSet.add(name);
        changed = true;
      }
    }
    const { injected } = partitionDeferredTools(input.allDefinitions, input.activatedSet);
    return { changed, injected };
  }

  clearSlot(slotKey: string): void {
    this.activatedBySlotKey.delete(slotKey);
  }

  clearSession(sessionId: string): void {
    const prefix = `${sessionId}::`;
    for (const key of Array.from(this.activatedBySlotKey.keys())) {
      if (key.startsWith(prefix)) {
        this.activatedBySlotKey.delete(key);
      }
    }
  }
}

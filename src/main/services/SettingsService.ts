/**
 * SettingsService - App-global 设置持久化
 * 使用 electron-store 管理 OpenRouter 配置和 Remote Targets
 */

import Store from 'electron-store';

// ── 内联类型定义（避免依赖 shared/types，防止与并行任务冲突） ──

interface OpenRouterSettings {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  agentModelOverrides?: Record<string, string>;
  temperature?: number;
}

interface RemoteTarget {
  id: string;
  hostname: string;
  port: number;
  label: string;
  lastConnected?: number;
}

interface AppGlobalSettings {
  openRouter: OpenRouterSettings;
  remoteTargets: RemoteTarget[];
}

// ── 默认值 ──

const DEFAULTS: AppGlobalSettings = {
  openRouter: {
    apiKey: '',
    defaultModel: 'anthropic/claude-sonnet-4-20250514',
  },
  remoteTargets: [],
};

// ── 服务类 ──

export class SettingsService {
  private store: Store<AppGlobalSettings>;

  constructor() {
    this.store = new Store<AppGlobalSettings>({
      name: 'rdc-agent-settings',
      defaults: DEFAULTS,
    });
  }

  // ── OpenRouter 配置 ──

  getOpenRouterConfig(): OpenRouterSettings {
    return this.store.get('openRouter');
  }

  setOpenRouterConfig(config: Partial<OpenRouterSettings>): void {
    const current = this.getOpenRouterConfig();
    this.store.set('openRouter', { ...current, ...config });
  }

  hasOpenRouterKey(): boolean {
    const config = this.getOpenRouterConfig();
    return !!config.apiKey && config.apiKey.length > 0;
  }

  // ── Remote Targets ──

  getRemoteTargets(): RemoteTarget[] {
    return this.store.get('remoteTargets');
  }

  saveRemoteTarget(target: RemoteTarget): void {
    const targets = this.getRemoteTargets();
    const idx = targets.findIndex(t => t.id === target.id);
    if (idx >= 0) {
      targets[idx] = target;
    } else {
      targets.push(target);
    }
    this.store.set('remoteTargets', targets);
  }

  removeRemoteTarget(targetId: string): void {
    const targets = this.getRemoteTargets().filter(t => t.id !== targetId);
    this.store.set('remoteTargets', targets);
  }

  // ── 全量读写（供 IPC settings:get / settings:set 使用） ──

  getAll(): AppGlobalSettings {
    return this.store.store;
  }

  setAll(partial: Partial<AppGlobalSettings>): void {
    if (partial.openRouter !== undefined) {
      this.setOpenRouterConfig(partial.openRouter);
    }
    if (partial.remoteTargets !== undefined) {
      this.store.set('remoteTargets', partial.remoteTargets);
    }
  }

  // ── 重置 ──

  reset(): void {
    this.store.clear();
  }
}

// 单例导出
export const settingsService = new SettingsService();

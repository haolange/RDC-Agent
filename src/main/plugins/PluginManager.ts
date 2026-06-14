/**
 * PluginManager — 插件系统框架。
 *
 * 插件包结构:
 *   {pluginDir}/
 *     manifest.json   — { name, version, hooks, commands, skills }
 *     index.js        — 插件入口
 */
import * as fs from 'fs';
import * as path from 'path';
import type { HookDefinition } from '../hooks/HookEngine';
import type { CommandDefinition } from '@shared/types/command';

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  hooks?: HookDefinition[];
  commands?: CommandDefinition[];
  skills?: string[];
  main?: string;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  dir: string;
  exports?: Record<string, unknown>;
}

export class PluginManager {
  private plugins = new Map<string, LoadedPlugin>();

  /** 从目录加载所有插件。 */
  async loadAll(pluginsDir: string): Promise<LoadedPlugin[]> {
    if (!fs.existsSync(pluginsDir)) return [];
    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    const loaded: LoadedPlugin[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(pluginsDir, entry.name);
      const manifestPath = path.join(dir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;

      try {
        const raw = fs.readFileSync(manifestPath, 'utf8');
        const manifest = JSON.parse(raw) as PluginManifest;
        const plugin: LoadedPlugin = { manifest, dir };

        // 加载 JS 入口
        if (manifest.main) {
          const mainPath = path.join(dir, manifest.main);
          if (fs.existsSync(mainPath)) {
            plugin.exports = require(mainPath) as Record<string, unknown>;
          }
        }

        this.plugins.set(manifest.name, plugin);
        loaded.push(plugin);
      } catch (err) {
        console.warn(`[PluginManager] Failed to load plugin "${entry.name}":`, (err as Error).message);
      }
    }

    return loaded;
  }

  /** 重新加载所有插件。 */
  async reload(pluginsDir: string): Promise<LoadedPlugin[]> {
    this.plugins.clear();
    return this.loadAll(pluginsDir);
  }

  /** 获取已加载插件列表。 */
  listPlugins(): LoadedPlugin[] {
    return [...this.plugins.values()];
  }

  /** 获取插件提供的 hook 定义。 */
  getPluginHooks(): HookDefinition[] {
    const hooks: HookDefinition[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.manifest.hooks) hooks.push(...plugin.manifest.hooks);
    }
    return hooks;
  }

  /** 获取插件提供的命令定义。 */
  getPluginCommands(): CommandDefinition[] {
    const commands: CommandDefinition[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.manifest.commands) {
        for (const cmd of plugin.manifest.commands) {
          // 为插件命令加命名空间前缀
          commands.push({ ...cmd, name: `${plugin.manifest.name}:${cmd.name}` });
        }
      }
    }
    return commands;
  }
}

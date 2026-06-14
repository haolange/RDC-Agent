/**
 * MultiScopeConfig — 多作用域配置加载与合并。
 *
 * 三层优先级（高→低）:
 *   Session (内存) → Project (.rdc/settings.json) → Global (用户目录)
 *
 * 合并策略: 浅合并，高层覆盖低层。
 */
import * as fs from 'fs';
import * as path from 'path';

export type ConfigScope = 'global' | 'project' | 'session';

export interface ConfigLayer {
  scope: ConfigScope;
  path?: string;
  data: Record<string, unknown>;
}

export class MultiScopeConfig {
  private globalPath: string;
  private sessionOverrides: Record<string, unknown> = {};

  constructor(globalPath: string) {
    this.globalPath = globalPath;
  }

  /** 加载三层配置并合并。 */
  load(workspaceRoot?: string): Record<string, unknown> {
    const layers: ConfigLayer[] = [];

    // Layer 1: Global
    const global = this.loadFile(this.globalPath);
    if (global) layers.push({ scope: 'global', path: this.globalPath, data: global });

    // Layer 2: Project
    if (workspaceRoot) {
      const projectPath = path.join(workspaceRoot, '.rdc', 'settings.json');
      const project = this.loadFile(projectPath);
      if (project) layers.push({ scope: 'project', path: projectPath, data: project });
    }

    // Layer 3: Session (内存覆盖)
    if (Object.keys(this.sessionOverrides).length > 0) {
      layers.push({ scope: 'session', data: { ...this.sessionOverrides } });
    }

    return this.merge(layers);
  }

  /** 设置会话级覆盖。 */
  setSessionOverride(key: string, value: unknown): void {
    this.sessionOverrides[key] = value;
  }

  /** 清除所有会话覆盖。 */
  clearSessionOverrides(): void {
    this.sessionOverrides = {};
  }

  /** 获取所有层信息（用于诊断）。 */
  getLayers(workspaceRoot?: string): ConfigLayer[] {
    const layers: ConfigLayer[] = [];
    const global = this.loadFile(this.globalPath);
    if (global) layers.push({ scope: 'global', path: this.globalPath, data: global });
    if (workspaceRoot) {
      const projectPath = path.join(workspaceRoot, '.rdc', 'settings.json');
      const project = this.loadFile(projectPath);
      if (project) layers.push({ scope: 'project', path: projectPath, data: project });
    }
    return layers;
  }

  // ── 内部 ──

  private loadFile(filePath: string): Record<string, unknown> | null {
    try {
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch { return null; }
  }

  private merge(layers: ConfigLayer[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const layer of layers) {
      Object.assign(result, layer.data);
    }
    return result;
  }
}

/**
 * SkillLoader — 技能（Skill）加载系统。
 *
 * 从 `resources/agent-runtime/skills/` 目录加载 JSON 描述的技能，
 * 提供：
 *  - scan/refresh：扫描目录、解析 JSON。
 *  - get/list：查询单个或全部技能。
 *  - getCatalog：生成可注入系统提示的简短目录文本。
 *  - loadContent：读取技能内容（Markdown 字符串）。
 *
 * 容错策略：
 *  - 单个文件解析失败时跳过并 console.warn，不影响其它技能。
 *  - 缺少 `name` / `description` 视为无效，跳过。
 *  - `content` 缺省时尝试从同名 .md 文件读取，再缺省时回落为空字符串。
 */

import { promises as fs } from 'fs';
import * as path from 'path';

import type { ToolDefinition } from '../core/types';

/** 技能元数据。 */
export interface SkillManifest {
  name: string;
  description: string;
  /** 技能完整内容（Markdown）。可能为空字符串。 */
  content: string;
  /** 可选：技能提供的额外工具。 */
  tools?: ToolDefinition[];
}

/**
 * 计算默认技能目录：相对于 process.cwd() 的 `resources/agent-runtime/skills`。
 *
 * dev 与 build 环境下 cwd 通常都指向项目根，足以满足 Skill 加载需求。
 * 如果调用方需要自定义位置（例如打包后的 resources 路径），
 * 可在构造 SkillLoader 时显式传入 skillsDir 参数。
 */
function defaultSkillsDir(): string {
  return path.resolve(process.cwd(), 'resources', 'agent-runtime', 'skills');
}

/** 技能加载器。 */
export class SkillLoader {
  private skills = new Map<string, SkillManifest>();
  private skillsDir: string;

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir ?? defaultSkillsDir();
  }

  /** 扫描技能目录，加载所有技能。 */
  async scan(): Promise<void> {
    this.skills.clear();

    let entries: string[];
    try {
      entries = await fs.readdir(this.skillsDir);
    } catch (err) {
      console.warn(
        `[SkillLoader] failed to read skills dir "${this.skillsDir}":`,
        err,
      );
      return;
    }

    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith('.json')) {
        continue;
      }
      const filePath = path.join(this.skillsDir, entry);
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const manifest = await this.normalize(parsed, filePath);
        if (!manifest) {
          console.warn(
            `[SkillLoader] skipped invalid skill file: ${filePath}`,
          );
          continue;
        }
        if (this.skills.has(manifest.name)) {
          console.warn(
            `[SkillLoader] duplicate skill name "${manifest.name}", overriding (${filePath})`,
          );
        }
        this.skills.set(manifest.name, manifest);
      } catch (err) {
        console.warn(
          `[SkillLoader] failed to load skill file "${filePath}":`,
          err,
        );
      }
    }
  }

  /** 获取技能。 */
  get(name: string): SkillManifest | undefined {
    return this.skills.get(name);
  }

  /** 列出所有可用技能。 */
  list(): SkillManifest[] {
    return Array.from(this.skills.values());
  }

  /** 获取技能目录文本（注入系统提示用）。 */
  getCatalog(): string {
    const items = this.list();
    if (items.length === 0) {
      return '(no skills available)';
    }
    return items
      .map((skill) => `- ${skill.name}: ${skill.description}`)
      .join('\n');
  }

  /** 加载指定技能的完整内容。 */
  loadContent(name: string): string | undefined {
    const skill = this.skills.get(name);
    if (!skill) {
      return undefined;
    }
    return skill.content;
  }

  /** 刷新（重新扫描）。 */
  async refresh(): Promise<void> {
    await this.scan();
  }

  // -------------------------------------------------------------------
  // 私有
  // -------------------------------------------------------------------

  /**
   * 把任意 JSON 对象规范化为 SkillManifest。
   * 缺失关键字段返回 null。
   */
  private async normalize(
    raw: Record<string, unknown>,
    filePath: string,
  ): Promise<SkillManifest | null> {
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const description =
      typeof raw.description === 'string' ? raw.description.trim() : '';
    if (!name || !description) {
      return null;
    }

    let content = typeof raw.content === 'string' ? raw.content : '';
    if (!content) {
      // 兼容：尝试加载同目录、同名（去掉 .json）的 .md 文件
      const baseName = path.basename(filePath, path.extname(filePath));
      const mdPath = path.join(this.skillsDir, `${baseName}.md`);
      try {
        content = await fs.readFile(mdPath, 'utf8');
      } catch {
        content = '';
      }
    }

    let tools: ToolDefinition[] | undefined;
    if (Array.isArray(raw.tools)) {
      tools = raw.tools.filter((t): t is ToolDefinition => {
        if (!t || typeof t !== 'object') return false;
        const obj = t as Record<string, unknown>;
        return (
          typeof obj.name === 'string' &&
          typeof obj.description === 'string' &&
          typeof obj.parameters === 'object' &&
          obj.parameters !== null
        );
      });
      if (tools.length === 0) {
        tools = undefined;
      }
    }

    return { name, description, content, tools };
  }
}

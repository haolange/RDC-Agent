import fs from 'fs';
import type { ToolManifest, ToolCategory } from '@shared/types/agenticTrace';

const PRIMITIVE_MANIFESTS: ToolManifest[] = [
  {
    toolName: 'file.read',
    displayName: '读取文件',
    category: 'file',
    renderer: { key: 'tool.file.read', defaultCollapsed: true, supportsPreview: true, supportsRawJson: true },
  },
  {
    toolName: 'bash',
    displayName: '运行命令',
    category: 'shell',
    renderer: { key: 'tool.shell.run', defaultCollapsed: false, supportsPreview: true, supportsRawJson: true },
    safety: { requiresApproval: true, riskLevel: 'medium', redactedFields: ['env', 'token', 'secret'] },
  },
  {
    toolName: 'grep',
    displayName: '搜索内容',
    category: 'code',
    renderer: { key: 'tool.code.search', defaultCollapsed: true, supportsPreview: true, supportsRawJson: true },
  },
  {
    toolName: 'glob',
    displayName: '搜索文件',
    category: 'file',
    renderer: { key: 'tool.file.search', defaultCollapsed: true, supportsPreview: true, supportsRawJson: true },
  },
];

const categoryFromNamespace = (toolName: string): ToolCategory => {
  if (toolName.startsWith('rd.capture.') || toolName.startsWith('rd.replay.')) return 'domain';
  if (toolName.startsWith('rd.pipeline.') || toolName.startsWith('rd.event.')) return 'domain';
  if (toolName.startsWith('rd.texture.') || toolName.startsWith('rd.shader.')) return 'domain';
  if (toolName.startsWith('rd.')) return 'domain';
  return 'unknown';
};

const displayNameFromTool = (toolName: string, description?: string): string => {
  if (description) {
    const short = description.split(/[。.!?\n]/)[0]?.trim();
    if (short && short.length <= 32) return short;
  }
  const segment = toolName.split('.').pop() || toolName;
  return segment.replace(/_/g, ' ');
};

export class ToolManifestRegistry {
  private manifests = new Map<string, ToolManifest>();

  constructor() {
    for (const manifest of PRIMITIVE_MANIFESTS) {
      this.manifests.set(manifest.toolName, manifest);
    }
  }

  loadFromCatalog(catalogPath: string): void {
    if (!fs.existsSync(catalogPath)) return;
    const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf-8')) as {
      tools?: Array<{ name: string; description?: string }>;
    };
    for (const tool of raw.tools ?? []) {
      if (this.manifests.has(tool.name)) continue;
      this.manifests.set(tool.name, {
        toolName: tool.name,
        displayName: displayNameFromTool(tool.name, tool.description),
        category: categoryFromNamespace(tool.name),
        description: tool.description,
        renderer: {
          key: 'tool.domain.rd',
          defaultCollapsed: true,
          supportsPreview: true,
          supportsRawJson: true,
          supportsArtifacts: true,
        },
      });
    }
  }

  get(toolName: string): ToolManifest {
    return this.manifests.get(toolName) ?? {
      toolName,
      displayName: displayNameFromTool(toolName),
      category: categoryFromNamespace(toolName),
      renderer: {
        key: 'tool.unknown',
        defaultCollapsed: true,
        supportsPreview: true,
        supportsRawJson: true,
      },
    };
  }

  list(): ToolManifest[] {
    return [...this.manifests.values()];
  }
}

export const toolManifestRegistry = new ToolManifestRegistry();

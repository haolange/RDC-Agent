/**
 * RDC 核心工具适配器
 * 将 RDC-Agent-Tools 的 200 个工具封装为 LangGraph 兼容的 StructuredTool
 */
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { toolBridge } from '../services/ToolBridge';
import type { ToolDefinition, ToolCallResult, ToolLayer } from '../../shared/types/tool';

/** RDC 工具组定义 */
const RDC_TOOL_GROUPS = [
  'core', 'capture', 'event', 'pipeline', 'resource',
  'texture', 'buffer', 'shader', 'shader_debug', 'counters',
  'export', 'diagnose', 'macro', 'snapshot', 'mesh',
  'replay', 'remote', 'vfs'
] as const;

export type RDCToolGroup = typeof RDC_TOOL_GROUPS[number];

export class RDCToolAdapter {
  private tools: Map<string, DynamicStructuredTool> = new Map();
  private catalog: ToolDefinition[] = [];
  private initialized = false;

  /**
   * 初始化：从 ToolBridge 加载 catalog 并转换为 LangGraph 工具
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const catalogResult = await toolBridge.loadCatalog();
      // catalogResult 包含 tools 数组
      if (catalogResult && Array.isArray(catalogResult.tools)) {
        this.catalog = catalogResult.tools;
      } else if (Array.isArray(catalogResult)) {
        this.catalog = catalogResult;
      }

      for (const toolDef of this.catalog) {
        const langchainTool = this.convertToStructuredTool(toolDef);
        this.tools.set(toolDef.name, langchainTool);
      }

      this.initialized = true;
    } catch (error) {
      console.error('[RDCToolAdapter] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * 将 ToolDefinition 转换为 DynamicStructuredTool
   */
  private convertToStructuredTool(toolDef: ToolDefinition): DynamicStructuredTool {
    const schema = this.buildZodSchema(toolDef.parameters);

    return new DynamicStructuredTool({
      name: toolDef.name.replace(/\./g, '_'),  // LangGraph 工具名不允许点号
      description: toolDef.description || `RDC tool: ${toolDef.name}`,
      schema,
      func: async (args: Record<string, unknown>) => {
        const result = await this.call(toolDef.name, args);
        if (result.ok) {
          return JSON.stringify(result.data ?? { success: true });
        } else {
          return JSON.stringify({
            error: true,
            code: result.error?.code,
            message: result.error?.message,
          });
        }
      },
      metadata: {
        layer: 'rdc' as ToolLayer,
        originalName: toolDef.name,
        namespace: toolDef.namespace,
        group: toolDef.group,
      },
    });
  }

  /**
   * 从 ToolParameter[] 构建 Zod schema
   */
  private buildZodSchema(parameters: any[]): z.ZodObject<any> {
    const shape: Record<string, z.ZodTypeAny> = {};

    if (!parameters || parameters.length === 0) {
      return z.object({});
    }

    for (const param of parameters) {
      let zodType: z.ZodTypeAny;

      switch (param.type) {
        case 'string':
          zodType = z.string().describe(param.description || param.name);
          break;
        case 'number':
          zodType = z.number().describe(param.description || param.name);
          break;
        case 'boolean':
          zodType = z.boolean().describe(param.description || param.name);
          break;
        case 'array':
          zodType = z.array(z.unknown()).describe(param.description || param.name);
          break;
        case 'object':
          zodType = z.record(z.string(), z.unknown()).describe(param.description || param.name);
          break;
        default:
          zodType = z.unknown().describe(param.description || param.name);
      }

      if (!param.required) {
        zodType = zodType.optional();
      }

      shape[param.name] = zodType;
    }

    return z.object(shape);
  }

  /**
   * 调用 RDC 工具（委托给 ToolBridge）
   */
  async call(toolName: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    return toolBridge.call({
      toolName,
      args,
    });
  }

  /**
   * 获取所有 LangGraph 兼容的工具实例
   */
  getTools(): DynamicStructuredTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * 按功能组过滤工具
   */
  getToolsByGroup(group: RDCToolGroup): DynamicStructuredTool[] {
    return Array.from(this.tools.values()).filter(
      (tool) => (tool.metadata as any)?.group === group
    );
  }

  /**
   * 按命名空间过滤工具
   */
  getToolsByNamespace(namespace: string): DynamicStructuredTool[] {
    return Array.from(this.tools.values()).filter(
      (tool) => (tool.metadata as any)?.namespace === namespace
    );
  }

  /**
   * 获取原始工具定义列表（用于 IPC tool:getCatalog）
   */
  getCatalog(): ToolDefinition[] {
    return this.catalog;
  }

  /**
   * 按名称获取单个工具（使用原始 rd.* 名称）
   */
  getToolByOriginalName(name: string): DynamicStructuredTool | undefined {
    return Array.from(this.tools.values()).find(
      (tool) => (tool.metadata as any)?.originalName === name
    );
  }

  /**
   * 获取特定 Agent 角色可用的工具集
   * 基于角色过滤相关工具组
   */
  getToolsForAgent(agentRole: string): DynamicStructuredTool[] {
    const roleToolGroups: Record<string, RDCToolGroup[]> = {
      'triage_agent': ['core', 'capture', 'event', 'pipeline', 'diagnose'],
      'capture_repro_agent': ['capture', 'replay', 'event', 'snapshot'],
      'pass_graph_pipeline_agent': ['pipeline', 'event', 'resource', 'buffer'],
      'pixel_forensics_agent': ['texture', 'shader_debug', 'buffer', 'mesh'],
      'shader_ir_agent': ['shader', 'shader_debug', 'pipeline'],
      'driver_device_agent': ['core', 'diagnose', 'counters', 'remote'],
      'skeptic_agent': ['core', 'capture', 'diagnose', 'snapshot'],
      'curator_agent': ['export', 'snapshot', 'diagnose'],
      'rdc-debugger': RDC_TOOL_GROUPS.slice() as unknown as RDCToolGroup[],
    };

    const groups = roleToolGroups[agentRole] || [];
    return groups.flatMap((group) => this.getToolsByGroup(group));
  }
}

/** 单例导出 */
export const rdcToolAdapter = new RDCToolAdapter();

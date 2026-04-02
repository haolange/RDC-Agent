/**
 * MCP 工具适配器
 * 将 MCP 远程工具转换为 LangGraph DynamicStructuredTool
 */

import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import type { MCPClient } from './MCPClient';
import type { MCPToolDefinition } from '../../shared/types/mcp';

/**
 * MCP 工具适配器类
 */
export class MCPToolAdapter {
  private client: MCPClient;
  private tools = new Map<string, DynamicStructuredTool>();

  constructor(client: MCPClient) {
    this.client = client;
  }

  /**
   * 刷新指定 Server 的工具列表
   */
  async refreshTools(serverId: string): Promise<void> {
    try {
      const toolDefinitions = await this.client.listTools(serverId);

      // 移除该 Server 的旧工具
      this.removeTools(serverId);

      // 转换并添加新工具
      for (const toolDef of toolDefinitions) {
        const tool = this.convertTool(toolDef);
        const uniqueName = `mcp_${serverId}_${toolDef.name}`;
        this.tools.set(uniqueName, tool);
      }
    } catch (error) {
      console.error(`[MCPToolAdapter] 刷新工具失败 (${serverId}):`, error);
      throw error;
    }
  }

  /**
   * 移除指定 Server 的所有工具
   */
  removeTools(serverId: string): void {
    const prefix = `mcp_${serverId}_`;
    for (const [name] of this.tools) {
      if (name.startsWith(prefix)) {
        this.tools.delete(name);
      }
    }
  }

  /**
   * 获取所有 MCP 工具
   */
  getTools(): DynamicStructuredTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * 获取指定名称的工具
   */
  getTool(name: string): DynamicStructuredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * 将 MCPToolDefinition 转换为 DynamicStructuredTool
   */
  private convertTool(toolDef: MCPToolDefinition): DynamicStructuredTool {
    const uniqueName = `mcp_${toolDef.serverId}_${toolDef.name}`;
    const zodSchema = this.jsonSchemaToZod(toolDef.inputSchema);

    return new DynamicStructuredTool({
      name: uniqueName,
      description: `[${toolDef.serverName}] ${toolDef.description}`,
      schema: zodSchema,
      func: async (args: Record<string, unknown>) => {
        try {
          const result = await this.client.callTool(
            toolDef.serverId,
            toolDef.name,
            args
          );

          // 将 MCP 结果转换为字符串返回
          if (result.isError) {
            const errorContent = result.content
              .map((c) => c.text || '')
              .join('\n');
            throw new Error(`MCP 工具执行错误: ${errorContent}`);
          }

          return result.content
            .map((c) => {
              if (c.type === 'text') return c.text || '';
              if (c.type === 'image') return `[Image: ${c.mimeType}]`;
              if (c.type === 'resource') return `[Resource: ${c.mimeType}]`;
              return '';
            })
            .join('\n');
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          throw new Error(`MCP 工具调用失败 (${uniqueName}): ${errorMessage}`);
        }
      },
      metadata: {
        layer: 'mcp',
        mcpServer: toolDef.serverId,
        originalName: toolDef.name,
        serverName: toolDef.serverName,
      },
    });
  }

  /**
   * 从 JSON Schema 构建 Zod schema
   */
  private jsonSchemaToZod(schema: Record<string, unknown>): z.ZodObject<any> {
    const properties = (schema.properties as Record<string, Record<string, unknown>>) || {};
    const required = (schema.required as string[]) || [];

    const shape: Record<string, z.ZodTypeAny> = {};

    for (const [key, propSchema] of Object.entries(properties)) {
      const zodType = this.convertPropertyToZod(propSchema);
      shape[key] = required.includes(key) ? zodType : zodType.optional();
    }

    return z.object(shape);
  }

  /**
   * 将单个 JSON Schema 属性转换为 Zod 类型
   */
  private convertPropertyToZod(propSchema: Record<string, unknown>): z.ZodTypeAny {
    const type = propSchema.type as string;
    const description = propSchema.description as string;

    let zodType: z.ZodTypeAny;

    switch (type) {
      case 'string':
        zodType = z.string();
        break;
      case 'number':
        zodType = z.number();
        break;
      case 'integer':
        zodType = z.number().int();
        break;
      case 'boolean':
        zodType = z.boolean();
        break;
      case 'array': {
        const items = propSchema.items as Record<string, unknown>;
        if (items) {
          zodType = z.array(this.convertPropertyToZod(items));
        } else {
          zodType = z.array(z.unknown());
        }
        break;
      }
      case 'object': {
        const nestedProperties = propSchema.properties as Record<string, Record<string, unknown>>;
        if (nestedProperties) {
          const nestedRequired = (propSchema.required as string[]) || [];
          const nestedShape: Record<string, z.ZodTypeAny> = {};
          for (const [key, val] of Object.entries(nestedProperties)) {
            const nestedZod = this.convertPropertyToZod(val);
            nestedShape[key] = nestedRequired.includes(key) ? nestedZod : nestedZod.optional();
          }
          zodType = z.object(nestedShape);
        } else {
          zodType = z.record(z.string(), z.unknown());
        }
        break;
      }
      case 'null':
        zodType = z.null();
        break;
      default:
        // 处理 enum
        if (propSchema.enum && Array.isArray(propSchema.enum)) {
          const enumValues = propSchema.enum as (string | number)[];
          if (enumValues.every((v) => typeof v === 'string')) {
            zodType = z.enum(enumValues as [string, ...string[]]);
          } else if (enumValues.every((v) => typeof v === 'number')) {
            zodType = z.number().refine((val) => enumValues.includes(val));
          } else {
            zodType = z.unknown();
          }
        } else if (propSchema.anyOf || propSchema.oneOf) {
          // 处理联合类型
          const variants = (propSchema.anyOf || propSchema.oneOf) as Record<string, unknown>[];
          const zodVariants = variants.map((v) => this.convertPropertyToZod(v));
          zodType = z.union(zodVariants as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
        } else if (propSchema.allOf) {
          // 处理交叉类型
          const variants = propSchema.allOf as Record<string, unknown>[];
          // 简化处理：取第一个对象类型的 schema
          const objectVariant = variants.find((v) => v.type === 'object');
          if (objectVariant) {
            zodType = this.convertPropertyToZod(objectVariant);
          } else {
            zodType = z.unknown();
          }
        } else {
          zodType = z.unknown();
        }
    }

    // 添加描述
    if (description) {
      zodType = zodType.describe(description);
    }

    // 处理默认值
    if (propSchema.default !== undefined) {
      zodType = zodType.default(propSchema.default);
    }

    // 处理字符串约束
    if (type === 'string') {
      if (propSchema.minLength !== undefined) {
        zodType = (zodType as z.ZodString).min(propSchema.minLength as number);
      }
      if (propSchema.maxLength !== undefined) {
        zodType = (zodType as z.ZodString).max(propSchema.maxLength as number);
      }
      if (propSchema.pattern !== undefined) {
        const regex = new RegExp(propSchema.pattern as string);
        zodType = (zodType as z.ZodString).regex(regex);
      }
      if (propSchema.format === 'email') {
        zodType = (zodType as z.ZodString).email();
      }
      if (propSchema.format === 'uri' || propSchema.format === 'url') {
        zodType = (zodType as z.ZodString).url();
      }
      if (propSchema.format === 'uuid') {
        zodType = (zodType as z.ZodString).uuid();
      }
    }

    // 处理数值约束
    if (type === 'number' || type === 'integer') {
      if (propSchema.minimum !== undefined) {
        zodType = (zodType as z.ZodNumber).min(propSchema.minimum as number);
      }
      if (propSchema.maximum !== undefined) {
        zodType = (zodType as z.ZodNumber).max(propSchema.maximum as number);
      }
      if (propSchema.exclusiveMinimum !== undefined) {
        zodType = (zodType as z.ZodNumber).gt(propSchema.exclusiveMinimum as number);
      }
      if (propSchema.exclusiveMaximum !== undefined) {
        zodType = (zodType as z.ZodNumber).lt(propSchema.exclusiveMaximum as number);
      }
      if (propSchema.multipleOf !== undefined) {
        const multiple = propSchema.multipleOf as number;
        zodType = (zodType as z.ZodNumber).refine((val) => val % multiple === 0);
      }
    }

    // 处理数组约束
    if (type === 'array') {
      if (propSchema.minItems !== undefined) {
        zodType = (zodType as z.ZodArray<any>).min(propSchema.minItems as number);
      }
      if (propSchema.maxItems !== undefined) {
        zodType = (zodType as z.ZodArray<any>).max(propSchema.maxItems as number);
      }
    }

    return zodType;
  }

  /**
   * 清除所有工具
   */
  clearAllTools(): void {
    this.tools.clear();
  }

  /**
   * 获取工具数量
   */
  getToolCount(): number {
    return this.tools.size;
  }

  /**
   * 获取指定 Server 的工具数量
   */
  getServerToolCount(serverId: string): number {
    const prefix = `mcp_${serverId}_`;
    let count = 0;
    for (const name of this.tools.keys()) {
      if (name.startsWith(prefix)) {
        count++;
      }
    }
    return count;
  }
}

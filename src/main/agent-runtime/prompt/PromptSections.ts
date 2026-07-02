/**
 * PromptSections — System Prompt 分段定义。
 *
 * 每个段落是一个纯函数，接收当前 {@link PromptContext}，
 * 返回需要注入的文本片段，或返回 `null` 表示当前上下文下跳过该段落。
 *
 * 段落按 {@link DEFAULT_SECTIONS} 中的顺序拼接，形成完整的 system prompt。
 * 段落顺序遵循"静态在前、动态在后"的约定，
 * 静态段落（identity / instructions / capabilities / tools / workspace / route / permission / catalog）
 * 用于享受 LLM 的 prompt cache，
 * 动态段落（memory / rules / context）随会话推进而变化。
 */

import type { AgentRouteCapability } from '@shared/types/agentRuntime';
import type { AgentPermissionSettings } from '@shared/types/settings';
import {
  AGENT_WORKBENCH_COMMAND_CATALOG,
  AGENT_WORKBENCH_TOOL_CATALOG,
} from '@shared/constants/agentWorkbenchCatalog';

/**
 * 组装 system prompt 时使用的上下文。
 *
 * 字段全部为只读语义：段落函数不应修改其内容。
 */
export interface PromptContext {
  /** 工作目录绝对路径。 */
  workDir: string;
  /** 当前可用的工具名列表。 */
  tools: string[];
  /** 记忆索引内容（来自 `MemoryStore.getIndexContent()`）。 */
  memoryIndex?: string;
  /** 按需加载的相关记忆内容（每条为完整 Markdown 文本）。 */
  relevantMemories?: string[];
  /** 已加载的技能名列表。 */
  skills?: string[];
  /** 当前使用的模型信息。 */
  model: { provider: string; name: string };
  currentDate?: string;
  timeZone?: string;
  /** 运行模式。 */
  mode: 'ask' | 'debugger' | 'edit' | 'analyzer' | 'optimizer';
  /** 用户自定义规则（如有）。 */
  userRules?: string;
  /** 额外的自定义段落。 */
  customSections?: Array<{ title: string; content: string }>;

  // ── Profile 契约段（替代旧 PromptComposer 的 composeProfileSystemPrompt 能力）──
  /** 当前 profile 的身份与指令定义（来自 `.agent.md`）。 */
  profile: {
    agentId: string;
    agentLabel: string;
    agentDescription: string;
    baseInstructions?: string;
    globalInstructions?: string;
  };
  /** 当前路由能力（决定 tool calling 模式说明段）。 */
  routeCapability: AgentRouteCapability;
  /** 运行时权限设置（决定 readable/writable roots 说明段）。 */
  permissionSettings: AgentPermissionSettings;
  /** allowlist 展开后的工具名列表（用于 catalog 段）。 */
  allowedToolNames?: string[];
}

/** 段落函数：接收上下文，返回文本片段；返回 `null` 表示跳过。 */
export type PromptSection = (context: PromptContext) => string | null;

/**
 * Profile 身份段：基于 `.agent.md` 的 label/description 定义 agent 角色。
 *
 * 始终注入。比通用 identity 更贴合 profile 契约。
 */
export const sectionIdentity: PromptSection = (context) => {
  const { agentLabel, agentDescription } = context.profile;
  return [
    `# Identity`,
    `You are ${agentLabel}. ${agentDescription}`,
    ``,
    `Core directives:`,
    `- Act, don't explain. Prefer tool invocations over narration.`,
    `- Show concise visible work summaries and tool results only. Do not reveal hidden chain-of-thought.`,
    `- Keep output minimal. Surface only what the user needs.`,
    `- Use tools to read, write, and verify; never guess when a tool can confirm.`,
  ].join('\n');
};

/**
 * Profile 指令段：注入 `.agent.md` 的 baseInstructions 与全局 instructions。
 *
 * 两者均缺省时返回 `null`。
 */
export const sectionProfileInstructions: PromptSection = (context) => {
  const base = context.profile.baseInstructions?.trim();
  const global = context.profile.globalInstructions?.trim();
  if (!base && !global) {
    return null;
  }
  const parts: string[] = [`# Profile Instructions`];
  if (base) {
    parts.push(``, base);
  }
  if (global) {
    parts.push(``, `## Global Instructions`, global);
  }
  return parts.join('\n');
};

/**
 * 列出 agent 的核心能力，帮助 LLM 选择合适的行动路径。
 */
export const sectionCapabilities: PromptSection = () => {
  return [
    `# Capabilities`,
    `- Read and write files in the workspace.`,
    `- Execute commands via the available shell tooling.`,
    `- Search code semantically and by exact pattern.`,
    `- Manage tasks, plans, and intermediate artifacts.`,
  ].join('\n');
};

/**
 * 列出当前可用工具。
 *
 * 当工具列表为空时返回 `null`，避免向 LLM 描述一个空集合。
 */
export const sectionTools: PromptSection = (context) => {
  if (!context.tools || context.tools.length === 0) {
    return null;
  }
  const lines = context.tools.map((name) => `- ${name}`);
  return [`# Available Tools`, ...lines].join('\n');
};

/**
 * 工作环境段：工作目录、操作系统、模型、模式，以及 permission mode 相关的路径说明。
 */
export const sectionWorkspace: PromptSection = (context) => {
  const platform = process.platform ?? 'unknown';
  const shell = process.env.SHELL ?? process.env.ComSpec ?? 'unknown';
  return [
    `# Working Directory`,
    `The current project root is ${context.workDir}. Use it as the default base for relative file paths, search roots, and shell working directory.`,
    `Platform: ${platform}`,
    `Shell: ${shell}`,
    `Model: ${context.model.provider}/${context.model.name}`,
    `Mode: ${context.mode}`,
    `Current date: ${context.currentDate ?? 'unknown'}`,
    `Time zone: ${context.timeZone ?? 'local'}`,
  ].join('\n');
};

/**
 * 路由能力段：说明 tool calling 模式（native-structured vs 其它）。
 *
 * 决定模型是否应使用结构化 tool call 还是纯文本。
 */
export const sectionRouteCapability: PromptSection = (context) => {
  const cap = context.routeCapability;
  if (cap.toolCallingMode === 'native-structured') {
    return [
      `# Route Capability`,
      `Route Capability: native structured tool calling is enabled for ${cap.providerId}/${cap.modelId}.`,
      `When a tool is needed, use only the provider structured tool/function-call channel.`,
      `Do not write textual tool-call syntax in the assistant message.`,
    ].join('\n');
  }
  return [
    `# Route Capability`,
    `Route Capability: ${cap.toolCallingMode} for ${cap.providerId}/${cap.modelId}.`,
    `This route cannot execute runtime tools in the current agent loop.`,
    `Do not invent tool calls, tool results, file reads, searches, or command output.`,
    `If you need runtime information, explain what information is missing and why.`,
  ].join('\n');
};

/**
 * 权限策略段：按四模式描述 readable/writable roots 与外部路径审批规则。
 *
 * 与 runtime permission policy 对齐，让模型理解路径访问边界。
 */
export const sectionPermission: PromptSection = (context) => {
  const ps = context.permissionSettings;
  const mode = ps.mode;
  const lines = [
    `# Runtime Permission Policy`,
    `Current permission mode: ${mode}.`,
  ];

  switch (mode) {
    case 'full-access':
      lines.push(
        'Readable roots: entire local machine.',
        'Writable roots: entire local machine.',
        'Use read_file with absolute paths for files outside the current project root.',
        'Do not claim inability to read or write a local path without attempting the tool first.',
        'You may also access files outside this project root using absolute paths when calling read_file, glob, grep, or shell commands.',
      );
      break;
    case 'auto-review':
      lines.push(
        'Readable roots: current project workspace; external read paths are auto-reviewed and usually denied at medium risk.',
        'Writable roots: current project workspace; external write paths are auto-reviewed and usually denied at medium or high risk.',
        'When external access is needed, ask the user to switch to Default or Full access, or add readableRoots in Custom mode settings.',
        'If policy may deny the path, still attempt read_file with an absolute path so the runtime can record the review outcome.',
      );
      break;
    case 'custom':
      lines.push(
        `Readable roots: current project workspace plus ${formatConfiguredRoots(
          ps.readableRoots,
          'no extra configured paths',
        )}.`,
        `Writable roots: current project workspace plus ${formatConfiguredRoots(
          ps.writableRoots,
          'no extra configured paths',
        )}.`,
        'Configured readableRoots and writableRoots in settings are allowed without extra approval.',
        'For other external paths, runtime approval rules still apply based on the closest matching policy.',
        'When policy allows access, use read_file with absolute paths and do not refuse without attempting the tool.',
      );
      break;
    default:
      lines.push(
        'Readable roots: current project workspace; external paths require one-time user approval.',
        'Writable roots: current project workspace; external paths require one-time user approval.',
        'When the user asks for a file outside the project, call read_file with its absolute path and wait for runtime approval if prompted.',
        'Do not refuse or guess file contents without attempting the tool first.',
        'External files, network access, file mutation, destructive shell commands, and unrecognized commands may pause for user approval.',
      );
      break;
  }

  lines.push(
    'Routine local inspection commands can run when the runtime policy allows them.',
    'When policy allows external access, use read_file with absolute paths instead of claiming the file is unreachable.',
    'If the runtime denies or requests approval, do not route around the decision with guessed paths or textual tool calls.',
    'When you report a file path, use the absolute path that the tool actually resolved. Do not claim a path that differs from the tool result.',
  );

  return lines.join('\n');
};

function formatConfiguredRoots(roots: string[], fallback: string): string {
  return roots.length > 0 ? roots.join(', ') : fallback;
}

/**
 * 运行时 catalog 段：列出 allowlist 工具的元数据与 slash commands。
 *
 * 仅在 native-structured 路由下注入，让模型了解工具与命令的语义。
 */
export const sectionCatalog: PromptSection = (context) => {
  if (context.routeCapability.toolCallingMode !== 'native-structured') {
    return null;
  }
  const allowedNames = context.allowedToolNames ?? context.tools ?? [];
  const allowed = new Set(allowedNames);
  const toolLines = AGENT_WORKBENCH_TOOL_CATALOG
    .filter((tool) => allowed.has(tool.id))
    .map((tool) => (
      `- ${tool.id}: ${tool.label}; permission=${tool.permission}; approval=${tool.approvalRequired ? 'required' : 'not required'}; result=${tool.resultSummary}`
    ));
  const commandLines = AGENT_WORKBENCH_COMMAND_CATALOG.map((command) => (
    `- ${command.command}: ${command.description}${command.relatedTools.length ? ` Uses: ${command.relatedTools.join(', ')}` : ''}.`
  ));

  return [
    '# Runtime Catalog',
    'Only use tools exposed to this profile by the runtime. Slash commands are intent hints and never bypass profile permissions.',
    '',
    'Allowed tools:',
    ...(toolLines.length > 0 ? toolLines : ['- None.']),
    '',
    'Slash commands:',
    ...commandLines,
  ].join('\n');
};

/**
 * 注入记忆相关内容：索引摘要 + 已加载的相关记忆。
 *
 * 当 `memoryIndex` 与 `relevantMemories` 都为空时返回 `null`。
 */
export const sectionMemory: PromptSection = (context) => {
  const hasIndex =
    typeof context.memoryIndex === 'string' &&
    context.memoryIndex.trim().length > 0;
  const hasRelevant =
    Array.isArray(context.relevantMemories) &&
    context.relevantMemories.length > 0;

  if (!hasIndex && !hasRelevant) {
    return null;
  }

  const parts: string[] = [`# Memory`];

  if (hasIndex) {
    parts.push(``, `Available memories:`, context.memoryIndex!.trim());
  }

  if (hasRelevant) {
    parts.push(``, `Relevant memories:`);
    for (const mem of context.relevantMemories!) {
      parts.push(``, mem.trim());
    }
  }

  return parts.join('\n');
};

/**
 * 通用规则约束。
 *
 * 通用规则始终输出；若提供 `userRules` 则在末尾追加。
 * 该段落不会返回 `null`，因为规则是 agent 行为的硬约束。
 */
export const sectionRules: PromptSection = (context) => {
  const lines: string[] = [
    `# Rules`,
    `- Do not modify files unrelated to the current task.`,
    `- Do not delete files or perform irreversible actions without explicit confirmation.`,
    `- Minimize output: avoid re-stating tool results, prefer next actions.`,
    `- When uncertain, prefer reading existing code over guessing.`,
    `- Respect the runtime permission policy for workspace boundaries; use absolute paths when policy allows external access.`,
    `- Do not claim a file is unreachable without attempting read_file when policy permits.`,
    `- Treat latest, current, today, and recent requests as date-sensitive. Calibrate search terms and conclusions against the Current date and Time zone above.`,
    `- Use web_search to discover candidate sources; before summarizing factual current/news claims, call web_fetch on selected source pages and ground the answer in fetched page text, not snippets alone.`,
  ];

  const userRules = context.userRules?.trim();
  if (userRules && userRules.length > 0) {
    lines.push(``, `## User Rules`, userRules);
  }

  return lines.join('\n');
};

/**
 * 动态上下文段落：技能、自定义段落等。
 *
 * 当无 skills 也无 customSections 时返回 `null`。
 */
export const sectionContext: PromptSection = (context) => {
  const hasSkills =
    Array.isArray(context.skills) && context.skills.length > 0;
  const hasCustom =
    Array.isArray(context.customSections) &&
    context.customSections.length > 0;

  if (!hasSkills && !hasCustom) {
    return null;
  }

  const parts: string[] = [`# Context`];

  if (hasSkills) {
    parts.push(``, `Loaded skills:`);
    for (const name of context.skills!) {
      parts.push(`- ${name}`);
    }
  }

  if (hasCustom) {
    for (const section of context.customSections!) {
      const title = section.title?.trim() || 'Custom';
      const content = section.content?.trim() ?? '';
      parts.push(``, `## ${title}`, content);
    }
  }

  return parts.join('\n');
};

/**
 * 默认段落顺序。
 *
 * 顺序设计：
 * 1. 静态段落（命中 prompt cache）：
 *    identity → instructions → capabilities → tools → workspace
 *    → route → permission → catalog
 * 2. 动态段落（随上下文变化）：memory → rules → context
 *
 * {@link PromptAssembler} 会在静态段与动态段之间插入 `DYNAMIC_BOUNDARY` 标记。
 */
export const DEFAULT_SECTIONS: PromptSection[] = [
  sectionIdentity,
  sectionProfileInstructions,
  sectionCapabilities,
  sectionTools,
  sectionWorkspace,
  sectionRouteCapability,
  sectionPermission,
  sectionCatalog,
  sectionMemory,
  sectionRules,
  sectionContext,
];

/**
 * 静态段落数量（前 N 个段落归入静态前缀）。
 *
 * 与 {@link DEFAULT_SECTIONS} 中静态段落的数量保持一致：
 * identity/instructions/capabilities/tools/workspace/route/permission/catalog = 8。
 */
export const DEFAULT_STATIC_SECTION_COUNT = 8;

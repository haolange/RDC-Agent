/**
 * PromptSections — System Prompt 分段定义。
 *
 * 每个段落是一个纯函数，接收当前 {@link PromptContext}，
 * 返回需要注入的文本片段，或返回 `null` 表示当前上下文下跳过该段落。
 *
 * 段落按 {@link DEFAULT_SECTIONS} 中的顺序拼接，形成完整的 system prompt。
 * 段落顺序遵循"静态在前、动态在后"的约定，
 * 静态段落（identity / capabilities / tools / workspace）
 * 用于享受 LLM 的 prompt cache，
 * 动态段落（memory / rules / context）随会话推进而变化。
 */

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
  /** 运行模式。 */
  mode: 'ask' | 'debugger' | 'edit' | 'analyzer' | 'optimizer';
  /** 用户自定义规则（如有）。 */
  userRules?: string;
  /** 额外的自定义段落。 */
  customSections?: Array<{ title: string; content: string }>;
}

/** 段落函数：接收上下文，返回文本片段；返回 `null` 表示跳过。 */
export type PromptSection = (context: PromptContext) => string | null;

/**
 * 根据运行模式返回 Agent 身份描述与核心指令。
 *
 * 始终注入，定义 agent 的角色与基本行为约束（act don't explain）。
 */
export const sectionIdentity: PromptSection = (context) => {
  const identity =
    context.mode === 'debugger'
      ? 'You are a GPU debugger agent specialized in analyzing RenderDoc `.rdc` captures.'
      : context.mode === 'edit'
        ? 'You are an implementation agent that can make approved workspace changes and verify them.'
        : 'You are a coding agent. Answer questions accurately and concisely.';

  return [
    `# Identity`,
    identity,
    ``,
    `Core directives:`,
    `- Act, don't explain. Prefer tool invocations over narration.`,
    `- Keep output minimal. Surface only what the user needs.`,
    `- Use tools to read, write, and verify; never guess when a tool can confirm.`,
  ].join('\n');
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
 * 描述工作环境：工作目录、操作系统、模型等运行期信息。
 */
export const sectionWorkspace: PromptSection = (context) => {
  const platform = process.platform ?? 'unknown';
  const shell =
    process.env.SHELL ?? process.env.ComSpec ?? 'unknown';
  return [
    `# Workspace`,
    `Working directory: ${context.workDir}`,
    `Platform: ${platform}`,
    `Shell: ${shell}`,
    `Model: ${context.model.provider}/${context.model.name}`,
    `Mode: ${context.mode}`,
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
    `- Respect workspace boundaries; never escape the working directory.`,
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
 * 1. 静态段落（命中 prompt cache）：identity → capabilities → tools → workspace
 * 2. 动态段落（随上下文变化）：memory → rules → context
 *
 * {@link PromptAssembler} 会在静态段与动态段之间插入 `DYNAMIC_BOUNDARY` 标记。
 */
export const DEFAULT_SECTIONS: PromptSection[] = [
  sectionIdentity,
  sectionCapabilities,
  sectionTools,
  sectionWorkspace,
  sectionMemory,
  sectionRules,
  sectionContext,
];

/**
 * 静态段落数量（前 N 个段落归入静态前缀）。
 *
 * 与 {@link DEFAULT_SECTIONS} 中静态段落的数量保持一致。
 */
export const DEFAULT_STATIC_SECTION_COUNT = 4;

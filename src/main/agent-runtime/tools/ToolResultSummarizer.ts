import type { AgentToolResult } from '../agent/AgentTool';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nativeShellSummary(result: AgentToolResult): string | null {
  const details = asRecord(result.details);
  const identity = asRecord(details?.rdcExecutionIdentity);
  const operation = details?.operation;
  const first = result.content[0];
  if (typeof operation !== 'string' || !identity || first?.type !== 'text') return null;
  const ids = ['productSessionId', 'contextId', 'replaySessionId', 'captureFileId'];
  if (ids.some((key) => typeof identity[key] !== 'string')) return null;

  let output: Record<string, unknown>;
  try {
    output = asRecord(JSON.parse(first.text)) ?? {};
  } catch {
    return null;
  }
  const native = asRecord(output.result);
  const data = asRecord(native?.data);
  if (!native || !data || native.result_kind !== operation) return null;
  const outputIdentity = asRecord(output.rdcExecutionIdentity);
  if (!outputIdentity || ids.some((key) => outputIdentity[key] !== identity[key])) {
    return `[shell/${operation}] RDC_EXECUTION_IDENTITY_MISMATCH; inspect the full result`;
  }

  const parts = [
    `[shell/${operation}] ok=${String(native.ok)}`,
    `session=${identity.productSessionId}`,
    `context=${identity.contextId}`,
    `replay=${identity.replaySessionId}`,
    `capture=${identity.captureFileId}`,
  ];
  const meta = asRecord(native.meta);
  if (typeof meta?.trace_id === 'string') parts.push(`trace=${meta.trace_id}`);
  if (operation === 'rd.texture.get_pixel_history') {
    const target = asRecord(data.target_metadata);
    const history = Array.isArray(data.history) ? data.history.map(asRecord).filter((item) => item !== null) : [];
    const event = data.resolved_event_id;
    const eventHistory = history.filter((item) => item.event_id === event);
    const passed = eventHistory.filter((item) => item.passed === true);
    const validShader = eventHistory.filter((item) => asRecord(item.shader_out)?.valid === true);
    if (Number.isSafeInteger(event)) parts.push(`event=${event}`);
    if (typeof target?.texture_id === 'string') parts.push(`target=${target.texture_id}`);
    if (target && Number.isSafeInteger(target.x) && Number.isSafeInteger(target.y)) parts.push(`pixel=(${target.x},${target.y})`);
    parts.push(`history=${history.length}`, `eventFragments=${eventHistory.length}`, `passed=${passed.length}`, `shaderValid=${validShader.length}`);
    const primitives = passed.map((item) => item.primitive_id).filter((value) => Number.isSafeInteger(value));
    if (primitives.length > 0) parts.push(`passedPrimitiveIds=${primitives.slice(0, 8).join(',')}${primitives.length > 8 ? ',…' : ''}`);
    if (typeof data.binding_truth_level === 'string') parts.push(`binding=${data.binding_truth_level}`);
    if (typeof data.evidence_truth_level === 'string') parts.push(`evidence=${data.evidence_truth_level}`);
    if (Array.isArray(data.summary_degraded_reasons) && data.summary_degraded_reasons.length > 0) {
      parts.push(`degraded=${JSON.stringify(data.summary_degraded_reasons)}`);
    }
  }
  if (operation === 'rd.shader.get_disassembly' && native.ok === true) {
    const boundedText = (value: unknown, maxLength: number): string =>
      typeof value === 'string' && value.length <= maxLength ? value : 'unverified';
    const boundedList = (value: unknown): string[] | 'unverified' =>
      Array.isArray(value) && value.length <= 8
      && value.every((item) => typeof item === 'string' && item.length <= 64)
        ? value as string[] : 'unverified';
    if (Number.isSafeInteger(data.resolved_event_id)) parts.push(`event=${data.resolved_event_id}`);
    parts.push(`shader=${boundedText(data.shader_id, 80)}`);
    parts.push(`target=${JSON.stringify(boundedText(data.target, 80))}`);
    parts.push(`encoding=${boundedText(data.source_encoding, 40)}`);
    parts.push(`sourceHash=${boundedText(data.source_hash, 128)}`);
    const plan = asRecord(data.edit_plan);
    if (plan) {
      const knownBoolean = (value: unknown): boolean | 'unverified' =>
        typeof value === 'boolean' ? value : 'unverified';
      parts.push(`editPlan=${JSON.stringify({
        inputKind: boundedText(plan.input_kind, 64),
        canEditText: knownBoolean(plan.can_edit_text),
        canBuild: knownBoolean(plan.can_build),
        canReplace: knownBoolean(plan.can_replace),
        allowedEditInputs: boundedList(plan.allowed_edit_inputs),
        allowedOps: boundedList(plan.allowed_ops),
        blockedReason: boundedText(plan.blocked_reason, 160),
      })}`);
    } else {
      parts.push('editPlan=unverified');
    }
  }
  return parts.join(' ');
}

/**
 * ToolResultSummarizer — 工具结果规则引擎摘要。
 * 当工具结果过长时，根据规则生成精简摘要，减少上下文占用。
 */
export class ToolResultSummarizer {
  private rules: Array<{
    match: (toolName: string, result: AgentToolResult) => boolean;
    summarize: (toolName: string, result: AgentToolResult) => string;
  }> = [];

  constructor() {
    this.registerDefaultRules();
  }

  private registerDefaultRules(): void {
    const firstText = (r: AgentToolResult): string | undefined => {
      const c = r.content[0];
      return c && c.type === 'text' ? c.text : undefined;
    };
    // grep / glob 结果：只保留数量信息
    this.rules.push({
      match: (name, r) => (name === 'grep' || name === 'glob') && !!firstText(r),
      summarize: (name, r) => {
        const text = firstText(r) ?? '';
        const lines = text.split('\n').filter(Boolean);
        return `[${name}] ${lines.length} matches (truncated summary)`;
      },
    });
    // read_file 结果：只保留行数信息
    this.rules.push({
      match: (name, r) => name === 'read_file' && !!firstText(r),
      summarize: (_name, r) => {
        const text = firstText(r) ?? '';
        const lineCount = text.split('\n').length;
        return `[read_file] ${lineCount} lines (truncated summary)`;
      },
    });
    // Ordinary shell results keep a short first-line projection.
    this.rules.push({
      match: (name, r) => name === 'shell' && !!firstText(r),
      summarize: (name, r) => {
        const firstLine = firstText(r)?.split('\n')[0] ?? '';
        return `[${name}] ${firstLine.slice(0, 80)}...`;
      },
    });
    // web_fetch 结果：保留 URL / Status 头，正文省略
    this.rules.push({
      match: (name, r) => name === 'web_fetch' && !!firstText(r),
      summarize: (_name, r) => {
        const text = firstText(r) ?? '';
        const head = text
          .split('\n')
          .filter((line) => line.startsWith('URL:') || line.startsWith('Status:'))
          .slice(0, 2)
          .join(' | ');
        return `[web_fetch] ${head || text.slice(0, 100)} — ${text.length} chars body omitted (truncated summary)`;
      },
    });
    // web_search 结果：保留 query/provider/results 头 + 前 3 条标题与 URL
    this.rules.push({
      match: (name, r) => name === 'web_search' && !!firstText(r),
      summarize: (_name, r) => {
        const lines = (firstText(r) ?? '').split('\n');
        const header = lines
          .filter((line) => /^(Search query|Provider|Results):/.test(line))
          .join(' | ');
        const entries: string[] = [];
        for (let i = 0; i < lines.length && entries.length < 6; i++) {
          if (/^\d+\.\s/.test(lines[i])) {
            entries.push(lines[i].trim().slice(0, 120));
            const url = lines[i + 1]?.trim();
            if (url) entries.push(url.slice(0, 160));
          }
        }
        return `[web_search] ${header}\n${entries.slice(0, 6).join('\n')}\n(truncated summary)`;
      },
    });
    // git 族结果：保留首行 + 总行数（diff/log 正文省略）
    this.rules.push({
      match: (name, r) => name.startsWith('git_') && !!firstText(r),
      summarize: (name, r) => {
        const text = firstText(r) ?? '';
        const lines = text.split('\n');
        return `[${name}] ${lines[0].slice(0, 100)} — ${lines.length} lines (truncated summary)`;
      },
    });
    // edit 族结果（edit_file / write_file）：保留首行（路径与字节 delta 已在首行内）
    this.rules.push({
      match: (name, r) => (name === 'edit_file' || name === 'write_file') && !!firstText(r),
      summarize: (name, r) => {
        const firstLine = (firstText(r) ?? '').split('\n')[0];
        return `[${name}] ${firstLine.slice(0, 160)} (truncated summary)`;
      },
    });
  }

  /**
   * 注册自定义摘要规则。
   */
  addRule(
    match: (toolName: string, result: AgentToolResult) => boolean,
    summarize: (toolName: string, result: AgentToolResult) => string,
  ): void {
    this.rules.push({ match, summarize });
  }

  /**
   * 尝试对工具结果生成摘要。若未匹配规则或结果不长，返回 null。
   */
  trySummarize(toolName: string, result: AgentToolResult, maxChars = 500): string | null {
    const text = result.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
    if (text.length <= maxChars) return null;
    // The full native payload remains at the artifact URI; surface its main-owned
    // binding and factual counters so large readbacks remain usable in context.
    if (toolName === 'shell') {
      const native = nativeShellSummary(result);
      if (native) return native;
    }
    for (const rule of this.rules) {
      if (rule.match(toolName, result)) {
        return rule.summarize(toolName, result);
      }
    }
    return `[${toolName}] ${text.length} chars (truncated summary)`;
  }
}

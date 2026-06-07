/**
 * Cron 表达式解析器。
 *
 * 支持标准五段式 cron：minute hour day month weekday
 * 每段支持：* (任意)、数字、范围(1-5)、列表(1,3,5)、步进(* /5)
 *
 * 字段取值范围：
 * - minute: 0-59
 * - hour: 0-23
 * - day (day-of-month): 1-31
 * - month: 1-12
 * - weekday (day-of-week): 0-6（0 = Sunday，与 cron 习惯一致）
 *
 * 该模块为纯函数集合，无副作用，不持有任何状态。
 */

/**
 * 解析后的 cron 单字段表示。
 *
 * 不同 type 使用不同字段：
 * - 'any'：通配 `*`，仅 type 有效
 * - 'value'：单一值，使用 value
 * - 'range'：闭区间 [start, end]
 * - 'list'：枚举值 values（范围会被展开为离散值）
 * - 'step'：步进，由 base 与 step 组成（如 `* /5` 或 `1-30/5`）
 */
export interface CronField {
  type: 'any' | 'value' | 'range' | 'list' | 'step';
  value?: number;
  start?: number;
  end?: number;
  values?: number[];
  step?: number;
  base?: CronField;
}

/** 五段字段的取值边界 [lo, hi]。 */
const FIELD_BOUNDS: ReadonlyArray<readonly [number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day-of-month
  [1, 12], // month
  [0, 6], // day-of-week
] as const;

/** 字段名称，仅用于错误信息。 */
const FIELD_NAMES = ['minute', 'hour', 'day', 'month', 'weekday'] as const;

/**
 * 解析 cron 表达式字符串。
 *
 * @param expr 五段式 cron 表达式，空格分隔
 * @returns 解析后的五个字段 [minute, hour, day, month, weekday]
 * @throws 如果格式不合法
 */
export function parseCron(expr: string): CronField[] {
  if (typeof expr !== 'string') {
    throw new Error('Cron expression must be a string');
  }
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `Invalid cron expression: expected 5 fields, got ${parts.length} ("${expr}")`,
    );
  }
  const result: CronField[] = [];
  for (let i = 0; i < 5; i += 1) {
    const [lo, hi] = FIELD_BOUNDS[i]!;
    try {
      result.push(parseField(parts[i]!, lo, hi));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid ${FIELD_NAMES[i]} field "${parts[i]}": ${reason}`);
    }
  }
  return result;
}

/**
 * 判断给定时间是否匹配 cron 表达式。
 *
 * 实现 cron 标准的 DOM/DOW OR 语义：当 day 与 weekday 同时被显式约束时，
 * 任意一方匹配即可命中；当其中一方为 `*` 时，仅另一方需要匹配。
 *
 * @param expr cron 表达式字符串
 * @param date 要检查的时间（默认 new Date()）
 */
export function matchesCron(expr: string, date: Date = new Date()): boolean {
  const fields = parseCron(expr);
  const [minute, hour, dom, month, weekday] = fields as [
    CronField,
    CronField,
    CronField,
    CronField,
    CronField,
  ];

  if (!matchesField(minute, date.getMinutes())) return false;
  if (!matchesField(hour, date.getHours())) return false;
  if (!matchesField(month, date.getMonth() + 1)) return false;

  const domOk = matchesField(dom, date.getDate());
  const dowOk = matchesField(weekday, date.getDay());

  // DOM/DOW OR 语义：以原始字符串判定是否被显式约束
  const rawParts = expr.trim().split(/\s+/);
  const domUnconstrained = rawParts[2] === '*';
  const dowUnconstrained = rawParts[4] === '*';

  if (domUnconstrained && dowUnconstrained) return true;
  if (domUnconstrained) return dowOk;
  if (dowUnconstrained) return domOk;
  return domOk || dowOk;
}

/**
 * 判断单个字段是否匹配指定值。
 *
 * 该函数为模块内部使用，但导出以便测试与高级用例。
 */
export function matchesField(field: CronField, value: number): boolean {
  switch (field.type) {
    case 'any':
      return true;
    case 'value':
      return field.value !== undefined && value === field.value;
    case 'range':
      return (
        field.start !== undefined &&
        field.end !== undefined &&
        value >= field.start &&
        value <= field.end
      );
    case 'list':
      return Array.isArray(field.values) && field.values.includes(value);
    case 'step': {
      if (!field.step || field.step <= 0 || !field.base) return false;
      // 先校验值落在 base 描述的范围内
      if (!isWithinBase(field.base, value)) return false;
      const origin = stepOrigin(field.base);
      return (value - origin) % field.step === 0;
    }
    default:
      return false;
  }
}

// ── 内部实现 ─────────────────────────────────────────────────────────────

/**
 * 解析单段字段。
 */
function parseField(raw: string, lo: number, hi: number): CronField {
  const s = raw.trim();
  if (s.length === 0) {
    throw new Error('empty field');
  }

  // 步进：base/step（base 可以是 *、范围或单值）
  if (s.includes('/')) {
    const slashIdx = s.indexOf('/');
    const basePart = s.slice(0, slashIdx);
    const stepPart = s.slice(slashIdx + 1);
    if (!/^[0-9]+$/.test(stepPart)) {
      throw new Error(`invalid step "${stepPart}"`);
    }
    const step = Number(stepPart);
    if (step <= 0) {
      throw new Error(`step must be > 0, got ${step}`);
    }
    if (basePart.length === 0) {
      throw new Error('step expression missing base');
    }
    const base = parseField(basePart, lo, hi);
    if (base.type === 'list') {
      throw new Error('step base cannot be a list');
    }
    return { type: 'step', step, base };
  }

  // 列表：逗号分隔
  if (s.includes(',')) {
    const parts = s.split(',');
    const values: number[] = [];
    for (const part of parts) {
      const f = parseField(part, lo, hi);
      if (f.type === 'value' && f.value !== undefined) {
        values.push(f.value);
      } else if (
        f.type === 'range' &&
        f.start !== undefined &&
        f.end !== undefined
      ) {
        for (let v = f.start; v <= f.end; v += 1) values.push(v);
      } else {
        throw new Error(`invalid list element "${part}"`);
      }
    }
    // 去重并排序，便于后续匹配
    const dedup = Array.from(new Set(values)).sort((a, b) => a - b);
    return { type: 'list', values: dedup };
  }

  // 范围：start-end
  if (s.includes('-')) {
    const dashIdx = s.indexOf('-');
    const a = s.slice(0, dashIdx);
    const b = s.slice(dashIdx + 1);
    if (!/^[0-9]+$/.test(a) || !/^[0-9]+$/.test(b)) {
      throw new Error(`invalid range "${s}"`);
    }
    const start = Number(a);
    const end = Number(b);
    if (start < lo || end > hi) {
      throw new Error(`range ${s} out of bounds [${lo}-${hi}]`);
    }
    if (start > end) {
      throw new Error(`range start > end: ${s}`);
    }
    return { type: 'range', start, end };
  }

  // 通配
  if (s === '*') return { type: 'any' };

  // 单值
  if (!/^[0-9]+$/.test(s)) {
    throw new Error(`invalid value "${s}"`);
  }
  const value = Number(s);
  if (value < lo || value > hi) {
    throw new Error(`value ${value} out of bounds [${lo}-${hi}]`);
  }
  return { type: 'value', value };
}

/** 判断 value 是否落在 step.base 的取值范围内。 */
function isWithinBase(base: CronField, value: number): boolean {
  switch (base.type) {
    case 'any':
      return true;
    case 'value':
      return base.value !== undefined && value >= base.value;
    case 'range':
      return (
        base.start !== undefined &&
        base.end !== undefined &&
        value >= base.start &&
        value <= base.end
      );
    default:
      return false;
  }
}

/** 计算步进起点：`* /n` 从 0 开始；`a-b/n` 从 a 开始；`a/n` 从 a 开始。 */
function stepOrigin(base: CronField): number {
  if (base.type === 'range' && base.start !== undefined) return base.start;
  if (base.type === 'value' && base.value !== undefined) return base.value;
  return 0;
}

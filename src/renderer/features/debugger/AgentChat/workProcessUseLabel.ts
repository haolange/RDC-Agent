import { useCallback } from 'react';
import type { AppLanguage } from '@shared/types/settings';
import { useI18n, type TranslationKey } from '../../../i18n';
import { CATALOG_VERB_LABEL_KEYS } from './workProcessCatalogVerbLabels';

const LABEL_TO_KEY: Record<string, TranslationKey> = {
  '等待中': 'chat.workProcessStatusPending',
  '进行中': 'chat.workProcessStatusRunning',
  '失败': 'chat.workProcessStatusError',
  '正在思考': 'chat.workProcessThinkingStreaming',
  '已思考': 'chat.workProcessThinkingComplete',
  '收束摘要': 'chat.workProcessThinkingClosing',
  '等待审批': 'chat.workProcessApprovalPending',
  '自动检查中': 'chat.workProcessAutoReviewPending',
  '已批准': 'chat.workProcessApprovalApproved',
  '自动检查通过': 'chat.workProcessAutoReviewApproved',
  '已拒绝': 'chat.workProcessApprovalRejected',
  '自动检查拒绝': 'chat.workProcessAutoReviewRejected',
  '已取消': 'chat.workProcessApprovalCancelled',
  '已回答': 'chat.workProcessUserAnswered',
  '等待用户': 'chat.workProcessUserWaiting',
  '用户交互中断': 'chat.workProcessUserInterrupted',
  '已询问': 'chat.workProcessAskComplete',
  '正在询问': 'chat.workProcessAskRunning',
  '询问已中断': 'chat.workProcessAskInterrupted',
  '已阻断': 'chat.workProcessToolBlocked',
  '执行失败': 'chat.workProcessToolFailed',
  '等待执行': 'chat.workProcessToolPending',
  '已调用工具': 'chat.workProcessToolGenericComplete',
  '正在调用工具': 'chat.workProcessToolGenericRunning',
  '等待调用工具': 'chat.workProcessToolGenericPending',
  ...CATALOG_VERB_LABEL_KEYS,
};

const THOUGHT_FOR_PATTERN = /^已思考 · (.+)$/;

const AGGREGATE_PART_PATTERNS: Array<{
  pattern: RegExp;
  oneKey: TranslationKey;
  manyKey: TranslationKey;
}> = [
  { pattern: /^创建了 (\d+) 个文件$/, oneKey: 'chat.workProcessAggregateCreatedOne', manyKey: 'chat.workProcessAggregateCreatedMany' },
  { pattern: /^编辑了 (\d+) 个文件$/, oneKey: 'chat.workProcessAggregateEditedOne', manyKey: 'chat.workProcessAggregateEditedMany' },
  { pattern: /^删除了 (\d+) 个文件$/, oneKey: 'chat.workProcessAggregateDeletedOne', manyKey: 'chat.workProcessAggregateDeletedMany' },
  { pattern: /^读取了 (\d+) 个文件$/, oneKey: 'chat.workProcessAggregateReadOne', manyKey: 'chat.workProcessAggregateReadMany' },
  { pattern: /^运行了 (\d+) 条命令$/, oneKey: 'chat.workProcessAggregateRanOne', manyKey: 'chat.workProcessAggregateRanMany' },
  { pattern: /^搜索了 (\d+) 次$/, oneKey: 'chat.workProcessAggregateSearchedOne', manyKey: 'chat.workProcessAggregateSearchedMany' },
  { pattern: /^列出了 (\d+) 项$/, oneKey: 'chat.workProcessAggregateListedOne', manyKey: 'chat.workProcessAggregateListedMany' },
  { pattern: /^使用了 (\d+) 个工具$/, oneKey: 'chat.workProcessAggregateUsedOne', manyKey: 'chat.workProcessAggregateUsedMany' },
];

function translateThinkingLabel(
  label: string,
  language: AppLanguage,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  if (language === 'zh-CN') return label;
  const thoughtFor = label.match(THOUGHT_FOR_PATTERN);
  if (thoughtFor) return t('chat.workProcessThoughtFor', { duration: thoughtFor[1] });
  return label;
}

function translateAggregatePart(
  part: string,
  language: AppLanguage,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  if (language === 'zh-CN') return part;
  for (const { pattern, oneKey, manyKey } of AGGREGATE_PART_PATTERNS) {
    const match = part.match(pattern);
    if (!match) continue;
    const count = Number(match[1]);
    return count === 1 ? t(oneKey) : t(manyKey, { count });
  }
  return part;
}

function translateAggregateSummary(
  summary: string,
  language: AppLanguage,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  if (!summary || language === 'zh-CN') return summary;
  const separator = summary.includes('，') ? '，' : ', ';
  return summary
    .split(separator)
    .map((part) => translateAggregatePart(part.trim(), language, t))
    .join(', ');
}

export function useWorkProcessLabel() {
  const { language, t } = useI18n();
  return useCallback((label: string) => {
    const thinking = translateThinkingLabel(label, language, t);
    if (thinking !== label) return thinking;
    const aggregate = translateAggregateSummary(label, language, t);
    if (aggregate !== label) return aggregate;
    const key = LABEL_TO_KEY[label];
    return key ? t(key) : label;
  }, [language, t]);
}

import { useCallback } from 'react';
import { useI18n, type TranslationKey } from '../../../i18n';
import { CATALOG_VERB_LABEL_KEYS } from './workProcessCatalogVerbLabels';

const LABEL_TO_KEY: Record<string, TranslationKey> = {
  '等待中': 'chat.workProcessStatusPending',
  '进行中': 'chat.workProcessStatusRunning',
  '失败': 'chat.workProcessStatusError',
  '正在思考': 'chat.workProcessThinkingStreaming',
  '思考': 'chat.workProcessThinkingSummary',
  '原始思考': 'chat.workProcessThinkingRaw',
  '收束摘要': 'chat.workProcessThinkingClosing',
  '回复': 'chat.workProcessResponseTitle',
  '正在生成最终回复': 'chat.workProcessResponseGenerating',
  '回复未完成': 'chat.workProcessResponseIncomplete',
  '回复已生成': 'chat.workProcessResponseGenerated',
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
  '已阻断': 'chat.workProcessToolBlocked',
  '执行失败': 'chat.workProcessToolFailed',
  '等待执行': 'chat.workProcessToolPending',
  '已调用工具': 'chat.workProcessToolGenericComplete',
  '正在调用工具': 'chat.workProcessToolGenericRunning',
  '等待调用工具': 'chat.workProcessToolGenericPending',
  '探索': 'chat.workProcessSemanticExplore',
  '联网': 'chat.workProcessSemanticWeb',
  '修改': 'chat.workProcessSemanticChange',
  '验证': 'chat.workProcessSemanticVerify',
  '交互': 'chat.workProcessSemanticInteraction',
  '协作': 'chat.workProcessSemanticCollaboration',
  '记忆': 'chat.workProcessSemanticMemory',
  '诊断': 'chat.workProcessSemanticDiagnostic',
  '上下文压缩': 'chat.workProcessSemanticCompaction',
  '阶段思考摘要': 'chat.workProcessGroupThinking',
  ...CATALOG_VERB_LABEL_KEYS,
};

export function useWorkProcessLabel() {
  const { t } = useI18n();
  return useCallback((label: string) => {
    const key = LABEL_TO_KEY[label];
    return key ? t(key) : label;
  }, [t]);
}

import type { AgentMode } from '@shared/types/layout';
import type { AppLanguage } from '@shared/types/settings';

export function buildComposerPresentation(input: {
  language: AppLanguage;
  currentMode: AgentMode;
  currentModeLabel: string;
  hasProject: boolean;
  hasActiveDebugRun: boolean;
  isComposerBusy: boolean;
}) {
  const zh = input.language === 'zh-CN';
  const promptPlaceholder = input.currentMode === 'ask'
    ? (zh
      ? '向 Ask 描述问题、目标或需要打开的 .rdc Capture'
      : 'Ask about the issue, goal, or .rdc capture to open')
    : (zh
      ? `向 ${input.currentModeLabel} 描述目标、异常或验证需求`
      : `Describe the goal, anomaly, or verification request for ${input.currentModeLabel}`);
  const attachButtonLabel = !input.hasProject
    ? (zh
      ? '选择项目后可附加图片、文件或 .rdc Capture'
      : 'Select a project before attaching images, files, or .rdc captures')
    : (zh ? '附加图片、文件或 .rdc Capture' : 'Attach images, files, or .rdc captures');
  const stopButtonLabel = input.hasActiveDebugRun
    ? (zh ? '停止当前调试' : 'Stop current debug run')
    : (zh ? '停止当前请求' : 'Stop current request');
  const primaryButtonLabel = input.isComposerBusy
    ? stopButtonLabel
    : input.currentMode === 'ask' || input.hasActiveDebugRun
      ? (zh ? '发送' : 'Send')
      : (zh ? '开始' : 'Start');

  return {
    promptPlaceholder,
    attachButtonLabel,
    primaryButtonDescription: input.isComposerBusy
      ? stopButtonLabel
      : `${primaryButtonLabel} ${input.currentModeLabel} ${zh ? '消息' : 'message'}`,
  };
}

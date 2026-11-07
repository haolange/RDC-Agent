import type { RecoveryAction } from './ErrorRecovery';

export function recoveryStartMessage(action: RecoveryAction, attempt: number): string {
  switch (action.type) {
    case 'retry': return `provider 错误，正在重试（第 ${attempt} 次）`;
    case 'reactive_compact': return '上下文过长，正在压缩历史消息';
    case 'switch_model': return '服务过载，正在切换备用模型';
    case 'continue_prompt': return '输出被截断，正在续写';
    default: return '';
  }
}

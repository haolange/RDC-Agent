import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * 斜杠命令补全 hook（R3 合规：IPC 调用集中于此，tsx 不直接调 window.electronAPI）。
 *
 * 检测输入框文本是否以 `/` 开头，若是则提取 filterText 并暴露命令列表。
 * SlashCommandPopover 消费 filterText/visible/onSelect/onDismiss。
 */
export interface SlashCommandState {
  /** 是否应显示命令弹出层。 */
  visible: boolean;
  /** 当前过滤文本（不含前导 `/`）。 */
  filterText: string;
  /** 选中命令后执行：发送命令或填充输入。 */
  onSelect: (commandName: string) => void;
  /** 关闭弹出层。 */
  onDismiss: () => void;
}

export function useSlashCommand(
  promptValue: string,
  setPromptValue: (value: string) => void,
  onSendCommand: (commandName: string) => void,
): SlashCommandState {
  const [visible, setVisible] = useState(false);

  const filterText = useMemo(() => {
    const trimmed = promptValue.trim();
    if (!trimmed.startsWith('/')) return '';
    return trimmed.slice(1);
  }, [promptValue]);

  useEffect(() => {
    setVisible(promptValue.trim().startsWith('/') && promptValue.trim().length <= 40);
  }, [promptValue]);

  const onSelect = useCallback((commandName: string) => {
    setVisible(false);
    setPromptValue('');
    void onSendCommand(commandName);
  }, [setPromptValue, onSendCommand]);

  const onDismiss = useCallback(() => {
    setVisible(false);
  }, []);

  return { visible, filterText, onSelect, onDismiss };
}

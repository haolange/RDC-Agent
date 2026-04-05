/**
 * Layout Types - 布局与模式类型定义
 */

// Agent 工作模式
export type AgentMode = 'debugger';

// 模式配置
export interface ModeConfig {
  id: AgentMode;
  label: string;
  icon: string;           // 图标标识
  description: string;    // 简要说明
  disabled: boolean;      // 是否禁用（Coming Soon）
}

// 面板状态
export interface PanelState {
  leftSidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
  rightPanelActiveTab: string;
}

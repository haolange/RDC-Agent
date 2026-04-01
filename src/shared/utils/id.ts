/**
 * ID Generation Utilities - ID生成工具
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * 生成唯一ID
 */
export function generateId(): string {
  return uuidv4();
}

/**
 * 生成短ID（12位）
 */
export function generateShortId(): string {
  return uuidv4().replace(/-/g, '').slice(0, 12);
}

/**
 * 生成事件ID
 */
export function generateEventId(prefix: string = 'evt'): string {
  return `${prefix}-${generateShortId()}-${Date.now()}`;
}

/**
 * 生成Case ID
 */
export function generateCaseId(): string {
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).slice(2, 6);
  return `case_${timestamp}_${random}`;
}

/**
 * 生成Run ID
 */
export function generateRunId(): string {
  const random = Math.random().toString(36).slice(2, 6);
  return `run_${random}`;
}

/**
 * 生成Session ID
 */
export function generateSessionId(caseId: string, runId: string): string {
  return `sess_${sanitizeToken(caseId)}_${sanitizeToken(runId)}`;
}

/**
 * 生成Token ID
 */
export function generateTokenId(agentId: string): string {
  return `tok-${sanitizeToken(agentId)}-${generateShortId()}`;
}

/**
 * 生成Lock ID
 */
export function generateLockId(agentId: string): string {
  return `lock-${sanitizeToken(agentId)}-${generateShortId()}`;
}

/**
 * 生成Context ID
 */
export function generateContextId(): string {
  return `ctx-${generateShortId()}`;
}

/**
 * 生成Capture ID
 */
export function generateCaptureId(role: string, index: number): string {
  return `cap-${role}-${String(index).padStart(3, '0')}`;
}

/**
 * 清理Token字符串
 */
export function sanitizeToken(value: string): string {
  const text = value
    .split('')
    .map(ch => (ch.isAlphanumeric() || ch === '_' || ch === '-' ? ch : '-'))
    .join('')
    .replace(/^-+|-+$/g, '');
  return text || 'unknown';
}

// 扩展String原型用于sanitizeToken
declare global {
  interface String {
    isAlphanumeric(): boolean;
  }
}

String.prototype.isAlphanumeric = function(this: string): boolean {
  return /^[a-zA-Z0-9]$/.test(this);
};

/**
 * 获取当前时间戳（毫秒）
 */
export function nowMs(): number {
  return Date.now();
}

/**
 * 获取当前ISO时间字符串
 */
export function nowIso(): string {
  return new Date().toISOString();
}

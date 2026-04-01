/**
 * JSONL Utilities - JSONL (JSON Lines) 读写工具
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * 读取JSONL文件，返回所有事件
 */
export function readJsonl<T = unknown>(filePath: string): T[] {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    const results: T[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        results.push(JSON.parse(trimmed) as T);
      } catch {
        // 跳过解析失败的行
        continue;
      }
    }
    return results;
  } catch (error) {
    console.error(`Failed to read JSONL file: ${filePath}`, error);
    return [];
  }
}

/**
 * 追加一行JSON到JSONL文件
 */
export function appendJsonl(filePath: string, data: unknown): boolean {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const serialized = JSON.stringify(data, null, 0);

    // 检查是否已存在（避免重复）
    if (fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath, 'utf-8');
      if (existing.includes(serialized)) {
        return true; // 已存在，跳过
      }
      // 确保文件以换行结尾
      if (existing && !existing.endsWith('\n')) {
        fs.appendFileSync(filePath, '\n', 'utf-8');
      }
    }

    fs.appendFileSync(filePath, serialized + '\n', 'utf-8');
    return true;
  } catch (error) {
    console.error(`Failed to append to JSONL file: ${filePath}`, error);
    return false;
  }
}

/**
 * 写入完整的JSONL文件（覆盖）
 */
export function writeJsonl(filePath: string, items: unknown[]): boolean {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const lines = items.map(item => JSON.stringify(item, null, 0));
    fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
    return true;
  } catch (error) {
    console.error(`Failed to write JSONL file: ${filePath}`, error);
    return false;
  }
}

/**
 * 过滤JSONL中的事件
 */
export function filterJsonl<T = unknown>(
  filePath: string,
  predicate: (item: T) => boolean
): T[] {
  const items = readJsonl<T>(filePath);
  return items.filter(predicate);
}

/**
 * 统计JSONL中的事件数量
 */
export function countJsonl(filePath: string): number {
  return readJsonl(filePath).length;
}

/**
 * YAML Utilities - YAML读写工具
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse, stringify } from 'yaml';

/**
 * 读取YAML文件
 */
export function readYaml<T = unknown>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return parse(content) as T;
  } catch (error) {
    console.error(`Failed to read YAML file: ${filePath}`, error);
    return null;
  }
}

/**
 * 写入YAML文件
 */
export function writeYaml(filePath: string, data: unknown): boolean {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const content = stringify(data, {
      indent: 2,
      lineWidth: 0,
      defaultStringType: 'QUOTE_DOUBLE',
      defaultKeyType: 'PLAIN',
    });
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  } catch (error) {
    console.error(`Failed to write YAML file: ${filePath}`, error);
    return false;
  }
}

/**
 * 安全解析YAML字符串
 */
export function parseYaml<T = unknown>(content: string): T | null {
  try {
    return parse(content) as T;
  } catch (error) {
    console.error('Failed to parse YAML content', error);
    return null;
  }
}

/**
 * 安全序列化为YAML字符串
 */
export function stringifyYaml(data: unknown): string {
  return stringify(data, {
    indent: 2,
    lineWidth: 0,
  });
}

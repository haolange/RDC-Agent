/**
 * FsTools - 文件系统工具
 * 提供 fs.read、fs.glob、fs.grep 三个系统工具
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 验证并解析路径，确保在 workspace 范围内
 */
function resolveSafePath(inputPath: string, workspacePath: string): string {
  const resolved = path.resolve(workspacePath, inputPath);
  const normalizedWorkspace = path.normalize(workspacePath);
  const normalizedResolved = path.normalize(resolved);
  
  if (!normalizedResolved.startsWith(normalizedWorkspace)) {
    throw new Error(`Path "${inputPath}" is outside of workspace`);
  }
  
  return resolved;
}

/**
 * 简单的 glob 匹配实现
 */
function matchGlob(filePath: string, pattern: string): boolean {
  // 转换 glob 模式为正则表达式
  const regexPattern = pattern
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/\\\\]*')
    .replace(/\?/g, '.')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  
  const regex = new RegExp(regexPattern, 'i');
  return regex.test(filePath);
}

/**
 * 递归搜索文件
 */
function globFiles(dir: string, pattern: string, results: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(dir, fullPath);
    
    if (entry.isDirectory()) {
      // 跳过 node_modules 和隐藏目录
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
        continue;
      }
      globFiles(fullPath, pattern, results);
    } else if (entry.isFile()) {
      if (matchGlob(entry.name, pattern) || matchGlob(relativePath, pattern)) {
        results.push(fullPath);
      }
    }
  }
  
  return results;
}

/**
 * 在文件中搜索文本
 */
function grepInFile(filePath: string, pattern: string): Array<{ line: number; content: string }> {
  const results: Array<{ line: number; content: string }> = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const regex = new RegExp(pattern, 'i');
  
  lines.forEach((line, index) => {
    if (regex.test(line)) {
      results.push({ line: index + 1, content: line.trim() });
    }
  });
  
  return results;
}

/**
 * 递归 grep 搜索
 */
function grepRecursive(dir: string, pattern: string, results: Array<{ file: string; line: number; content: string }> = []): Array<{ file: string; line: number; content: string }> {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      // 跳过 node_modules 和隐藏目录
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
        continue;
      }
      grepRecursive(fullPath, pattern, results);
    } else if (entry.isFile()) {
      try {
        const matches = grepInFile(fullPath, pattern);
        matches.forEach(match => {
          results.push({
            file: fullPath,
            line: match.line,
            content: match.content
          });
        });
      } catch {
        // 忽略无法读取的文件（二进制文件等）
      }
    }
  }
  
  return results;
}

/**
 * 创建文件系统工具
 */
export function createFsTools(workspacePath: string): DynamicStructuredTool[] {
  return [
    // fs.read - 读取文件内容
    new DynamicStructuredTool({
      name: 'fs_read',
      description: 'Read file content from workspace. Returns file content as string.',
      schema: z.object({
        path: z.string().describe('Relative or absolute path to the file within workspace'),
        encoding: z.enum(['utf-8', 'base64', 'latin1']).optional().default('utf-8').describe('File encoding'),
      }),
      func: async ({ path: filePath, encoding }) => {
        try {
          const resolvedPath = resolveSafePath(filePath, workspacePath);
          
          if (!fs.existsSync(resolvedPath)) {
            return JSON.stringify({
              ok: false,
              error: { code: 'FILE_NOT_FOUND', message: `File not found: ${filePath}` }
            });
          }
          
          if (fs.statSync(resolvedPath).isDirectory()) {
            return JSON.stringify({
              ok: false,
              error: { code: 'IS_DIRECTORY', message: `Path is a directory: ${filePath}` }
            });
          }
          
          const content = fs.readFileSync(resolvedPath, encoding as BufferEncoding);
          
          return JSON.stringify({
            ok: true,
            data: {
              path: filePath,
              content: content.toString(),
              size: content.length
            }
          });
        } catch (error) {
          return JSON.stringify({
            ok: false,
            error: { 
              code: 'READ_ERROR', 
              message: error instanceof Error ? error.message : 'Unknown error' 
            }
          });
        }
      },
      metadata: { layer: 'system', originalName: 'fs.read' }
    }),

    // fs.glob - 文件匹配搜索
    new DynamicStructuredTool({
      name: 'fs_glob',
      description: 'Search files matching a glob pattern within workspace. Returns list of matching file paths.',
      schema: z.object({
        pattern: z.string().describe('Glob pattern to match (e.g., "*.ts", "**/*.json")'),
        cwd: z.string().optional().describe('Working directory relative to workspace'),
      }),
      func: async ({ pattern, cwd }) => {
        try {
          const searchDir = cwd 
            ? resolveSafePath(cwd, workspacePath)
            : workspacePath;
          
          if (!fs.existsSync(searchDir)) {
            return JSON.stringify({
              ok: false,
              error: { code: 'DIRECTORY_NOT_FOUND', message: `Directory not found: ${cwd || '.'}` }
            });
          }
          
          const files = globFiles(searchDir, pattern);
          
          // 转换为相对路径
          const relativeFiles = files.map(f => path.relative(workspacePath, f));
          
          return JSON.stringify({
            ok: true,
            data: {
              pattern,
              cwd: cwd || '.',
              matches: relativeFiles,
              count: relativeFiles.length
            }
          });
        } catch (error) {
          return JSON.stringify({
            ok: false,
            error: { 
              code: 'GLOB_ERROR', 
              message: error instanceof Error ? error.message : 'Unknown error' 
            }
          });
        }
      },
      metadata: { layer: 'system', originalName: 'fs.glob' }
    }),

    // fs.grep - 文本搜索
    new DynamicStructuredTool({
      name: 'fs_grep',
      description: 'Search text content in files. Returns matching lines with file paths and line numbers.',
      schema: z.object({
        pattern: z.string().describe('Regex pattern to search for'),
        path: z.string().describe('File or directory path relative to workspace'),
        recursive: z.boolean().optional().default(false).describe('Search recursively in directories'),
      }),
      func: async ({ pattern, path: searchPath, recursive }) => {
        try {
          const resolvedPath = resolveSafePath(searchPath, workspacePath);
          
          if (!fs.existsSync(resolvedPath)) {
            return JSON.stringify({
              ok: false,
              error: { code: 'PATH_NOT_FOUND', message: `Path not found: ${searchPath}` }
            });
          }
          
          const stats = fs.statSync(resolvedPath);
          let results: Array<{ file: string; line: number; content: string }> = [];
          
          if (stats.isFile()) {
            const matches = grepInFile(resolvedPath, pattern);
            results = matches.map(m => ({
              file: searchPath,
              line: m.line,
              content: m.content
            }));
          } else if (stats.isDirectory()) {
            if (recursive) {
              results = grepRecursive(resolvedPath, pattern);
              // 转换为相对路径
              results = results.map(r => ({
                ...r,
                file: path.relative(workspacePath, r.file)
              }));
            } else {
              return JSON.stringify({
                ok: false,
                error: { code: 'IS_DIRECTORY', message: 'Path is a directory. Use recursive=true to search directories.' }
              });
            }
          }
          
          return JSON.stringify({
            ok: true,
            data: {
              pattern,
              path: searchPath,
              recursive,
              matches: results.slice(0, 100), // 限制结果数量
              total: results.length,
              truncated: results.length > 100
            }
          });
        } catch (error) {
          return JSON.stringify({
            ok: false,
            error: { 
              code: 'GREP_ERROR', 
              message: error instanceof Error ? error.message : 'Unknown error' 
            }
          });
        }
      },
      metadata: { layer: 'system', originalName: 'fs.grep' }
    }),
  ];
}

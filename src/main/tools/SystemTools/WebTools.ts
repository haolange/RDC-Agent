/**
 * WebTools - Web 相关工具
 * 提供 web.fetch、web.search 两个系统工具
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

interface WebFetchInput {
  url: string;
  headers?: Record<string, string>;
  maxLength?: number;
}

interface WebSearchInput {
  query: string;
  maxResults?: number;
}


const MAX_RESPONSE_LENGTH = 100000; // 最大响应长度限制

/**
 * 执行 HTTP GET 请求
 */
function httpGet(url: string, headers?: Record<string, string>): Promise<{
  status: number;
  headers: Record<string, string>;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'RDC-Agent/1.0',
        'Accept': 'text/html,application/json,text/plain,*/*',
        ...headers
      },
      timeout: 30000, // 30秒超时
    };
    
    const req = client.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
        // 防止响应过大
        if (data.length > MAX_RESPONSE_LENGTH * 2) {
          req.destroy();
          reject(new Error('Response too large'));
          return;
        }
      });
      
      res.on('end', () => {
        const responseHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(res.headers)) {
          if (typeof value === 'string') {
            responseHeaders[key] = value;
          } else if (Array.isArray(value)) {
            responseHeaders[key] = value.join(', ');
          }
        }
        
        resolve({
          status: res.statusCode || 0,
          headers: responseHeaders,
          body: data
        });
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.end();
  });
}

/**
 * 截断响应内容
 */
function truncateResponse(content: string, maxLength: number = MAX_RESPONSE_LENGTH): {
  content: string;
  truncated: boolean;
  originalLength: number;
} {
  if (content.length <= maxLength) {
    return {
      content,
      truncated: false,
      originalLength: content.length
    };
  }
  
  return {
    content: content.substring(0, maxLength) + '\n... [truncated]',
    truncated: true,
    originalLength: content.length
  };
}

/**
 * 创建 Web 工具
 */
export function createWebTools(): DynamicStructuredTool[] {
  return [
    // web.fetch - HTTP GET 请求
    new DynamicStructuredTool({
      name: 'web_fetch',
      description: 'Fetch content from a URL via HTTP GET. Returns response body with status and headers.',
      schema: z.object({
        url: z.string().url().describe('URL to fetch'),
        headers: z.record(z.string(), z.string()).optional().describe('Optional HTTP headers'),
        maxLength: z.number().int().min(100).max(500000).optional().default(MAX_RESPONSE_LENGTH).describe('Maximum response length'),
      }),
      func: async ({ url, headers, maxLength = MAX_RESPONSE_LENGTH }: WebFetchInput) => {
        try {
          const response = await httpGet(url, headers);
          
          // 处理重定向
          if (response.status >= 300 && response.status < 400 && response.headers.location) {
            const redirectUrl = new URL(response.headers.location, url).toString();
            return JSON.stringify({
              ok: true,
              data: {
                url,
                status: response.status,
                redirected: true,
                redirectUrl,
                headers: response.headers,
                body: null
              }
            });
          }
          
          // 截断响应内容
          const truncated = truncateResponse(response.body, maxLength);
          
          return JSON.stringify({
            ok: true,
            data: {
              url,
              status: response.status,
              redirected: false,
              headers: response.headers,
              body: truncated.content,
              truncated: truncated.truncated,
              originalLength: truncated.originalLength
            }
          });
        } catch (error) {
          return JSON.stringify({
            ok: false,
            error: { 
              code: 'FETCH_ERROR', 
              message: error instanceof Error ? error.message : 'Unknown error' 
            }
          });
        }
      },
      metadata: { layer: 'system', originalName: 'web.fetch' }
    }),

    // web.search - Web 搜索（占位实现）
    new DynamicStructuredTool({
      name: 'web_search',
      description: 'Search the web for information. Returns search results (placeholder implementation).',
      schema: z.object({
        query: z.string().describe('Search query'),
        maxResults: z.number().int().min(1).max(20).optional().default(5).describe('Maximum number of results'),
      }),
      func: async ({ query, maxResults = 5 }: WebSearchInput) => {
        // 这是一个占位实现
        // 实际实现需要接入搜索引擎 API（如 Google Custom Search、Bing Search 等）
        
        return JSON.stringify({
          ok: true,
          data: {
            query,
            maxResults,
            results: [
              {
                title: 'Placeholder Search Result',
                url: 'https://example.com',
                snippet: 'This is a placeholder implementation. To enable real web search, configure a search API key in settings.'
              }
            ],
            note: 'Web search is using placeholder implementation. Configure search API to get real results.'
          }
        });
      },
      metadata: { layer: 'system', originalName: 'web.search' }
    }),
  ];
}

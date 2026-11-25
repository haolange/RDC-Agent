import { z } from 'zod';

/**
 * One Chat Completions stream chunk, as OpenAI-compatible and Mistral surfaces send it. Every field the adapters read
 * is validated; compatible servers send absent fields as `null` and add their own fields, which pass through.
 */
const ChatCompletionsChoiceSchema = z.object({
  index: z.number().nullish(),
  delta: z.object({
    role: z.string().nullish(),
    // Text deltas are strings; some servers stream structured content chunks, which the adapters do not read.
    content: z.union([z.string(), z.array(z.unknown())]).nullish(),
    reasoning: z.string().nullish(),
    reasoning_content: z.string().nullish(),
    tool_calls: z.array(z.object({
      index: z.number().nullish(),
      id: z.string().nullish(),
      type: z.string().nullish(),
      function: z.object({ name: z.string().nullish(), arguments: z.string().nullish() }).passthrough().nullish(),
    }).passthrough()).nullish(),
  }).passthrough().nullish(),
  finish_reason: z.string().nullish(),
}).passthrough();

export const ChatCompletionsChunkSchema = z.object({
  id: z.string().nullish(),
  model: z.string().nullish(),
  service_tier: z.string().nullish(),
  choices: z.array(ChatCompletionsChoiceSchema).nullish(),
  usage: z.object({
    prompt_tokens: z.number().nullish(),
    completion_tokens: z.number().nullish(),
    total_tokens: z.number().nullish(),
    prompt_cache_hit_tokens: z.number().nullish(),
    prompt_cache_miss_tokens: z.number().nullish(),
    prompt_tokens_details: z.object({ cached_tokens: z.number().nullish(), cache_write_tokens: z.number().nullish() }).passthrough().nullish(),
    completion_tokens_details: z.object({ reasoning_tokens: z.number().nullish() }).passthrough().nullish(),
  }).passthrough().nullish(),
}).passthrough();

export type ChatCompletionsChoice = z.infer<typeof ChatCompletionsChoiceSchema>;

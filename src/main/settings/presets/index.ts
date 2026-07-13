import type { ProviderPreset } from '@shared/types/providerCapability';
import p0 from './claude-account';
import p1 from './chatgpt-account';
import p2 from './github-copilot';
import p3 from './grok-account';
import p4 from './gemini-account';
import p5 from './qwen-account';
import p6 from './openai';
import p7 from './openai-eu';
import p8 from './openai-us';
import p9 from './anthropic';
import p10 from './google-ai-studio';
import p11 from './azure-openai';
import p12 from './bedrock';
import p13 from './vertex';
import p14 from './deepseek';
import p15 from './bailian';
import p16 from './qwen';
import p17 from './volcengine';
import p18 from './glm-cn';
import p19 from './glm-global';
import p20 from './minimax-cn';
import p21 from './minimax-global';
import p22 from './xiaomi-mimo';
import p23 from './moonshot';
import p24 from './xai';
import p25 from './groq';
import p26 from './mistral';
import p27 from './cerebras';
import p28 from './kimi-coding-plan';
import p29 from './bailian-coding-plan';
import p30 from './volcengine-coding-plan';
import p31 from './glm-cn-coding-plan';
import p32 from './glm-global-coding-plan';
import p33 from './minimax-cn-coding-plan';
import p34 from './minimax-global-coding-plan';
import p35 from './xiaomi-mimo-token-plan';
import p36 from './openrouter';
import p37 from './custom-endpoint';
import p38 from './anthropic-thirdparty';
import p39 from './302ai';
import p40 from './siliconflow';
import p41 from './litellm';
import p42 from './vercel-ai-gateway';
import p43 from './huggingface';
import p44 from './manifest';
import p45 from './ollama';
import p46 from './iflow';
import p47 from './longcat';
import p48 from './opencode-zen';
import p49 from './together-ai';
import p50 from './fireworks-ai';
import p51 from './novita-ai';
import p52 from './synthetic';
import p53 from './chutes';
import p54 from './lm-studio';
import p55 from './nvidia-nim';
import p56 from './github-models';
import p57 from './ollama-cloud';

export const PROVIDER_PRESETS = [
  p0,
  p1,
  p2,
  p3,
  p4,
  p5,
  p6,
  p7,
  p8,
  p9,
  p10,
  p11,
  p12,
  p13,
  p14,
  p15,
  p16,
  p17,
  p18,
  p19,
  p20,
  p21,
  p22,
  p23,
  p24,
  p25,
  p26,
  p27,
  p28,
  p29,
  p30,
  p31,
  p32,
  p33,
  p34,
  p35,
  p36,
  p37,
  p38,
  p39,
  p40,
  p41,
  p42,
  p43,
  p44,
  p45,
  p46,
  p47,
  p48,
  p49,
  p50,
  p51,
  p52,
  p53,
  p54,
  p55,
  p56,
  p57,
] satisfies ProviderPreset[];

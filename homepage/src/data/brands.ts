// Agents, providers and IM channels shown on the homepage. Keep this list to
// what the product actually supports (see frontend/src/components/BrandIcons.tsx).
import anthropic from '@lobehub/icons-static-svg/icons/anthropic.svg?url';
import azure from '@lobehub/icons-static-svg/icons/azure-color.svg?url';
import bedrock from '@lobehub/icons-static-svg/icons/bedrock-color.svg?url';
import cherryStudio from '@lobehub/icons-static-svg/icons/cherrystudio-color.svg?url';
import claude from '@lobehub/icons-static-svg/icons/claude-color.svg?url';
import claudeCode from '@lobehub/icons-static-svg/icons/claudecode-color.svg?url';
import codex from '@lobehub/icons-static-svg/icons/codex-color.svg?url';
import cursor from '@lobehub/icons-static-svg/icons/cursor.svg?url';
import deepseek from '@lobehub/icons-static-svg/icons/deepseek-color.svg?url';
import doubao from '@lobehub/icons-static-svg/icons/doubao-color.svg?url';
import fireworks from '@lobehub/icons-static-svg/icons/fireworks-color.svg?url';
import gemini from '@lobehub/icons-static-svg/icons/gemini-color.svg?url';
import groq from '@lobehub/icons-static-svg/icons/groq.svg?url';
import hunyuan from '@lobehub/icons-static-svg/icons/hunyuan-color.svg?url';
import kimi from '@lobehub/icons-static-svg/icons/kimi.svg?url';
import lmstudio from '@lobehub/icons-static-svg/icons/lmstudio.svg?url';
import minimax from '@lobehub/icons-static-svg/icons/minimax-color.svg?url';
import mistral from '@lobehub/icons-static-svg/icons/mistral-color.svg?url';
import modelscope from '@lobehub/icons-static-svg/icons/modelscope-color.svg?url';
import nvidia from '@lobehub/icons-static-svg/icons/nvidia-color.svg?url';
import ollama from '@lobehub/icons-static-svg/icons/ollama.svg?url';
import openai from '@lobehub/icons-static-svg/icons/openai.svg?url';
import openclaw from '@lobehub/icons-static-svg/icons/openclaw-color.svg?url';
import opencode from '@lobehub/icons-static-svg/icons/opencode.svg?url';
import openrouter from '@lobehub/icons-static-svg/icons/openrouter-color.svg?url';
import pi from '@lobehub/icons-static-svg/icons/pi.svg?url';
import qwen from '@lobehub/icons-static-svg/icons/qwen-color.svg?url';
import siliconflow from '@lobehub/icons-static-svg/icons/siliconcloud-color.svg?url';
import stepfun from '@lobehub/icons-static-svg/icons/stepfun-color.svg?url';
import together from '@lobehub/icons-static-svg/icons/together-color.svg?url';
import vertex from '@lobehub/icons-static-svg/icons/vertexai-color.svg?url';
import vllm from '@lobehub/icons-static-svg/icons/vllm-color.svg?url';
import xai from '@lobehub/icons-static-svg/icons/xai.svg?url';
import mimo from '@lobehub/icons-static-svg/icons/xiaomimimo.svg?url';
import zhipu from '@lobehub/icons-static-svg/icons/zhipu-color.svg?url';

import dingtalk from '@app-assets/icons/dingtalk.svg?url';
import feishu from '@app-assets/icons/feishu.svg?url';
import telegram from '@app-assets/icons/telegram.svg?url';
import vscode from '@app-assets/icons/vscode.svg?url';
import wecom from '@app-assets/icons/wecom.svg?url';
import weixin from '@app-assets/icons/weixin.svg?url';
import xcode from '@app-assets/icons/xcode.svg?url';

export interface Brand {
  name: string;
  icon: string;
}

export const AGENTS: Brand[] = [
  { name: 'Claude Code', icon: claudeCode },
  { name: 'Claude Desktop', icon: claude },
  { name: 'Codex', icon: codex },
  { name: 'OpenCode', icon: opencode },
  { name: 'Cursor', icon: cursor },
  { name: 'Xcode', icon: xcode },
  { name: 'VS Code', icon: vscode },
  { name: 'Pi', icon: pi },
  { name: 'OpenClaw', icon: openclaw },
  { name: 'Cherry Studio', icon: cherryStudio },
  { name: 'OpenAI SDK', icon: openai },
  { name: 'Anthropic SDK', icon: anthropic },
];

export const PROVIDERS: Brand[] = [
  { name: 'Anthropic', icon: anthropic },
  { name: 'OpenAI', icon: openai },
  { name: 'Gemini', icon: gemini },
  { name: 'DeepSeek', icon: deepseek },
  { name: 'Qwen', icon: qwen },
  { name: 'Kimi', icon: kimi },
  { name: 'Zhipu', icon: zhipu },
  { name: 'MiniMax', icon: minimax },
  { name: 'xAI', icon: xai },
  { name: 'Mistral', icon: mistral },
  { name: 'OpenRouter', icon: openrouter },
  { name: 'Groq', icon: groq },
  { name: 'Doubao', icon: doubao },
  { name: 'Hunyuan', icon: hunyuan },
  { name: 'Bedrock', icon: bedrock },
  { name: 'Azure', icon: azure },
  { name: 'Vertex AI', icon: vertex },
  { name: 'NVIDIA', icon: nvidia },
  { name: 'SiliconFlow', icon: siliconflow },
  { name: 'StepFun', icon: stepfun },
  { name: 'ModelScope', icon: modelscope },
  { name: 'Xiaomi MiMo', icon: mimo },
  { name: 'Fireworks', icon: fireworks },
  { name: 'Together', icon: together },
  { name: 'Ollama', icon: ollama },
  { name: 'vLLM', icon: vllm },
  { name: 'LM Studio', icon: lmstudio },
];

// Remote-control channels. Slack and Discord are not shipped yet — add them
// back here once they are.
export const CHANNELS: Brand[] = [
  { name: 'Telegram', icon: telegram },
  { name: 'Weixin', icon: weixin },
  { name: 'WeCom', icon: wecom },
  { name: 'Feishu / Lark', icon: feishu },
  { name: 'DingTalk', icon: dingtalk },
];

export const byName = (list: Brand[], name: string): Brand => {
  const found = list.find((b) => b.name === name);
  if (!found) throw new Error(`unknown brand: ${name}`);
  return found;
};

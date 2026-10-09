import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv() {
  const file = join(ROOT, '.env');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const BASE = () => process.env.LLMGW_BASE_URL || 'https://discovery-api.intern-ai.org.cn/v1';

export function requireKey() {
  const key = process.env.LLMGW_API_KEY;
  if (!key) throw new Error('缺少 LLMGW_API_KEY：请在项目根目录建 .env（参考 .env.example）');
  return key;
}

/**
 * OpenAI 兼容 chat 调用（书生 discovery-api 网关）。
 * 网关坑位实测：思考模型的 reasoning 与正文共用 max_tokens 预算，
 * 正文可能被推理吃空 —— 此时回落到 reasoning_content，不丢弃已经想好的内容。
 */
export async function chat({ model, messages, temperature = 0.8, maxTokens = 16000, thinking = true, json = false, timeoutMs = 600000 }) {
  const body = { model, messages, temperature, max_tokens: maxTokens };
  if (!thinking) {
    body.thinking = { type: 'disabled' };
    body.reasoning_effort = 'low';
  }
  if (json) body.response_format = { type: 'json_object' };

  const t0 = Date.now();
  const res = await fetch(`${BASE()}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${requireKey()}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`网关 ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const choice = data.choices?.[0];
  if (!choice) throw new Error(`响应缺少 choices: ${JSON.stringify(data).slice(0, 300)}`);

  const reasoning = choice.message.reasoning_content || '';
  let content = choice.message.content || '';
  let recovered = false;
  if (!content.trim() && reasoning.trim()) { content = reasoning; recovered = true; }

  return {
    model,
    text: content.trim(),
    reasoning,
    truncated: choice.finish_reason === 'length',
    recoveredFromReasoning: recovered,
    elapsedMs: Date.now() - t0,
    usage: data.usage || {},
  };
}

export async function listModels() {
  const res = await fetch(`${BASE()}/models`, { headers: { authorization: `Bearer ${requireKey()}` } });
  if (!res.ok) throw new Error(`网关 ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

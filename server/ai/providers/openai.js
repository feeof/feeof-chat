'use strict';

// OpenAI-compatible Chat Completions API (OpenAI, DeepSeek, Qwen/DashScope,
// Kimi, Zhipu GLM, Ollama, vLLM and other gateways that speak this format).

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);

class ProviderHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Accepts a base URL ending in `/v1` (the usual form) or the full endpoint. */
function endpointUrl(baseUrl) {
  const base = (baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((p) => p && p.type === 'text').map((p) => p.text).join('');
  return '';
}

// Some reasoning models inline their reasoning as <think>...</think>.
function stripThinking(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

function parseArguments(raw) {
  if (raw && typeof raw === 'object') return raw;
  try {
    const value = JSON.parse(raw || '{}');
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function describeError(err) {
  if (!(err instanceof ProviderHttpError)) return null;
  if (err.status === 401 || err.status === 403) return `API Key 无效或没有权限（${err.status}）：${err.message}`;
  if (err.status === 404) return `接口地址或模型名称不正确（404）：${err.message}`;
  if (err.status === 429) return `请求过于频繁或额度不足（429）：${err.message}`;
  if (err.status === 400) return `请求被拒绝（400）：${err.message}`;
  if (err.status === 0) return err.message;
  return `接口错误（${err.status}）：${err.message}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class OpenAiProvider {
  constructor({ apiKey, baseUrl, model, maxTokens, vision, fetchImpl, timeoutMs = 90 * 1000 }) {
    this.url = endpointUrl(baseUrl);
    this.apiKey = apiKey;
    this.model = model;
    this.maxTokens = maxTokens;
    this.vision = Boolean(vision);
    this.fetch = fetchImpl || globalThis.fetch;
    this.timeoutMs = timeoutMs;
  }

  get supportsImages() {
    return this.vision;
  }

  /** POSTs to the endpoint, retrying once on network errors, timeouts and 429/5xx. */
  async post(body) {
    const headers = { 'content-type': 'application/json' };
    // Local servers such as Ollama need no key.
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let res;
      try {
        res = await this.fetch(this.url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
      } catch (err) {
        if (attempt === 0) {
          await sleep(1000);
          continue;
        }
        throw new ProviderHttpError(0, err.name === 'AbortError' ? '请求超时' : `无法连接到 API 地址：${err.message}`);
      } finally {
        clearTimeout(timer);
      }
      const data = await res.json().catch(() => null);
      if (res.ok && data) return data;
      if (attempt === 0 && RETRYABLE.has(res.status)) {
        await sleep(1000);
        continue;
      }
      const message = (data && (data.error?.message || data.message)) || `HTTP ${res.status}`;
      throw new ProviderHttpError(res.ok ? 502 : res.status, res.ok ? `返回内容无法解析：${message}` : message);
    }
  }

  toMessage(message) {
    if (message.role === 'assistant') {
      return { role: 'assistant', content: message.parts.map((p) => p.text).join('\n') };
    }
    const parts = message.parts.map((part) =>
      part.type === 'image'
        ? { type: 'image_url', image_url: { url: `data:${part.mediaType};base64,${part.data}` } }
        : { type: 'text', text: part.text },
    );
    // Plain string content is the most widely supported form.
    if (parts.every((p) => p.type === 'text')) return { role: 'user', content: parts.map((p) => p.text).join('\n') };
    return { role: 'user', content: parts };
  }

  createSession({ stablePrompt, dynamicPrompt, tools, messages }) {
    // One system message with the stable part first, so providers that cache
    // prompt prefixes automatically can reuse it.
    const native = [
      { role: 'system', content: dynamicPrompt ? `${stablePrompt}\n\n${dynamicPrompt}` : stablePrompt },
      ...messages.map((m) => this.toMessage(m)),
    ];
    const toolDefs = tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));

    return {
      send: async () => {
        const body = { model: this.model, messages: native, max_tokens: this.maxTokens };
        if (toolDefs.length) body.tools = toolDefs;
        const data = await this.post(body);
        const choice = data.choices && data.choices[0];
        if (!choice || !choice.message) throw new ProviderHttpError(502, '返回内容中没有回复');
        const msg = choice.message;
        if (choice.finish_reason === 'content_filter' || msg.refusal) return { stop: 'refusal', text: '', toolCalls: [] };
        const rawCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls.filter((c) => c && c.function) : [];
        native.push({ role: 'assistant', content: msg.content ?? null, ...(rawCalls.length ? { tool_calls: rawCalls } : {}) });
        const toolCalls = rawCalls.map((c) => ({ id: c.id, name: c.function.name, input: parseArguments(c.function.arguments) }));
        let stop = 'end';
        if (toolCalls.length) stop = 'tool';
        else if (choice.finish_reason === 'length') stop = 'length';
        return { stop, text: stripThinking(textOf(msg.content)), toolCalls };
      },
      addToolResults: (results) => {
        for (const r of results) native.push({ role: 'tool', tool_call_id: r.id, content: r.content });
      },
    };
  }
}

module.exports = { OpenAiProvider, ProviderHttpError, DEFAULT_BASE_URL, describeError, endpointUrl };

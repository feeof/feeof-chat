'use strict';

const { Anthropic } = require('@anthropic-ai/sdk');

const DEFAULT_MODEL = 'claude-opus-5-5';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';
// Models that accept the `fallbacks: "default"` server-side refusal fallback.
const FALLBACK_MODELS = /^claude-(opus-5|opus-5-5|fable-5-1|sonnet-5-5)$/;

/** The SDK appends `/v1/messages` itself, so accept URLs with or without `/v1`. */
function normalizeBaseUrl(url) {
  return url ? url.trim().replace(/\/+$/, '').replace(/\/v1$/, '') : '';
}

function isOfficialEndpoint(baseUrl) {
  if (!baseUrl) return true;
  try {
    return new URL(baseUrl).host === new URL(DEFAULT_BASE_URL).host;
  } catch {
    return false;
  }
}

/**
 * Drops content that must not be echoed back after a server-side refusal
 * fallback: before the last `fallback` marker only text blocks are kept.
 */
function echoableContent(content) {
  const boundary = content.map((b) => b.type).lastIndexOf('fallback');
  return content.filter((block, i) => block.type !== 'fallback' && (i > boundary || block.type === 'text'));
}

function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return 'API Key 无效或没有权限';
  }
  if (err instanceof Anthropic.NotFoundError) return `接口地址或模型名称不正确（404）：${err.message}`;
  if (err instanceof Anthropic.RateLimitError) return '请求过于频繁（429），已达到速率限制';
  if (err instanceof Anthropic.APIConnectionError) return '无法连接到 API 地址，请检查地址和服务器网络';
  if (err instanceof Anthropic.BadRequestError) return `请求被拒绝（400）：${err.message}`;
  if (err instanceof Anthropic.APIError) return `API 错误（${err.status ?? '未知'}）：${err.message}`;
  return null;
}

/** Claude through the Anthropic Messages API (official SDK). */
class AnthropicProvider {
  constructor({ client, apiKey, baseUrl, model, effort, maxTokens, fallbacks }) {
    const base = normalizeBaseUrl(baseUrl);
    this.model = model || DEFAULT_MODEL;
    this.effort = effort;
    this.maxTokens = maxTokens;
    // Without an explicit key the SDK reads ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN.
    this.client =
      client ||
      new Anthropic({
        ...(apiKey ? { apiKey } : {}),
        ...(base ? { baseURL: base } : {}),
        // A visitor is waiting: fail over to a human rather than retrying for minutes.
        timeout: 90 * 1000,
        maxRetries: 1,
      });
    // Proxies and gateways may not know the beta parameter, so only use it against the official API.
    this.fallbacks = Boolean(fallbacks && isOfficialEndpoint(base) && FALLBACK_MODELS.test(this.model));
  }

  get supportsImages() {
    return true;
  }

  toMessage(message) {
    return {
      role: message.role,
      content: message.parts.map((part) =>
        part.type === 'image'
          ? { type: 'image', source: { type: 'base64', media_type: part.mediaType, data: part.data } }
          : { type: 'text', text: part.text },
      ),
    };
  }

  params({ system, tools, messages }) {
    const params = { model: this.model, max_tokens: this.maxTokens, system, messages };
    if (tools.length) params.tools = tools;
    if (this.effort) params.output_config = { effort: this.effort };
    // Server-side refusal fallback: a classifier decline is retried on the
    // model Anthropic recommends for that category instead of failing.
    if (this.fallbacks) {
      params.betas = ['server-side-fallback-2026-07-01'];
      params.fallbacks = 'default';
    }
    return params;
  }

  /**
   * The stable prompt carries the cache breakpoint; per-question content
   * comes after it so it never invalidates the cached prefix.
   */
  createSession({ stablePrompt, dynamicPrompt, tools, messages }) {
    const system = [{ type: 'text', text: stablePrompt, cache_control: { type: 'ephemeral' } }];
    if (dynamicPrompt) system.push({ type: 'text', text: dynamicPrompt });
    const toolDefs = tools.map((t) => ({
      name: t.name,
      description: t.description,
      strict: true,
      input_schema: t.parameters,
    }));
    const native = messages.map((m) => this.toMessage(m));

    return {
      send: async () => {
        const response = await this.client.beta.messages.create(this.params({ system, tools: toolDefs, messages: native }));
        if (response.stop_reason === 'refusal') return { stop: 'refusal', text: '', toolCalls: [] };
        native.push({ role: 'assistant', content: echoableContent(response.content) });
        const text = response.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('')
          .trim();
        const toolCalls = response.content
          .filter((b) => b.type === 'tool_use')
          .map((b) => ({ id: b.id, name: b.name, input: b.input }));
        let stop = 'end';
        if (response.stop_reason === 'tool_use' && toolCalls.length) stop = 'tool';
        else if (response.stop_reason === 'max_tokens') stop = 'length';
        return { stop, text, toolCalls };
      },
      addToolResults: (results) => {
        native.push({
          role: 'user',
          content: results.map((r) => ({
            type: 'tool_result',
            tool_use_id: r.id,
            content: r.content,
            ...(r.isError ? { is_error: true } : {}),
          })),
        });
      },
    };
  }
}

module.exports = { AnthropicProvider, DEFAULT_MODEL, DEFAULT_BASE_URL, echoableContent, describeError, normalizeBaseUrl };

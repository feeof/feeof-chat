import { h, clear } from '/shared/dom.js';
import { get, post, put } from './api.js';
import { button, field, toast, toastError } from './ui.js';

export const PROVIDER_LABELS = { anthropic: 'Anthropic（Claude）', openai: 'OpenAI 兼容' };

const PROVIDERS = {
  anthropic: {
    label: 'Anthropic（Claude）',
    defaultBaseUrl: 'https://api.anthropic.com',
    baseUrlHint: '留空使用官方地址。通过代理或网关访问时填写其地址，例如 https://your-gateway.example.com',
    modelPlaceholder: 'claude-opus-5-5',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    modelHint: '留空使用 claude-opus-5-5',
  },
  openai: {
    label: 'OpenAI 兼容',
    defaultBaseUrl: 'https://api.openai.com/v1',
    baseUrlHint: '填写到 /v1 为止，例如 https://api.deepseek.com/v1；本机 Ollama 为 http://localhost:11434/v1',
    modelPlaceholder: '例如 deepseek-chat、qwen-plus',
    models: [],
    modelHint: '填写服务商提供的模型名称；模型需要支持工具调用（function calling）',
  },
};

const EFFORTS = [
  ['', '不指定（使用模型默认）'],
  ['low', 'low：最快，适合客服问答'],
  ['medium', 'medium'],
  ['high', 'high'],
  ['xhigh', 'xhigh'],
  ['max', 'max：最深入，最慢'],
];

/**
 * Settings card for the AI interface: type, address, key, model.
 * The key is write-only: the server only ever returns a masked hint.
 */
export function aiConnectionCard({ onSaved } = {}) {
  const card = h('section', { class: 'card form ai-connection' }, h('p', { class: 'cell-sub' }, '加载中…'));

  function render(conn) {
    const provider = h(
      'select',
      { 'aria-label': '接口类型' },
      Object.entries(PROVIDERS).map(([value, p]) => h('option', { value }, p.label)),
    );
    provider.value = conn.provider;
    const baseUrl = h('input', { value: conn.base_url, maxlength: 500, inputmode: 'url', autocomplete: 'off' });
    const apiKey = h('input', { type: 'password', maxlength: 1000, autocomplete: 'new-password' });
    const datalist = h('datalist', { id: 'ai-model-options' });
    const model = h('input', { value: conn.model, maxlength: 200, list: 'ai-model-options', autocomplete: 'off' });
    const effort = h('select', null, EFFORTS.map(([value, label]) => h('option', { value }, label)));
    effort.value = conn.effort || '';
    const vision = h('input', { type: 'checkbox', checked: conn.vision });
    // field() wraps hints in .field-hint already.
    const baseUrlHint = h('span');
    const modelHint = h('span');
    const keyHint = h('span');
    const result = h('div', { class: 'ping-result', role: 'status' });

    const effortField = field('推理强度', effort, '只对支持 effort 参数的 Claude 模型有效；其他模型请选“不指定”');
    const visionField = h('label', { class: 'check' }, vision, '模型支持图片输入（访客发送的截图会交给模型）');

    if (conn.api_key_set) {
      const source = conn.api_key_source === 'env' ? '，来自服务器环境变量' : '';
      keyHint.textContent = `已设置（${conn.api_key_hint}${source}），留空保持不变`;
      apiKey.placeholder = '输入新的 Key 以替换';
    } else {
      keyHint.textContent = '尚未设置';
      apiKey.placeholder = 'sk-...';
    }
    const clearKey =
      conn.api_key_source === 'settings'
        ? h('button', { type: 'button', class: 'link-btn', onclick: () => save({ clear_api_key: true }) }, '清除已保存的 Key')
        : null;

    function syncProvider() {
      const p = PROVIDERS[provider.value];
      baseUrl.placeholder = p.defaultBaseUrl;
      baseUrlHint.textContent = p.baseUrlHint;
      model.placeholder = p.modelPlaceholder;
      modelHint.textContent = p.modelHint;
      clear(datalist, p.models.map((m) => h('option', { value: m })));
      effortField.hidden = provider.value !== 'anthropic';
      visionField.hidden = provider.value !== 'openai';
    }

    provider.addEventListener('change', () => {
      // A Claude model name means nothing to another interface, and vice versa.
      const isClaude = /^claude-/.test(model.value.trim());
      if ((provider.value === 'openai' && isClaude) || (provider.value === 'anthropic' && model.value && !isClaude)) {
        model.value = '';
      }
      syncProvider();
    });
    syncProvider();

    function values() {
      const body = {
        provider: provider.value,
        base_url: baseUrl.value.trim(),
        model: model.value.trim(),
      };
      if (provider.value === 'anthropic') body.effort = effort.value;
      if (provider.value === 'openai') body.vision = vision.checked;
      if (apiKey.value.trim()) body.api_key = apiKey.value.trim();
      return body;
    }

    async function save(extra = {}) {
      try {
        const { connection } = await put('/api/admin/ai/connection', { ...values(), ...extra });
        toast(extra.clear_api_key ? '已清除 API Key' : 'AI 接口已保存', 'success');
        render(connection);
        if (onSaved) onSaved(connection);
        return true;
      } catch (err) {
        toastError(err);
        return false;
      }
    }

    async function saveAndTest(event) {
      const btn = event.currentTarget;
      btn.disabled = true;
      try {
        if (!(await save())) return;
        const output = card.querySelector('.ping-result');
        clear(output, h('span', { class: 'cell-sub' }, '正在测试…'));
        const { result: r } = await post('/api/admin/ai/ping');
        const seconds = (r.latency_ms / 1000).toFixed(1);
        clear(
          output,
          r.ok
            ? h('span', { class: 'text-ok' }, `连接成功（${seconds} 秒）${r.reply ? `：${r.reply}` : ''}`)
            : h('span', { class: 'text-warn' }, `连接失败：${r.error}`),
        );
      } catch (err) {
        toastError(err);
      } finally {
        btn.disabled = false;
      }
    }

    const form = h(
      'form',
      { class: 'form', onsubmit: (e) => e.preventDefault() },
      field('接口类型', provider, 'OpenAI、DeepSeek、通义千问、Kimi、智谱、Ollama 等都提供 OpenAI 兼容接口'),
      field('API 地址', baseUrl, baseUrlHint),
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field-label' }, 'API Key'),
        apiKey,
        h('span', { class: 'field-hint' }, keyHint, clearKey ? ' · ' : null, clearKey),
      ),
      field('模型名称', model, modelHint),
      datalist,
      effortField,
      visionField,
      h(
        'div',
        { class: 'form-actions start' },
        button('保存', { onClick: () => save() }),
        button('保存并测试连接', { variant: 'primary', onClick: saveAndTest }),
      ),
      result,
    );
    clear(
      card,
      h('h3', null, 'AI 接口'),
      h('p', { class: 'page-tip' }, 'AI 客服调用的大模型接口。API Key 只保存在服务器上，页面中不会显示完整内容。'),
      form,
    );
  }

  get('/api/admin/ai/connection')
    .then(({ connection }) => render(connection))
    .catch((err) => {
      clear(card, h('p', { class: 'text-warn' }, err.message));
    });
  return card;
}

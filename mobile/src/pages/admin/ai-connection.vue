<template>
  <view v-if="conn">
    <view class="page-pad small muted">AI 客服调用的大模型接口。API Key 只保存在服务器上，这里不会显示完整内容。</view>
    <view class="card">
      <view class="field">
        <view class="field-label">接口类型</view>
        <picker mode="selector" :range="PROVIDER_LIST" range-key="label" :value="providerIndex" @change="changeProvider">
          <view class="input picker-value">
            <text>{{ PROVIDER_LIST[providerIndex].label }}</text>
            <text class="cell-arrow">›</text>
          </view>
        </picker>
        <view class="field-hint">OpenAI、DeepSeek、通义千问、Kimi、智谱、Ollama 等都提供 OpenAI 兼容接口</view>
      </view>
      <view class="field">
        <view class="field-label">API 地址</view>
        <input v-model="form.base_url" class="input" type="text" maxlength="500" :placeholder="provider.defaultBaseUrl" />
        <view class="field-hint">{{ provider.baseUrlHint }}</view>
      </view>
      <view class="field">
        <view class="field-label">API Key</view>
        <input v-model="form.api_key" class="input" type="text" password maxlength="1000" :placeholder="conn.api_key_set ? '输入新的 Key 以替换' : 'sk-...'" />
        <view class="field-hint">
          {{ keyHint }}
          <text v-if="conn.api_key_source === 'settings'" class="link-text" @tap="clearKey"> · 清除已保存的 Key</text>
        </view>
      </view>
      <view class="field">
        <view class="field-label">模型名称</view>
        <input v-model="form.model" class="input" type="text" maxlength="200" :placeholder="provider.modelPlaceholder" />
        <view v-if="provider.models.length" class="model-chips">
          <text v-for="m in provider.models" :key="m" :class="['chip', 'model-chip', form.model === m ? 'chip-active' : '']" @tap="form.model = m">{{ m }}</text>
        </view>
        <view class="field-hint">{{ provider.modelHint }}</view>
      </view>
      <view v-if="form.provider === 'anthropic'" class="field">
        <view class="field-label">推理强度</view>
        <picker mode="selector" :range="EFFORTS" range-key="label" :value="effortIndex" @change="form.effort = EFFORTS[$event.detail.value].value">
          <view class="input picker-value">
            <text>{{ EFFORTS[effortIndex].label }}</text>
            <text class="cell-arrow">›</text>
          </view>
        </picker>
        <view class="field-hint">只对支持 effort 参数的 Claude 模型有效；其他模型请选“不指定”</view>
      </view>
      <view v-if="form.provider === 'openai'" class="field switch-row">
        <view class="grow">
          <view>模型支持图片输入</view>
          <view class="field-hint">访客发送的截图会交给模型</view>
        </view>
        <switch :checked="form.vision" color="#2563eb" @change="form.vision = $event.detail.value" />
      </view>
    </view>

    <view v-if="result" class="page-pad">
      <text :class="result.ok ? 'text-ok' : 'text-warn'">{{ result.text }}</text>
    </view>

    <view class="actions">
      <button class="btn btn-primary btn-block" :disabled="busy" @tap="saveAndTest">{{ testing ? '正在测试…' : '保存并测试连接' }}</button>
      <button class="btn btn-block" :disabled="busy" @tap="save()">仅保存</button>
    </view>
  </view>
  <view v-else class="empty">{{ error || '加载中…' }}</view>
</template>

<script setup>
import { ref, reactive, computed } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { get, post, put, showError } from '../../api/http';

const PROVIDERS = {
  anthropic: {
    label: 'Anthropic（Claude）',
    defaultBaseUrl: 'https://api.anthropic.com',
    baseUrlHint: '留空使用官方地址。通过代理或网关访问时填写其地址',
    modelPlaceholder: 'claude-opus-5-5',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    modelHint: '留空使用 claude-opus-5-5',
  },
  openai: {
    label: 'OpenAI 兼容',
    defaultBaseUrl: 'https://api.openai.com/v1',
    baseUrlHint: '填写到 /v1 为止，例如 https://api.deepseek.com/v1',
    modelPlaceholder: '例如 deepseek-chat、qwen-plus',
    models: [],
    modelHint: '填写服务商提供的模型名称；模型需要支持工具调用（function calling）',
  },
};
const PROVIDER_LIST = Object.entries(PROVIDERS).map(([value, p]) => ({ value, label: p.label }));
const EFFORTS = [
  { value: '', label: '不指定（使用模型默认）' },
  { value: 'low', label: 'low：最快，适合客服问答' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'xhigh', label: 'xhigh' },
  { value: 'max', label: 'max：最深入，最慢' },
];

const conn = ref(null);
const error = ref('');
const saving = ref(false);
const testing = ref(false);
const result = ref(null);
const form = reactive({ provider: 'anthropic', base_url: '', api_key: '', model: '', effort: '', vision: false });

const provider = computed(() => PROVIDERS[form.provider]);
const providerIndex = computed(() => Math.max(0, PROVIDER_LIST.findIndex((p) => p.value === form.provider)));
const effortIndex = computed(() => Math.max(0, EFFORTS.findIndex((e) => e.value === (form.effort || ''))));
const busy = computed(() => saving.value || testing.value);
const keyHint = computed(() => {
  const c = conn.value;
  if (!c.api_key_set) return '尚未设置';
  return `已设置（${c.api_key_hint}${c.api_key_source === 'env' ? '，来自服务器环境变量' : ''}），留空保持不变`;
});

function fill(c) {
  conn.value = c;
  Object.assign(form, {
    provider: c.provider,
    base_url: c.base_url || '',
    api_key: '',
    model: c.model || '',
    effort: c.effort || '',
    vision: Boolean(c.vision),
  });
}

function changeProvider(event) {
  const next = PROVIDER_LIST[event.detail.value].value;
  // A Claude model name means nothing to another interface, and vice versa.
  const isClaude = /^claude-/.test(form.model.trim());
  if ((next === 'openai' && isClaude) || (next === 'anthropic' && form.model && !isClaude)) form.model = '';
  form.provider = next;
}

onLoad(async () => {
  try {
    const { connection } = await get('/api/admin/ai/connection');
    fill(connection);
  } catch (err) {
    error.value = err.message;
  }
});

async function save(extra = {}) {
  const body = { provider: form.provider, base_url: form.base_url.trim(), model: form.model.trim() };
  if (form.provider === 'anthropic') body.effort = form.effort;
  if (form.provider === 'openai') body.vision = form.vision;
  if (form.api_key.trim()) body.api_key = form.api_key.trim();
  saving.value = true;
  try {
    const { connection } = await put('/api/admin/ai/connection', { ...body, ...extra });
    fill(connection);
    uni.showToast({ title: extra.clear_api_key ? '已清除 API Key' : '已保存', icon: 'success' });
    return true;
  } catch (err) {
    showError(err);
    return false;
  } finally {
    saving.value = false;
  }
}

async function saveAndTest() {
  result.value = null;
  if (!(await save())) return;
  testing.value = true;
  try {
    const { result: r } = await post('/api/admin/ai/ping');
    const seconds = (r.latency_ms / 1000).toFixed(1);
    result.value = r.ok
      ? { ok: true, text: `连接成功（${seconds} 秒）${r.reply ? `：${r.reply}` : ''}` }
      : { ok: false, text: `连接失败：${r.error}` };
  } catch (err) {
    showError(err);
  } finally {
    testing.value = false;
  }
}

function clearKey() {
  uni.showModal({
    title: '清除 API Key',
    content: '清除后 AI 客服将无法工作，直到重新填写。',
    confirmText: '清除',
    confirmColor: '#dc2626',
    success: (res) => {
      if (res.confirm) save({ clear_api_key: true });
    },
  });
}
</script>

<style>
.model-chips {
  display: flex;
  flex-wrap: wrap;
  margin-top: 8px;
}
.model-chip {
  margin: 0 6px 6px 0;
  font-size: 12px;
  line-height: 24px;
  padding: 0 10px;
  border-radius: 12px;
}
.link-text {
  color: var(--brand);
}
</style>

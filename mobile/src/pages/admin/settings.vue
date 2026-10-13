<template>
  <view v-if="loaded">
    <view class="section-title">访客挂件</view>
    <view class="card">
      <view class="field">
        <view class="field-label">站点名称</view>
        <input v-model="form.site_name" class="input" type="text" maxlength="50" />
        <view class="field-hint">显示在访客聊天窗口顶部</view>
      </view>
      <view class="field">
        <view class="field-label">主题色</view>
        <view class="row">
          <view class="color-swatch" :style="{ background: validColor ? form.theme_color : '#ffffff' }" />
          <input v-model="form.theme_color" class="input grow" type="text" maxlength="7" placeholder="#2563eb" />
        </view>
      </view>
      <view class="field">
        <view class="field-label">欢迎语</view>
        <textarea v-model="form.welcome_message" class="textarea" maxlength="500" auto-height />
        <view class="field-hint">访客打开聊天窗口时看到的第一句话，留空则不显示</view>
      </view>
    </view>

    <view class="section-title">会话分配</view>
    <view class="card">
      <view class="field switch-row">
        <view class="grow">
          <view>自动分配</view>
          <view class="field-hint">新会话自动分配给在线且未满负荷的客服</view>
        </view>
        <switch :checked="form.auto_assign" color="#2563eb" @change="form.auto_assign = $event.detail.value" />
      </view>
      <view class="field">
        <view class="field-label">排队提示</view>
        <textarea v-model="form.queue_message" class="textarea" maxlength="500" auto-height />
        <view class="field-hint">有客服在线但暂时无法接入时发送给访客</view>
      </view>
      <view class="field">
        <view class="field-label">离线提示</view>
        <textarea v-model="form.offline_message" class="textarea" maxlength="500" auto-height />
        <view class="field-hint">没有客服在线时发送给访客</view>
      </view>
      <view class="field">
        <view class="field-label">无消息自动结束（分钟）</view>
        <input v-model="form.auto_close_minutes" class="input" type="number" maxlength="4" />
        <view class="field-hint">进行中的会话超过该时间没有新消息将自动结束，0 表示不自动结束</view>
      </view>
    </view>

    <view class="section-title">AI 智能客服</view>
    <view class="card">
      <view class="field switch-row">
        <view class="grow">
          <view>开启 AI 智能客服</view>
          <view class="field-hint">根据知识库自动回答访客问题</view>
        </view>
        <switch :checked="form.ai_enabled" color="#2563eb" @change="form.ai_enabled = $event.detail.value" />
      </view>
      <view class="field">
        <view class="field-label">接待模式</view>
        <picker mode="selector" :range="AI_MODES" range-key="label" :value="modeIndex" @change="form.ai_mode = AI_MODES[$event.detail.value].value">
          <view class="input picker-value">
            <text class="ellipsis">{{ AI_MODES[modeIndex].short }}</text>
            <text class="cell-arrow">›</text>
          </view>
        </picker>
        <view class="field-hint">{{ AI_MODES[modeIndex].label }}</view>
      </view>
      <view class="field">
        <view class="field-label">AI 客服名称</view>
        <input v-model="form.ai_name" class="input" type="text" maxlength="20" />
        <view class="field-hint">访客看到的 AI 客服名字</view>
      </view>
      <view class="field">
        <view class="field-label">转人工提示</view>
        <textarea v-model="form.ai_handoff_message" class="textarea" maxlength="200" auto-height />
        <view class="field-hint">AI 把会话转给人工时发送给访客，留空则不发送</view>
      </view>
      <view class="field">
        <view class="field-label">补充说明</view>
        <textarea v-model="form.ai_instructions" class="textarea" maxlength="4000" auto-height />
        <view class="field-hint">告诉 AI 你的业务背景、语气要求和不能做的事，会附加在 AI 的指令中</view>
      </view>
      <view class="cell" hover-class="cell-hover" @tap="go('/pages/admin/ai-connection')">
        <text class="cell-label">AI 接口（类型、地址、Key、模型）</text>
        <text class="cell-arrow">›</text>
      </view>
    </view>

    <view class="actions">
      <button class="btn btn-primary btn-block" :disabled="saving" @tap="save">保存设置</button>
    </view>
  </view>
  <view v-else class="empty">{{ error || '加载中…' }}</view>
</template>

<script setup>
import { ref, reactive, computed } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { get, put, showError } from '../../api/http';
import { state } from '../../store/state';

const AI_MODES = [
  { value: 'always', short: 'AI 优先', label: 'AI 优先：所有新会话先由 AI 接待，需要时转人工' },
  { value: 'offline', short: 'AI 兜底', label: 'AI 兜底：只在没有客服能接待时由 AI 接待' },
];
const TEXT_FIELDS = [
  'site_name',
  'theme_color',
  'welcome_message',
  'queue_message',
  'offline_message',
  'ai_name',
  'ai_handoff_message',
  'ai_instructions',
];

const loaded = ref(false);
const saving = ref(false);
const error = ref('');
const form = reactive({
  site_name: '',
  theme_color: '',
  welcome_message: '',
  queue_message: '',
  offline_message: '',
  auto_close_minutes: '0',
  auto_assign: true,
  ai_enabled: false,
  ai_mode: 'always',
  ai_name: '',
  ai_handoff_message: '',
  ai_instructions: '',
});

const modeIndex = computed(() => Math.max(0, AI_MODES.findIndex((m) => m.value === form.ai_mode)));
const validColor = computed(() => /^#[0-9a-fA-F]{6}$/.test(form.theme_color));

function fill(s) {
  for (const key of TEXT_FIELDS) form[key] = s[key] || '';
  form.auto_close_minutes = String(s.auto_close_minutes || 0);
  form.auto_assign = Boolean(s.auto_assign);
  form.ai_enabled = Boolean(s.ai_enabled);
  form.ai_mode = s.ai_mode || 'always';
}

onLoad(async () => {
  try {
    const { settings } = await get('/api/settings');
    state.settings = settings;
    fill(settings);
    loaded.value = true;
  } catch (err) {
    error.value = err.message;
  }
});

function go(url) {
  uni.navigateTo({ url });
}

async function save() {
  if (!validColor.value) {
    uni.showToast({ title: '主题色格式应为 #RRGGBB', icon: 'none' });
    return;
  }
  const body = {};
  for (const key of TEXT_FIELDS) body[key] = form[key].trim();
  Object.assign(body, {
    auto_close_minutes: Number(form.auto_close_minutes) || 0,
    auto_assign: form.auto_assign,
    ai_enabled: form.ai_enabled,
    ai_mode: form.ai_mode,
  });
  saving.value = true;
  try {
    const { settings } = await put('/api/admin/settings', body);
    state.settings = settings;
    fill(settings);
    uni.showToast({ title: '已保存', icon: 'success' });
  } catch (err) {
    showError(err);
  } finally {
    saving.value = false;
  }
}
</script>

<style>
.color-swatch {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  border: 1px solid var(--border);
  margin-right: 10px;
  flex-shrink: 0;
  box-sizing: border-box;
}
</style>

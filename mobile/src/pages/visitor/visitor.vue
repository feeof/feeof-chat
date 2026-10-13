<template>
  <view v-if="visitor && conv" class="visitor">
    <view class="card visitor-head">
      <Avatar :name="visitor.display_name" :size="48" :presence="visitor.online ? 'on' : 'off'" />
      <view class="grow visitor-title">
        <view class="visitor-name ellipsis">{{ visitor.display_name }}</view>
        <view class="small muted">{{ visitor.online ? '在线' : `最近活跃 ${formatTime(visitor.last_seen_at)}` }}</view>
      </view>
    </view>

    <view class="section-title">联系方式</view>
    <view class="card">
      <view class="field">
        <view class="field-label">称呼</view>
        <input v-model="form.name" class="input" type="text" maxlength="50" placeholder="未填写" />
      </view>
      <view class="field">
        <view class="field-label">电话</view>
        <input v-model="form.phone" class="input" type="text" maxlength="30" placeholder="未填写" />
      </view>
      <view class="field">
        <view class="field-label">邮箱</view>
        <input v-model="form.email" class="input" type="text" maxlength="100" placeholder="未填写" />
      </view>
      <view class="field">
        <view class="field-label">备注</view>
        <textarea v-model="form.note" class="textarea" maxlength="1000" auto-height placeholder="仅客服可见" />
      </view>
      <view class="actions">
        <button class="btn btn-primary btn-block" :disabled="saving || !dirty" @tap="save">保存</button>
      </view>
    </view>

    <view class="section-title">访问信息</view>
    <view class="card">
      <view v-for="row in visitRows" :key="row[0]" class="cell">
        <text class="cell-label">{{ row[0] }}</text>
        <text class="cell-value" :user-select="true" selectable @tap="copy(row[1])">{{ row[1] || '-' }}</text>
      </view>
    </view>

    <view class="section-title">本次会话</view>
    <view class="card">
      <view v-for="row in convRows" :key="row[0]" class="cell">
        <text class="cell-label">{{ row[0] }}</text>
        <text class="cell-value">{{ row[1] || '-' }}</text>
      </view>
    </view>
    <view style="height: 24px" />
  </view>
  <view v-else class="empty">{{ error || '加载中…' }}</view>
</template>

<script setup>
import { ref, reactive, computed } from 'vue';
import { onLoad, onUnload } from '@dcloudio/uni-app';
import Avatar from '../../components/Avatar.vue';
import { get, patch, showError } from '../../api/http';
import { formatTime, formatDateTime, formatDuration, describeUserAgent, stars } from '../../utils/format';

let id = 0;
const conv = ref(null);
const visitor = ref(null);
const error = ref('');
const saving = ref(false);
const form = reactive({ name: '', phone: '', email: '', note: '' });

const dirty = computed(() => {
  const v = visitor.value;
  return Boolean(v) && ['name', 'phone', 'email', 'note'].some((k) => (form[k] || '') !== (v[k] || ''));
});

const visitRows = computed(() => {
  const v = visitor.value;
  return [
    ['当前页面', v.page_title || v.page_url],
    ['页面地址', v.page_url],
    ['来源', v.referrer],
    ['设备', describeUserAgent(v.user_agent)],
    ['IP', v.ip],
    ['首次访问', formatDateTime(v.created_at)],
    ['历史会话', `${v.conversation_count} 次`],
  ];
});

const convRows = computed(() => {
  const c = conv.value;
  const rows = [
    ['会话编号', `#${c.id}`],
    ['开始时间', formatDateTime(c.created_at)],
    ['排队时长', c.assigned_at ? formatDuration(c.assigned_at - c.created_at) : ''],
    ['首次响应', c.first_response_at ? formatDuration(c.first_response_at - c.created_at) : ''],
  ];
  if (c.handoff_at) rows.push(['转人工', `${formatDateTime(c.handoff_at)}${c.handoff_reason ? `，${c.handoff_reason}` : ''}`]);
  rows.push(['接待客服', c.agent_name]);
  if (c.status === 'closed') rows.push(['结束时间', formatDateTime(c.closed_at)]);
  if (c.rating) rows.push(['满意度', `${stars(c.rating)}${c.rating_comment ? ` ${c.rating_comment}` : ''}`]);
  return rows;
});

function fill(v) {
  visitor.value = v;
  form.name = v.name || '';
  form.phone = v.phone || '';
  form.email = v.email || '';
  form.note = v.note || '';
}

async function load() {
  try {
    const data = await get(`/api/conversations/${id}`);
    conv.value = data.conversation;
    fill(data.visitor);
  } catch (err) {
    error.value = err.message;
  }
}

async function save() {
  saving.value = true;
  try {
    const body = {};
    for (const key of ['name', 'phone', 'email', 'note']) body[key] = form[key].trim();
    const { visitor: updated } = await patch(`/api/conversations/${id}/visitor`, body);
    fill(updated);
    uni.showToast({ title: '已保存', icon: 'success' });
  } catch (err) {
    showError(err);
  } finally {
    saving.value = false;
  }
}

function copy(value) {
  if (!value) return;
  uni.setClipboardData({ data: String(value), fail() {} });
}

function onConversation({ conv: next }) {
  if (next.id === id) conv.value = next;
}

onLoad((query) => {
  id = Number(query.id);
  uni.$on('ws:conversation', onConversation);
  load();
});

onUnload(() => {
  uni.$off('ws:conversation', onConversation);
});
</script>

<style>
.visitor-head {
  display: flex;
  align-items: center;
  padding: 16px;
}
.visitor-title {
  margin-left: 12px;
}
.visitor-name {
  font-size: 18px;
  font-weight: 600;
}
</style>

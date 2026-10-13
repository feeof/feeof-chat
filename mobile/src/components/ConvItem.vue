<template>
  <view :class="['conv-item', unread ? 'unread' : '']" hover-class="cell-hover" @tap="emit('select', conv.id)">
    <Avatar :name="conv.visitor_name" :size="44" :presence="conv.status === 'closed' ? '' : conv.visitor_online ? 'on' : 'off'" />
    <view class="conv-main">
      <view class="conv-row">
        <text class="conv-name ellipsis">{{ conv.visitor_name }}</text>
        <text class="conv-time">{{ time }}</text>
      </view>
      <view class="conv-row">
        <text class="conv-preview ellipsis">{{ conv.last_message_preview || '（暂无消息）' }}</text>
        <text v-if="unread" class="badge">{{ unread > 99 ? '99+' : unread }}</text>
      </view>
      <view v-if="meta || conv.status === 'bot' || stars" class="conv-meta ellipsis">
        <text v-if="conv.status === 'bot'" class="chip chip-bot">AI 接待中</text>
        <text v-if="meta">{{ meta }}</text>
        <text v-if="stars" class="stars"> {{ stars }}</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue';
import Avatar from './Avatar.vue';
import { isMine } from '../store/state';
import { formatTime, formatDuration, stars as starText } from '../utils/format';

const props = defineProps({
  conv: { type: Object, required: true },
  // Current time, refreshed by the list so waiting durations stay current.
  now: { type: Number, default: 0 },
  showAgent: { type: Boolean, default: false },
});
const emit = defineEmits(['select']);

const unread = computed(() => {
  const c = props.conv;
  const show = c.status === 'waiting' || (c.status === 'active' && isMine(c));
  return show ? c.agent_unread || 0 : 0;
});

const time = computed(() => formatTime(props.conv.status === 'closed' ? props.conv.closed_at : props.conv.last_message_at));

const meta = computed(() => {
  const c = props.conv;
  if (c.status === 'waiting') {
    const waited = `已等待 ${formatDuration((props.now || Date.now()) - (c.handoff_at || c.created_at))}`;
    return c.handoff_reason ? `${waited} · 转人工：${c.handoff_reason}` : waited;
  }
  if (c.status === 'closed') return c.agent_name ? `客服 ${c.agent_name}` : '未接入';
  if (c.status === 'active' && props.showAgent && !isMine(c)) return `客服 ${c.agent_name || '-'}`;
  return '';
});

const stars = computed(() => (props.conv.status === 'closed' ? starText(props.conv.rating) : ''));
</script>

<style>
.conv-item {
  display: flex;
  align-items: flex-start;
  padding: 12px 16px;
  background: var(--surface);
  position: relative;
}
.conv-item + .conv-item::before {
  content: '';
  position: absolute;
  left: 72px;
  right: 0;
  top: 0;
  border-top: 1px solid var(--border);
}
.conv-main {
  flex: 1;
  min-width: 0;
  margin-left: 12px;
}
.conv-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.conv-name {
  flex: 1;
  font-size: 16px;
  font-weight: 500;
}
.conv-item.unread .conv-name {
  font-weight: 700;
}
.conv-time {
  flex-shrink: 0;
  margin-left: 8px;
  font-size: 12px;
  color: var(--muted);
}
.conv-preview {
  flex: 1;
  font-size: 14px;
  color: var(--text-2);
  margin-right: 8px;
}
.conv-meta {
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
}
.conv-meta .chip {
  margin-right: 6px;
}
</style>

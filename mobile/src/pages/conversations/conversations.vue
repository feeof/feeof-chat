<template>
  <view class="conversations">
    <view class="list-head">
      <view v-if="state.ready && !state.connected" class="banner">实时连接已断开，正在重新连接…</view>
      <view class="page-pad">
        <view class="seg">
          <view :class="['seg-item', tab === 'active' ? 'active' : '']" @tap="setTab('active')">
            进行中<text class="seg-count">{{ counts.active }}</text>
          </view>
          <view :class="['seg-item', tab === 'waiting' ? 'active' : '']" @tap="setTab('waiting')">
            排队中<text :class="['seg-count', counts.waiting ? 'alert' : '']">{{ counts.waiting }}</text>
          </view>
          <view v-if="showBot" :class="['seg-item', tab === 'bot' ? 'active' : '']" @tap="setTab('bot')">
            AI 接待<text class="seg-count">{{ counts.bot }}</text>
          </view>
        </view>
        <view v-if="admin && tab === 'active'" class="switch-row mine-filter">
          <text class="small muted">只看我接待的</text>
          <switch :checked="mineOnly" color="#2563eb" style="transform: scale(0.8)" @change="mineOnly = $event.detail.value" />
        </view>
      </view>
    </view>

    <view v-if="items.length" class="conv-list">
      <ConvItem v-for="conv in items" :key="conv.id" :conv="conv" :now="now" :show-agent="admin" @select="open" />
    </view>
    <view v-else class="empty">{{ emptyText }}</view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue';
import { onShow, onHide, onPullDownRefresh } from '@dcloudio/uni-app';
import ConvItem from '../../components/ConvItem.vue';
import { state, isAdmin, isMine } from '../../store/state';
import { syncWorkspace, refreshBadge } from '../../store/workspace';
import { showError } from '../../api/http';

const tab = ref('active');
const mineOnly = ref(false);
const now = ref(Date.now());
let timer = null;

const admin = computed(() => isAdmin());
const all = computed(() => Object.values(state.live));

const counts = computed(() => {
  const list = all.value;
  return {
    active: list.filter((c) => c.status === 'active' && (!mineOnly.value || isMine(c))).length,
    waiting: list.filter((c) => c.status === 'waiting').length,
    bot: list.filter((c) => c.status === 'bot').length,
  };
});

const showBot = computed(() => counts.value.bot > 0 || Boolean(state.settings.ai_enabled));

const items = computed(() => {
  const list = all.value;
  const current = tab.value === 'bot' && !showBot.value ? 'active' : tab.value;
  if (current === 'waiting') {
    // Longest-waiting first.
    const since = (c) => c.handoff_at || c.created_at;
    return list.filter((c) => c.status === 'waiting').sort((a, b) => since(a) - since(b));
  }
  if (current === 'bot') {
    return list.filter((c) => c.status === 'bot').sort((a, b) => b.last_message_at - a.last_message_at);
  }
  return list
    .filter((c) => c.status === 'active' && (!mineOnly.value || isMine(c)))
    .sort((a, b) => b.last_message_at - a.last_message_at);
});

const emptyText = computed(() => {
  if (!state.ready) return '加载中…';
  return { waiting: '当前没有排队的访客', bot: 'AI 当前没有在接待的访客', active: '暂无进行中的会话' }[tab.value];
});

function setTab(key) {
  tab.value = key;
}

function open(id) {
  uni.navigateTo({ url: `/pages/chat/chat?id=${id}` });
}

onShow(() => {
  if (!state.me) {
    uni.reLaunch({ url: '/pages/login/login' });
    return;
  }
  now.value = Date.now();
  clearInterval(timer);
  timer = setInterval(() => (now.value = Date.now()), 30 * 1000);
  refreshBadge();
  // Jump to the queue when visitors are waiting and nothing is in progress.
  if (tab.value === 'active' && counts.value.active === 0 && counts.value.waiting > 0) tab.value = 'waiting';
});

onHide(() => {
  clearInterval(timer);
  timer = null;
});

onPullDownRefresh(async () => {
  try {
    await syncWorkspace();
  } catch (err) {
    showError(err);
  } finally {
    uni.stopPullDownRefresh();
  }
});
</script>

<style>
.list-head {
  background: var(--bg);
}
.mine-filter {
  margin-top: 8px;
}
.conv-list {
  padding-bottom: 12px;
}
</style>

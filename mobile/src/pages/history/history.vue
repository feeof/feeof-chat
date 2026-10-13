<template>
  <view class="history">
    <view class="page-pad history-filters">
      <input
        v-model="query"
        class="input"
        type="text"
        confirm-type="search"
        placeholder="搜索访客、电话、消息或会话编号"
        @input="onQueryInput"
        @confirm="reload"
      />
      <picker v-if="admin" mode="selector" :range="agentOptions" range-key="label" :value="agentIndex" @change="onAgentChange">
        <view class="input picker-value agent-picker">
          <text>{{ agentOptions[agentIndex].label }}</text>
          <text class="cell-arrow">›</text>
        </view>
      </picker>
    </view>

    <view v-if="items.length">
      <ConvItem v-for="conv in items" :key="conv.id" :conv="conv" :show-agent="true" @select="open" />
    </view>
    <view v-else class="empty">{{ loading ? '加载中…' : query ? '没有找到匹配的会话' : '还没有历史会话' }}</view>
    <view v-if="items.length" class="load-more">{{ loading ? '加载中…' : hasMore ? '上拉加载更多' : '没有更多了' }}</view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue';
import { onLoad, onShow, onUnload, onPullDownRefresh, onReachBottom } from '@dcloudio/uni-app';
import ConvItem from '../../components/ConvItem.vue';
import { get, showError } from '../../api/http';
import { state, isAdmin } from '../../store/state';
import { refreshBadge } from '../../store/workspace';

const PAGE = 30;
const items = ref([]);
const query = ref('');
const agentIndex = ref(0);
const loading = ref(false);
const hasMore = ref(false);
let requestId = 0;
let debounce = null;
// A conversation closed since the list was loaded.
let stale = false;

const admin = computed(() => isAdmin());
const agentOptions = computed(() => [
  { id: '', label: '全部客服' },
  ...state.agents.map((a) => ({ id: String(a.id), label: a.display_name })),
]);

function url(offset) {
  let path = `/api/conversations?status=closed&limit=${PAGE}&offset=${offset}`;
  if (query.value.trim()) path += `&q=${encodeURIComponent(query.value.trim())}`;
  const agent = agentOptions.value[agentIndex.value];
  if (agent && agent.id) path += `&agent_id=${agent.id}`;
  return path;
}

async function fetchPage(reset) {
  const current = (requestId += 1);
  loading.value = true;
  try {
    const { conversations } = await get(url(reset ? 0 : items.value.length));
    if (current !== requestId) return;
    items.value = reset ? conversations : [...items.value, ...conversations];
    hasMore.value = conversations.length >= PAGE;
  } catch (err) {
    if (current === requestId) showError(err);
  } finally {
    if (current === requestId) loading.value = false;
  }
}

function reload() {
  clearTimeout(debounce);
  return fetchPage(true);
}

function onQueryInput() {
  clearTimeout(debounce);
  debounce = setTimeout(reload, 400);
}

function onAgentChange(event) {
  agentIndex.value = Number(event.detail.value) || 0;
  reload();
}

function open(id) {
  uni.navigateTo({ url: `/pages/chat/chat?id=${id}` });
}

function onConversation({ conv }) {
  if (conv.status === 'closed') stale = true;
}

onLoad(() => {
  uni.$on('ws:conversation', onConversation);
  if (state.me) reload();
});

onUnload(() => {
  uni.$off('ws:conversation', onConversation);
});

onShow(() => {
  if (!state.me) {
    uni.reLaunch({ url: '/pages/login/login' });
    return;
  }
  refreshBadge();
  if (stale) {
    stale = false;
    reload();
  }
});

onPullDownRefresh(async () => {
  await reload();
  uni.stopPullDownRefresh();
});

onReachBottom(() => {
  if (hasMore.value && !loading.value) fetchPage(false);
});
</script>

<style>
.history-filters .agent-picker {
  margin-top: 8px;
}
</style>

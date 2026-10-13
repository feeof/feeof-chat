<template>
  <view>
    <view v-if="ai" class="card card-body kb-status">
      <view class="kb-status-row">
        <text class="muted">AI 客服</text>
        <text :class="state.settings.ai_enabled ? 'text-ok' : 'text-warn'" @tap="go('/pages/admin/settings')">
          {{ state.settings.ai_enabled ? '已开启' : '未开启 · 去设置' }}
        </text>
      </view>
      <view class="kb-status-row">
        <text class="muted">AI 接口</text>
        <text v-if="ai.configured" class="kb-status-value">{{ PROVIDER_LABELS[ai.provider] }} · {{ ai.model }}</text>
        <text v-else class="text-warn" @tap="go('/pages/admin/ai-connection')">未配置 · 去填写</text>
      </view>
      <view class="kb-status-row">
        <text class="muted">知识库</text>
        <text class="kb-status-value">{{ ai.knowledge_articles }} 条启用，共 {{ formatNumber(ai.knowledge_chars) }} 字</text>
      </view>
      <view class="kb-status-row">
        <text class="muted">检索方式</text>
        <text class="kb-status-value">{{ ai.knowledge_mode === 'full' ? '全部条目发送给 AI' : '按问题检索相关条目' }}</text>
      </view>
      <view v-if="ai.last_error" class="kb-status-row">
        <text class="muted">最近错误</text>
        <text class="kb-status-value text-warn">{{ formatDateTime(ai.last_error.at) }} {{ ai.last_error.message }}</text>
      </view>
      <button class="btn btn-small btn-block kb-try-btn" @tap="go('/pages/admin/kb-test')">试一试：用访客的口吻提问</button>
    </view>

    <view class="page-pad">
      <input v-model="query" class="input" type="text" confirm-type="search" placeholder="搜索标题或内容" @input="onQueryInput" @confirm="reload" />
      <view class="small muted kb-count">共 {{ total }} 条{{ query ? '匹配' : '' }}</view>
    </view>

    <view v-if="articles.length" class="card">
      <view v-for="a in articles" :key="a.id" class="kb-item" hover-class="cell-hover" @tap="edit(a)">
        <view class="row">
          <text class="grow ellipsis kb-title">{{ a.title }}</text>
          <text v-if="!a.enabled" class="chip chip-closed">已停用</text>
        </view>
        <view class="kb-content">{{ a.content }}</view>
      </view>
    </view>
    <view v-else class="empty">{{ loading ? '加载中…' : query ? '没有匹配的条目' : '知识库还是空的，点右下角添加第一条' }}</view>
    <view v-if="articles.length" class="load-more">{{ loading ? '加载中…' : articles.length < total ? '上拉加载更多' : '没有更多了' }}</view>
    <view class="page-pad small muted">批量导入（Markdown / CSV / JSON）请在电脑上的管理后台操作。</view>
    <view style="height: 96px" />
    <view class="fab" @tap="edit(null)">+</view>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { onShow, onPullDownRefresh, onReachBottom } from '@dcloudio/uni-app';
import { get, showError } from '../../api/http';
import { state } from '../../store/state';
import { editing, PROVIDER_LABELS } from '../../store/admin';
import { formatNumber, formatDateTime } from '../../utils/format';

const PAGE = 30;
const articles = ref([]);
const total = ref(0);
const ai = ref(null);
const query = ref('');
const loading = ref(false);
let requestId = 0;
let debounce = null;

async function fetchPage(reset) {
  const current = (requestId += 1);
  loading.value = true;
  const offset = reset ? 0 : articles.value.length;
  let path = `/api/admin/kb?limit=${PAGE}&offset=${offset}`;
  if (query.value.trim()) path += `&q=${encodeURIComponent(query.value.trim())}`;
  try {
    const data = await get(path);
    if (current !== requestId) return;
    articles.value = reset ? data.articles : [...articles.value, ...data.articles];
    total.value = data.total;
    ai.value = data.ai;
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

function edit(article) {
  editing.article = article;
  uni.navigateTo({ url: `/pages/admin/article-edit${article ? `?id=${article.id}` : ''}` });
}

function go(url) {
  uni.navigateTo({ url });
}

onShow(() => {
  get('/api/settings')
    .then(({ settings }) => (state.settings = settings))
    .catch(() => {});
  reload();
});

onPullDownRefresh(async () => {
  await reload();
  uni.stopPullDownRefresh();
});

onReachBottom(() => {
  if (!loading.value && articles.value.length < total.value) fetchPage(false);
});
</script>

<style>
.kb-status-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  padding: 3px 0;
}
.kb-status-value {
  margin-left: 12px;
  text-align: right;
  word-break: break-all;
}
.kb-try-btn {
  margin-top: 10px;
}
.kb-count {
  margin-top: 6px;
}
.kb-item {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.kb-title {
  font-weight: 600;
}
.kb-content {
  margin-top: 2px;
  font-size: 13px;
  color: var(--text-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>

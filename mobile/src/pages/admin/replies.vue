<template>
  <view>
    <view class="page-pad small muted">客服在聊天页点「快捷回复」即可选用。</view>
    <view v-if="state.quickReplies.length" class="card">
      <view v-for="r in state.quickReplies" :key="r.id" class="reply-item" hover-class="cell-hover" @tap="edit(r.id)">
        <view class="reply-title">{{ r.title }}</view>
        <view class="reply-content">{{ r.content }}</view>
      </view>
    </view>
    <view v-else class="empty">还没有快捷回复，点右下角添加</view>
    <view style="height: 96px" />
    <view class="fab" @tap="edit('')">+</view>
  </view>
</template>

<script setup>
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app';
import { get, showError } from '../../api/http';
import { state } from '../../store/state';

async function refresh() {
  try {
    const { quick_replies: list } = await get('/api/quick-replies');
    state.quickReplies = list;
  } catch (err) {
    showError(err);
  }
}

function edit(id) {
  uni.navigateTo({ url: `/pages/admin/reply-edit${id ? `?id=${id}` : ''}` });
}

onShow(refresh);

onPullDownRefresh(async () => {
  await refresh();
  uni.stopPullDownRefresh();
});
</script>

<style>
.reply-item {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.reply-title {
  font-weight: 600;
}
.reply-content {
  margin-top: 2px;
  font-size: 13px;
  color: var(--text-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>

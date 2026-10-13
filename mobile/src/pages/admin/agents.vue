<template>
  <view>
    <view class="card agents-card">
      <view v-for="a in state.agents" :key="a.id" class="cell" hover-class="cell-hover" @tap="edit(a.id)">
        <Avatar :name="a.display_name" :size="40" :presence="a.status === 'online' ? 'on' : 'off'" />
        <view class="grow agent-main">
          <view class="row">
            <text class="ellipsis agent-display">{{ a.display_name }}</text>
            <text v-if="a.role === 'admin'" class="chip">管理员</text>
            <text v-if="a.disabled" class="chip chip-closed">已禁用</text>
          </view>
          <view class="small muted">
            {{ a.username }} · {{ STATUS_LABEL[a.status] }} · 接待 {{ a.active_count || 0 }}/{{ a.max_concurrent }}
          </view>
        </view>
        <text class="cell-arrow">›</text>
      </view>
    </view>
    <view v-if="!state.agents.length" class="empty">加载中…</view>
    <view style="height: 96px" />
    <view class="fab" @tap="edit('')">+</view>
  </view>
</template>

<script setup>
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app';
import Avatar from '../../components/Avatar.vue';
import { showError } from '../../api/http';
import { state } from '../../store/state';
import { refreshAgents } from '../../store/workspace';
import { STATUS_LABEL } from '../../utils/format';

function edit(id) {
  uni.navigateTo({ url: `/pages/admin/agent-edit${id ? `?id=${id}` : ''}` });
}

onShow(() => {
  refreshAgents().catch(showError);
});

onPullDownRefresh(async () => {
  try {
    await refreshAgents();
  } catch (err) {
    showError(err);
  }
  uni.stopPullDownRefresh();
});
</script>

<style>
.agent-main {
  margin-left: 12px;
}
.agent-display {
  font-size: 16px;
  font-weight: 500;
  margin-right: 6px;
}
.agent-main .chip {
  margin-right: 4px;
}
</style>

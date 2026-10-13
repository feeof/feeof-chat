<template>
  <view v-if="state.me" class="me">
    <view class="card me-head" hover-class="cell-hover" @tap="go('/pages/me/profile')">
      <Avatar :name="state.me.display_name" :size="52" />
      <view class="grow me-title">
        <view class="me-name ellipsis">{{ state.me.display_name }}</view>
        <view class="small muted">{{ state.me.username }} · {{ state.me.role === 'admin' ? '管理员' : '客服' }}</view>
      </view>
      <text class="cell-arrow">›</text>
    </view>

    <view class="section-title">接待状态</view>
    <view class="card">
      <view v-for="s in STATUSES" :key="s" class="cell" hover-class="cell-hover" @tap="setStatus(s)">
        <view :class="['dot', 'dot-' + s]" />
        <text class="cell-label status-label">{{ STATUS_DESC[s] }}</text>
        <text v-if="preferred === s" class="check">✓</text>
      </view>
    </view>

    <view class="section-title">连接</view>
    <view class="card">
      <view class="cell">
        <text class="cell-label">实时连接</text>
        <text :class="['cell-value', state.connected ? 'text-ok' : 'text-warn']">{{ state.connected ? '已连接' : '正在重连…' }}</text>
      </view>
      <view class="cell">
        <text class="cell-label">服务器</text>
        <text class="cell-value small">{{ session.server }}</text>
      </view>
      <view class="cell switch-row">
        <text class="cell-label">新消息振动提醒</text>
        <switch :checked="state.vibrate" color="#2563eb" @change="onVibrate" />
      </view>
    </view>

    <view v-if="admin">
      <view class="section-title">管理后台</view>
      <view class="card">
        <view v-for="item in ADMIN_MENU" :key="item.url" class="cell" hover-class="cell-hover" @tap="go(item.url)">
          <text class="cell-label">{{ item.label }}</text>
          <text class="cell-arrow">›</text>
        </view>
      </view>
    </view>

    <view class="section-title">账号</view>
    <view class="card">
      <view class="cell" hover-class="cell-hover" @tap="go('/pages/me/profile')">
        <text class="cell-label">个人资料</text>
        <text class="cell-arrow">›</text>
      </view>
      <view class="cell" hover-class="cell-hover" @tap="go('/pages/me/password')">
        <text class="cell-label">修改密码</text>
        <text class="cell-arrow">›</text>
      </view>
    </view>

    <view class="actions">
      <button class="btn btn-block btn-danger" @tap="confirmLogout">退出登录</button>
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import Avatar from '../../components/Avatar.vue';
import { put, showError } from '../../api/http';
import { session } from '../../store/session';
import { state, isAdmin, setVibrate } from '../../store/state';
import { refreshBadge } from '../../store/workspace';
import { logout } from '../../store/app';
import { STATUS_DESC } from '../../utils/format';

const STATUSES = ['online', 'away', 'offline'];
const ADMIN_MENU = [
  { label: '数据看板', url: '/pages/admin/dashboard' },
  { label: '客服管理', url: '/pages/admin/agents' },
  { label: '知识库', url: '/pages/admin/knowledge' },
  { label: '快捷回复', url: '/pages/admin/replies' },
  { label: '系统设置', url: '/pages/admin/settings' },
  { label: 'AI 接口', url: '/pages/admin/ai-connection' },
];

const admin = computed(() => isAdmin());
const preferred = computed(() => state.me.preferred_status || state.me.status);

function go(url) {
  uni.navigateTo({ url });
}

async function setStatus(status) {
  if (preferred.value === status) return;
  try {
    const { user } = await put('/api/auth/me/status', { status });
    state.me = user;
  } catch (err) {
    showError(err);
  }
}

function onVibrate(event) {
  setVibrate(event.detail.value);
}

function confirmLogout() {
  uni.showModal({
    title: '退出登录',
    content: '退出后将不再收到新会话提醒。',
    confirmText: '退出',
    confirmColor: '#dc2626',
    success: (res) => {
      if (res.confirm) logout();
    },
  });
}

onShow(() => {
  if (!state.me) {
    uni.reLaunch({ url: '/pages/login/login' });
    return;
  }
  refreshBadge();
});
</script>

<style>
.me-head {
  display: flex;
  align-items: center;
  padding: 16px;
}
.me-title {
  margin-left: 12px;
}
.me-name {
  font-size: 18px;
  font-weight: 600;
}
.status-label {
  margin-left: 10px;
}
.check {
  color: var(--brand);
  font-weight: 600;
}
</style>

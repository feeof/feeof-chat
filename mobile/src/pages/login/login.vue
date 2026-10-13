<template>
  <view class="login">
    <view class="login-head">
      <image class="login-logo" src="/static/logo.png" mode="aspectFit" />
      <text class="login-title">客服工作台</text>
      <text class="login-sub">登录后开始接待访客</text>
    </view>

    <view v-if="booting" class="login-booting">正在连接服务器…</view>

    <view v-else class="card login-card">
      <view class="field">
        <view class="field-label">服务器地址</view>
        <input
          v-model="server"
          class="input"
          type="text"
          placeholder="例如 https://chat.example.com"
          confirm-type="next"
          :adjust-position="true"
        />
      </view>
      <view class="field">
        <view class="field-label">用户名</view>
        <input v-model="username" class="input" type="text" maxlength="64" placeholder="请输入用户名" confirm-type="next" />
      </view>
      <view class="field">
        <view class="field-label">密码</view>
        <input
          v-model="password"
          class="input"
          type="text"
          password
          maxlength="200"
          placeholder="请输入密码"
          confirm-type="done"
          @confirm="submit"
        />
      </view>
      <view v-if="error" class="login-error">{{ error }}</view>
      <view class="actions">
        <button class="btn btn-primary btn-block" :disabled="submitting" :loading="submitting" @tap="submit">登录</button>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { get, post } from '../../api/http';
import { session, setServer, setToken, normalizeServer } from '../../store/session';
import { state } from '../../store/state';
import { startApp } from '../../store/app';

const server = ref(session.server);
const username = ref('');
const password = ref('');
const error = ref('');
const submitting = ref(false);
const booting = ref(false);

function enterWorkspace() {
  uni.switchTab({ url: '/pages/conversations/conversations' });
}

onLoad(async (query) => {
  if (query && query.expired) error.value = '登录已失效，请重新登录';
  if (!session.token || !session.server) return;
  // Resume the saved login.
  booting.value = true;
  try {
    const { user } = await get('/api/auth/me');
    state.me = user;
    await startApp();
    enterWorkspace();
  } catch (err) {
    booting.value = false;
    // A 401 already reopened this page through authExpired().
    if (err.status !== 401) error.value = err.message;
  }
});

async function submit() {
  if (submitting.value) return;
  error.value = '';
  const url = normalizeServer(server.value);
  if (!url) {
    error.value = '请填写正确的服务器地址，例如 https://chat.example.com';
    return;
  }
  if (!username.value.trim() || !password.value) {
    error.value = '请输入用户名和密码';
    return;
  }
  submitting.value = true;
  try {
    server.value = url;
    setServer(url);
    const { token, user } = await post('/api/auth/login', { username: username.value.trim(), password: password.value });
    setToken(token);
    state.me = user;
    await startApp();
    password.value = '';
    enterWorkspace();
  } catch (err) {
    error.value = err.message;
  } finally {
    submitting.value = false;
  }
}
</script>

<style>
.login {
  min-height: 100vh;
  padding-top: calc(var(--status-bar-height) + 48px);
  padding-bottom: 32px;
  box-sizing: border-box;
}
.login-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 20px;
}
.login-logo {
  width: 64px;
  height: 64px;
  border-radius: 16px;
}
.login-title {
  margin-top: 14px;
  font-size: 22px;
  font-weight: 600;
}
.login-sub {
  margin-top: 4px;
  font-size: 14px;
  color: var(--muted);
}
.login-card .field::before {
  left: 16px;
}
.login-error {
  padding: 4px 16px 0;
  font-size: 13px;
  color: var(--danger);
}
.login-booting {
  text-align: center;
  color: var(--muted);
  padding: 48px 0;
}
</style>

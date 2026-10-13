<template>
  <view v-if="state.me">
    <view class="card">
      <view class="field">
        <view class="field-label">显示名称</view>
        <input v-model="name" class="input" type="text" maxlength="32" />
        <view class="field-hint">访客在聊天窗口中看到的名称</view>
      </view>
      <view class="field">
        <view class="field-label">用户名</view>
        <view class="muted">{{ state.me.username }}</view>
      </view>
    </view>
    <view class="actions">
      <button class="btn btn-primary btn-block" :disabled="saving" @tap="save">保存</button>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { patch, showError } from '../../api/http';
import { state } from '../../store/state';

const name = ref(state.me ? state.me.display_name : '');
const saving = ref(false);

async function save() {
  if (!name.value.trim()) {
    uni.showToast({ title: '请填写显示名称', icon: 'none' });
    return;
  }
  saving.value = true;
  try {
    const { user } = await patch('/api/auth/me', { display_name: name.value.trim() });
    state.me = user;
    uni.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => uni.navigateBack(), 600);
  } catch (err) {
    showError(err);
  } finally {
    saving.value = false;
  }
}
</script>

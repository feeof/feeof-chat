<template>
  <view>
    <view class="card">
      <view class="field">
        <view class="field-label">当前密码</view>
        <input v-model="current" class="input" type="text" password maxlength="200" />
      </view>
      <view class="field">
        <view class="field-label">新密码</view>
        <input v-model="next" class="input" type="text" password maxlength="200" placeholder="至少 6 位" />
      </view>
      <view class="field">
        <view class="field-label">确认新密码</view>
        <input v-model="confirm" class="input" type="text" password maxlength="200" />
      </view>
    </view>
    <view class="page-pad small muted">修改后，其他设备上的登录会失效。</view>
    <view class="actions">
      <button class="btn btn-primary btn-block" :disabled="saving" @tap="save">保存</button>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue';
import { patch, showError } from '../../api/http';

const current = ref('');
const next = ref('');
const confirm = ref('');
const saving = ref(false);

function toast(title) {
  uni.showToast({ title, icon: 'none' });
}

async function save() {
  if (!current.value || !next.value) return toast('请填写当前密码和新密码');
  if (next.value.length < 6) return toast('新密码至少 6 位');
  if (next.value !== confirm.value) return toast('两次输入的新密码不一致');
  saving.value = true;
  try {
    await patch('/api/auth/me', { current_password: current.value, new_password: next.value });
    uni.showToast({ title: '密码已修改', icon: 'success' });
    setTimeout(() => uni.navigateBack(), 800);
  } catch (err) {
    showError(err);
  } finally {
    saving.value = false;
  }
}
</script>

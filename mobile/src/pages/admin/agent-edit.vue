<template>
  <view>
    <view class="card">
      <view class="field">
        <view class="field-label">用户名</view>
        <input v-if="isNew" v-model="form.username" class="input" type="text" maxlength="32" placeholder="字母、数字、下划线，3-32 位" />
        <view v-else class="muted">{{ form.username }}</view>
      </view>
      <view class="field">
        <view class="field-label">显示名称</view>
        <input v-model="form.display_name" class="input" type="text" maxlength="32" placeholder="访客看到的名称" />
      </view>
      <view class="field">
        <view class="field-label">{{ isNew ? '密码' : '重置密码' }}</view>
        <input v-model="form.password" class="input" type="text" password maxlength="200" :placeholder="isNew ? '至少 6 位' : '留空则不修改'" />
      </view>
      <view class="field">
        <view class="field-label">角色</view>
        <picker mode="selector" :range="ROLES" range-key="label" :value="roleIndex" @change="form.role = ROLES[$event.detail.value].value">
          <view class="input picker-value">
            <text>{{ ROLES[roleIndex].label }}</text>
            <text class="cell-arrow">›</text>
          </view>
        </picker>
      </view>
      <view class="field">
        <view class="field-label">最大同时接待数</view>
        <input v-model="form.max_concurrent" class="input" type="number" maxlength="3" />
        <view class="field-hint">自动分配时最多同时分配给该客服的会话数</view>
      </view>
      <view v-if="!isNew" class="field switch-row">
        <view>
          <view>禁用账号</view>
          <view class="field-hint">禁用后立即下线，进行中的会话回到排队</view>
        </view>
        <switch :checked="form.disabled" color="#dc2626" @change="form.disabled = $event.detail.value" />
      </view>
    </view>
    <view class="actions">
      <button class="btn btn-primary btn-block" :disabled="saving" @tap="save">{{ isNew ? '创建' : '保存' }}</button>
    </view>
  </view>
</template>

<script setup>
import { ref, reactive, computed } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { post, patch, showError } from '../../api/http';
import { state } from '../../store/state';
import { refreshAgents } from '../../store/workspace';

const ROLES = [
  { value: 'agent', label: '客服' },
  { value: 'admin', label: '管理员' },
];

const id = ref(0);
const saving = ref(false);
const form = reactive({ username: '', display_name: '', password: '', role: 'agent', max_concurrent: '5', disabled: false });
const isNew = computed(() => !id.value);
const roleIndex = computed(() => Math.max(0, ROLES.findIndex((r) => r.value === form.role)));

function fill(agent) {
  Object.assign(form, {
    username: agent.username,
    display_name: agent.display_name,
    role: agent.role,
    max_concurrent: String(agent.max_concurrent),
    disabled: agent.disabled,
    password: '',
  });
}

onLoad(async (query) => {
  id.value = Number(query.id) || 0;
  uni.setNavigationBarTitle({ title: id.value ? '编辑客服' : '新增客服' });
  if (!id.value) return;
  let agent = state.agents.find((a) => a.id === id.value);
  if (!agent) {
    await refreshAgents().catch(showError);
    agent = state.agents.find((a) => a.id === id.value);
  }
  if (agent) fill(agent);
});

async function save() {
  const max = Number(form.max_concurrent);
  if (!Number.isInteger(max) || max < 1 || max > 100) {
    uni.showToast({ title: '最大接待数应为 1-100', icon: 'none' });
    return;
  }
  const body = { display_name: form.display_name.trim(), role: form.role, max_concurrent: max };
  if (form.password) body.password = form.password;
  saving.value = true;
  try {
    if (isNew.value) {
      body.username = form.username.trim();
      await post('/api/admin/agents', body);
    } else {
      body.disabled = form.disabled;
      await patch(`/api/admin/agents/${id.value}`, body);
    }
    await refreshAgents().catch(() => {});
    uni.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => uni.navigateBack(), 600);
  } catch (err) {
    showError(err);
  } finally {
    saving.value = false;
  }
}
</script>

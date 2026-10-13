<template>
  <view>
    <view class="card">
      <view class="field">
        <view class="field-label">标题</view>
        <input v-model="form.title" class="input" type="text" maxlength="50" placeholder="例如：问候语" />
      </view>
      <view class="field">
        <view class="field-label">内容</view>
        <textarea v-model="form.content" class="textarea" maxlength="2000" auto-height placeholder="发送给访客的文字" />
      </view>
      <view class="field">
        <view class="field-label">排序</view>
        <input v-model="form.sort" class="input" type="number" maxlength="4" />
        <view class="field-hint">数字越小越靠前</view>
      </view>
    </view>
    <view class="actions">
      <button class="btn btn-primary btn-block" :disabled="saving" @tap="save">保存</button>
      <button v-if="id" class="btn btn-block btn-danger" @tap="remove">删除</button>
    </view>
  </view>
</template>

<script setup>
import { ref, reactive } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { get, post, patch, del, showError } from '../../api/http';
import { state } from '../../store/state';

const id = ref(0);
const saving = ref(false);
const form = reactive({ title: '', content: '', sort: '0' });

async function refreshReplies() {
  const { quick_replies: list } = await get('/api/quick-replies');
  state.quickReplies = list;
}

onLoad((query) => {
  id.value = Number(query.id) || 0;
  uni.setNavigationBarTitle({ title: id.value ? '编辑快捷回复' : '新增快捷回复' });
  const reply = state.quickReplies.find((r) => r.id === id.value);
  if (reply) Object.assign(form, { title: reply.title, content: reply.content, sort: String(reply.sort || 0) });
});

async function save() {
  if (!form.title.trim() || !form.content.trim()) {
    uni.showToast({ title: '请填写标题和内容', icon: 'none' });
    return;
  }
  const body = { title: form.title.trim(), content: form.content.trim(), sort: Number(form.sort) || 0 };
  saving.value = true;
  try {
    if (id.value) await patch(`/api/admin/quick-replies/${id.value}`, body);
    else await post('/api/admin/quick-replies', body);
    await refreshReplies().catch(() => {});
    uni.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => uni.navigateBack(), 600);
  } catch (err) {
    showError(err);
  } finally {
    saving.value = false;
  }
}

function remove() {
  uni.showModal({
    title: '删除快捷回复',
    content: `确定删除「${form.title}」吗？`,
    confirmText: '删除',
    confirmColor: '#dc2626',
    success: async (res) => {
      if (!res.confirm) return;
      try {
        await del(`/api/admin/quick-replies/${id.value}`);
        await refreshReplies().catch(() => {});
        uni.navigateBack();
      } catch (err) {
        showError(err);
      }
    },
  });
}
</script>

<template>
  <view>
    <view class="card">
      <view class="field">
        <view class="field-label">标题</view>
        <input v-model="form.title" class="input" type="text" maxlength="100" placeholder="例如：发货时间" />
        <view class="field-hint">写成访客会问的问题或主题，AI 更容易找到</view>
      </view>
      <view class="field">
        <view class="field-label">内容</view>
        <textarea v-model="form.content" class="textarea kb-textarea" maxlength="20000" placeholder="回答这个问题需要的全部信息" />
        <view class="field-hint">{{ form.content.length }} / 20000</view>
      </view>
      <view class="field switch-row">
        <view>
          <view>启用</view>
          <view class="field-hint">停用的条目不会被 AI 使用</view>
        </view>
        <switch :checked="form.enabled" color="#2563eb" @change="form.enabled = $event.detail.value" />
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
import { post, patch, del, showError } from '../../api/http';
import { editing } from '../../store/admin';

const id = ref(0);
const saving = ref(false);
const form = reactive({ title: '', content: '', enabled: true });

onLoad((query) => {
  id.value = Number(query.id) || 0;
  uni.setNavigationBarTitle({ title: id.value ? '编辑知识' : '新增知识' });
  const article = editing.article;
  editing.article = null;
  if (id.value && article && article.id === id.value) {
    Object.assign(form, { title: article.title, content: article.content, enabled: article.enabled });
  }
});

async function save() {
  if (!form.title.trim() || !form.content.trim()) {
    uni.showToast({ title: '请填写标题和内容', icon: 'none' });
    return;
  }
  const body = { title: form.title.trim(), content: form.content.trim(), enabled: form.enabled };
  saving.value = true;
  try {
    if (id.value) await patch(`/api/admin/kb/${id.value}`, body);
    else await post('/api/admin/kb', body);
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
    title: '删除知识条目',
    content: `确定删除「${form.title}」吗？`,
    confirmText: '删除',
    confirmColor: '#dc2626',
    success: async (res) => {
      if (!res.confirm) return;
      try {
        await del(`/api/admin/kb/${id.value}`);
        uni.navigateBack();
      } catch (err) {
        showError(err);
      }
    },
  });
}
</script>

<style>
.kb-textarea {
  height: 320px;
}
</style>

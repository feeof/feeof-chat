<template>
  <view>
    <view class="page-pad small muted">用访客的口吻提问，检查 AI 的回答是否准确。「问 AI」会实际调用 AI 接口。</view>
    <view class="card">
      <view class="field">
        <textarea v-model="question" class="textarea" maxlength="2000" auto-height placeholder="例如：多久发货？" />
      </view>
      <view class="actions row">
        <button class="btn grow" :disabled="busy" @tap="preview">检索预览</button>
        <button class="btn btn-primary grow ask-btn" :disabled="busy" @tap="ask">{{ busy ? 'AI 正在回答…' : '问 AI' }}</button>
      </view>
    </view>

    <view v-if="hits" class="card card-body">
      <view class="small muted">会匹配到的条目（检索方式下使用；全量方式下 AI 会看到全部条目）</view>
      <view v-for="(r, i) in hits" :key="r.id" class="hit">{{ i + 1 }}. {{ r.title }}<text class="muted small"> · 相关度 {{ r.score }}</text></view>
      <view v-if="!hits.length" class="small muted hit">没有匹配的条目，可以补充相关知识</view>
    </view>

    <view v-if="answer" class="card card-body">
      <view v-if="answer.text" class="answer">{{ answer.text }}</view>
      <view v-if="answer.action === 'handoff'" class="handoff">
        会转人工：{{ answer.reason || '' }}
        <view v-if="answer.error" class="text-warn">{{ answer.error }}</view>
      </view>
      <view v-if="answer.retrieved.length" class="small muted hit">参考的条目：{{ retrievedTitles }}</view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue';
import { get, post, showError } from '../../api/http';

const question = ref('');
const busy = ref(false);
const hits = ref(null);
const answer = ref(null);
const retrievedTitles = computed(() => (answer.value ? answer.value.retrieved.map((r) => r.title).join('、') : ''));

function q() {
  const text = question.value.trim();
  if (!text) uni.showToast({ title: '请先输入问题', icon: 'none' });
  return text;
}

async function preview() {
  const text = q();
  if (!text) return;
  try {
    const { results } = await get(`/api/admin/kb/search?q=${encodeURIComponent(text)}`);
    hits.value = results;
    answer.value = null;
  } catch (err) {
    showError(err);
  }
}

async function ask() {
  const text = q();
  if (!text) return;
  busy.value = true;
  hits.value = null;
  answer.value = null;
  try {
    const { result } = await post('/api/admin/ai/test', { question: text });
    answer.value = result;
  } catch (err) {
    showError(err);
  } finally {
    busy.value = false;
  }
}
</script>

<style>
.ask-btn {
  margin-left: 12px;
}
.hit {
  margin-top: 6px;
}
.answer {
  white-space: pre-wrap;
  line-height: 1.6;
}
.handoff {
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #fff7ed;
  color: #9a3412;
  font-size: 13px;
}
</style>

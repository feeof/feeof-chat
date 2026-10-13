<template>
  <view class="avatar" :style="style">
    <text>{{ initial }}</text>
    <view v-if="presence" :class="['presence', presence === 'on' ? 'on' : '']" />
  </view>
</template>

<script setup>
import { computed } from 'vue';

const COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#059669', '#0891b2', '#4f46e5', '#b45309'];

const props = defineProps({
  name: { type: String, default: '' },
  size: { type: Number, default: 40 },
  // 'on' / 'off' shows a presence dot; '' shows none.
  presence: { type: String, default: '' },
});

const text = computed(() => (props.name || '?').trim() || '?');
const initial = computed(() => Array.from(text.value)[0].toUpperCase());
const style = computed(() => {
  let hash = 0;
  for (const ch of text.value) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return {
    width: `${props.size}px`,
    height: `${props.size}px`,
    fontSize: `${Math.round(props.size * 0.42)}px`,
    background: COLORS[hash % COLORS.length],
  };
});
</script>

<style>
.avatar {
  position: relative;
  flex-shrink: 0;
  border-radius: 50%;
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
}
.presence {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 10px;
  height: 10px;
  border-radius: 5px;
  background: #9ca3af;
  border: 2px solid #ffffff;
}
.presence.on {
  background: #16a34a;
}
</style>

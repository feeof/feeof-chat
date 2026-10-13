<template>
  <view class="dashboard">
    <view class="page-pad">
      <view class="seg">
        <view v-for="r in RANGES" :key="r[0]" :class="['seg-item', range === r[0] ? 'active' : '']" @tap="setRange(r[0])">
          {{ r[1] }}
        </view>
      </view>
    </view>

    <view v-if="data" :class="{ refreshing: loading }">
      <view class="section-title">实时</view>
      <view class="tiles">
        <view v-for="t in liveTiles" :key="t.label" class="tile">
          <view class="tile-label">{{ t.label }}</view>
          <view class="tile-value">{{ t.value }}</view>
          <view class="tile-note">{{ t.note }}</view>
        </view>
      </view>

      <view class="section-title">{{ rangeLabel }}</view>
      <view class="tiles">
        <view v-for="t in kpis" :key="t.label" class="tile">
          <view class="tile-label">{{ t.label }}</view>
          <view class="tile-value">{{ t.value }}</view>
          <view class="tile-note">{{ t.note }}</view>
        </view>
      </view>

      <view v-if="data.daily.length > 1">
        <view class="section-title">每日会话量（{{ data.daily[0].day }} 至 {{ data.daily[data.daily.length - 1].day }}）</view>
        <view class="card card-body">
          <view class="chart">
            <view v-for="d in bars" :key="d.day" class="bar-col" @tap="pick(d)">
              <view class="bar-track">
                <view :class="['bar', picked === d.day ? 'picked' : '']" :style="{ height: d.height }" />
              </view>
              <text class="bar-label">{{ d.label }}</text>
            </view>
          </view>
          <view class="small muted chart-note">{{ pickedText }}</view>
        </view>
      </view>

      <view class="section-title">客服绩效</view>
      <view class="card">
        <view v-for="a in data.agents" :key="a.id" class="agent-row">
          <view class="row">
            <view :class="['dot', 'dot-' + a.status]" />
            <text class="grow agent-row-name ellipsis">{{ a.display_name }}{{ a.disabled ? '（已禁用）' : '' }}</text>
            <text class="small muted">{{ STATUS_LABEL[a.status] }}</text>
          </view>
          <view class="agent-stats small muted">
            会话 {{ formatNumber(a.conversations) }} · 已结束 {{ formatNumber(a.closed) }} · 消息 {{ formatNumber(a.messages) }}
          </view>
          <view class="agent-stats small muted">
            首次响应 {{ formatDuration(a.avg_first_response_ms) }} · 满意度 {{ a.rated ? `${a.avg_rating.toFixed(1)} 分（${a.rated} 条）` : '-' }}
          </view>
        </view>
      </view>
      <view style="height: 24px" />
    </view>
    <view v-else class="empty">{{ error || '加载中…' }}</view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue';
import { onLoad, onShow, onHide, onUnload, onPullDownRefresh } from '@dcloudio/uni-app';
import { get, showError } from '../../api/http';
import { state } from '../../store/state';
import { formatDuration, formatNumber, STATUS_LABEL } from '../../utils/format';

const RANGES = [
  ['today', '今日'],
  ['7d', '近 7 天'],
  ['30d', '近 30 天'],
];

const range = ref('today');
const data = ref(null);
const loading = ref(false);
const error = ref('');
const picked = ref('');
let timer = null;

const rangeLabel = computed(() => RANGES.find((r) => r[0] === range.value)[1]);

const liveTiles = computed(() => {
  const c = data.value.current;
  const agents = state.agents.filter((a) => !a.disabled);
  const tiles = [];
  if (state.settings.ai_enabled || c.bot) tiles.push({ label: 'AI 接待中', value: formatNumber(c.bot), note: '实时' });
  tiles.push({ label: '排队中', value: formatNumber(c.waiting), note: '实时' });
  tiles.push({ label: '进行中', value: formatNumber(c.active), note: '实时' });
  tiles.push({
    label: '在线客服',
    value: formatNumber(agents.filter((a) => a.status === 'online').length),
    note: `共 ${agents.length} 名`,
  });
  return tiles;
});

const kpis = computed(() => {
  const o = data.value.overview;
  const tiles = [
    { label: '会话量', value: formatNumber(o.conversations), note: `${formatNumber(o.visitors)} 位访客` },
    { label: '平均首次响应', value: formatDuration(o.avg_first_response_ms), note: '从咨询到首次回复' },
    {
      label: '满意度',
      value: o.rated ? `${o.avg_rating.toFixed(1)} 分` : '-',
      note: o.rated ? `满意率 ${Math.round((o.satisfied / o.rated) * 100)}%（${o.rated} 条）` : '暂无评价',
    },
    { label: '平均会话时长', value: formatDuration(o.avg_duration_ms), note: `已结束 ${formatNumber(o.closed)} 个` },
    { label: '消息数', value: formatNumber(o.messages), note: '访客与客服消息合计' },
    { label: '未回复会话', value: formatNumber(o.unanswered), note: '客服和 AI 都未回复' },
  ];
  if (state.settings.ai_enabled || o.ai_conversations) {
    tiles.push({
      label: 'AI 接待会话',
      value: formatNumber(o.ai_conversations),
      note: o.ai_conversations ? `AI 独立解决 ${Math.round((o.ai_resolved / o.ai_conversations) * 100)}%` : '暂无',
    });
  }
  if (state.settings.ai_enabled || o.handoffs) {
    tiles.push({ label: '转人工', value: formatNumber(o.handoffs), note: 'AI 转给人工的次数' });
  }
  return tiles;
});

const bars = computed(() => {
  const daily = data.value.daily;
  const max = Math.max(1, ...daily.map((d) => d.conversations));
  const every = Math.ceil(daily.length / 7);
  return daily.map((d, i) => ({
    ...d,
    height: `${Math.round((d.conversations / max) * 100)}%`,
    label: (daily.length - 1 - i) % every === 0 ? d.day.slice(5) : '',
  }));
});

const pickedText = computed(() => {
  const d = data.value.daily.find((x) => x.day === picked.value);
  return d ? `${d.day}：${formatNumber(d.conversations)} 个会话` : '点击柱子查看当天数据';
});

function pick(d) {
  picked.value = d.day;
}

async function load() {
  loading.value = true;
  try {
    data.value = await get(`/api/admin/stats?range=${range.value}`);
    error.value = '';
  } catch (err) {
    if (data.value) showError(err);
    else error.value = err.message;
  } finally {
    loading.value = false;
  }
}

function setRange(key) {
  if (range.value === key) return;
  range.value = key;
  picked.value = '';
  load();
}

onLoad(load);

onShow(() => {
  clearInterval(timer);
  timer = setInterval(load, 60 * 1000);
});

onHide(() => clearInterval(timer));
onUnload(() => clearInterval(timer));

onPullDownRefresh(async () => {
  await load();
  uni.stopPullDownRefresh();
});
</script>

<style>
.refreshing {
  opacity: 0.6;
}
.tiles {
  display: flex;
  flex-wrap: wrap;
  padding: 0 10px;
}
.tile {
  width: calc(50% - 12px);
  margin: 6px;
  padding: 12px 14px;
  background: var(--surface);
  border-radius: 12px;
  box-sizing: border-box;
}
.tile-label {
  font-size: 13px;
  color: var(--text-2);
}
.tile-value {
  font-size: 22px;
  font-weight: 600;
  margin-top: 2px;
}
.tile-note {
  font-size: 11px;
  color: var(--muted);
  margin-top: 2px;
}
.chart {
  display: flex;
  align-items: flex-end;
  height: 160px;
}
.bar-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}
.bar-track {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.bar {
  width: 70%;
  max-width: 22px;
  min-height: 1px;
  background: var(--brand);
  border-radius: 4px 4px 0 0;
}
.bar.picked {
  background: #1d4ed8;
}
.bar-label {
  height: 18px;
  font-size: 10px;
  color: var(--muted);
  white-space: nowrap;
}
.chart-note {
  margin-top: 8px;
}
.agent-row {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.agent-row-name {
  margin-left: 8px;
  font-weight: 500;
}
.agent-stats {
  margin-top: 2px;
}
</style>

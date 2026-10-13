<template>
  <view class="chat">
    <view v-if="state.ready && !state.connected" class="banner">实时连接已断开，正在重新连接…</view>

    <view v-if="conv" class="chat-info">
      <view class="row">
        <text :class="['chip', 'chip-' + conv.status]">{{ CONVERSATION_STATUS[conv.status] }}</text>
        <text class="chat-sub grow ellipsis">{{ subtitle }}</text>
        <text class="link" @tap="openVisitor">访客信息</text>
      </view>
      <view v-if="actions.length" class="chat-actions">
        <button
          v-for="a in actions"
          :key="a.key"
          :class="['btn', 'btn-small', a.primary ? 'btn-primary' : '', a.danger ? 'btn-danger' : '']"
          @tap="act(a.key)"
        >
          {{ a.label }}
        </button>
      </view>
    </view>

    <scroll-view
      class="chat-messages"
      scroll-y
      :scroll-into-view="scrollInto"
      lower-threshold="60"
      @scroll="onScroll"
      @scrolltolower="onScrolledToBottom"
    >
      <view v-if="hasMore" class="load-more" @tap="loadOlder">{{ loadingOlder ? '加载中…' : '加载更早的消息' }}</view>
      <view v-if="loadError" class="empty">{{ loadError }}</view>
      <view v-else-if="loaded && !messages.length" class="empty">暂无消息</view>
      <view v-for="item in rows" :id="'m' + item.msg.id" :key="item.msg.id">
        <view v-if="item.msg.sender_type === 'system'" class="sys-msg">
          <text>{{ item.msg.content }} · {{ item.time }}</text>
        </view>
        <view v-else :class="['msg', item.ours ? 'ours' : 'theirs', item.grouped ? 'grouped' : '']">
          <view v-if="!item.grouped" class="msg-meta">
            <text>{{ item.name }}</text>
            <text v-if="item.bot" class="ai-tag">AI</text>
            <text class="msg-time">{{ item.time }}</text>
          </view>
          <image
            v-if="item.msg.type === 'image'"
            class="msg-image"
            :src="item.url"
            mode="widthFix"
            @load="onImageLoad"
            @tap="preview(item.url)"
          />
          <view v-else :class="['bubble', item.bot ? 'bot' : '']">
            <text :user-select="true" selectable>{{ item.msg.content }}</text>
          </view>
        </view>
      </view>
      <view v-if="typing" class="typing-hint">访客正在输入…</view>
      <view id="chat-bottom" class="chat-bottom" />
    </scroll-view>

    <view v-if="newCount" class="new-pill" @tap="scrollToBottom">{{ newCount }} 条新消息</view>

    <view v-if="conv" class="chat-footer">
      <view v-if="mode === 'compose'" class="composer">
        <view class="composer-row">
          <textarea
            v-model="text"
            class="composer-input"
            auto-height
            :maxlength="2000"
            :show-confirm-bar="false"
            :adjust-position="true"
            :cursor-spacing="16"
            :disable-default-padding="true"
            placeholder="输入回复…"
            @input="onInput"
          />
          <button class="btn btn-primary btn-small send-btn" :disabled="!text.trim() || sending" @tap="send">发送</button>
        </view>
        <view class="composer-tools">
          <text class="tool" @tap="openQuick">快捷回复</text>
          <text class="tool" @tap="chooseImage">{{ uploading ? '图片上传中…' : '发送图片' }}</text>
        </view>
      </view>
      <view v-else class="footer-bar">
        <text class="footer-text">{{ footerText }}</text>
        <text v-if="mode === 'closed' && conv.rating" class="stars">{{ stars(conv.rating) }}</text>
        <button v-if="mode === 'waiting' || mode === 'bot'" class="btn btn-primary btn-small" @tap="accept">
          {{ mode === 'bot' ? '接管会话' : '接入会话' }}
        </button>
      </view>
    </view>

    <!-- quick replies -->
    <view v-if="quickOpen" class="sheet-mask" @tap="quickOpen = false">
      <view class="sheet" @tap.stop="noop">
        <view class="sheet-head">
          <text class="sheet-title">快捷回复</text>
          <text class="link" @tap="quickOpen = false">关闭</text>
        </view>
        <view class="sheet-search">
          <input v-model="quickFilter" class="input" type="text" placeholder="搜索标题或内容" />
        </view>
        <view class="sheet-body">
          <view v-for="r in quickItems" :key="r.id" class="quick-item" hover-class="cell-hover" @tap="applyQuick(r)">
            <view class="quick-title">{{ r.title }}</view>
            <view class="quick-content">{{ r.content }}</view>
          </view>
          <view v-if="!quickItems.length" class="empty">
            {{ state.quickReplies.length ? '没有匹配的快捷回复' : '还没有快捷回复，可由管理员在「我的 → 快捷回复」中添加' }}
          </view>
        </view>
      </view>
    </view>

    <!-- transfer / assign -->
    <view v-if="transferOpen" class="sheet-mask" @tap="transferOpen = false">
      <view class="sheet" @tap.stop="noop">
        <view class="sheet-head">
          <text class="sheet-title">{{ conv && conv.status === 'active' ? '转接给' : '分配给' }}</text>
          <text class="link" @tap="transferOpen = false">取消</text>
        </view>
        <view class="sheet-body">
          <view v-for="a in transferTargets" :key="a.id" class="cell" hover-class="cell-hover" @tap="transfer(a)">
            <view :class="['dot', 'dot-' + a.status]" />
            <view class="cell-label agent-name">{{ a.display_name }}{{ a.id === state.me.id ? '（我）' : '' }}</view>
            <text class="cell-value small">{{ STATUS_LABEL[a.status] }} · 接待 {{ a.active_count || 0 }}/{{ a.max_concurrent }}</text>
          </view>
          <view v-if="!transferTargets.length" class="empty">没有可转接的客服</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue';
import { onLoad, onShow, onHide, onUnload } from '@dcloudio/uni-app';
import { get, post, uploadImage, showError, MAX_IMAGE_BYTES } from '../../api/http';
import { serverUrl } from '../../store/session';
import { state, isAdmin, isMine } from '../../store/state';
import { upsertConversation, knownConversation, refreshAgents } from '../../store/workspace';
import { sendRealtime } from '../../store/app';
import { formatTime, formatDateTime, formatDuration, stars, STATUS_LABEL, CONVERSATION_STATUS } from '../../utils/format';

const PAGE_SIZE = 50;
const GROUP_GAP_MS = 2 * 60 * 1000;
// Unsent text per conversation, kept while the app runs.
const drafts = new Map();

let id = 0;
const conv = ref(null);
const messages = ref([]);
const messageIds = new Set();
const loaded = ref(false);
const loadError = ref('');
const hasMore = ref(false);
const loadingOlder = ref(false);
const typing = ref(false);
const text = ref('');
const sending = ref(false);
const uploading = ref(false);
const quickOpen = ref(false);
const quickFilter = ref('');
const transferOpen = ref(false);
const scrollInto = ref('');
const newCount = ref(0);
let atBottom = true;
let viewHeight = 0;
let visible = false;
let typingTimer = null;
let lastTyping = 0;
const now = ref(Date.now());

// ---- derived ----

const mode = computed(() => {
  const c = conv.value;
  if (!c) return '';
  if (c.status === 'closed') return 'closed';
  if (c.status === 'waiting') return 'waiting';
  if (c.status === 'bot') return 'bot';
  if (isMine(c)) return 'compose';
  return isAdmin() ? 'observe' : 'transferred';
});

const subtitle = computed(() => {
  const c = conv.value;
  if (c.status === 'bot') return 'AI 智能客服正在接待';
  if (c.status === 'waiting') {
    const waited = `已等待 ${formatDuration(now.value - (c.handoff_at || c.created_at))}`;
    return c.handoff_reason ? `${waited} · ${c.handoff_reason}` : waited;
  }
  if (c.status === 'active') return `接待客服：${c.agent_name || '-'}`;
  return `${formatDateTime(c.closed_at)} 结束`;
});

const footerText = computed(() => {
  const c = conv.value;
  switch (mode.value) {
    case 'waiting':
      return '访客正在排队，接入后即可回复';
    case 'bot':
      return 'AI 正在接待，接管后由你继续回复';
    case 'observe':
      return `由客服 ${c.agent_name || ''} 接待中，如需介入请先转接给自己`;
    case 'transferred':
      return `该会话已转接给客服 ${c.agent_name || ''}`;
    default:
      return c.rating ? `访客评价${c.rating_comment ? `：“${c.rating_comment}”` : ''}` : '会话已结束';
  }
});

const actions = computed(() => {
  const c = conv.value;
  if (!c) return [];
  if (c.status === 'waiting' || c.status === 'bot') {
    const list = [{ key: 'accept', label: c.status === 'bot' ? '接管' : '接入', primary: true }];
    if (isAdmin()) list.push({ key: 'transfer', label: '分配' });
    list.push({ key: 'close', label: '结束', danger: true });
    return list;
  }
  if (c.status === 'active' && (isMine(c) || isAdmin())) {
    return [
      { key: 'transfer', label: '转接' },
      { key: 'close', label: '结束', danger: true },
    ];
  }
  return [];
});

const rows = computed(() => {
  let prev = null;
  const visitorName = conv.value ? conv.value.visitor_name : '访客';
  return messages.value.map((msg) => {
    const ours = msg.sender_type === 'agent' || msg.sender_type === 'bot';
    const grouped = Boolean(
      prev &&
        prev.sender_type === msg.sender_type &&
        prev.sender_id === msg.sender_id &&
        msg.created_at - prev.created_at < GROUP_GAP_MS,
    );
    prev = msg;
    return {
      msg,
      ours,
      grouped,
      bot: msg.sender_type === 'bot',
      name: ours ? msg.sender_name || '客服' : visitorName,
      time: formatTime(msg.created_at),
      url: msg.type === 'image' ? serverUrl(msg.content) : '',
    };
  });
});

const quickItems = computed(() => {
  const q = quickFilter.value.trim().toLowerCase();
  return state.quickReplies.filter((r) => !q || r.title.toLowerCase().includes(q) || r.content.toLowerCase().includes(q));
});

const transferTargets = computed(() => {
  const c = conv.value;
  if (!c) return [];
  return state.agents.filter((a) => !a.disabled && a.id !== c.agent_id);
});

// ---- loading ----

function setConversation(next) {
  conv.value = next;
  uni.setNavigationBarTitle({ title: next.visitor_name });
}

async function load() {
  try {
    const [detail, list] = await Promise.all([
      get(`/api/conversations/${id}`),
      get(`/api/conversations/${id}/messages?limit=${PAGE_SIZE}`),
    ]);
    setConversation(detail.conversation);
    upsertConversation(detail.conversation);
    messageIds.clear();
    list.messages.forEach((m) => messageIds.add(m.id));
    messages.value = list.messages;
    hasMore.value = list.messages.length >= PAGE_SIZE;
    loaded.value = true;
    scrollToBottom();
    markRead();
  } catch (err) {
    loadError.value = err.message;
  }
}

/** Adds messages missed while the realtime connection was down. */
async function backfill() {
  if (!loaded.value) return;
  try {
    const { messages: latest } = await get(`/api/conversations/${id}/messages?limit=${PAGE_SIZE}`);
    latest.forEach((m) => appendMessage(m));
    const { conversation } = await get(`/api/conversations/${id}`);
    setConversation(conversation);
  } catch {
    /* the next reconnect retries */
  }
}

async function loadOlder() {
  if (loadingOlder.value || !messages.value.length) return;
  loadingOlder.value = true;
  const firstId = messages.value[0].id;
  try {
    const { messages: older } = await get(`/api/conversations/${id}/messages?before=${firstId}&limit=${PAGE_SIZE}`);
    const fresh = older.filter((m) => !messageIds.has(m.id));
    fresh.forEach((m) => messageIds.add(m.id));
    messages.value = [...fresh, ...messages.value];
    hasMore.value = older.length >= PAGE_SIZE;
    // Keep the previously first message in view.
    scrollInto.value = '';
    nextTick(() => (scrollInto.value = `m${firstId}`));
  } catch (err) {
    showError(err);
  } finally {
    loadingOlder.value = false;
  }
}

function appendMessage(msg) {
  if (messageIds.has(msg.id)) return;
  messageIds.add(msg.id);
  const list = messages.value.slice();
  // Keep id order even when a backfill races a live event.
  let i = list.length;
  while (i > 0 && list[i - 1].id > msg.id) i -= 1;
  list.splice(i, 0, msg);
  messages.value = list;
  if (atBottom || msg.sender_type === 'agent') scrollToBottom();
  else newCount.value += 1;
}

// ---- scrolling ----

function scrollToBottom() {
  newCount.value = 0;
  atBottom = true;
  scrollInto.value = '';
  nextTick(() => {
    scrollInto.value = 'chat-bottom';
  });
}

function measure() {
  uni
    .createSelectorQuery()
    .select('.chat-messages')
    .boundingClientRect((rect) => {
      if (rect) viewHeight = rect.height;
    })
    .exec();
}

function onScroll(event) {
  const { scrollTop, scrollHeight } = event.detail;
  if (!viewHeight) measure();
  atBottom = !viewHeight || scrollHeight - scrollTop - viewHeight < 80;
  if (atBottom) newCount.value = 0;
}

function onScrolledToBottom() {
  atBottom = true;
  newCount.value = 0;
}

function onImageLoad() {
  if (atBottom) scrollToBottom();
}

function preview(url) {
  const urls = rows.value.filter((r) => r.url).map((r) => r.url);
  uni.previewImage({ urls, current: url });
}

// ---- actions ----

function markRead() {
  const c = conv.value;
  if (!visible || !c || c.status !== 'active' || !isMine(c) || !c.agent_unread) return;
  post(`/api/conversations/${id}/read`).catch(() => {});
}

async function accept() {
  try {
    const { conversation } = await post(`/api/conversations/${id}/accept`);
    setConversation(conversation);
    upsertConversation(conversation);
  } catch (err) {
    showError(err);
  }
}

function close() {
  uni.showModal({
    title: '结束会话',
    content: '确定结束该会话吗？访客将收到会话结束提示和评价邀请。',
    confirmText: '结束',
    confirmColor: '#dc2626',
    success: async (res) => {
      if (!res.confirm) return;
      try {
        const { conversation } = await post(`/api/conversations/${id}/close`);
        setConversation(conversation);
        upsertConversation(conversation);
      } catch (err) {
        showError(err);
      }
    },
  });
}

function openTransfer() {
  transferOpen.value = true;
  refreshAgents().catch(() => {});
}

function transfer(agent) {
  const verb = conv.value.status === 'active' ? '转接' : '分配';
  uni.showModal({
    title: `${verb}会话`,
    content: `确定把该会话${verb}给 ${agent.display_name} 吗？`,
    success: async (res) => {
      if (!res.confirm) return;
      try {
        const { conversation } = await post(`/api/conversations/${id}/transfer`, { agent_id: agent.id });
        transferOpen.value = false;
        setConversation(conversation);
        upsertConversation(conversation);
        uni.showToast({ title: `已${verb}给 ${agent.display_name}`, icon: 'none' });
      } catch (err) {
        showError(err);
      }
    },
  });
}

function act(key) {
  if (key === 'accept') accept();
  else if (key === 'transfer') openTransfer();
  else if (key === 'close') close();
}

function openVisitor() {
  uni.navigateTo({ url: `/pages/visitor/visitor?id=${id}` });
}

function noop() {}

// ---- composer ----

function onInput() {
  drafts.set(id, text.value);
  const t = Date.now();
  if (text.value.trim() && t - lastTyping > 2000) {
    lastTyping = t;
    sendRealtime('typing', { conversation_id: id });
  }
}

async function send() {
  const content = text.value.trim();
  if (!content || sending.value) return;
  sending.value = true;
  try {
    const { message } = await post(`/api/conversations/${id}/messages`, { type: 'text', content });
    text.value = '';
    drafts.delete(id);
    lastTyping = 0;
    appendMessage(message);
    scrollToBottom();
  } catch (err) {
    showError(err);
  } finally {
    sending.value = false;
  }
}

function chooseImage() {
  if (uploading.value) return;
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: async (res) => {
      const file = res.tempFiles && res.tempFiles[0];
      if (file && file.size > MAX_IMAGE_BYTES) {
        uni.showToast({ title: '图片不能超过 5MB', icon: 'none' });
        return;
      }
      uploading.value = true;
      try {
        const url = await uploadImage(res.tempFilePaths[0]);
        const { message } = await post(`/api/conversations/${id}/messages`, { type: 'image', content: url });
        appendMessage(message);
        scrollToBottom();
      } catch (err) {
        showError(err);
      } finally {
        uploading.value = false;
      }
    },
  });
}

function openQuick() {
  quickFilter.value = '';
  quickOpen.value = true;
}

function applyQuick(reply) {
  text.value = text.value ? `${text.value}${reply.content}` : reply.content;
  drafts.set(id, text.value);
  quickOpen.value = false;
}

// ---- realtime ----

function onMessage(msg) {
  if (msg.conversation_id !== id || !loaded.value) return;
  appendMessage(msg);
  if (msg.sender_type === 'visitor') {
    hideTyping();
    markRead();
  }
}

function onConversation({ conv: next }) {
  if (next.id !== id) return;
  setConversation(next);
  markRead();
}

function onTyping({ conversation_id: cid, from }) {
  if (cid !== id || from !== 'visitor') return;
  typing.value = true;
  if (atBottom) scrollToBottom();
  clearTimeout(typingTimer);
  typingTimer = setTimeout(hideTyping, 4000);
}

function hideTyping() {
  typing.value = false;
  clearTimeout(typingTimer);
}

let clock = null;

onLoad((query) => {
  id = Number(query.id);
  text.value = drafts.get(id) || '';
  const snapshot = knownConversation(id);
  if (snapshot) setConversation(snapshot);
  uni.$on('ws:message', onMessage);
  uni.$on('ws:conversation', onConversation);
  uni.$on('ws:typing', onTyping);
  uni.$on('ws:resync', backfill);
  load();
});

onShow(() => {
  visible = true;
  state.openConversationId = id;
  now.value = Date.now();
  clock = setInterval(() => (now.value = Date.now()), 30 * 1000);
  markRead();
});

onHide(() => {
  visible = false;
  if (state.openConversationId === id) state.openConversationId = null;
  clearInterval(clock);
});

onUnload(() => {
  visible = false;
  if (state.openConversationId === id) state.openConversationId = null;
  clearInterval(clock);
  clearTimeout(typingTimer);
  uni.$off('ws:message', onMessage);
  uni.$off('ws:conversation', onConversation);
  uni.$off('ws:typing', onTyping);
  uni.$off('ws:resync', backfill);
});
</script>

<style>
.chat {
  display: flex;
  flex-direction: column;
  height: calc(100vh - var(--window-top));
  background: var(--bg);
}
.chat-info {
  flex-shrink: 0;
  padding: 10px 16px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.chat-sub {
  margin: 0 8px;
  font-size: 13px;
  color: var(--muted);
}
.link {
  color: var(--brand);
  font-size: 14px;
  flex-shrink: 0;
}
.chat-actions {
  display: flex;
  margin-top: 10px;
}
.chat-actions .btn {
  flex: 1;
}
.chat-actions .btn + .btn {
  margin-left: 8px;
}
.chat-messages {
  flex: 1;
  height: 0;
}
.chat-bottom {
  height: 12px;
}
.sys-msg {
  text-align: center;
  margin: 12px 24px;
  font-size: 12px;
  color: var(--muted);
}
.msg {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 0 12px;
  margin-top: 12px;
}
.msg.grouped {
  margin-top: 4px;
}
.msg.ours {
  align-items: flex-end;
}
.msg-meta {
  font-size: 12px;
  color: var(--muted);
  margin: 0 4px 4px;
}
.msg-time {
  margin-left: 6px;
}
.ai-tag {
  margin-left: 4px;
  font-size: 10px;
  padding: 0 4px;
  border-radius: 4px;
  background: #f3e8ff;
  color: #7c3aed;
}
.bubble {
  max-width: 78%;
  padding: 9px 12px;
  border-radius: 12px;
  background: var(--surface);
  font-size: 15px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg.ours .bubble {
  background: var(--brand);
  color: #ffffff;
}
.msg.ours .bubble.bot {
  background: #ede9fe;
  color: var(--text);
}
.msg-image {
  width: 180px;
  border-radius: 10px;
  background: var(--surface);
}
.typing-hint {
  padding: 8px 16px 0;
  font-size: 12px;
  color: var(--muted);
}
.new-pill {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: calc(120px + env(safe-area-inset-bottom));
  padding: 6px 14px;
  border-radius: 16px;
  background: var(--brand);
  color: #ffffff;
  font-size: 13px;
  z-index: 5;
}
.chat-footer {
  flex-shrink: 0;
  background: var(--surface);
  border-top: 1px solid var(--border);
  padding-bottom: env(safe-area-inset-bottom);
}
.composer {
  padding: 8px 12px 4px;
}
.composer-row {
  display: flex;
  align-items: flex-end;
}
.composer-input {
  flex: 1;
  width: auto;
  min-height: 22px;
  max-height: 120px;
  padding: 9px 12px;
  border-radius: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  font-size: 15px;
  line-height: 22px;
}
.send-btn {
  margin-left: 8px;
  height: 40px;
  line-height: 40px;
}
.composer-tools {
  display: flex;
  padding: 6px 2px;
}
.tool {
  font-size: 13px;
  color: var(--brand);
  margin-right: 20px;
}
.footer-bar {
  display: flex;
  align-items: center;
  padding: 12px 16px;
}
.footer-text {
  flex: 1;
  font-size: 13px;
  color: var(--muted);
  margin-right: 8px;
}
.footer-bar .stars {
  margin-right: 8px;
}
.sheet-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 20;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.sheet {
  background: var(--surface);
  border-radius: 16px 16px 0 0;
  padding-bottom: env(safe-area-inset-bottom);
}
.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}
.sheet-title {
  font-size: 16px;
  font-weight: 600;
}
.sheet-search {
  padding: 10px 16px 0;
}
.sheet-body {
  max-height: 55vh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.quick-item {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.quick-title {
  font-weight: 600;
  font-size: 15px;
}
.quick-content {
  margin-top: 2px;
  font-size: 13px;
  color: var(--text-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.agent-name {
  margin-left: 10px;
}
</style>

import {
  h,
  clear,
  formatTime,
  formatDateTime,
  formatDuration,
  renderText,
  safeHref,
  describeUserAgent,
  isComposing,
} from '/shared/dom.js';
import { icon } from '/shared/icons.js';
import { get, post, patch, uploadImage } from './api.js';
import { state, on, isAdmin, isMine, upsertConversation } from './state.js';
import {
  avatar,
  button,
  iconButton,
  emptyState,
  toast,
  toastError,
  modal,
  confirmDialog,
  field,
  statusDot,
  STATUS_LABEL,
  CONVERSATION_STATUS,
} from './ui.js';

const PAGE_SIZE = 100;
const GROUP_GAP_MS = 2 * 60 * 1000;
const drafts = new Map();

function stars(rating) {
  if (!rating) return null;
  return h(
    'span',
    { class: 'stars', title: `${rating} 星` },
    [1, 2, 3, 4, 5].map((n) => icon('star', { size: 13, className: n <= rating ? 'star-on' : 'star-off' })),
  );
}

function statusChip(conv) {
  return h('span', { class: `chip chip-${conv.status}` }, CONVERSATION_STATUS[conv.status]);
}

// ---- conversation list item ----

function conversationItem(conv, { selected, onSelect, showAgent }) {
  const showUnread = conv.status === 'waiting' || (conv.status === 'active' && isMine(conv));
  const unread = showUnread ? conv.agent_unread : 0;
  let meta = null;
  if (conv.status === 'waiting') meta = `已等待 ${formatDuration(Date.now() - conv.created_at)}`;
  else if (conv.status === 'closed') meta = h('span', null, conv.agent_name ? `客服 ${conv.agent_name}` : '未接入', ' ', stars(conv.rating));
  else if (showAgent && !isMine(conv)) meta = `客服 ${conv.agent_name || '-'}`;
  return h(
    'button',
    {
      type: 'button',
      class: `conv-item${selected ? ' selected' : ''}${unread ? ' unread' : ''}`,
      onclick: () => onSelect(conv.id),
    },
    avatar(conv.visitor_name, { size: 40, online: conv.status === 'closed' ? undefined : conv.visitor_online }),
    h(
      'span',
      { class: 'conv-main' },
      h(
        'span',
        { class: 'conv-row' },
        h('span', { class: 'conv-name' }, conv.visitor_name),
        h('span', { class: 'conv-time' }, formatTime(conv.status === 'closed' ? conv.closed_at : conv.last_message_at)),
      ),
      h(
        'span',
        { class: 'conv-row' },
        h('span', { class: 'conv-preview' }, conv.last_message_preview || '（暂无消息）'),
        unread ? h('span', { class: 'badge' }, unread > 99 ? '99+' : String(unread)) : null,
      ),
      meta ? h('span', { class: 'conv-meta' }, meta) : null,
    ),
  );
}

// ---- composer ----

class Composer {
  constructor(panel) {
    this.panel = panel;
    this.quickIndex = 0;
    this.lastTyping = 0;
    this.textarea = h('textarea', {
      rows: 3,
      maxlength: 2000,
      placeholder: '输入消息，Enter 发送，Shift+Enter 换行，输入 / 选择快捷回复',
      'aria-label': '消息内容',
    });
    this.textarea.value = drafts.get(panel.id) || '';
    this.fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', hidden: true });
    this.quickPanel = h('div', { class: 'quick-panel', hidden: true });
    this.sendBtn = button('发送', { variant: 'primary', iconName: 'send', onClick: () => this.send() });
    this.el = h(
      'div',
      { class: 'composer' },
      this.quickPanel,
      h(
        'div',
        { class: 'composer-tools' },
        iconButton('zap', { title: '快捷回复', onClick: () => this.toggleQuick() }),
        iconButton('image', { title: '发送图片', onClick: () => this.fileInput.click() }),
        this.fileInput,
      ),
      this.textarea,
      h('div', { class: 'composer-actions' }, h('span', { class: 'composer-hint' }, 'Enter 发送 · Shift+Enter 换行'), this.sendBtn),
    );

    this.textarea.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.textarea.addEventListener('input', () => this.onInput());
    this.textarea.addEventListener('paste', (event) => {
      const file = [...(event.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
      if (file) {
        event.preventDefault();
        this.sendImage(file);
      }
    });
    this.fileInput.addEventListener('change', () => {
      if (this.fileInput.files[0]) this.sendImage(this.fileInput.files[0]);
      this.fileInput.value = '';
    });
  }

  focus() {
    this.textarea.focus({ preventScroll: true });
  }

  destroy() {
    drafts.set(this.panel.id, this.textarea.value);
  }

  onInput() {
    drafts.set(this.panel.id, this.textarea.value);
    const value = this.textarea.value;
    if (value.startsWith('/')) this.showQuick(value.slice(1));
    else if (this.quickMode === 'slash') this.hideQuick();
    const now = Date.now();
    if (value.trim() && state.socket && now - this.lastTyping > 2000) {
      this.lastTyping = now;
      state.socket.emit('typing', { conversation_id: this.panel.id });
    }
  }

  onKeyDown(event) {
    if (!this.quickPanel.hidden) {
      const items = this.quickItems || [];
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        this.quickIndex = (this.quickIndex + delta + items.length) % Math.max(items.length, 1);
        this.renderQuick();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.hideQuick();
        return;
      }
      if (event.key === 'Enter' && !isComposing(event) && this.quickMode === 'slash' && items.length) {
        event.preventDefault();
        this.applyQuick(items[this.quickIndex]);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !isComposing(event)) {
      event.preventDefault();
      this.send();
    }
  }

  toggleQuick() {
    if (!this.quickPanel.hidden && this.quickMode === 'button') this.hideQuick();
    else {
      this.quickMode = 'button';
      this.filter = '';
      this.quickIndex = 0;
      this.renderQuick();
    }
  }

  showQuick(filter) {
    this.quickMode = 'slash';
    if (filter !== this.filter) this.quickIndex = 0;
    this.filter = filter;
    this.renderQuick();
  }

  hideQuick() {
    this.quickPanel.hidden = true;
    this.quickMode = null;
  }

  renderQuick() {
    const q = (this.filter || '').trim().toLowerCase();
    this.quickItems = state.quickReplies.filter(
      (r) => !q || r.title.toLowerCase().includes(q) || r.content.toLowerCase().includes(q),
    );
    clear(this.quickPanel);
    if (this.quickItems.length === 0) {
      this.quickPanel.append(
        h('div', { class: 'quick-empty' }, state.quickReplies.length ? '没有匹配的快捷回复' : '还没有快捷回复，可由管理员在「快捷回复」中添加'),
      );
    } else {
      this.quickItems.forEach((reply, index) => {
        this.quickPanel.append(
          h(
            'button',
            {
              type: 'button',
              class: `quick-item${index === this.quickIndex ? ' active' : ''}`,
              onmousedown: (event) => event.preventDefault(),
              onclick: () => this.applyQuick(reply),
            },
            h('strong', null, reply.title),
            h('span', null, reply.content),
          ),
        );
      });
      this.quickPanel.querySelector('.quick-item.active')?.scrollIntoView({ block: 'nearest' });
    }
    this.quickPanel.hidden = false;
  }

  applyQuick(reply) {
    const ta = this.textarea;
    if (this.quickMode === 'slash') {
      ta.value = reply.content;
    } else {
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      ta.value = ta.value.slice(0, start) + reply.content + ta.value.slice(end);
      ta.selectionStart = ta.selectionEnd = start + reply.content.length;
    }
    drafts.set(this.panel.id, ta.value);
    this.hideQuick();
    this.focus();
  }

  async send() {
    const content = this.textarea.value.trim();
    if (!content || this.sending) return;
    this.sending = true;
    this.sendBtn.disabled = true;
    try {
      const { message } = await post(`/api/conversations/${this.panel.id}/messages`, { type: 'text', content });
      this.textarea.value = '';
      drafts.delete(this.panel.id);
      this.lastTyping = 0;
      this.panel.appendMessage(message);
    } catch (err) {
      toastError(err);
    } finally {
      this.sending = false;
      this.sendBtn.disabled = false;
      this.focus();
    }
  }

  async sendImage(file) {
    try {
      const url = await uploadImage(file);
      const { message } = await post(`/api/conversations/${this.panel.id}/messages`, { type: 'image', content: url });
      this.panel.appendMessage(message);
    } catch (err) {
      toastError(err);
    }
  }
}

// ---- transfer dialog ----

async function openTransferDialog(conv) {
  let agents;
  try {
    ({ agents } = await get('/api/agents'));
  } catch (err) {
    toastError(err);
    return;
  }
  const candidates = agents.filter((a) => !a.disabled && a.id !== conv.agent_id);
  if (candidates.length === 0) {
    toast('没有可转接的客服', 'error');
    return;
  }
  const order = { online: 0, away: 1, offline: 2 };
  candidates.sort((a, b) => order[a.status] - order[b.status] || a.active_count - b.active_count);
  let selected = null;
  const list = h(
    'div',
    { class: 'pick-list' },
    candidates.map((agent) =>
      h(
        'label',
        { class: 'pick-item' },
        h('input', { type: 'radio', name: 'transfer-target', value: agent.id, onchange: () => (selected = agent.id) }),
        avatar(agent.display_name, { size: 32 }),
        h(
          'span',
          { class: 'pick-main' },
          h('span', { class: 'pick-name' }, agent.display_name, agent.id === state.me.id ? '（我）' : ''),
          h('span', { class: 'pick-sub' }, statusDot(agent.status), STATUS_LABEL[agent.status], ` · 接待中 ${agent.active_count}/${agent.max_concurrent}`),
        ),
      ),
    ),
  );
  modal({
    title: conv.status === 'waiting' ? '分配会话' : '转接会话',
    body: list,
    actions: [
      { label: '取消' },
      {
        label: '确定',
        variant: 'primary',
        onClick: async () => {
          if (!selected) {
            toast('请选择一位客服', 'error');
            return false;
          }
          const { conversation } = await post(`/api/conversations/${conv.id}/transfer`, { agent_id: selected });
          upsertConversation(conversation);
          toast('会话已转接', 'success');
          return true;
        },
      },
    ],
  });
}

// ---- chat panel ----

export class ChatPanel {
  constructor(conversationId, { onBack, onToggleInfo } = {}) {
    this.id = conversationId;
    this.onBack = onBack;
    this.onToggleInfo = onToggleInfo;
    this.messageIds = new Set();
    this.lastMessage = null;
    this.footerMode = null;
    this.composer = null;

    this.header = h('header', { class: 'panel-header' });
    this.list = h('div', { class: 'message-list' });
    this.typingEl = h('div', { class: 'typing-hint', hidden: true }, h('span', { class: 'typing-dots' }, h('i'), h('i'), h('i')), '访客正在输入…');
    this.footer = h('div', { class: 'panel-footer' });
    this.el = h('section', { class: 'chat-panel' }, this.header, this.list, this.typingEl, this.footer);
    this.list.append(h('div', { class: 'loading' }, '加载中…'));

    this.onVisible = () => this.markRead();
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('focus', this.onVisible);
    this.unsubscribe = [
      on('message', (msg) => this.onMessage(msg)),
      on('conversation', ({ conv }) => {
        if (conv.id === this.id) this.onConversation(conv);
      }),
      on('typing', (payload) => this.onTyping(payload)),
      on('resync', () => this.backfill()),
    ];
  }

  /** Appends messages missed while the realtime connection was down. */
  async backfill() {
    if (!this.conv) return;
    try {
      const { messages } = await get(`/api/conversations/${this.id}/messages?limit=${PAGE_SIZE}`);
      for (const msg of messages) this.appendMessage(msg);
    } catch {
      /* the next reconnect retries */
    }
  }

  destroy() {
    this.unsubscribe.forEach((fn) => fn());
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('focus', this.onVisible);
    clearTimeout(this.typingTimer);
    if (this.composer) this.composer.destroy();
  }

  async load() {
    const [detail, { messages }] = await Promise.all([
      get(`/api/conversations/${this.id}`),
      get(`/api/conversations/${this.id}/messages?limit=${PAGE_SIZE}`),
    ]);
    this.conv = detail.conversation;
    this.render();
    this.renderMessages(messages);
    upsertConversation(detail.conversation);
    this.markRead();
    return detail;
  }

  render() {
    this.renderHeader();
    this.renderFooter();
  }

  renderHeader() {
    const conv = this.conv;
    let subtitle;
    if (conv.status === 'waiting') subtitle = `已等待 ${formatDuration(Date.now() - conv.created_at)}`;
    else if (conv.status === 'active') subtitle = `接待客服：${conv.agent_name || '-'}`;
    else subtitle = h('span', null, `${formatDateTime(conv.closed_at)} 结束`, ' ', stars(conv.rating));

    const actions = [];
    if (conv.status === 'waiting') {
      actions.push(button('接入', { variant: 'primary', iconName: 'check', onClick: () => this.accept() }));
      if (isAdmin()) actions.push(button('分配', { iconName: 'transfer', onClick: () => openTransferDialog(this.conv) }));
      actions.push(button('结束', { iconName: 'power', onClick: () => this.close() }));
    } else if (conv.status === 'active' && (isMine(conv) || isAdmin())) {
      actions.push(button('转接', { iconName: 'transfer', onClick: () => openTransferDialog(this.conv) }));
      actions.push(button('结束', { iconName: 'power', onClick: () => this.close() }));
    }

    clear(this.header, 
      this.onBack ? iconButton('back', { title: '返回列表', onClick: this.onBack, className: 'back-btn' }) : '',
      avatar(conv.visitor_name, { size: 36, online: conv.status === 'closed' ? undefined : conv.visitor_online }),
      h(
        'div',
        { class: 'panel-title' },
        h('div', { class: 'panel-name' }, conv.visitor_name, ' ', statusChip(conv)),
        h('div', { class: 'panel-sub' }, subtitle),
      ),
      h(
        'div',
        { class: 'panel-actions' },
        actions,
        this.onToggleInfo ? iconButton('info', { title: '访客信息', onClick: this.onToggleInfo, className: 'info-btn' }) : '',
      ),
    );
  }

  footerModeFor(conv) {
    if (conv.status === 'closed') return 'closed';
    if (conv.status === 'waiting') return 'waiting';
    if (isMine(conv)) return 'compose';
    return isAdmin() ? 'observe' : 'transferred';
  }

  renderFooter() {
    const mode = this.footerModeFor(this.conv);
    if (mode === this.footerMode) return;
    this.footerMode = mode;
    if (this.composer) {
      this.composer.destroy();
      this.composer = null;
    }
    clear(this.footer);
    const bar = (...children) => h('div', { class: 'footer-bar' }, ...children);
    if (mode === 'compose') {
      this.composer = new Composer(this);
      this.footer.append(this.composer.el);
      this.composer.focus();
    } else if (mode === 'waiting') {
      this.footer.append(
        bar(h('span', null, '访客正在排队，接入后即可回复'), button('接入会话', { variant: 'primary', onClick: () => this.accept() })),
      );
    } else if (mode === 'observe') {
      this.footer.append(bar(`该会话由客服 ${this.conv.agent_name || ''} 接待中，如需介入请先转接给自己`));
    } else if (mode === 'transferred') {
      this.footer.append(bar(`该会话已转接给客服 ${this.conv.agent_name || ''}`));
    } else {
      const comment = this.conv.rating_comment ? `“${this.conv.rating_comment}”` : '';
      this.footer.append(bar(this.conv.rating ? h('span', null, '访客评价：', stars(this.conv.rating), ' ', comment) : '会话已结束'));
    }
  }

  renderMessages(messages) {
    clear(this.list);
    this.messageIds.clear();
    this.lastMessage = null;
    this.firstId = messages.length ? messages[0].id : null;
    if (messages.length >= PAGE_SIZE) this.list.append(this.loadMoreButton());
    for (const msg of messages) this.appendMessage(msg, { scroll: false });
    if (messages.length === 0) this.list.append(h('div', { class: 'loading' }, '暂无消息'));
    this.scrollToBottom();
  }

  loadMoreButton() {
    return h('button', { type: 'button', class: 'load-more', onclick: (event) => this.loadOlder(event.currentTarget) }, '加载更早的消息');
  }

  async loadOlder(btn) {
    btn.disabled = true;
    try {
      const { messages } = await get(`/api/conversations/${this.id}/messages?before=${this.firstId}&limit=${PAGE_SIZE}`);
      const previousHeight = this.list.scrollHeight;
      const frag = document.createDocumentFragment();
      let prev = null;
      for (const msg of messages) {
        if (this.messageIds.has(msg.id)) continue;
        this.messageIds.add(msg.id);
        frag.append(this.renderMessage(msg, prev));
        prev = msg;
      }
      if (messages.length) this.firstId = messages[0].id;
      btn.after(frag);
      if (messages.length < PAGE_SIZE) btn.remove();
      this.list.scrollTop += this.list.scrollHeight - previousHeight;
    } catch (err) {
      toastError(err);
    } finally {
      btn.disabled = false;
    }
  }

  renderMessage(msg, prev) {
    if (msg.sender_type === 'system') {
      return h('div', { class: 'sys-msg' }, h('span', null, msg.content, ' · ', formatTime(msg.created_at)));
    }
    const ours = msg.sender_type === 'agent';
    const grouped =
      prev &&
      prev.sender_type === msg.sender_type &&
      prev.sender_id === msg.sender_id &&
      msg.created_at - prev.created_at < GROUP_GAP_MS;
    const content =
      msg.type === 'image'
        ? h(
            'a',
            { class: 'bubble image', href: msg.content, target: '_blank', rel: 'noopener' },
            h('img', { src: msg.content, alt: '图片', loading: 'lazy', onload: () => this.scrollToBottom(false) }),
          )
        : h('div', { class: 'bubble' }, renderText(msg.content));
    const name = ours ? msg.sender_name || '客服' : this.conv.visitor_name;
    return h(
      'div',
      { class: `msg ${ours ? 'ours' : 'theirs'}${grouped ? ' grouped' : ''}` },
      grouped ? null : h('div', { class: 'msg-meta' }, h('span', null, name), h('time', null, formatTime(msg.created_at))),
      content,
    );
  }

  appendMessage(msg, { scroll = true } = {}) {
    if (this.messageIds.has(msg.id)) return;
    this.list.querySelector(':scope > .loading')?.remove();
    const stick = this.isNearBottom();
    this.messageIds.add(msg.id);
    this.list.append(this.renderMessage(msg, this.lastMessage));
    this.lastMessage = msg;
    if (scroll) this.scrollToBottom(stick || msg.sender_type === 'agent');
  }

  isNearBottom() {
    return this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 80;
  }

  scrollToBottom(force = true) {
    if (force || this.isNearBottom()) this.list.scrollTop = this.list.scrollHeight;
  }

  onMessage(msg) {
    if (msg.conversation_id !== this.id || !this.conv) return;
    this.appendMessage(msg);
    if (msg.sender_type === 'visitor') {
      this.hideTyping();
      this.markRead();
    }
  }

  onConversation(conv) {
    const previous = this.conv;
    this.conv = conv;
    if (!previous) return;
    this.render();
  }

  onTyping({ conversation_id: id, from }) {
    if (id !== this.id || from !== 'visitor') return;
    this.typingEl.hidden = false;
    clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(() => this.hideTyping(), 4000);
  }

  hideTyping() {
    this.typingEl.hidden = true;
    clearTimeout(this.typingTimer);
  }

  markRead() {
    const conv = state.known.get(this.id) || this.conv;
    if (!conv || document.hidden || !isMine(conv) || conv.status !== 'active' || !conv.agent_unread) return;
    post(`/api/conversations/${this.id}/read`).catch(() => {});
  }

  async accept() {
    try {
      const { conversation } = await post(`/api/conversations/${this.id}/accept`);
      upsertConversation(conversation);
    } catch (err) {
      toastError(err);
    }
  }

  async close() {
    const ok = await confirmDialog('确定结束该会话吗？访客将收到会话结束提示和评价邀请。', { okText: '结束会话', danger: true });
    if (!ok) return;
    try {
      const { conversation } = await post(`/api/conversations/${this.id}/close`);
      upsertConversation(conversation);
    } catch (err) {
      toastError(err);
    }
  }
}

// ---- visitor info panel ----

export class VisitorPanel {
  constructor(conversation, visitor) {
    this.conv = conversation;
    this.visitor = visitor;
    this.editing = false;
    this.el = h('div', { class: 'visitor-panel' });
    this.render();
  }

  update(conversation, visitor) {
    this.conv = conversation;
    if (visitor) this.visitor = visitor;
    if (!this.editing) this.render();
  }

  render() {
    const v = this.visitor;
    const c = this.conv;
    const row = (label, value) => h('div', { class: 'info-row' }, h('span', { class: 'info-label' }, label), h('span', { class: 'info-value' }, value || '-'));
    const pageHref = safeHref(v.page_url);
    const referrerHref = safeHref(v.referrer);
    const link = (href, text) =>
      href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer', title: href }, text || href) : null;

    clear(this.el, 
      h(
        'div',
        { class: 'info-head' },
        avatar(v.display_name, { size: 48, online: v.online }),
        h('div', { class: 'info-name' }, v.display_name),
        h('div', { class: 'info-sub' }, v.online ? '在线' : `最近活跃 ${formatTime(v.last_seen_at)}`),
      ),
      h(
        'section',
        { class: 'info-section' },
        h('div', { class: 'info-title' }, h('span', null, '联系方式'), iconButton('edit', { title: '编辑', onClick: () => this.edit() })),
        row('称呼', v.name),
        row('电话', v.phone),
        row('邮箱', v.email),
        row('备注', v.note ? h('span', { class: 'pre' }, v.note) : null),
      ),
      h(
        'section',
        { class: 'info-section' },
        h('div', { class: 'info-title' }, h('span', null, '访问信息')),
        row('当前页面', link(pageHref, v.page_title || pageHref)),
        row('来源', link(referrerHref)),
        row('设备', describeUserAgent(v.user_agent)),
        row('IP', v.ip),
        row('首次访问', formatDateTime(v.created_at)),
        row('历史会话', `${v.conversation_count} 次`),
      ),
      h(
        'section',
        { class: 'info-section' },
        h('div', { class: 'info-title' }, h('span', null, '本次会话')),
        row('会话编号', `#${c.id}`),
        row('开始时间', formatDateTime(c.created_at)),
        row('排队时长', c.assigned_at ? formatDuration(c.assigned_at - c.created_at) : null),
        row('首次响应', c.first_response_at ? formatDuration(c.first_response_at - c.created_at) : null),
        row('接待客服', c.agent_name),
        c.status === 'closed' ? row('结束时间', formatDateTime(c.closed_at)) : null,
        c.rating ? row('满意度', h('span', null, stars(c.rating), c.rating_comment ? ` ${c.rating_comment}` : '')) : null,
      ),
    );
  }

  edit() {
    this.editing = true;
    const v = this.visitor;
    const inputs = {
      name: h('input', { value: v.name || '', maxlength: 50 }),
      phone: h('input', { value: v.phone || '', maxlength: 30 }),
      email: h('input', { value: v.email || '', maxlength: 100 }),
      note: h('textarea', { value: v.note || '', maxlength: 1000, rows: 4 }),
    };
    const form = h(
      'form',
      { class: 'info-section info-form' },
      h('div', { class: 'info-title' }, h('span', null, '编辑访客信息')),
      field('称呼', inputs.name),
      field('电话', inputs.phone),
      field('邮箱', inputs.email),
      field('备注', inputs.note),
      h(
        'div',
        { class: 'form-actions' },
        button('取消', { onClick: () => { this.editing = false; this.render(); } }),
        button('保存', { variant: 'primary', type: 'submit' }),
      ),
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = {};
      for (const [key, input] of Object.entries(inputs)) body[key] = input.value.trim();
      try {
        const { visitor } = await patch(`/api/conversations/${this.conv.id}/visitor`, body);
        this.visitor = visitor;
        this.editing = false;
        this.render();
        toast('访客信息已更新', 'success');
      } catch (err) {
        toastError(err);
      }
    });
    this.el.querySelector('.info-section').replaceWith(form);
    inputs.name.focus();
  }
}

// ---- shared detail area (panel + info column) ----

class ConversationDetail {
  constructor(panelCol, infoCol, { onBack }) {
    this.panelCol = panelCol;
    this.infoCol = infoCol;
    this.onBack = onBack;
    this.panel = null;
    this.info = null;
    this.unsubscribe = on('conversation', ({ conv, previous }) => {
      if (!this.info || conv.id !== this.info.conv.id) return;
      // Visitor contact changes show up as a new visitor_name; refetch the profile then.
      if (previous && previous.visitor_name !== conv.visitor_name) {
        get(`/api/conversations/${conv.id}`).then((d) => this.info?.update(d.conversation, d.visitor)).catch(() => {});
      } else {
        this.info.update(conv);
      }
    });
  }

  show(id) {
    this.clear();
    this.panel = new ChatPanel(id, {
      onBack: this.onBack,
      onToggleInfo: () => this.infoCol.classList.toggle('open'),
    });
    this.panelCol.append(this.panel.el);
    const panel = this.panel;
    panel
      .load()
      .then(({ conversation, visitor }) => {
        if (this.panel !== panel) return;
        this.info = new VisitorPanel(conversation, visitor);
        clear(this.infoCol, 
          h('div', { class: 'info-close' }, iconButton('x', { title: '关闭', onClick: () => this.infoCol.classList.remove('open') })),
          this.info.el,
        );
      })
      .catch((err) => {
        if (this.panel !== panel) return;
        clear(panel.list, emptyState(err.message));
      });
  }

  clear() {
    if (this.panel) this.panel.destroy();
    this.panel = null;
    this.info = null;
    clear(this.panelCol);
    clear(this.infoCol);
    this.infoCol.classList.remove('open');
  }

  destroy() {
    this.clear();
    this.unsubscribe();
  }
}

function workspaceShell() {
  const listCol = h('aside', { class: 'conv-column' });
  const panelCol = h('div', { class: 'panel-column' });
  const infoCol = h('aside', { class: 'info-column' });
  const el = h('div', { class: 'workspace' }, listCol, panelCol, infoCol);
  return { el, listCol, panelCol, infoCol };
}

// ---- live conversations view ----

let lastSelected = null;
let lastTab = 'active';

export class ChatsView {
  constructor() {
    const shell = workspaceShell();
    Object.assign(this, shell);
    this.tab = lastTab;
    this.mineOnly = false;
    this.selectedId = null;
    this.detail = new ConversationDetail(this.panelCol, this.infoCol, { onBack: () => this.deselect() });

    this.tabs = h('div', { class: 'tabs', role: 'tablist' });
    this.filterBar = h('div', { class: 'list-filter' });
    this.listEl = h('div', { class: 'conv-list' });
    this.listCol.append(h('div', { class: 'column-head' }, h('h2', null, '会话')), this.tabs, this.filterBar, this.listEl);
    this.panelCol.append(emptyState('选择左侧会话开始接待', 'chat'));

    this.unsubscribe = [on('conversations', () => this.renderList()), on('conversation', () => this.renderList())];
    this.timer = setInterval(() => this.renderList(), 30 * 1000);
    this.renderList();
    if (lastSelected && state.known.has(lastSelected)) this.select(lastSelected);
  }

  destroy() {
    this.unsubscribe.forEach((fn) => fn());
    clearInterval(this.timer);
    this.detail.destroy();
  }

  items() {
    const all = [...state.live.values()];
    if (this.tab === 'waiting') {
      return all.filter((c) => c.status === 'waiting').sort((a, b) => a.created_at - b.created_at);
    }
    return all
      .filter((c) => c.status === 'active' && (!this.mineOnly || isMine(c)))
      .sort((a, b) => b.last_message_at - a.last_message_at);
  }

  renderList() {
    const waitingCount = [...state.live.values()].filter((c) => c.status === 'waiting').length;
    const activeCount = [...state.live.values()].filter((c) => c.status === 'active' && (!this.mineOnly || isMine(c))).length;
    const tab = (key, label, count) =>
      h(
        'button',
        {
          type: 'button',
          role: 'tab',
          'aria-selected': String(this.tab === key),
          class: `tab${this.tab === key ? ' active' : ''}`,
          onclick: () => {
            this.tab = lastTab = key;
            this.renderList();
          },
        },
        label,
        h('span', { class: `tab-count${key === 'waiting' && count ? ' alert' : ''}` }, String(count)),
      );
    clear(this.tabs, tab('active', isAdmin() && !this.mineOnly ? '进行中（全部）' : '进行中', activeCount), tab('waiting', '排队中', waitingCount));

    clear(this.filterBar);
    if (isAdmin() && this.tab === 'active') {
      this.filterBar.append(
        h(
          'label',
          { class: 'check' },
          h('input', {
            type: 'checkbox',
            checked: this.mineOnly,
            onchange: (event) => {
              this.mineOnly = event.target.checked;
              this.renderList();
            },
          }),
          '只看我接待的',
        ),
      );
    }

    const items = this.items();
    clear(this.listEl);
    if (items.length === 0) {
      this.listEl.append(emptyState(this.tab === 'waiting' ? '当前没有排队的访客' : '暂无进行中的会话'));
      return;
    }
    for (const conv of items) {
      this.listEl.append(
        conversationItem(conv, { selected: conv.id === this.selectedId, onSelect: (id) => this.select(id), showAgent: isAdmin() }),
      );
    }
  }

  select(id) {
    if (this.selectedId === id) return;
    this.selectedId = lastSelected = id;
    this.el.classList.add('has-selection');
    this.detail.show(id);
    this.renderList();
  }

  deselect() {
    this.selectedId = lastSelected = null;
    this.el.classList.remove('has-selection');
    this.detail.clear();
    this.panelCol.append(emptyState('选择左侧会话开始接待', 'chat'));
    this.renderList();
  }
}

// ---- history view ----

export class HistoryView {
  constructor() {
    const shell = workspaceShell();
    Object.assign(this, shell);
    this.selectedId = null;
    this.items = [];
    this.offset = 0;
    this.query = '';
    this.agentId = '';
    this.detail = new ConversationDetail(this.panelCol, this.infoCol, { onBack: () => this.deselect() });

    this.search = h('input', { type: 'search', placeholder: '搜索访客、电话、消息或会话编号', 'aria-label': '搜索' });
    let debounce;
    this.search.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        this.query = this.search.value.trim();
        this.reload();
      }, 300);
    });
    const filters = [h('div', { class: 'search-box' }, icon('search', { size: 16 }), this.search)];
    if (isAdmin()) {
      const select = h(
        'select',
        { 'aria-label': '按客服筛选', onchange: (event) => { this.agentId = event.target.value; this.reload(); } },
        h('option', { value: '' }, '全部客服'),
        [...state.agents.values()].map((a) => h('option', { value: String(a.id) }, a.display_name)),
      );
      filters.push(select);
    }
    this.listEl = h('div', { class: 'conv-list' });
    this.moreBtn = h('button', { type: 'button', class: 'load-more', hidden: true, onclick: () => this.loadMore() }, '加载更多');
    this.listCol.append(
      h('div', { class: 'column-head' }, h('h2', null, '历史会话')),
      h('div', { class: 'list-filter stack' }, filters),
      this.listEl,
      this.moreBtn,
    );
    this.panelCol.append(emptyState('选择一条历史会话查看聊天记录', 'history'));
    this.reload();
  }

  destroy() {
    this.detail.destroy();
  }

  url() {
    const params = new URLSearchParams({ status: 'closed', limit: '30', offset: String(this.offset) });
    if (this.query) params.set('q', this.query);
    if (this.agentId) params.set('agent_id', this.agentId);
    return `/api/conversations?${params}`;
  }

  async reload() {
    this.offset = 0;
    this.items = [];
    clear(this.listEl, h('div', { class: 'loading' }, '加载中…'));
    await this.loadMore();
  }

  async loadMore() {
    const requestId = (this.requestId = (this.requestId || 0) + 1);
    try {
      const { conversations } = await get(this.url());
      if (requestId !== this.requestId) return;
      this.items.push(...conversations);
      this.offset += conversations.length;
      this.moreBtn.hidden = conversations.length < 30;
      this.renderList();
    } catch (err) {
      toastError(err);
    }
  }

  renderList() {
    clear(this.listEl);
    if (this.items.length === 0) {
      this.listEl.append(emptyState(this.query ? '没有找到匹配的会话' : '还没有历史会话', 'history'));
      return;
    }
    for (const conv of this.items) {
      this.listEl.append(conversationItem(conv, { selected: conv.id === this.selectedId, onSelect: (id) => this.select(id), showAgent: true }));
    }
  }

  select(id) {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.el.classList.add('has-selection');
    this.detail.show(id);
    this.renderList();
  }

  deselect() {
    this.selectedId = null;
    this.el.classList.remove('has-selection');
    this.detail.clear();
    this.panelCol.append(emptyState('选择一条历史会话查看聊天记录', 'history'));
    this.renderList();
  }
}

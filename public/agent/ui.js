import { h } from '/shared/dom.js';
import { icon } from '/shared/icons.js';

export const STATUS_LABEL = { online: '在线', away: '离开', offline: '离线' };
export const CONVERSATION_STATUS = { waiting: '排队中', active: '进行中', closed: '已结束' };

export function statusDot(status) {
  return h('span', { class: `dot dot-${status}`, title: STATUS_LABEL[status] || '' });
}

const AVATAR_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#059669', '#0891b2', '#4f46e5', '#b45309'];

export function avatar(name, { size = 36, online } = {}) {
  const text = (name || '?').trim();
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return h(
    'span',
    {
      class: 'avatar',
      style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.42)}px`, background: AVATAR_COLORS[hash % AVATAR_COLORS.length] },
    },
    text.slice(0, 1).toUpperCase(),
    online === undefined ? null : h('span', { class: `avatar-presence${online ? ' on' : ''}` }),
  );
}

export function button(label, { variant = 'default', iconName, onClick, title, type = 'button', disabled } = {}) {
  return h(
    'button',
    { type, class: `btn btn-${variant}`, onclick: onClick, title, disabled },
    iconName ? icon(iconName, { size: 16 }) : null,
    label ? h('span', null, label) : null,
  );
}

export function iconButton(iconName, { title, onClick, className = '' } = {}) {
  return h('button', { type: 'button', class: `icon-btn ${className}`, title, 'aria-label': title, onclick: onClick }, icon(iconName));
}

export function emptyState(text, iconName = 'inbox') {
  return h('div', { class: 'empty' }, icon(iconName, { size: 32 }), h('p', null, text));
}

// ---- toast ----

let toastHost;
export function toast(message, type = 'info') {
  if (!toastHost) {
    toastHost = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const el = h('div', { class: `toast toast-${type}` }, message);
  toastHost.append(el);
  setTimeout(() => el.classList.add('leaving'), 2600);
  setTimeout(() => el.remove(), 3000);
}

export function toastError(err) {
  toast(err && err.message ? err.message : String(err), 'error');
}

// ---- modal ----

/**
 * Opens a dialog. `actions` are { label, variant, onClick } where onClick may
 * return a promise; returning false keeps the dialog open.
 */
export function modal({ title, body, actions = [], width = 440 }) {
  const previousFocus = document.activeElement;
  const overlay = h('div', { class: 'modal-overlay' });
  const footer = h('div', { class: 'modal-footer' });
  const dialog = h(
    'div',
    { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: { width: `min(${width}px, calc(100vw - 32px))` } },
    h('div', { class: 'modal-header' }, h('h3', null, title), iconButton('x', { title: '关闭', onClick: () => close() })),
    h('div', { class: 'modal-body' }, body),
    footer,
  );

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (previousFocus && previousFocus.focus) previousFocus.focus();
  }

  function onKey(event) {
    if (event.key === 'Escape') close();
  }

  for (const action of actions) {
    const btn = button(action.label, {
      variant: action.variant || 'default',
      onClick: async () => {
        if (!action.onClick) return close();
        btn.disabled = true;
        try {
          const result = await action.onClick();
          if (result !== false) close();
        } catch (err) {
          toastError(err);
        } finally {
          btn.disabled = false;
        }
      },
    });
    footer.append(btn);
  }

  overlay.append(dialog);
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  const focusable = dialog.querySelector('input, textarea, select');
  (focusable || dialog.querySelector('.modal-footer .btn:last-child'))?.focus();
  return { close, dialog };
}

export function confirmDialog(message, { title = '请确认', okText = '确定', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const { dialog } = modal({
      title,
      body: h('p', { class: 'confirm-text' }, message),
      actions: [
        { label: '取消', onClick: () => { answered = true; resolve(false); } },
        { label: okText, variant: danger ? 'danger' : 'primary', onClick: () => { answered = true; resolve(true); } },
      ],
    });
    // Resolve false when closed via the X button, Escape or the backdrop.
    new MutationObserver((_, observer) => {
      if (!dialog.isConnected) {
        observer.disconnect();
        if (!answered) resolve(false);
      }
    }).observe(document.body, { childList: true });
  });
}

/** Labeled form field. */
export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null);
}

// ---- popover menus ----

let openPopover = null;

export function closePopover() {
  if (openPopover) {
    openPopover.remove();
    openPopover = null;
  }
}

/** Shows a floating menu next to `anchor`. */
export function popover(anchor, content, { placement = 'right-end' } = {}) {
  closePopover();
  const el = h('div', { class: 'popover' }, content);
  document.body.append(el);
  const rect = anchor.getBoundingClientRect();
  const { width, height } = el.getBoundingClientRect();
  let left;
  let top;
  if (placement === 'right-end') {
    left = rect.right + 8;
    top = rect.bottom - height;
  } else if (placement === 'top-start') {
    left = rect.left;
    top = rect.top - height - 8;
  } else {
    left = rect.right - width;
    top = rect.bottom + 6;
  }
  el.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
  el.style.top = `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`;
  openPopover = el;
  setTimeout(() => {
    const dismiss = (event) => {
      if (!el.contains(event.target)) {
        closePopover();
        document.removeEventListener('mousedown', dismiss);
      }
    };
    document.addEventListener('mousedown', dismiss);
  });
  return el;
}

export function menu(items) {
  return h(
    'div',
    { class: 'menu', role: 'menu' },
    items.map((item) =>
      item === '-'
        ? h('div', { class: 'menu-sep' })
        : h(
            'button',
            {
              type: 'button',
              role: 'menuitem',
              class: `menu-item${item.active ? ' active' : ''}${item.danger ? ' danger' : ''}`,
              onclick: () => {
                closePopover();
                item.onClick();
              },
            },
            item.prefix || (item.icon ? icon(item.icon, { size: 16 }) : null),
            h('span', null, item.label),
          ),
    ),
  );
}

// ---- desktop notifications & sound ----

let audioCtx;
function beep() {
  try {
    audioCtx = audioCtx || new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.35);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.4);
  } catch {
    /* audio unavailable */
  }
}

export const notifier = {
  get supported() {
    return 'Notification' in window;
  },
  get enabled() {
    return this.supported && Notification.permission === 'granted';
  },
  async request() {
    if (!this.supported) return false;
    if (Notification.permission === 'default') await Notification.requestPermission();
    return this.enabled;
  },
  alert(title, body, onClick) {
    beep();
    if (!document.hidden || !this.enabled) return;
    const n = new Notification(title, { body, tag: 'feeof-chat', renotify: true });
    n.onclick = () => {
      window.focus();
      n.close();
      if (onClick) onClick();
    };
  },
};

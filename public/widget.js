/*
 * Feeof 在线客服挂件
 *
 * 在任意网页中加入：
 *   <script src="https://你的域名/widget.js" async></script>
 *
 * 可选属性：
 *   data-color="#2563eb"   按钮颜色（默认取后台设置的主题色）
 *   data-position="left"   按钮显示在左下角
 *   data-name / data-email 已登录用户的称呼、邮箱，会带给客服
 *
 * JS 接口：window.FeeofChat.open() / close() / toggle()
 */
(function () {
  'use strict';
  if (window.FeeofChat) return;

  var script = document.currentScript;
  if (!script) return;
  var origin = new URL(script.getAttribute('data-server') || script.src, location.href).origin;
  var position = script.getAttribute('data-position') === 'left' ? 'left' : 'right';
  var color = script.getAttribute('data-color');
  var USED_KEY = 'feeof_chat_used';

  var css =
    '.feeof-launcher{position:fixed;bottom:20px;' + position + ':20px;z-index:2147483000;width:56px;height:56px;border:0;border-radius:50%;' +
    'background:var(--feeof-color,#2563eb);color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.2);cursor:pointer;display:grid;place-items:center;' +
    'transition:transform .15s ease}' +
    '.feeof-launcher:hover{transform:scale(1.06)}' +
    '.feeof-launcher svg{width:26px;height:26px}' +
    '.feeof-badge{position:absolute;top:-2px;right:-2px;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:#ef4444;' +
    'color:#fff;font:600 12px/20px sans-serif;text-align:center;box-sizing:border-box}' +
    '.feeof-badge[hidden]{display:none}' +
    '.feeof-panel{position:fixed;bottom:88px;' + position + ':20px;z-index:2147483000;width:380px;height:600px;max-height:calc(100vh - 108px);' +
    'border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.25);background:#fff;opacity:0;transform:translateY(12px);' +
    'pointer-events:none;visibility:hidden;transition:opacity .2s ease,transform .2s ease,visibility .2s}' +
    '.feeof-panel.feeof-open{opacity:1;transform:none;pointer-events:auto;visibility:visible}' +
    '.feeof-panel iframe{width:100%;height:100%;border:0;display:block}' +
    '@media (max-width:480px){.feeof-panel{inset:0;width:auto;height:auto;max-height:none;border-radius:0}' +
    '.feeof-panel.feeof-open~.feeof-launcher{display:none}}';

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var panel = document.createElement('div');
  panel.className = 'feeof-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '在线客服');

  var launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'feeof-launcher';
  launcher.setAttribute('aria-label', '在线客服');
  launcher.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var badge = document.createElement('span');
  badge.className = 'feeof-badge';
  badge.hidden = true;
  launcher.appendChild(badge);

  var iframe = null;
  var isOpen = false;

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      /* ignore */
    }
  }

  function setColor(value) {
    if (/^#[0-9a-fA-F]{6}$/.test(value || '')) {
      launcher.style.setProperty('--feeof-color', value);
    }
  }

  function post(message) {
    if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage(message, origin);
  }

  function ensureFrame() {
    if (iframe) return;
    var query = new URLSearchParams({ embed: '1', ref: location.href, title: document.title, referrer: document.referrer });
    var name = script.getAttribute('data-name');
    var email = script.getAttribute('data-email');
    if (name) query.set('name', name);
    if (email) query.set('email', email);
    iframe = document.createElement('iframe');
    iframe.src = origin + '/chat.html?' + query.toString();
    iframe.title = '在线客服';
    iframe.allow = 'clipboard-write';
    panel.appendChild(iframe);
    storageSet(USED_KEY, '1');
  }

  function setBadge(count) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = !count;
  }

  function open() {
    ensureFrame();
    isOpen = true;
    panel.classList.add('feeof-open');
    setBadge(0);
    post({ type: 'feeof:visibility', open: true });
  }

  function close() {
    isOpen = false;
    panel.classList.remove('feeof-open');
    post({ type: 'feeof:visibility', open: false });
    launcher.focus();
  }

  function toggle() {
    if (isOpen) close();
    else open();
  }

  launcher.addEventListener('click', toggle);

  window.addEventListener('message', function (event) {
    if (event.origin !== origin || !iframe || event.source !== iframe.contentWindow) return;
    var data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'feeof:minimize') close();
    else if (data.type === 'feeof:unread' && !isOpen) setBadge(Number(data.count) || 0);
    else if (data.type === 'feeof:ready') post({ type: 'feeof:visibility', open: isOpen });
  });

  function mount() {
    document.body.appendChild(panel);
    document.body.appendChild(launcher);
    // Returning visitors load the chat in the background so replies show up as a badge.
    if (storageGet(USED_KEY)) ensureFrame();
  }

  if (color) {
    setColor(color);
  } else {
    fetch(origin + '/api/widget/config')
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        setColor(data.config && data.config.theme_color);
      })
      .catch(function () {});
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);

  window.FeeofChat = { open: open, close: close, toggle: toggle };
})();

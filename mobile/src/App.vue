<script>
import { appShown, appHidden, networkChanged } from './store/app';

export default {
  onLaunch(options) {
    // Every page needs the logged-in workspace, which the login page restores (or asks for).
    // Matters when the H5 page is reloaded, or a mini program is opened on a deep page.
    if (options && options.path && options.path !== 'pages/login/login') {
      setTimeout(() => uni.reLaunch({ url: '/pages/login/login' }), 0);
    }
    uni.onNetworkStatusChange((res) => networkChanged(res.isConnected));
    // #ifdef APP-PLUS
    // Tapping a system notification opens the conversation list.
    if (typeof uni.onPushMessage === 'function') {
      uni.onPushMessage((res) => {
        if (res.type === 'click') uni.switchTab({ url: '/pages/conversations/conversations' });
      });
    }
    // #endif
  },
  onShow() {
    appShown();
  },
  onHide() {
    appHidden();
  },
};
</script>

<style>
page {
  --brand: #2563eb;
  --brand-soft: #eff4ff;
  --bg: #f4f5f7;
  --surface: #ffffff;
  --surface-2: #f8f9fb;
  --text: #1f2328;
  --text-2: #4b5563;
  --muted: #6b7280;
  --border: #e5e7eb;
  --danger: #dc2626;
  --success: #16a34a;
  --warning: #d97706;
  --star: #f59e0b;
  background: var(--bg);
  color: var(--text);
  font-size: 15px;
  line-height: 1.5;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', 'Microsoft YaHei', sans-serif;
}

/* #ifdef H5 */
body {
  background-color: #f4f5f7;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', 'Microsoft YaHei', sans-serif;
}
/* uni-app preloads a navigation bar shadow image from its CDN; this app does not use it. */
body::after {
  animation: none !important;
}
/* #endif */

/* ---- layout ---- */
.page-pad {
  padding: 12px 16px;
}
.section-title {
  padding: 16px 16px 6px;
  font-size: 13px;
  color: var(--muted);
}
.card {
  background: var(--surface);
  border-radius: 12px;
  margin: 12px 16px;
  overflow: hidden;
}
.card-body {
  padding: 14px 16px;
}
.row {
  display: flex;
  align-items: center;
}
.grow {
  flex: 1;
  min-width: 0;
}
.ellipsis {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.muted {
  color: var(--muted);
}
.small {
  font-size: 13px;
}

/* ---- list cells ---- */
.cell {
  display: flex;
  align-items: center;
  min-height: 52px;
  padding: 10px 16px;
  background: var(--surface);
  position: relative;
}
.cell + .cell::before {
  content: '';
  position: absolute;
  left: 16px;
  right: 0;
  top: 0;
  border-top: 1px solid var(--border);
}
.cell-hover {
  background: var(--surface-2);
}
.cell-label {
  flex: 1;
  min-width: 0;
}
.cell-value {
  color: var(--muted);
  margin-left: 12px;
  text-align: right;
  max-width: 60%;
  word-break: break-all;
}
.cell-arrow {
  color: #c0c4cc;
  margin-left: 8px;
  font-size: 18px;
}

/* ---- forms ---- */
.field {
  padding: 12px 16px;
  background: var(--surface);
  position: relative;
}
.field + .field::before {
  content: '';
  position: absolute;
  left: 16px;
  right: 0;
  top: 0;
  border-top: 1px solid var(--border);
}
.field-label {
  font-size: 13px;
  color: var(--text-2);
  margin-bottom: 6px;
}
.field-hint {
  font-size: 12px;
  color: var(--muted);
  margin-top: 6px;
}
.input {
  height: 40px;
  line-height: 40px;
  font-size: 15px;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0 12px;
}
.textarea {
  width: auto;
  min-height: 96px;
  font-size: 15px;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
}
.picker-value {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* ---- buttons ---- */
.btn {
  margin: 0;
  padding: 0 16px;
  height: 40px;
  line-height: 40px;
  font-size: 15px;
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
}
.btn::after {
  border: none;
}
.btn-primary {
  background: var(--brand);
  color: #ffffff;
  border-color: var(--brand);
}
.btn-danger {
  color: var(--danger);
}
.btn-small {
  height: 32px;
  line-height: 32px;
  font-size: 14px;
  padding: 0 12px;
}
.btn-block {
  display: block;
  width: 100%;
}
.btn[disabled] {
  opacity: 0.6;
}
.actions {
  padding: 16px;
}
.actions .btn + .btn {
  margin-top: 12px;
}

/* ---- chips, badges, dots ---- */
.chip {
  display: inline-block;
  font-size: 11px;
  line-height: 18px;
  padding: 0 6px;
  border-radius: 9px;
  background: var(--surface-2);
  color: var(--text-2);
  vertical-align: middle;
}
.chip-bot {
  background: #f3e8ff;
  color: #7c3aed;
}
.chip-waiting {
  background: #fff7ed;
  color: #c2410c;
}
.chip-active {
  background: #ecfdf5;
  color: #047857;
}
.chip-closed {
  background: #f3f4f6;
  color: #6b7280;
}
.badge {
  min-width: 18px;
  height: 18px;
  line-height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--danger);
  color: #ffffff;
  font-size: 11px;
  text-align: center;
  box-sizing: border-box;
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 4px;
  background: #9ca3af;
  vertical-align: middle;
}
.dot-online {
  background: var(--success);
}
.dot-away {
  background: var(--warning);
}
.stars {
  color: var(--star);
  letter-spacing: 1px;
}

/* ---- segmented tabs ---- */
.seg {
  display: flex;
  background: #e9ebef;
  border-radius: 9px;
  padding: 3px;
}
.seg-item {
  flex: 1;
  text-align: center;
  font-size: 14px;
  line-height: 32px;
  border-radius: 7px;
  color: var(--text-2);
}
.seg-item.active {
  background: var(--surface);
  color: var(--text);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
.seg-count {
  margin-left: 4px;
  font-size: 12px;
  color: var(--muted);
}
.seg-count.alert {
  color: var(--danger);
  font-weight: 600;
}

/* ---- banners & empty states ---- */
.banner {
  padding: 8px 16px;
  font-size: 13px;
  background: #fff7ed;
  color: #9a3412;
}
.empty {
  padding: 64px 24px;
  text-align: center;
  color: var(--muted);
  font-size: 14px;
}
.load-more {
  padding: 16px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}
.fab {
  position: fixed;
  right: 20px;
  bottom: calc(24px + env(safe-area-inset-bottom));
  width: 52px;
  height: 52px;
  border-radius: 26px;
  background: var(--brand);
  color: #ffffff;
  font-size: 30px;
  line-height: 50px;
  text-align: center;
  box-shadow: 0 6px 16px rgba(37, 99, 235, 0.35);
  z-index: 10;
}

/* Last, so they win over the muted colors above. */
.text-ok {
  color: var(--success);
}
.text-warn {
  color: var(--danger);
}
</style>

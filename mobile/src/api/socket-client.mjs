/**
 * Minimal Socket.IO client (Engine.IO v4 / Socket.IO v5 protocol, websocket
 * transport only, default namespace, text packets).
 *
 * The official socket.io-client does not run in mini programs or the App, so
 * this speaks the wire protocol directly over whatever websocket the platform
 * provides. `transport(url, handlers)` opens a websocket and returns
 * `{ send(text), close() }`; it calls `handlers.onOpen()`,
 * `handlers.onMessage(data)` and `handlers.onClose(reason)`.
 *
 * Events emitted to listeners:
 *   connect            the namespace connection is ready
 *   disconnect         (reason) the connection was lost or closed
 *   connect_error      (message) the server refused the connection, e.g. "unauthorized"
 *   reconnecting       ({ attempt, delay }) a reconnect is scheduled
 *   <server events>    (payload) e.g. "message", "conversation:update"
 */

const LIFECYCLE = new Set(['connect', 'disconnect', 'connect_error', 'reconnecting']);

export class SocketClient {
  constructor({ url, auth = () => ({}), transport, reconnect = true, minDelay = 1000, maxDelay = 15000, random = Math.random }) {
    this.url = `${url.replace(/^http/, 'ws').replace(/\/+$/, '')}/socket.io/?EIO=4&transport=websocket`;
    this.auth = typeof auth === 'function' ? auth : () => auth;
    this.transport = transport;
    this.reconnect = reconnect;
    this.minDelay = minDelay;
    this.maxDelay = maxDelay;
    this.random = random;
    this.listeners = new Map();
    this.conn = null;
    this.connected = false;
    this.active = false;
    this.attempts = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.heartbeatMs = 0;
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event).delete(fn);
  }

  fire(event, ...args) {
    for (const fn of [...(this.listeners.get(event) || [])]) {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[socket] ${event} handler failed`, err);
      }
    }
  }

  /** Sends an event to the server. Dropped while disconnected (only ephemeral events are sent this way). */
  emit(event, data) {
    if (!this.connected || LIFECYCLE.has(event)) return false;
    this.conn.send(`42${JSON.stringify(data === undefined ? [event] : [event, data])}`);
    return true;
  }

  /** Starts connecting, and keeps reconnecting until disconnect() is called. */
  connect() {
    this.active = true;
    if (this.conn) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.open();
  }

  /** Reconnects right away, e.g. when the app returns to the foreground. */
  reconnectNow() {
    if (!this.active || this.conn) return;
    this.attempts = 0;
    this.connect();
  }

  disconnect() {
    this.active = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.conn) {
      if (this.connected) this.conn.send('41');
      this.drop('io client disconnect');
    }
  }

  open() {
    const conn = { send: () => {}, close: () => {}, opened: false };
    this.conn = conn;
    const current = () => this.conn === conn;
    let socket;
    try {
      socket = this.transport(this.url, {
        onOpen: () => {
          if (current()) conn.opened = true;
        },
        onMessage: (data) => {
          if (current()) this.receive(data);
        },
        onClose: (reason) => {
          if (current()) this.drop(reason || 'transport close');
        },
      });
    } catch (err) {
      this.drop(`transport error: ${err.message}`);
      return;
    }
    conn.send = (text) => {
      try {
        socket.send(text);
      } catch {
        /* the close handler reports the failure */
      }
    };
    conn.close = () => {
      try {
        socket.close();
      } catch {
        /* already closed */
      }
    };
    // Give up on a handshake that never completes.
    this.resetHeartbeat(20000);
  }

  receive(data) {
    if (typeof data !== 'string' || data.length === 0) return;
    if (this.heartbeatMs) this.resetHeartbeat(this.heartbeatMs);
    switch (data[0]) {
      case '0': {
        // Engine.IO open: heartbeat settings, then join the default namespace.
        const info = parseJson(data.slice(1)) || {};
        this.heartbeatMs = (Number(info.pingInterval) || 25000) + (Number(info.pingTimeout) || 20000);
        this.resetHeartbeat(this.heartbeatMs);
        this.conn.send(`40${JSON.stringify(this.auth() || {})}`);
        break;
      }
      case '1':
        this.drop('transport close');
        break;
      case '2':
        this.conn.send('3');
        break;
      case '4':
        this.receivePacket(data.slice(1));
        break;
      default:
        break;
    }
  }

  receivePacket(packet) {
    const type = packet[0];
    // Namespaced packets ("/admin,...") are not used by this app.
    if (packet[1] === '/') return;
    if (type === '0') {
      this.connected = true;
      this.attempts = 0;
      this.fire('connect');
    } else if (type === '1') {
      // The server ended the session (e.g. the account logged out elsewhere): do not reconnect.
      this.active = false;
      this.drop('io server disconnect');
    } else if (type === '2') {
      const args = parseJson(packet.slice(1).replace(/^\d+/, ''));
      if (Array.isArray(args) && typeof args[0] === 'string') this.fire(args[0], ...args.slice(1));
    } else if (type === '4') {
      const error = parseJson(packet.slice(1)) || {};
      const message = error.message || 'connect error';
      if (message === 'unauthorized') this.active = false;
      this.fire('connect_error', message);
      this.drop('connect error', { silent: true });
    }
  }

  /** Tears down the current connection and schedules a reconnect if still wanted. */
  drop(reason, { silent = false } = {}) {
    const conn = this.conn;
    if (!conn) return;
    this.conn = null;
    clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.heartbeatMs = 0;
    conn.close();
    const wasConnected = this.connected;
    this.connected = false;
    if (wasConnected) this.fire('disconnect', reason);
    else if (!silent && reason !== 'io client disconnect') this.fire('connect_error', reason);
    if (this.active && this.reconnect) this.scheduleReconnect();
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    const base = Math.min(this.maxDelay, this.minDelay * 2 ** this.attempts);
    const delay = Math.round(base * (0.5 + this.random() * 0.5));
    this.attempts += 1;
    this.fire('reconnecting', { attempt: this.attempts, delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.active && !this.conn) this.open();
    }, delay);
  }

  resetHeartbeat(ms) {
    clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => this.drop('ping timeout'), ms);
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

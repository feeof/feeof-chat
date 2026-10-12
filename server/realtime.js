'use strict';

const { hashToken } = require('./auth');

function setupRealtime(io, { store, service, presence }) {
  io.use((socket, next) => {
    const { token, visitorToken } = socket.handshake.auth || {};
    if (typeof token === 'string' && token) {
      const tokenHash = hashToken(token);
      const user = store.getSessionUser(tokenHash);
      if (!user) return next(new Error('unauthorized'));
      Object.assign(socket.data, { kind: 'agent', userId: user.id, role: user.role, tokenHash });
      return next();
    }
    if (typeof visitorToken === 'string' && visitorToken) {
      const visitor = store.getVisitorByTokenHash(hashToken(visitorToken));
      if (!visitor) return next(new Error('unauthorized'));
      Object.assign(socket.data, { kind: 'visitor', visitorId: visitor.id });
      return next();
    }
    return next(new Error('unauthorized'));
  });

  // Handlers run outside Express, so errors must not escape and crash the process.
  const safe = (fn) => (...args) => {
    try {
      fn(...args);
    } catch (err) {
      console.error('[realtime]', err);
    }
  };

  io.on('connection', safe((socket) => {
    if (socket.data.kind === 'agent') handleAgent(socket);
    else handleVisitor(socket);
  }));

  function handleAgent(socket) {
    const { userId, role } = socket.data;
    socket.join(['agents', `agent:${userId}`]);
    if (role === 'admin') socket.join('admins');
    const firstConnection = presence.addAgent(userId);

    socket.on('typing', safe((payload) => {
      const conversationId = Number(payload && payload.conversation_id);
      if (Number.isSafeInteger(conversationId)) service.agentTyping(userId, conversationId);
    }));

    socket.on('disconnect', safe(() => {
      if (presence.removeAgent(userId)) service.agentConnectionChanged(userId);
    }));

    if (firstConnection) service.agentConnectionChanged(userId);
  }

  function handleVisitor(socket) {
    const { visitorId } = socket.data;
    socket.join(['visitors', `visitor:${visitorId}`]);
    const firstConnection = presence.addVisitor(visitorId);

    // Clients already throttle typing events; this only caps abusive bursts.
    let typingWindow = 0;
    let typingCount = 0;
    socket.on('typing', safe(() => {
      const now = Date.now();
      if (now - typingWindow > 2000) {
        typingWindow = now;
        typingCount = 0;
      }
      if (++typingCount > 4) return;
      service.visitorTyping(visitorId);
    }));

    socket.on('disconnect', safe(() => {
      if (presence.removeVisitor(visitorId)) service.visitorConnectionChanged(visitorId);
    }));

    if (firstConnection) service.visitorConnectionChanged(visitorId);
  }
}

module.exports = { setupRealtime };

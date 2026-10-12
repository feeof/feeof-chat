'use strict';

const path = require('node:path');

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

function envFlag(value) {
  return value === '1' || value === 'true';
}

function loadConfig(overrides = {}) {
  const dataDir = overrides.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  return {
    port: Number(process.env.PORT) || 3000,
    host: process.env.HOST || '0.0.0.0',
    dataDir,
    dbFile: path.join(dataDir, 'feeof-chat.db'),
    uploadsDir: path.join(dataDir, 'uploads'),
    publicDir: path.join(__dirname, '..', 'public'),
    // Initial admin account, created only when the database has no users yet.
    adminUsername: process.env.ADMIN_USERNAME || 'admin',
    adminPassword: process.env.ADMIN_PASSWORD || '',
    trustProxy: envFlag(process.env.TRUST_PROXY),
    // Value of the CSP frame-ancestors directive for the visitor chat page,
    // i.e. which sites may embed the widget. "*" allows any site.
    widgetFrameAncestors: process.env.WIDGET_FRAME_ANCESTORS || '*',
    sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
    maxMessageLength: 2000,
    maxUploadBytes: 5 * 1024 * 1024,
    maintenanceIntervalMs: 60 * 1000,
    ...overrides,
    // AI customer service (Claude). Credentials come from ANTHROPIC_API_KEY.
    // Connection settings here are defaults; the admin UI (settings table) overrides them.
    ai: {
      provider: process.env.AI_PROVIDER === 'openai' ? 'openai' : 'anthropic',
      baseUrl: process.env.AI_BASE_URL || '',
      apiKey: process.env.AI_API_KEY || '',
      // Empty means the provider's default (claude-opus-5-5 for Anthropic).
      model: process.env.AI_MODEL || '',
      // Anthropic only. Chat replies are latency-sensitive; raise to 'medium'
      // if answers need more reasoning. 'none' leaves it to the model default.
      effort:
        process.env.AI_EFFORT === 'none' ? '' : EFFORTS.includes(process.env.AI_EFFORT) ? process.env.AI_EFFORT : 'low',
      // OpenAI-compatible only: whether the model accepts image input.
      vision: envFlag(process.env.AI_VISION),
      // Thinking counts toward this limit as well as the reply.
      maxTokens: Number(process.env.AI_MAX_TOKENS) || 8000,
      // Knowledge bases up to this size are sent whole (and prompt-cached);
      // larger ones are searched per question.
      fullKnowledgeMaxChars: Number(process.env.AI_FULL_KB_MAX_CHARS) || 60000,
      fallbacks: process.env.AI_FALLBACKS !== 'off',
      // Bounds what one conversation can cost; beyond it a human takes over.
      maxRepliesPerConversation: Number(process.env.AI_MAX_REPLIES) || 30,
      ...overrides.ai,
    },
  };
}

module.exports = { loadConfig, EFFORTS };

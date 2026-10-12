'use strict';

const express = require('express');
const { HttpError, badRequest, notFound, readString, readInt, readId, RateLimiter } = require('../util');
const { PROVIDERS } = require('../ai/assistant');
const { EFFORTS } = require('../config');

const MAX_IMPORT = 500;

/** Knowledge base management and AI diagnostics. Mounted inside the admin router (already authenticated). */
function knowledgeRoutes({ store, ai, knowledge }) {
  const router = express.Router();
  const testLimiter = new RateLimiter({ limit: 20, windowMs: 60 * 1000 });

  function readArticle(body, required) {
    const article = {
      title: readString(body.title, { field: '标题', required, max: 100 }),
      content: readString(body.content, { field: '内容', required, max: 20000 }),
    };
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') throw badRequest('enabled 必须是布尔值');
      article.enabled = body.enabled;
    }
    return article;
  }

  const view = (a) => ({ ...a, enabled: Boolean(a.enabled) });

  router.get('/kb', (req, res) => {
    const { articles, total } = store.listKbArticles({
      q: readString(req.query.q, { field: '搜索关键词', max: 100 }),
      limit: readInt(req.query.limit, { field: 'limit', min: 1, max: 200 }) ?? 50,
      offset: readInt(req.query.offset, { field: 'offset', min: 0 }) ?? 0,
    });
    res.json({ articles: articles.map(view), total, ai: ai.status() });
  });

  router.post('/kb', (req, res) => {
    const [article] = store.createKbArticles([readArticle(req.body, true)]);
    res.status(201).json({ article: view(article) });
  });

  router.post('/kb/import', (req, res) => {
    const list = req.body.articles;
    if (!Array.isArray(list) || list.length === 0) throw badRequest('没有可导入的内容');
    if (list.length > MAX_IMPORT) throw badRequest(`单次最多导入 ${MAX_IMPORT} 条`);
    const articles = list.map((item, i) => {
      try {
        return readArticle(item || {}, true);
      } catch (err) {
        throw badRequest(`第 ${i + 1} 条：${err.message}`);
      }
    });
    res.status(201).json({ created: store.createKbArticles(articles).length });
  });

  router.patch('/kb/:id', (req, res) => {
    const id = readId(req.params.id);
    if (!store.getKbArticle(id)) throw notFound('知识条目不存在');
    res.json({ article: view(store.updateKbArticle(id, readArticle(req.body, false))) });
  });

  router.delete('/kb/:id', (req, res) => {
    if (!store.deleteKbArticle(readId(req.params.id))) throw notFound('知识条目不存在');
    res.json({ ok: true });
  });

  // Shows which articles a question would retrieve, without calling the AI.
  router.get('/kb/search', (req, res) => {
    const q = readString(req.query.q, { field: '问题', required: true, max: 500 });
    const results = knowledge.search(q, 5).map(({ article, score }) => ({
      id: article.id,
      title: article.title,
      score: Math.round(score * 100) / 100,
    }));
    res.json({ results });
  });

  router.get('/ai/status', (req, res) => {
    res.json({ status: ai.status() });
  });

  // ---- AI connection: interface type, API URL, API key, model ----

  router.get('/ai/connection', (req, res) => {
    res.json({ connection: ai.connectionView() });
  });

  router.put('/ai/connection', (req, res) => {
    const body = req.body;
    const patch = {};
    if (body.provider !== undefined) {
      if (!PROVIDERS.includes(body.provider)) throw badRequest('接口类型无效');
      patch.provider = body.provider;
    }
    if (body.base_url !== undefined) {
      const url = readString(body.base_url, { field: 'API 地址', max: 500 });
      if (url) {
        let parsed;
        try {
          parsed = new URL(url);
        } catch {
          throw badRequest('API 地址格式不正确');
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) throw badRequest('API 地址必须以 http:// 或 https:// 开头');
      }
      // An empty value means the interface type's official address.
      patch.base_url = url ? url.replace(/\/+$/, '') : null;
    }
    if (body.model !== undefined) {
      const model = readString(body.model, { field: '模型名称', max: 200 });
      if (model && /\s/.test(model)) throw badRequest('模型名称不能包含空格');
      patch.model = model || null;
    }
    if (body.effort !== undefined) {
      if (body.effort !== '' && !EFFORTS.includes(body.effort)) throw badRequest('推理强度无效');
      patch.effort = body.effort;
    }
    if (body.vision !== undefined) {
      if (typeof body.vision !== 'boolean') throw badRequest('vision 必须是布尔值');
      patch.vision = body.vision;
    }
    // The key is write-only: an empty value keeps the saved one, clear_api_key removes it.
    const apiKey = readString(body.api_key, { field: 'API Key', max: 1000 });
    if (apiKey) {
      if (/\s/.test(apiKey)) throw badRequest('API Key 不能包含空格或换行');
      patch.api_key = apiKey;
    } else if (body.clear_api_key === true) {
      patch.api_key = null;
    }
    store.updateAiConnection(patch);
    res.json({ connection: ai.connectionView() });
  });

  router.post('/ai/ping', async (req, res) => {
    if (!testLimiter.hit(String(req.user.id))) throw new HttpError(429, '测试太频繁了，请稍后再试');
    if (!ai.isConfigured()) throw badRequest('请先填写模型名称和 API Key（或 API 地址）');
    res.json({ result: await ai.ping() });
  });

  // Asks the AI one question exactly as a visitor would (this calls the Claude API).
  router.post('/ai/test', async (req, res) => {
    const question = readString(req.body.question, { field: '问题', required: true, max: 2000 });
    if (!ai.isConfigured()) throw badRequest('AI 接口未配置：请在「设置 → AI 接口」中填写 API Key 和模型');
    if (!testLimiter.hit(String(req.user.id))) throw new HttpError(429, '测试太频繁了，请稍后再试');
    const history = [{ id: 0, sender_type: 'visitor', type: 'text', content: question }];
    const result = await ai.respond(history, store.getSettings());
    res.json({
      result: {
        action: result.action,
        text: result.text || '',
        reason: result.reason || null,
        error: result.error || null,
        retrieved: (result.retrieved || []).map((a) => ({ id: a.id, title: a.title })),
        knowledge_mode: ai.status().knowledge_mode,
      },
    });
  });

  return router;
}

module.exports = { knowledgeRoutes };

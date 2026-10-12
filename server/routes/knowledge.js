'use strict';

const express = require('express');
const { HttpError, badRequest, notFound, readString, readInt, readId, RateLimiter } = require('../util');

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

  // Asks the AI one question exactly as a visitor would (this calls the Claude API).
  router.post('/ai/test', async (req, res) => {
    const question = readString(req.body.question, { field: '问题', required: true, max: 2000 });
    if (!ai.isConfigured()) throw badRequest('服务器未配置 ANTHROPIC_API_KEY，无法调用 AI');
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

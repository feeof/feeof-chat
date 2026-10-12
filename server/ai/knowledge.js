'use strict';

// Knowledge base retrieval: BM25 over a tokenization that works for Chinese
// without a word segmenter (overlapping character bigrams) and for
// English / numbers (whole words). Fine for knowledge bases of up to a few
// thousand articles; the index lives in memory and is rebuilt on change.

const CJK_RUN = /[㐀-䶿一-鿿豈-﫿]+/g;
const WORD = /[a-z0-9]+(?:[.'-][a-z0-9]+)*/g;

// Bigrams that appear in almost every question and carry no topic.
const STOP_BIGRAMS = new Set([
  '请问', '你好', '您好', '怎么', '什么', '如何', '可以', '可不', '不可', '能不', '不能', '是不', '不是',
  '我的', '我们', '你们', '他们', '一下', '一个', '这个', '那个', '哪个', '有没', '没有', '为什', '么办',
  '怎样', '的话', '是否', '需要', '还是', '就是', '吗？', '谢谢',
]);

const K1 = 1.2;
const B = 0.75;
const TITLE_WEIGHT = 3;

function tokenize(text) {
  const lower = String(text).toLowerCase();
  const tokens = lower.match(WORD) || [];
  for (const [run] of lower.matchAll(CJK_RUN)) {
    if (run.length === 1) {
      tokens.push(run);
      continue;
    }
    for (let i = 0; i + 1 < run.length; i++) {
      const bigram = run.slice(i, i + 2);
      if (!STOP_BIGRAMS.has(bigram)) tokens.push(bigram);
    }
  }
  return tokens;
}

function termCounts(tokens, weight, into = new Map()) {
  for (const token of tokens) into.set(token, (into.get(token) || 0) + weight);
  return into;
}

class KnowledgeIndex {
  constructor(articles) {
    this.docs = articles.map((article) => {
      const tf = termCounts(tokenize(article.title), TITLE_WEIGHT);
      termCounts(tokenize(article.content), 1, tf);
      let length = 0;
      for (const count of tf.values()) length += count;
      return { article, tf, length };
    });
    this.df = new Map();
    for (const doc of this.docs) {
      for (const term of doc.tf.keys()) this.df.set(term, (this.df.get(term) || 0) + 1);
    }
    const total = this.docs.reduce((sum, doc) => sum + doc.length, 0);
    this.avgLength = this.docs.length ? total / this.docs.length : 0;
  }

  search(query, limit = 5) {
    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0 || this.docs.length === 0) return [];
    const n = this.docs.length;
    const results = [];
    for (const doc of this.docs) {
      let score = 0;
      for (const term of terms) {
        const freq = doc.tf.get(term);
        if (!freq) continue;
        const df = this.df.get(term);
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        score += (idf * freq * (K1 + 1)) / (freq + K1 * (1 - B + (B * doc.length) / this.avgLength));
      }
      if (score > 0) results.push({ article: doc.article, score });
    }
    results.sort((a, b) => b.score - a.score || a.article.id - b.article.id);
    return results.slice(0, limit);
  }
}

/** Formats articles for the model; ids let it (and logs) refer back to sources. */
function formatArticles(articles) {
  return articles
    .map((a) => `<article id="${a.id}">\n<title>${a.title}</title>\n${a.content}\n</article>`)
    .join('\n\n');
}

/** Caches the enabled articles and their index until the knowledge base changes. */
class KnowledgeBase {
  constructor(store) {
    this.store = store;
    this.version = -1;
  }

  refresh() {
    if (this.version === this.store.kbVersion) return;
    this.articles = this.store.listEnabledKbArticles();
    this.index = new KnowledgeIndex(this.articles);
    this.totalChars = this.articles.reduce((sum, a) => sum + a.title.length + a.content.length, 0);
    this.version = this.store.kbVersion;
  }

  stats() {
    this.refresh();
    return { articles: this.articles.length, chars: this.totalChars };
  }

  all() {
    this.refresh();
    return this.articles;
  }

  search(query, limit = 5) {
    this.refresh();
    return this.index.search(query, limit);
  }
}

module.exports = { KnowledgeBase, KnowledgeIndex, tokenize, formatArticles };

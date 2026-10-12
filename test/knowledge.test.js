'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { KnowledgeIndex, tokenize } = require('../server/ai/knowledge');

const ARTICLES = [
  { id: 1, title: '退货政策', content: '商品签收后 7 天内可申请无理由退货，退货运费由买家承担，质量问题除外。' },
  { id: 2, title: '发货时间', content: '下单后 48 小时内发货，节假日顺延。默认使用顺丰快递，偏远地区可能需要 3-5 天送达。' },
  { id: 3, title: '发票说明', content: '支持开具电子普通发票和增值税专用发票，请在订单详情页申请开票。' },
  { id: 4, title: 'Shipping to Hong Kong', content: 'We ship to Hong Kong via SF Express. Delivery takes 2-4 days.' },
];

test('tokenize produces Chinese bigrams and lowercase words, dropping filler bigrams', () => {
  assert.deepEqual(tokenize('退货运费'), ['退货', '货运', '运费']);
  assert.deepEqual(tokenize('SF Express 2-4 days'), ['sf', 'express', '2-4', 'days']);
  assert.ok(!tokenize('请问怎么退货').includes('请问'));
  assert.deepEqual(tokenize('票'), ['票']);
});

test('search ranks the article that answers the question first', () => {
  const index = new KnowledgeIndex(ARTICLES);
  assert.equal(index.search('请问怎么退货？运费谁出')[0].article.id, 1);
  assert.equal(index.search('什么时候发货，用什么快递')[0].article.id, 2);
  assert.equal(index.search('我想开发票')[0].article.id, 3);
  assert.equal(index.search('How long does shipping to hong kong take?')[0].article.id, 4);
});

test('unrelated questions match nothing', () => {
  const index = new KnowledgeIndex(ARTICLES);
  assert.deepEqual(index.search('你好'), []);
  assert.deepEqual(index.search('今天天气'), []);
  assert.deepEqual(new KnowledgeIndex([]).search('退货'), []);
});

import { h, clear, formatDateTime } from '/shared/dom.js';
import { icon } from '/shared/icons.js';
import { get, post, patch, del } from './api.js';
import { state } from './state.js';
import { button, iconButton, emptyState, toast, toastError, modal, confirmDialog, field } from './ui.js';
import { PROVIDER_LABELS } from './ai-connection.js';

const PAGE_SIZE = 30;
const CHUNK_CHARS = 3000;
const IMPORT_BATCH = 500;
const IMPORT_BATCH_CHARS = 1_000_000;

/** Groups articles into requests that stay under the server's count and size limits. */
function importBatches(articles) {
  const batches = [];
  let batch = [];
  let size = 0;
  for (const article of articles) {
    const length = article.title.length + article.content.length;
    if (batch.length && (batch.length >= IMPORT_BATCH || size + length > IMPORT_BATCH_CHARS)) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(article);
    size += length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

// ---- import parsing ----

/** Splits text into pieces of at most CHUNK_CHARS, preferring paragraph breaks. */
function chunkText(text) {
  if (text.length <= CHUNK_CHARS * 1.3) return [text];
  const chunks = [];
  let current = '';
  for (const para of text.split(/\n\s*\n/)) {
    if (current && current.length + para.length > CHUNK_CHARS) {
      chunks.push(current.trim());
      current = '';
    }
    if (para.length > CHUNK_CHARS) {
      for (let i = 0; i < para.length; i += CHUNK_CHARS) chunks.push(para.slice(i, i + CHUNK_CHARS));
    } else {
      current += `${para}\n\n`;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/**
 * Turns a Markdown / text file into articles: each heading starts a new
 * article; text without headings becomes one article named after the file.
 */
export function parseKnowledgeFile(fileName, text) {
  const base = fileName.replace(/\.[^.]+$/, '') || '未命名';
  const sections = [];
  let title = base;
  let body = [];
  const flush = () => {
    const content = body.join('\n').trim();
    if (content) sections.push({ title, content });
    body = [];
  };
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^#{1,4}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      title = heading[1].trim();
    } else {
      body.push(line);
    }
  }
  flush();
  return sections.flatMap(({ title: t, content }) => {
    const parts = chunkText(content);
    return parts.map((part, i) => ({
      title: (parts.length > 1 ? `${t}（${i + 1}）` : t).slice(0, 100),
      content: part,
    }));
  });
}

// ---- view ----

export class KnowledgeView {
  constructor() {
    this.query = '';
    this.items = [];
    this.total = 0;

    this.fileInput = h('input', { type: 'file', accept: '.md,.markdown,.txt', multiple: true, hidden: true });
    this.fileInput.addEventListener('change', () => {
      const files = [...this.fileInput.files];
      this.fileInput.value = '';
      if (files.length) this.importFiles(files);
    });

    this.statusEl = h('section', { class: 'card kb-status' });
    this.search = h('input', { type: 'search', placeholder: '搜索标题或内容', 'aria-label': '搜索知识条目' });
    let debounce;
    this.search.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        this.query = this.search.value.trim();
        this.reload();
      }, 300);
    });
    this.listEl = h('div', { class: 'kb-list' });
    this.moreBtn = h('button', { type: 'button', class: 'load-more', hidden: true, onclick: () => this.loadMore() }, '加载更多');
    this.countEl = h('span', { class: 'page-tip' });

    this.el = h(
      'div',
      { class: 'page' },
      h(
        'header',
        { class: 'page-head' },
        h('h2', null, '知识库'),
        h(
          'div',
          { class: 'page-actions' },
          this.fileInput,
          button('导入文件', { iconName: 'upload', onClick: () => this.fileInput.click() }),
          button('新增条目', { variant: 'primary', iconName: 'plus', onClick: () => this.openForm() }),
        ),
      ),
      h(
        'div',
        { class: 'page-body' },
        this.statusEl,
        h(
          'div',
          { class: 'kb-grid' },
          h(
            'section',
            { class: 'kb-main' },
            h('div', { class: 'kb-toolbar' }, h('div', { class: 'search-box' }, icon('search', { size: 16 }), this.search), this.countEl),
            this.listEl,
            this.moreBtn,
          ),
          this.tryPanel(),
        ),
      ),
    );
    this.reload();
  }

  destroy() {}

  // ---- status ----

  renderStatus(ai) {
    const enabled = state.settings.ai_enabled;
    const mode =
      ai.knowledge_mode === 'full'
        ? '全部条目随每次提问发送给 AI（已启用提示缓存）'
        : `条目较多（超过 ${ai.full_knowledge_max_chars.toLocaleString()} 字），每次按问题检索最相关的条目`;
    const rows = [
      ['AI 客服', enabled ? '已开启' : h('span', null, '未开启 · ', h('a', { href: '#/settings' }, '去设置开启'))],
      [
        'AI 接口',
        ai.configured
          ? `${PROVIDER_LABELS[ai.provider]} · ${ai.model} · ${ai.base_url}`
          : h('span', { class: 'text-warn' }, '未配置：', h('a', { href: '#/settings' }, '在「设置 → AI 接口」中填写 API Key 和模型')),
      ],
      ['知识库', `${ai.knowledge_articles} 条启用中，共 ${ai.knowledge_chars.toLocaleString()} 字`],
      ['检索方式', mode],
    ];
    if (ai.last_error) {
      rows.push(['最近错误', h('span', { class: 'text-warn' }, `${formatDateTime(ai.last_error.at)} ${ai.last_error.message}`)]);
    }
    clear(
      this.statusEl,
      h('div', { class: 'kb-status-icon' }, icon('cpu', { size: 22 })),
      h(
        'dl',
        { class: 'kb-facts' },
        rows.map(([label, value]) => [h('dt', null, label), h('dd', null, value)]),
      ),
    );
  }

  // ---- list ----

  url() {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(this.items.length) });
    if (this.query) params.set('q', this.query);
    return `/api/admin/kb?${params}`;
  }

  async reload() {
    this.items = [];
    await this.loadMore();
  }

  async loadMore() {
    const requestId = (this.requestId = (this.requestId || 0) + 1);
    try {
      const data = await get(this.url());
      if (requestId !== this.requestId) return;
      this.items.push(...data.articles);
      this.total = data.total;
      this.renderStatus(data.ai);
      this.renderList();
    } catch (err) {
      toastError(err);
    }
  }

  renderList() {
    this.countEl.textContent = this.query ? `找到 ${this.total} 条` : `共 ${this.total} 条`;
    this.moreBtn.hidden = this.items.length >= this.total;
    if (this.items.length === 0) {
      clear(
        this.listEl,
        emptyState(this.query ? '没有匹配的条目' : '知识库还是空的。新增条目，或导入 Markdown / TXT 文件（按标题自动拆分）', 'book'),
      );
      return;
    }
    clear(
      this.listEl,
      this.items.map((a) =>
        h(
          'article',
          { class: `card kb-item${a.enabled ? '' : ' disabled'}` },
          h(
            'div',
            { class: 'kb-item-main' },
            h('div', { class: 'kb-item-title' }, a.title, a.enabled ? null : h('span', { class: 'chip chip-closed' }, '已停用')),
            h('div', { class: 'kb-item-content' }, a.content),
            h('div', { class: 'kb-item-meta' }, `#${a.id} · ${a.content.length} 字 · 更新于 ${formatDateTime(a.updated_at)}`),
          ),
          h(
            'div',
            { class: 'kb-item-actions' },
            h(
              'label',
              { class: 'switch', title: a.enabled ? '停用后 AI 不再使用此条目' : '启用' },
              h('input', { type: 'checkbox', checked: a.enabled, onchange: (e) => this.toggle(a, e.target.checked) }),
              h('span', null, a.enabled ? '启用' : '停用'),
            ),
            iconButton('edit', { title: '编辑', onClick: () => this.openForm(a) }),
            iconButton('trash', { title: '删除', onClick: () => this.remove(a) }),
          ),
        ),
      ),
    );
  }

  replaceItem(article) {
    const i = this.items.findIndex((a) => a.id === article.id);
    if (i >= 0) this.items[i] = article;
    this.renderList();
  }

  async toggle(article, enabled) {
    try {
      const { article: updated } = await patch(`/api/admin/kb/${article.id}`, { enabled });
      this.replaceItem(updated);
      this.refreshStatus();
    } catch (err) {
      toastError(err);
      this.renderList();
    }
  }

  async refreshStatus() {
    try {
      this.renderStatus((await get('/api/admin/ai/status')).status);
    } catch {
      /* status card keeps its last value */
    }
  }

  openForm(article) {
    const title = h('input', { maxlength: 100, required: true, value: article ? article.title : '', placeholder: '例如：退货政策' });
    const content = h('textarea', {
      maxlength: 20000,
      required: true,
      rows: 12,
      value: article ? article.content : '',
      placeholder: '写清楚具体规则、步骤和例外情况。AI 只会根据这里写的内容回答。',
    });
    const enabled = h('input', { type: 'checkbox', checked: article ? article.enabled : true });
    const form = h(
      'form',
      { class: 'form', onsubmit: (e) => e.preventDefault() },
      field('标题', title, '一条只写一个主题，标题写成访客会问的样子效果更好'),
      field('内容', content),
      h('label', { class: 'check' }, enabled, '启用（AI 回答时使用此条目）'),
    );
    modal({
      title: article ? '编辑知识条目' : '新增知识条目',
      body: form,
      width: 640,
      actions: [
        { label: '取消' },
        {
          label: '保存',
          variant: 'primary',
          onClick: async () => {
            if (!form.reportValidity()) return false;
            const body = { title: title.value.trim(), content: content.value.trim(), enabled: enabled.checked };
            if (article) {
              const { article: updated } = await patch(`/api/admin/kb/${article.id}`, body);
              this.replaceItem(updated);
              this.refreshStatus();
            } else {
              await post('/api/admin/kb', body);
              await this.reload();
            }
            toast('已保存', 'success');
            return true;
          },
        },
      ],
    });
  }

  async remove(article) {
    if (!(await confirmDialog(`确定删除「${article.title}」吗？`, { okText: '删除', danger: true }))) return;
    try {
      await del(`/api/admin/kb/${article.id}`);
      await this.reload();
    } catch (err) {
      toastError(err);
    }
  }

  async importFiles(files) {
    const articles = [];
    for (const file of files) {
      if (file.size > 5 * 1024 * 1024) {
        toast(`${file.name} 超过 5MB，已跳过`, 'error');
        continue;
      }
      articles.push(...parseKnowledgeFile(file.name, await file.text()));
    }
    if (articles.length === 0) {
      toast('文件中没有可导入的内容', 'error');
      return;
    }
    const preview = h(
      'div',
      { class: 'import-preview' },
      h('p', { class: 'confirm-text' }, `将从 ${files.length} 个文件导入 ${articles.length} 条知识（按标题拆分）：`),
      h(
        'ol',
        null,
        articles.slice(0, 12).map((a) => h('li', null, a.title, h('span', { class: 'cell-sub' }, ` · ${a.content.length} 字`))),
        articles.length > 12 ? h('li', { class: 'cell-sub' }, `…… 另外 ${articles.length - 12} 条`) : null,
      ),
    );
    modal({
      title: '导入知识库',
      body: preview,
      width: 520,
      actions: [
        { label: '取消' },
        {
          label: '导入',
          variant: 'primary',
          onClick: async () => {
            let created = 0;
            for (const batch of importBatches(articles)) {
              created += (await post('/api/admin/kb/import', { articles: batch })).created;
            }
            toast(`已导入 ${created} 条`, 'success');
            await this.reload();
            return true;
          },
        },
      ],
    });
  }

  // ---- try it ----

  tryPanel() {
    const question = h('textarea', { rows: 3, maxlength: 2000, placeholder: '输入一个访客可能会问的问题，例如：多久发货？' });
    const output = h('div', { class: 'try-output' });
    const previewBtn = button('检索预览', {
      onClick: async () => {
        const q = question.value.trim();
        if (!q) return question.focus();
        try {
          const { results } = await get(`/api/admin/kb/search?q=${encodeURIComponent(q)}`);
          clear(
            output,
            h('div', { class: 'try-label' }, '会匹配到的条目（检索方式下使用；全量方式下 AI 会看到全部条目）'),
            results.length
              ? h('ol', { class: 'try-hits' }, results.map((r) => h('li', null, r.title, h('span', { class: 'cell-sub' }, ` · 相关度 ${r.score}`))))
              : h('p', { class: 'cell-sub' }, '没有匹配的条目，可以补充相关知识'),
          );
        } catch (err) {
          toastError(err);
        }
      },
    });
    const askBtn = button('问 AI', {
      variant: 'primary',
      onClick: async () => {
        const q = question.value.trim();
        if (!q) return question.focus();
        askBtn.disabled = true;
        clear(output, h('p', { class: 'cell-sub' }, 'AI 正在回答…'));
        try {
          const { result } = await post('/api/admin/ai/test', { question: q });
          const parts = [];
          if (result.text) parts.push(h('div', { class: 'try-answer' }, result.text));
          if (result.action === 'handoff') {
            parts.push(
              h(
                'div',
                { class: 'try-handoff' },
                icon('transfer', { size: 14 }),
                ` 会转人工：${result.reason || ''}`,
                result.error ? h('div', { class: 'text-warn' }, result.error) : null,
              ),
            );
          }
          if (result.retrieved.length) {
            parts.push(h('div', { class: 'try-label' }, `参考的条目：${result.retrieved.map((r) => r.title).join('、')}`));
          }
          clear(output, parts);
        } catch (err) {
          clear(output);
          toastError(err);
        } finally {
          askBtn.disabled = false;
          this.refreshStatus();
        }
      },
    });
    return h(
      'aside',
      { class: 'card kb-try' },
      h('h3', null, '试一试'),
      h('p', { class: 'page-tip' }, '用访客的口吻提问，检查 AI 的回答是否准确。「问 AI」会实际调用 AI 接口。'),
      question,
      h('div', { class: 'form-actions start' }, previewBtn, askBtn),
      output,
    );
  }
}

import { h, clear, formatDateTime, formatDuration } from '/shared/dom.js';
import { icon } from '/shared/icons.js';
import { get, post, put, patch, del } from './api.js';
import { state, on, emit } from './state.js';
import {
  avatar,
  button,
  iconButton,
  emptyState,
  toast,
  toastError,
  modal,
  confirmDialog,
  field,
  statusDot,
  STATUS_LABEL,
} from './ui.js';

function pageShell(title, actions = []) {
  const body = h('div', { class: 'page-body' });
  const el = h('div', { class: 'page' }, h('header', { class: 'page-head' }, h('h2', null, title), h('div', { class: 'page-actions' }, actions)), body);
  return { el, body };
}

const nf = new Intl.NumberFormat('zh-CN');
const compact = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 });

// ---- dashboard ----

const RANGES = [
  ['today', '今日'],
  ['7d', '近 7 天'],
  ['30d', '近 30 天'],
];

function statTile(label, value, note) {
  return h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value), note ? h('div', { class: 'stat-note' }, note) : null);
}

/** Rounded step for axis ticks: 1, 2, 5 × 10^n. */
function niceStep(max, ticks) {
  const raw = Math.max(max, 1) / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const unit = [1, 2, 5, 10].find((m) => m * pow >= raw) * pow;
  return Math.max(1, unit);
}

/** Column path with a 4px rounded top and a square baseline. */
function columnPath(x, y, w, hgt, r = 4) {
  const rr = Math.min(r, hgt, w / 2);
  return `M${x},${y + hgt}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + hgt}Z`;
}

function svg(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

/** Daily conversation counts as a single-series column chart with hover/focus tooltips. */
function columnChart(daily) {
  const wrap = h('div', { class: 'chart' });
  const tooltip = h('div', { class: 'chart-tip', hidden: true });

  function draw() {
    const width = Math.max(wrap.clientWidth, 280);
    const height = 220;
    const pad = { top: 12, right: 8, bottom: 26, left: 36 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const max = Math.max(...daily.map((d) => d.conversations), 0);
    const step = niceStep(max, 4);
    const top = Math.max(step * Math.ceil(max / step), step);
    const y = (v) => pad.top + plotH - (v / top) * plotH;
    const band = plotW / daily.length;
    const barW = Math.max(2, Math.min(24, band - 2));

    const root = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': '每日会话量柱状图' });
    for (let v = 0; v <= top; v += step) {
      root.append(svg('line', { x1: pad.left, x2: width - pad.right, y1: y(v), y2: y(v), class: v === 0 ? 'axis' : 'grid' }));
      const tick = svg('text', { x: pad.left - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' });
      tick.textContent = compact.format(v);
      root.append(tick);
    }
    const labelEvery = Math.ceil(daily.length / Math.max(1, Math.floor(plotW / 48)));
    daily.forEach((d, i) => {
      const cx = pad.left + band * i + band / 2;
      if ((daily.length - 1 - i) % labelEvery === 0) {
        const label = svg('text', { x: cx, y: height - 8, 'text-anchor': 'middle', class: 'tick' });
        label.textContent = d.day.slice(5);
        root.append(label);
      }
      const g = svg('g', { class: 'bar', tabindex: 0, role: 'img', 'aria-label': `${d.day}：${d.conversations} 个会话` });
      // Hit target spans the whole band, not just the painted column.
      g.append(svg('rect', { x: pad.left + band * i, y: pad.top, width: band, height: plotH, class: 'hit' }));
      if (d.conversations > 0) {
        const hgt = plotH - (y(d.conversations) - pad.top);
        g.append(svg('path', { d: columnPath(cx - barW / 2, y(d.conversations), barW, hgt), class: 'col' }));
      }
      const show = () => {
        clear(tooltip, h('strong', null, `${nf.format(d.conversations)} 个会话`), h('span', null, d.day));
        tooltip.hidden = false;
        const left = Math.min(Math.max(cx - tooltip.offsetWidth / 2, 0), width - tooltip.offsetWidth);
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${Math.max(y(d.conversations) - tooltip.offsetHeight - 8, 0)}px`;
      };
      g.addEventListener('pointerenter', show);
      g.addEventListener('focus', show);
      g.addEventListener('pointerleave', () => (tooltip.hidden = true));
      g.addEventListener('blur', () => (tooltip.hidden = true));
      root.append(g);
    });
    clear(wrap, root, tooltip);
  }

  const observer = new ResizeObserver(() => draw());
  observer.observe(wrap);
  wrap.disconnect = () => observer.disconnect();
  return wrap;
}

function dailyTable(daily) {
  return h(
    'table',
    { class: 'table compact' },
    h('thead', null, h('tr', null, h('th', null, '日期'), h('th', { class: 'num' }, '会话数'))),
    h(
      'tbody',
      null,
      daily.map((d) => h('tr', null, h('td', null, d.day), h('td', { class: 'num' }, nf.format(d.conversations)))),
    ),
  );
}

const ratingText = (avg, rated) => (rated ? `${avg.toFixed(1)} 分` : '-');

export class DashboardView {
  constructor() {
    this.range = 'today';
    this.showTable = false;
    this.filters = h('div', { class: 'segmented', role: 'tablist', 'aria-label': '时间范围' });
    const shell = pageShell('数据看板');
    this.el = shell.el;
    this.content = h('div', { class: 'dashboard' });
    shell.body.append(this.filters, this.content);
    this.renderFilters();
    this.load();
    this.unsubscribe = on('agents', () => this.data && this.renderLive());
    this.timer = setInterval(() => this.load(), 60 * 1000);
  }

  destroy() {
    this.unsubscribe();
    clearInterval(this.timer);
    this.chart?.disconnect();
  }

  renderFilters() {
    clear(this.filters, 
      RANGES.map(([key, label]) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            'aria-selected': String(this.range === key),
            class: this.range === key ? 'active' : '',
            onclick: () => {
              this.range = key;
              this.renderFilters();
              this.load();
            },
          },
          label,
        ),
      ),
    );
  }

  async load() {
    // Keep the previous render visible (dimmed) while refetching.
    this.content.classList.add('refreshing');
    try {
      this.data = await get(`/api/admin/stats?range=${this.range}`);
      this.render();
    } catch (err) {
      toastError(err);
    } finally {
      this.content.classList.remove('refreshing');
    }
  }

  renderLive() {
    const online = [...state.agents.values()].filter((a) => !a.disabled && a.status === 'online').length;
    const { current } = this.data;
    clear(this.liveRow, 
      statTile('排队中', nf.format(current.waiting), '实时'),
      statTile('进行中', nf.format(current.active), '实时'),
      statTile('在线客服', nf.format(online), `共 ${[...state.agents.values()].filter((a) => !a.disabled).length} 名`),
    );
  }

  render() {
    const { overview: o, agents, daily, range } = this.data;
    const satisfaction = o.rated ? `满意率 ${Math.round((o.satisfied / o.rated) * 100)}%（${o.rated} 条评价）` : '暂无评价';
    this.liveRow = h('div', { class: 'stat-grid live' });
    this.renderLive();

    const kpis = h(
      'div',
      { class: 'stat-grid' },
      statTile('会话量', nf.format(o.conversations), `${nf.format(o.visitors)} 位访客`),
      statTile('平均首次响应', formatDuration(o.avg_first_response_ms), '从发起咨询到客服首次回复'),
      statTile('满意度', ratingText(o.avg_rating, o.rated), satisfaction),
      statTile('平均会话时长', formatDuration(o.avg_duration_ms), `已结束 ${nf.format(o.closed)} 个`),
      statTile('消息数', compact.format(o.messages), '访客与客服消息合计'),
      statTile('未回复会话', nf.format(o.unanswered), '客服尚未回复过的会话'),
    );

    this.chart?.disconnect();
    this.chart = null;
    let trend = null;
    if (range.days > 1) {
      const toggle = h(
        'button',
        { type: 'button', class: 'link-btn', onclick: () => { this.showTable = !this.showTable; this.render(); } },
        this.showTable ? '查看图表' : '查看表格',
      );
      let body;
      if (this.showTable) body = dailyTable(daily);
      else body = this.chart = columnChart(daily);
      trend = h(
        'section',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('div', null, h('h3', null, '每日会话量'), h('p', { class: 'card-sub' }, `${daily[0].day} 至 ${daily.at(-1).day}`)), toggle),
        body,
      );
    }

    const table = h(
      'section',
      { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', null, '客服绩效')),
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'table' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h('th', null, '客服'),
              h('th', null, '状态'),
              h('th', { class: 'num' }, '接待会话'),
              h('th', { class: 'num' }, '已结束'),
              h('th', { class: 'num' }, '平均首次响应'),
              h('th', { class: 'num' }, '平均评分'),
              h('th', { class: 'num' }, '发送消息'),
            ),
          ),
          h(
            'tbody',
            null,
            agents
              .filter((a) => !a.disabled || a.conversations > 0)
              .map((a) =>
                h(
                  'tr',
                  null,
                  h('td', null, h('span', { class: 'cell-user' }, avatar(a.display_name, { size: 24 }), a.display_name)),
                  h('td', null, h('span', { class: 'cell-status' }, statusDot(a.status), STATUS_LABEL[a.status])),
                  h('td', { class: 'num' }, nf.format(a.conversations)),
                  h('td', { class: 'num' }, nf.format(a.closed)),
                  h('td', { class: 'num' }, formatDuration(a.avg_first_response_ms)),
                  h('td', { class: 'num' }, a.rated ? `${a.avg_rating.toFixed(1)}（${a.rated}）` : '-'),
                  h('td', { class: 'num' }, nf.format(a.messages)),
                ),
              ),
          ),
        ),
      ),
    );

    clear(this.content, 
      h('h3', { class: 'section-title' }, '实时状态'),
      this.liveRow,
      h('h3', { class: 'section-title' }, RANGES.find(([key]) => key === this.range)[1]),
      kpis,
      trend,
      table,
    );
  }
}

// ---- agents ----

function agentForm(agent) {
  const isNew = !agent;
  const inputs = {
    username: isNew ? h('input', { required: true, maxlength: 32, autocomplete: 'off', placeholder: '登录用户名（字母、数字、_ . -）' }) : null,
    display_name: h('input', { maxlength: 32, value: agent ? agent.display_name : '', placeholder: '访客看到的客服名称' }),
    password: h('input', {
      type: 'password',
      minlength: 6,
      autocomplete: 'new-password',
      placeholder: isNew ? '至少 6 位' : '留空则不修改',
      required: isNew,
    }),
    role: h(
      'select',
      null,
      h('option', { value: 'agent' }, '客服'),
      h('option', { value: 'admin' }, '管理员'),
    ),
    max_concurrent: h('input', { type: 'number', min: 1, max: 100, value: String(agent ? agent.max_concurrent : 5) }),
  };
  inputs.role.value = agent ? agent.role : 'agent';
  const form = h(
    'form',
    { class: 'form', onsubmit: (event) => event.preventDefault() },
    isNew ? field('用户名', inputs.username) : null,
    field('显示名称', inputs.display_name),
    field(isNew ? '初始密码' : '重置密码', inputs.password),
    field('角色', inputs.role, '管理员可以管理客服账号、快捷回复、系统设置并查看数据看板'),
    field('最大同时接待数', inputs.max_concurrent, '自动分配时，达到上限的客服不再分配新会话'),
  );
  const values = () => {
    const body = {
      display_name: inputs.display_name.value.trim() || undefined,
      role: inputs.role.value,
      max_concurrent: Number(inputs.max_concurrent.value),
    };
    if (inputs.password.value) body.password = inputs.password.value;
    if (isNew) body.username = inputs.username.value.trim();
    return body;
  };
  return { form, values };
}

export class AgentsView {
  constructor() {
    const shell = pageShell('客服管理', [button('新增客服', { variant: 'primary', iconName: 'plus', onClick: () => this.openForm() })]);
    this.el = shell.el;
    this.body = shell.body;
    this.unsubscribe = on('agents', () => this.render());
    this.refresh();
  }

  destroy() {
    this.unsubscribe();
  }

  async refresh() {
    try {
      const { agents } = await get('/api/agents');
      state.agents = new Map(agents.map((a) => [a.id, a]));
      emit('agents');
    } catch (err) {
      toastError(err);
    }
  }

  render() {
    const agents = [...state.agents.values()];
    clear(this.body, 
      h(
        'div',
        { class: 'card table-wrap' },
        h(
          'table',
          { class: 'table' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h('th', null, '客服'),
              h('th', null, '角色'),
              h('th', null, '状态'),
              h('th', { class: 'num' }, '接待中 / 上限'),
              h('th', null, '创建时间'),
              h('th', { class: 'actions-col' }, '操作'),
            ),
          ),
          h(
            'tbody',
            null,
            agents.map((a) =>
              h(
                'tr',
                { class: a.disabled ? 'muted-row' : '' },
                h(
                  'td',
                  null,
                  h(
                    'span',
                    { class: 'cell-user' },
                    avatar(a.display_name, { size: 28 }),
                    h('span', null, h('span', { class: 'cell-strong' }, a.display_name), h('span', { class: 'cell-sub' }, a.username)),
                  ),
                ),
                h('td', null, a.role === 'admin' ? '管理员' : '客服'),
                h(
                  'td',
                  null,
                  a.disabled
                    ? h('span', { class: 'chip chip-closed' }, '已禁用')
                    : h('span', { class: 'cell-status' }, statusDot(a.status), STATUS_LABEL[a.status]),
                ),
                h('td', { class: 'num' }, `${a.active_count ?? 0} / ${a.max_concurrent}`),
                h('td', null, formatDateTime(a.created_at)),
                h(
                  'td',
                  { class: 'actions-col' },
                  button('编辑', { variant: 'ghost', onClick: () => this.openForm(a) }),
                  a.id === state.me.id
                    ? null
                    : button(a.disabled ? '启用' : '禁用', {
                        variant: a.disabled ? 'ghost' : 'ghost-danger',
                        onClick: () => this.toggleDisabled(a),
                      }),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  openForm(agent) {
    const { form, values } = agentForm(agent);
    modal({
      title: agent ? `编辑客服：${agent.display_name}` : '新增客服',
      body: form,
      actions: [
        { label: '取消' },
        {
          label: '保存',
          variant: 'primary',
          onClick: async () => {
            if (!form.reportValidity()) return false;
            if (agent) await patch(`/api/admin/agents/${agent.id}`, values());
            else await post('/api/admin/agents', values());
            toast(agent ? '已保存' : '客服已创建', 'success');
            await this.refresh();
            return true;
          },
        },
      ],
    });
  }

  async toggleDisabled(agent) {
    if (!agent.disabled) {
      const ok = await confirmDialog(`禁用后「${agent.display_name}」将被强制下线，其进行中的会话会重新分配。确定禁用吗？`, {
        okText: '禁用',
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await patch(`/api/admin/agents/${agent.id}`, { disabled: !agent.disabled });
      toast(agent.disabled ? '已启用' : '已禁用', 'success');
      await this.refresh();
    } catch (err) {
      toastError(err);
    }
  }
}

// ---- quick replies ----

export class RepliesView {
  constructor() {
    const shell = pageShell('快捷回复', [button('新增快捷回复', { variant: 'primary', iconName: 'plus', onClick: () => this.openForm() })]);
    this.el = shell.el;
    this.body = shell.body;
    this.refresh();
  }

  destroy() {}

  async refresh() {
    try {
      const { quick_replies: replies } = await get('/api/quick-replies');
      state.quickReplies = replies;
      this.render();
    } catch (err) {
      toastError(err);
    }
  }

  render() {
    clear(this.body);
    this.body.append(h('p', { class: 'page-tip' }, '客服在输入框中输入「/」或点击闪电按钮即可快速插入以下内容。'));
    if (state.quickReplies.length === 0) {
      this.body.append(emptyState('还没有快捷回复', 'zap'));
      return;
    }
    this.body.append(
      h(
        'div',
        { class: 'reply-list' },
        state.quickReplies.map((r) =>
          h(
            'div',
            { class: 'card reply-item' },
            h('div', { class: 'reply-main' }, h('div', { class: 'reply-title' }, r.title), h('div', { class: 'reply-content' }, r.content)),
            h(
              'div',
              { class: 'reply-actions' },
              iconButton('edit', { title: '编辑', onClick: () => this.openForm(r) }),
              iconButton('trash', { title: '删除', onClick: () => this.remove(r) }),
            ),
          ),
        ),
      ),
    );
  }

  openForm(reply) {
    const title = h('input', { maxlength: 50, required: true, value: reply ? reply.title : '', placeholder: '例如：问候语' });
    const content = h('textarea', { maxlength: 2000, required: true, rows: 5, value: reply ? reply.content : '' });
    const sort = h('input', { type: 'number', min: 0, max: 9999, value: String(reply ? reply.sort : 0) });
    const form = h('form', { class: 'form', onsubmit: (e) => e.preventDefault() }, field('标题', title), field('内容', content), field('排序', sort, '数字越小越靠前'));
    modal({
      title: reply ? '编辑快捷回复' : '新增快捷回复',
      body: form,
      width: 520,
      actions: [
        { label: '取消' },
        {
          label: '保存',
          variant: 'primary',
          onClick: async () => {
            if (!form.reportValidity()) return false;
            const body = { title: title.value.trim(), content: content.value.trim(), sort: Number(sort.value) || 0 };
            if (reply) await patch(`/api/admin/quick-replies/${reply.id}`, body);
            else await post('/api/admin/quick-replies', body);
            await this.refresh();
            return true;
          },
        },
      ],
    });
  }

  async remove(reply) {
    if (!(await confirmDialog(`确定删除快捷回复「${reply.title}」吗？`, { okText: '删除', danger: true }))) return;
    try {
      await del(`/api/admin/quick-replies/${reply.id}`);
      await this.refresh();
    } catch (err) {
      toastError(err);
    }
  }
}

// ---- settings ----

export class SettingsView {
  constructor() {
    const shell = pageShell('系统设置');
    this.el = shell.el;
    this.body = shell.body;
    this.load();
  }

  destroy() {}

  async load() {
    try {
      const { settings } = await get('/api/settings');
      state.settings = settings;
      this.render(settings);
    } catch (err) {
      toastError(err);
    }
  }

  render(s) {
    const inputs = {
      site_name: h('input', { maxlength: 50, required: true, value: s.site_name }),
      theme_color: h('input', { type: 'color', value: s.theme_color }),
      welcome_message: h('textarea', { maxlength: 500, rows: 3, value: s.welcome_message }),
      queue_message: h('textarea', { maxlength: 500, rows: 2, value: s.queue_message }),
      offline_message: h('textarea', { maxlength: 500, rows: 2, value: s.offline_message }),
      auto_assign: h('input', { type: 'checkbox', checked: s.auto_assign }),
      auto_close_minutes: h('input', { type: 'number', min: 0, max: 1440, value: String(s.auto_close_minutes) }),
    };
    const form = h(
      'form',
      { class: 'card form settings-form' },
      h('h3', null, '访客挂件'),
      field('站点名称', inputs.site_name, '显示在访客聊天窗口顶部'),
      field('主题色', inputs.theme_color),
      field('欢迎语', inputs.welcome_message, '访客打开聊天窗口时看到的第一句话，留空则不显示'),
      h('h3', null, '会话分配'),
      h('label', { class: 'check' }, inputs.auto_assign, '自动分配：新会话自动分配给在线且未满负荷的客服'),
      field('排队提示', inputs.queue_message, '有客服在线但暂时无法接入时发送给访客'),
      field('离线提示', inputs.offline_message, '没有客服在线时发送给访客'),
      field('无消息自动结束（分钟）', inputs.auto_close_minutes, '进行中的会话超过该时间没有新消息将自动结束，0 表示不自动结束'),
      h('div', { class: 'form-actions' }, button('保存设置', { variant: 'primary', type: 'submit' })),
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      try {
        const { settings } = await put('/api/admin/settings', {
          site_name: inputs.site_name.value.trim(),
          theme_color: inputs.theme_color.value,
          welcome_message: inputs.welcome_message.value.trim(),
          queue_message: inputs.queue_message.value.trim(),
          offline_message: inputs.offline_message.value.trim(),
          auto_assign: inputs.auto_assign.checked,
          auto_close_minutes: Number(inputs.auto_close_minutes.value) || 0,
        });
        state.settings = settings;
        toast('设置已保存', 'success');
      } catch (err) {
        toastError(err);
      }
    });

    const code = `<script src="${location.origin}/widget.js" async></script>`;
    const embed = h(
      'section',
      { class: 'card' },
      h('h3', null, '嵌入代码'),
      h('p', { class: 'page-tip' }, '将以下代码粘贴到网站页面的 </body> 之前，页面右下角就会出现客服按钮。'),
      h('pre', { class: 'code' }, code),
      h(
        'div',
        { class: 'form-actions start' },
        button('复制代码', {
          iconName: 'copy',
          onClick: async () => {
            try {
              await navigator.clipboard.writeText(code);
              toast('已复制', 'success');
            } catch {
              toast('复制失败，请手动选择复制', 'error');
            }
          },
        }),
        h('a', { class: 'btn btn-ghost', href: '/', target: '_blank', rel: 'noopener' }, icon('external', { size: 16 }), h('span', null, '打开演示页')),
        h('a', { class: 'btn btn-ghost', href: '/chat.html', target: '_blank', rel: 'noopener' }, icon('external', { size: 16 }), h('span', null, '独立聊天链接')),
      ),
      h('p', { class: 'field-hint' }, '可选属性：data-position="left" 左侧显示；data-name / data-email 传入已登录用户信息；也可调用 window.FeeofChat.open() 打开窗口。'),
    );
    clear(this.body, h('div', { class: 'settings-grid' }, form, embed));
  }
}

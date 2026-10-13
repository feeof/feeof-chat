# Feeof 在线客服系统

一个开箱即用的网页在线客服系统：一行代码把客服挂件嵌入你的网站，访客实时咨询，客服在工作台统一接待，管理员在后台管理客服、快捷回复和查看数据。可选开启基于知识库的 **AI 智能客服**（Claude），先由 AI 回答常见问题，需要时无缝转人工。

- **后端**：Node.js 22 + Express 5 + Socket.IO，数据存储使用 Node 内置的 SQLite（`node:sqlite`），无需安装数据库
- **前端**：原生 JavaScript（ES Modules），无需构建，支持浅色 / 深色模式和手机端
- **手机 App**：uni-app（Vue 3），一套代码发布 Android / iOS App、微信小程序和 H5，见 [mobile/README.md](mobile/README.md)

## 功能

**访客端（聊天挂件）**

- 网页右下角悬浮按钮，点开即聊；手机上自动全屏
- 文字、图片（选择 / 粘贴截图 / 拖拽）、链接自动识别
- 客服在线状态、排队提示、离线留言提示、客服“正在输入”提示
- 留下联系方式（称呼、电话、邮箱）
- 访客可主动结束会话；会话结束后 1–5 星满意度评价
- 刷新页面或下次访问自动恢复身份和历史消息；最小化时显示未读角标

**客服工作台**

- 「排队中」「进行中」会话列表实时更新，未读数、访客在线状态、等待时长
- 自动分配：按客服在线状态和当前接待量分配新会话，达到接待上限自动排队，客服空闲后按先来后到接入
- 手动接入、转接给其他客服、结束会话
- 快捷回复：输入框中输入 `/` 或点击闪电按钮
- 访客信息面板：访问页面、来源、设备、IP、历史会话次数，可编辑联系方式和备注
- 历史会话检索（访客、电话、邮箱、消息内容、会话编号）
- 桌面通知 + 提示音，标题栏未读计数；在线 / 离开 / 离线状态切换
- 断线自动重连并补齐期间的消息

**AI 智能客服（可选）**

- 根据后台维护的知识库自动回答访客问题，回答只依据知识库，不编造价格、政策等信息
- 两种接待模式：AI 优先（所有新会话先由 AI 接待）或 AI 兜底（只在没有客服能接待时由 AI 接待）
- 自动转人工：知识库没有答案、访客要求人工、退款投诉等需要人工处理的问题；访客也可以点「转人工」或直接发送“人工”
- 客服可以在「AI 接待」标签实时查看 AI 的对话，随时一键接管；转人工时显示原因
- 知识库管理：新增 / 编辑 / 停用条目，导入 Markdown / TXT 文件（按标题自动拆分），「试一试」直接测试 AI 回答
- 访客发的截图也会交给 AI 理解；数据看板统计 AI 接待量、独立解决率和转人工次数

**管理后台（管理员）**

- 数据看板：会话量、访客数、平均首次响应时间、满意度、会话时长、未回复会话、每日会话量图表、客服绩效表
- 客服管理：新增、编辑、重置密码、设置角色和最大同时接待数、禁用（禁用后强制下线并重新分配其会话）
- 快捷回复管理
- 系统设置：站点名称、主题色、欢迎语、排队 / 离线提示、自动分配开关、无消息自动结束时间，以及嵌入代码

**手机 App（客服 / 管理员）**

- 客服工作台和管理后台的手机版：会话列表、聊天（文字 / 图片 / 快捷回复）、接入 / 接管 / 转接 / 结束、访客信息、历史会话、状态切换
- 管理员可在手机上看数据看板，管理客服、知识库、快捷回复、系统设置和 AI 接口
- 新会话、转人工、新消息振动提醒，断线自动重连
- 发布为 Android / iOS App、微信小程序，或构建 H5 后由服务端托管在 `/m/`，详见 [mobile/README.md](mobile/README.md)

## 快速开始

需要 Node.js **22.13 或更高版本**。

```bash
npm install
npm start
```

首次启动会自动创建管理员账号，用户名 `admin`，**随机密码打印在启动日志中**。也可以通过环境变量指定：

```bash
ADMIN_PASSWORD='你的强密码' npm start
```

启动后访问：

| 地址 | 说明 |
| --- | --- |
| http://localhost:3000/ | 演示页（已嵌入客服挂件） |
| http://localhost:3000/agent/ | 客服工作台 / 管理后台 |
| http://localhost:3000/chat.html | 独立聊天页（可直接作为客服链接分享） |
| http://localhost:3000/m/ | 手机版工作台（需先在 `mobile/` 中执行 `npm install && npm run build:h5`） |

体验完整流程：一个浏览器窗口登录客服工作台，另一个窗口（或无痕窗口）打开演示页点击“试试联系客服”。

## 开启 AI 智能客服

1. 用管理员登录工作台，打开「设置 → AI 接口」，填写接口类型、API 地址、API Key 和模型名称，点「保存并测试连接」确认可用（见下方「AI 接口」）。
2. 在「知识库」中新增条目或导入文档。一条只写一个主题，标题写成访客会问的样子，内容写清楚规则、步骤和例外情况。
3. 在「知识库」右侧的「试一试」中用访客的口吻提问，检查回答是否准确。
4. 在「设置 → AI 智能客服」中勾选开启，选择接待模式，可以在「补充说明」里写上业务背景和语气要求。

### AI 接口

支持两种接口类型，在「设置 → AI 接口」中切换：

| 接口类型 | 适用 | API 地址 | 模型名称示例 |
| --- | --- | --- | --- |
| Anthropic（Claude） | Claude 官方 API，或兼容 Anthropic Messages API 的代理 / 网关 | 留空即官方地址；代理填写其地址，如 `https://your-gateway.example.com` | `claude-opus-5-5`（默认）、`claude-sonnet-5-5`、`claude-haiku-5-5` |
| OpenAI 兼容 | OpenAI、DeepSeek、通义千问（DashScope 兼容模式）、Kimi、智谱、本地 Ollama / vLLM 等 Chat Completions 接口 | 填写到 `/v1` 为止，如 `https://api.deepseek.com/v1`、`http://localhost:11434/v1`；也可以直接填完整的 `.../chat/completions` | 以服务商文档为准，如 `deepseek-chat`、`qwen-plus` |

- **API Key** 只保存在服务器数据库里，页面上只显示前后几位；留空保存会保留原来的 Key。本地模型（如 Ollama）可以不填 Key。
- **推理强度** 只对 Anthropic 接口有效，默认 `low`。所选 Claude 模型不支持 effort 参数时，选择“不指定”。
- **OpenAI 兼容接口** 要求模型支持工具调用（function calling），AI 靠它转人工和检索知识库；模型支持图片输入时可勾选「模型支持图片输入」，访客发的截图会交给模型。部分推理模型输出的 `<think>…</think>` 思考内容会被自动去掉。
- 也可以用环境变量设置默认值（见「配置」），后台保存的值优先。

**工作方式**

- 知识库不大时（默认 6 万字以内），每次提问都会把全部条目交给 AI，这部分内容使用了提示缓存（prompt caching），重复部分按缓存价格计费；知识库更大时改为按问题检索最相关的条目，AI 也可以自己换关键词再检索
- AI 回答不了、访客要求人工、问题需要人工处理，或者调用 Claude API 出错时，会话都会转入人工排队，按正常规则分配给客服
- 同一会话中访客连续发多条消息时，AI 会等所有消息到齐后一次性回答
- 每个会话最多由 AI 回复 30 次（可配置），超过后转人工，避免异常会话持续消耗费用
- 默认使用 Anthropic 接口的 `claude-opus-5-5` 模型和 `low` 推理强度（聊天场景响应更快）；直连 Claude 官方 API 时还会开启服务端拒答回退（`fallbacks: "default"`）：当模型的安全分类器误拦截一个问题时，会自动由另一个模型作答。通过代理访问时不发送这个参数
- 知识库在 Anthropic 接口下使用提示缓存；OpenAI 兼容接口下，固定不变的指令和知识库放在最前面，便于支持自动前缀缓存的服务商命中缓存

## 嵌入到你的网站

把下面这行代码放到网页 `</body>` 之前：

```html
<script src="https://你的客服域名/widget.js" async></script>
```

可选属性：

| 属性 | 说明 |
| --- | --- |
| `data-position="left"` | 按钮显示在左下角 |
| `data-color="#10b981"` | 按钮颜色（默认使用后台设置的主题色） |
| `data-name` / `data-email` | 已登录用户的称呼和邮箱，会显示给客服 |

也可以用 JS 控制：`window.FeeofChat.open()`、`close()`、`toggle()`。

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `./data` | 数据目录（SQLite 数据库和上传的图片） |
| `ADMIN_USERNAME` | `admin` | 初始管理员用户名（仅在数据库没有任何账号时使用） |
| `ADMIN_PASSWORD` | 随机生成 | 初始管理员密码 |
| `TRUST_PROXY` | 关闭 | 部署在 Nginx 等反向代理之后时设为 `1`，以便获取访客真实 IP |
| `WIDGET_FRAME_ANCESTORS` | `*` | 允许嵌入聊天窗口的网站（CSP `frame-ancestors`），例如 `https://a.com https://b.com` |
| `MOBILE_DIR` | `mobile/dist/build/h5` | 手机版 H5 构建目录，存在时托管在 `/m/` |
| `AI_PROVIDER` | `anthropic` | AI 接口类型的默认值：`anthropic` 或 `openai`（OpenAI 兼容） |
| `AI_BASE_URL` | 官方地址 | AI 接口地址的默认值 |
| `AI_API_KEY` | 无 | AI 接口 Key 的默认值；Anthropic 接口也会读取 `ANTHROPIC_API_KEY`，OpenAI 兼容接口也会读取 `OPENAI_API_KEY` |
| `AI_MODEL` | `claude-opus-5-5`（Anthropic） | 模型名称的默认值 |
| `AI_EFFORT` | `low` | 推理强度（仅 Anthropic）：`low` / `medium` / `high` / `xhigh` / `max`，`none` 表示不指定 |
| `AI_VISION` | 关闭 | 设为 `1` 表示 OpenAI 兼容模型支持图片输入 |
| `AI_MAX_TOKENS` | `8000` | 单次回复的最大 token 数（包含模型的思考过程） |
| `AI_FULL_KB_MAX_CHARS` | `60000` | 知识库总字数不超过该值时全部交给 AI，超过则按问题检索 |
| `AI_MAX_REPLIES` | `30` | 每个会话 AI 最多回复的次数，超过后转人工 |
| `AI_FALLBACKS` | 开启 | 设为 `off` 关闭服务端拒答回退（只在直连 Claude 官方 API 时生效） |

> 「设置 → AI 接口」中保存的接口类型、地址、Key 和模型优先于这些环境变量。

## 部署

### Docker

```bash
docker build -t feeof-chat .
docker run -d -p 3000:3000 -v feeof-data:/app/data -e ADMIN_PASSWORD='你的强密码' feeof-chat
```

镜像不包含手机版 H5；需要 `/m/` 时先在本机构建，再挂载进容器（见 [mobile/README.md](mobile/README.md)）。

### 反向代理（Nginx）

Socket.IO 需要 WebSocket 升级头：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

并设置 `TRUST_PROXY=1`。生产环境请务必使用 HTTPS。

**备份**：备份 `DATA_DIR` 目录即可（`feeof-chat.db*` 与 `uploads/`）。

> 当前版本为单进程架构（在线状态保存在内存中），适合中小团队。如需多实例部署，需要为 Socket.IO 增加 Redis 适配器并把数据库换成 PostgreSQL 等服务端数据库。

## 开发

```bash
npm run dev   # 修改后端代码自动重启
npm test      # 运行集成测试（node:test）
```

目录结构：

```
server/
  index.js        启动入口
  app.js          组装 Express、Socket.IO、定时任务
  service.js      会话业务逻辑：分配、转接、结束、评价、实时推送
  store.js        SQLite 数据访问
  db.js           数据库初始化与迁移
  realtime.js     Socket.IO 连接与在线状态
  ai/             AI 客服：assistant.js（回答与转人工）、knowledge.js（知识库检索）
    providers/    接口适配：anthropic.js（官方 SDK）、openai.js（OpenAI 兼容）
  routes/         REST 接口（auth、workspace、admin、knowledge、visitor、upload）
public/
  widget.js       嵌入网站用的挂件脚本
  chat.html/js    访客聊天页面（挂件 iframe 内的页面）
  agent/          客服工作台与管理后台
  shared/         前端公共工具
mobile/           手机 App（uni-app），见 mobile/README.md
test/             集成测试
```

### 接口概览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/login` | 客服登录，返回 token（之后用 `Authorization: Bearer <token>`） |
| GET | `/api/conversations?status=waiting\|active\|closed` | 会话列表 |
| GET | `/api/conversations/:id` / `/messages` | 会话详情 / 消息记录 |
| POST | `/api/conversations/:id/messages` | 客服发送消息 |
| POST | `/api/conversations/:id/accept` / `transfer` / `close` | 接入 / 转接 / 结束 |
| POST | `/api/visitor/session` | 访客建立或恢复身份（之后用 `X-Visitor-Token` 头） |
| POST | `/api/visitor/messages` | 访客发送消息 |
| POST | `/api/uploads` | 上传图片（PNG / JPG / GIF / WebP，最大 5MB）；请求体直接是图片，或 `multipart/form-data`（App / 小程序） |
| GET | `/api/admin/stats?range=today\|7d\|30d` | 数据统计（管理员） |
| GET / POST / PATCH / DELETE | `/api/admin/kb`、`/api/admin/kb/:id` | 知识库条目管理（管理员） |
| POST | `/api/admin/kb/import` | 批量导入知识条目 |
| POST | `/api/admin/ai/test` | 用一个问题测试 AI 回答（会调用 AI 接口） |
| GET / PUT | `/api/admin/ai/connection` | 读取 / 保存 AI 接口设置（Key 只写不读） |
| POST | `/api/admin/ai/ping` | 测试 AI 接口连接 |
| POST | `/api/visitor/handoff` | 访客从 AI 转人工 |

实时事件通过 Socket.IO 推送：`message`、`conversation:update`、`conversation`、`typing`、`agent:presence`、`service:status`。

不能发送 PATCH 的客户端（如微信小程序）可以用 `POST` 加请求头 `X-HTTP-Method-Override: PATCH` 代替。

## 安全说明

- AI 接口的 API Key 保存在数据库中，接口只返回打码后的提示，普通客服无法读取；请妥善保管 `DATA_DIR`
- 密码使用 scrypt 加盐哈希；登录失败限流；修改 / 重置密码后其他设备登录自动失效
- 登录凭证与访客身份令牌在数据库中只保存 SHA-256 哈希
- 所有用户输入均以纯文本渲染，链接只允许 http / https
- 上传文件按文件头识别真实格式，只接受常见图片格式，并以 `nosniff` + 沙箱 CSP 返回
- 客服工作台禁止被其他网站嵌入；只有访客聊天页允许被嵌入（可通过 `WIDGET_FRAME_ANCESTORS` 收紧）
- 访客发消息、上传、创建身份均有频率限制
- AI 的指令中要求它不执行访客消息里改变身份、忽略指令或泄露指令的要求；访客无法修改 AI 的系统指令和知识库

## License

MIT

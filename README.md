# Feeof 在线客服系统

一个开箱即用的网页在线客服系统：一行代码把客服挂件嵌入你的网站，访客实时咨询，客服在工作台统一接待，管理员在后台管理客服、快捷回复和查看数据。

- **后端**：Node.js 22 + Express 5 + Socket.IO，数据存储使用 Node 内置的 SQLite（`node:sqlite`），无需安装数据库
- **前端**：原生 JavaScript（ES Modules），无需构建，支持浅色 / 深色模式和手机端

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

**管理后台（管理员）**

- 数据看板：会话量、访客数、平均首次响应时间、满意度、会话时长、未回复会话、每日会话量图表、客服绩效表
- 客服管理：新增、编辑、重置密码、设置角色和最大同时接待数、禁用（禁用后强制下线并重新分配其会话）
- 快捷回复管理
- 系统设置：站点名称、主题色、欢迎语、排队 / 离线提示、自动分配开关、无消息自动结束时间，以及嵌入代码

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

体验完整流程：一个浏览器窗口登录客服工作台，另一个窗口（或无痕窗口）打开演示页点击“试试联系客服”。

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

## 部署

### Docker

```bash
docker build -t feeof-chat .
docker run -d -p 3000:3000 -v feeof-data:/app/data -e ADMIN_PASSWORD='你的强密码' feeof-chat
```

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
  routes/         REST 接口（auth、workspace、admin、visitor、upload）
public/
  widget.js       嵌入网站用的挂件脚本
  chat.html/js    访客聊天页面（挂件 iframe 内的页面）
  agent/          客服工作台与管理后台
  shared/         前端公共工具
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
| POST | `/api/uploads` | 上传图片（PNG / JPG / GIF / WebP，最大 5MB） |
| GET | `/api/admin/stats?range=today\|7d\|30d` | 数据统计（管理员） |

实时事件通过 Socket.IO 推送：`message`、`conversation:update`、`conversation`、`typing`、`agent:presence`、`service:status`。

## 安全说明

- 密码使用 scrypt 加盐哈希；登录失败限流；修改 / 重置密码后其他设备登录自动失效
- 登录凭证与访客身份令牌在数据库中只保存 SHA-256 哈希
- 所有用户输入均以纯文本渲染，链接只允许 http / https
- 上传文件按文件头识别真实格式，只接受常见图片格式，并以 `nosniff` + 沙箱 CSP 返回
- 客服工作台禁止被其他网站嵌入；只有访客聊天页允许被嵌入（可通过 `WIDGET_FRAME_ANCESTORS` 收紧）
- 访客发消息、上传、创建身份均有频率限制

## License

MIT

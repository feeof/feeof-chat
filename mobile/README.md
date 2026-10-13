# 客服工作台 App（uni-app）

客服工作台和管理后台的手机版，用 [uni-app](https://uniapp.dcloud.net.cn/)（Vue 3）开发，一套代码发布为：

- **Android / iOS App**（HBuilderX 云打包或离线打包）
- **H5**：构建后由客服系统服务端直接托管在 `/m/`，手机浏览器打开即用
- **微信小程序**

App 只是一个客户端，连接的是同一个 Feeof 客服系统服务端，和网页版工作台的数据、账号完全相通。

## 功能

**客服**

- 登录时填写服务器地址（H5 版默认就是当前网站），登录状态保存在手机上
- 会话列表：「进行中」「排队中」「AI 接待」实时更新，未读数、访客在线状态、等待时长；底部「会话」标签显示待处理数量
- 聊天：文字、图片（相册 / 拍照）、快捷回复、访客“正在输入”提示、加载更早的消息、点击图片预览
- 接入、接管 AI 会话、转接（管理员可分配）、结束会话
- 访客信息：访问页面、来源、设备、IP、本次会话数据，编辑称呼 / 电话 / 邮箱 / 备注
- 历史会话：搜索、按客服筛选（管理员）、上拉加载
- 我的：在线 / 离开 / 离线状态、个人资料、修改密码、振动提醒开关、退出登录
- 新会话、转人工、新消息时振动 + 应用内提示；断线自动重连，回到前台自动补齐数据

**管理员**（「我的 → 管理后台」）

- 数据看板：实时排队 / 进行中 / 在线客服，今日 / 近 7 天 / 近 30 天指标、每日会话量图表、客服绩效
- 客服管理：新增、编辑、重置密码、角色、最大接待数、禁用
- 知识库：搜索、新增 / 编辑 / 停用 / 删除条目、AI 状态、「试一试」检索预览和问 AI
- 快捷回复管理
- 系统设置（含 AI 智能客服开关、接待模式等）和 AI 接口（类型、地址、Key、模型、测试连接）

> 知识库的批量导入（Markdown / TXT 文件）请在电脑上的网页版管理后台操作。

## 开发

需要 Node.js 22。先在仓库根目录启动服务端（`npm start`，默认 http://localhost:3000），然后：

```bash
cd mobile
npm install
npm run dev:h5          # 浏览器调试，接口自动代理到 http://localhost:3000
FEEOF_SERVER=http://192.168.1.10:3000 npm run dev:h5   # 代理到其他服务端
npm run dev:mp-weixin   # 输出到 dist/dev/mp-weixin，用微信开发者工具打开
npm run dev:app         # 输出到 dist/dev/app，用 HBuilderX 运行到手机
```

也可以直接用 HBuilderX 打开 `mobile/` 目录开发和运行。

目录结构：

```
src/
  pages.json        页面路由、底部标签栏
  manifest.json     应用名称、App / 小程序 / H5 配置
  App.vue           全局样式、前后台切换
  api/
    http.js         接口请求、图片上传
    socket-client.mjs  Socket.IO 客户端（直接实现协议，App / 小程序 / H5 通用）
  store/            登录信息、会话列表、实时连接与提醒
  components/       头像、会话列表项
  pages/            login、conversations、chat、visitor、history、me、admin/*
  static/           图标
```

官方的 `socket.io-client` 不能在小程序和 App 中运行，所以 `api/socket-client.mjs` 基于 `uni.connectSocket` 实现了 Socket.IO 协议（握手、心跳、事件、断线重连）。它的测试在仓库根目录的 `test/mobile-socket.test.js`，随 `npm test` 一起针对真实服务端运行。

## 发布

正式使用请为服务端部署 **HTTPS**（Nginx 配置见根目录 README），App 和小程序都要求加密连接。

### H5（手机浏览器）

```bash
npm run build:h5
```

构建结果在 `dist/build/h5`。服务端会自动把它托管在 **`https://你的域名/m/`**，无需其他配置；手机浏览器打开后可“添加到主屏幕”。

用 Docker 部署时，先在本机构建，再把目录挂载进容器：

```bash
docker run -d -p 3000:3000 -v feeof-data:/app/data \
  -v "$(pwd)/mobile/dist/build/h5:/app/mobile/dist/build/h5:ro" feeof-chat
```

（或用环境变量 `MOBILE_DIR` 指定 H5 构建目录。）

### Android / iOS App

**云打包（推荐）**

1. 安装 [HBuilderX](https://www.dcloud.io/hbuilderx.html) 并登录 DCloud 账号
2. 「文件 → 导入 → 从本地目录导入」选择 `mobile/` 目录
3. 打开 `src/manifest.json`，在「基础配置」中点「重新获取」生成 AppID，按需修改应用名称、图标（「App 图标配置」可从一张 1024×1024 图片自动生成）
4. 「发行 → 原生 App-云打包」：Android 可使用 DCloud 公共测试证书或自己的证书；iOS 需要 Apple 开发者账号的证书和描述文件

**离线打包**：执行 `npm run build:app`，把 `dist/build/app` 放入 DCloud App 离线 SDK 工程（Android Studio / Xcode）中打包，步骤见 uni-app 官方文档《App 离线打包》。

**后台通知**：App 在前台时有振动和应用内提示。如需切到后台后弹出系统通知栏消息，在 `manifest.json` 的「App 模块配置」中勾选 **Push（消息推送）** 模块后重新打包。注意：手机系统会在 App 进入后台一段时间后断开网络连接，长时间后台的实时提醒需要接入厂商推送（服务端推送尚未实现）。

### 微信小程序

1. 在 `src/manifest.json` 的 `mp-weixin.appid` 中填写小程序 AppID
2. `npm run build:mp-weixin`，用微信开发者工具打开 `dist/build/mp-weixin`，上传代码
3. 在小程序管理后台「开发管理 → 开发设置 → 服务器域名」中添加你的客服系统域名：
   - request 合法域名：`https://你的域名`
   - socket 合法域名：`wss://你的域名`
   - uploadFile 合法域名：`https://你的域名`
   - downloadFile 合法域名：`https://你的域名`（预览图片）
4. 登录页的服务器地址填写同一个 `https://` 地址

小程序不支持 PATCH 请求，App 统一用 `POST` + `X-HTTP-Method-Override: PATCH` 代替，服务端已支持。客服工具类小程序上线需要选择合适的服务类目；只给内部员工使用时，也可以直接用体验版。

## 测试

在仓库根目录：

```bash
npm test   # 包含移动端 Socket.IO 客户端针对真实服务端的测试
```

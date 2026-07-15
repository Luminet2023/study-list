# 暁夕の箋

面向 2026 夏日学习计划的移动优先、本地优先 PWA。应用以日历和翻页日视图组织每日目标、日记与赠语，并在登录后将 IndexedDB 中的增量数据同步到独立 Go 后端。

## 在线地址

- <https://stellafortuna.luminet.cn/>
- <https://stellafortuna.hifumi.luminet.cn/>

后端代码位于 [Luminet2023/hifumi-backend](https://github.com/Luminet2023/hifumi-backend)，生产 API 根地址为 `https://api.luminet.cn/hifumi/`。

## 主要功能

- 2026-07-13 至 2026-08-29 的日、周、月学习计划视图。
- 基于 `page-flip` 的单页日历翻页体验，适配移动端触控操作。
- 每日目标三态循环：待完成、已完成、未完成警报。
- 支持草稿恢复的日记；普通模式提供 Markdown 编辑与预览，极简模式使用纯文本。
- 赠语收藏、学习统计、摸鱼转盘与活动结束页。
- 默认启用极简模式，并在当前浏览器中保留用户的关闭选择。
- IndexedDB 本地持久化、离线启动和可安装 PWA。
- Linux DO 登录以及基于 Protobuf 的多设备增量同步。

## 技术栈

- Vue 3、Vue Router
- Vuetify、Material Design Icons
- Vite
- IndexedDB
- Protobuf、HTTP Diff、Server-Sent Events
- Cloudflare Workers Static Assets
- Node.js 原生测试、Vitest、Playwright

## 本地开发

要求 Node.js 24 和 npm。

```bash
npm ci
npm run dev
```

开发服务器默认监听 `http://localhost:5173`。未设置 `VITE_API_BASE_URL` 时，浏览器请求 `/v1/*`，Vite 会将其代理到本地 Go 服务：

```text
http://127.0.0.1:8080/hifumi
```

可以通过环境变量改写代理目标：

```bash
VITE_API_PROXY_TARGET=http://127.0.0.1:8080/hifumi npm run dev
```

也可以让开发前端直接访问指定 API：

```bash
VITE_API_BASE_URL=https://api.luminet.cn/hifumi/ npm run dev
```

前端不需要、也不应保存 OAuth Client Secret、Session JWT Secret 或数据库凭据。

## 环境变量

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `VITE_API_BASE_URL` | 浏览器访问的 API 根地址；留空时使用同源 `/v1/*` | 开发环境留空，生产环境见 `.env.production` |
| `VITE_API_PROXY_TARGET` | Vite 开发代理目标 | `http://127.0.0.1:8080/hifumi` |
| `QA_URL` | Playwright QA 脚本访问的前端地址 | `http://127.0.0.1:4173/` |
| `API_BASE_URL` | Node 集成脚本访问的后端根地址 | `https://api.luminet.cn/hifumi/` |
| `FRONTEND_ORIGIN` | Node 集成脚本模拟的精确前端 Origin/Referer | `https://stellafortuna.luminet.cn` |

## 同步协议

浏览器以 IndexedDB 作为本地工作数据源。登录后：

1. 本地实际变更最多每 5 秒合并上传至 `POST /hifumi/v1/sync/diff`。
2. 远端变更通过 `GET /hifumi/v1/sync/events` 的 SSE 流接收。
3. 基线冲突由 `POST /hifumi/v1/sync/resolve` 显式处理。
4. 页面隐藏或离线时关闭 SSE 并保留本地 outbox；窗口失焦时保持 SSE、暂停 Diff POST，重新聚焦后复用当前 checkpoint 恢复上传。

请求使用带 Base64 Protobuf 的版本化 JSON 信封。前端没有 WebSocket 或周期性 HTTP 拉取回退。

## 检查与构建

```bash
# 领域、持久化、路由、同步等测试
npm test

# Cloudflare Worker 契约测试
npm run test:worker

# 生产构建
npm run build

# 检查 Worker 构建与配置，但不发布
npm run worker:check
```

翻页交互 QA 需要先在另一个终端运行预览服务器：

```bash
npm run build
npm run preview
```

然后执行：

```bash
npm run test:flipbook
```

## 部署

```bash
npm run deploy
```

该命令先生成 `dist/`，再按 `wrangler.jsonc` 发布 Cloudflare Worker。Worker 只提供 SPA 静态资源；退役的同源 `/api` 与 `/api/*` 会稳定返回 `410 Gone`，所有新 API 请求必须直接使用 `/hifumi/v1/*`。

生产构建会把当前 Git commit hash 注入 `globalThis.flag.ver`，并生成带内容版本的 PWA Service Worker 预缓存清单。

## 目录结构

```text
src/
  components/   页面与交互组件
  composables/  Campaign 状态与 Session
  domain/       学习计划领域模型
  persistence/  IndexedDB 持久化
  pwa/          Service Worker 注册
  router/       前端路由
  sync/         Diff、SSE、Protobuf 与同步状态机
proto/          同步协议定义
worker/         静态资源入口及旧 API 410 响应
build/          PWA 构建插件
scripts/        集成与浏览器 QA 脚本
tests/          Node/Vitest 测试
public/         PWA 图标和静态资源
```

## 数据与安全边界

- MySQL 是云端权威数据源，Redis 只用于限流、连接租约与跨实例唤醒。
- Session 仅保存在 `HttpOnly; Secure; SameSite=Lax` Cookie 中。
- 所有跨源请求使用 `credentials: "include"`，生产服务端精确校验允许的 Origin 与 Referer。
- 静态资源可以缓存；认证、同步和退役 API 路径不得进入 Service Worker Cache Storage。

本项目为私有项目，未声明开源许可证。

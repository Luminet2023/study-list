# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Locked product direction

- Recreate the selected third concept: warm rice paper, pale watercolor branches, oversized date, centered blessing, and a fine vertical study path.
- The app is mobile-first at 390 x 844 and must remain usable at 360 and 430 CSS pixels without horizontal scrolling.
- Use Vue 3 + Vuetify 3 with the `md3` blueprint. Prefer Vuetify components, including Labs `VStepperVertical`, stable `VSnackbarQueue`, and `VFadeTransition`.
- Do not use `VSnackbar`; user feedback belongs in the queue component.
- The campaign is fixed to 2026-07-13 through 2026-08-29. All user content and interaction state are persisted locally.
- Sites/Cloudflare Workers is the selected deployment target. IndexedDB 仍是本地优先的数据源；登录后通过 Protobuf 增量同步到按用户隔离的 Durable Object，并把不可变变更归档到 Workers KV。
- Linux DO 是唯一登录入口。Session JWT 只允许放在 31 天有效期的 HttpOnly Cookie 中，OAuth Client Secret 与 Session Secret 必须使用 Worker Secret，禁止写入源码或前端存储。
- Linux DO 登录成功后，必须在该用户学习数据所属的同一个 Durable Object 中维护单行 `user_profile`，保存 subject、username、display name、avatar URL、可用的 email、创建/更新时间和最近登录时间；同一哈希 `owner_key` 同时作为资料与学习数据的关联边界。旧 Session 调用会话接口时要自动补建资料，且缺少 email 的旧 JWT 不得清空已保存 email。
- 保存与同步节奏固定为：业务持久化状态变化后每 1 秒批量保存 IndexedDB、可同步记录产生实际 diff 后每 5 秒最多发起一次上传；前台聚焦时通过同源 Hibernation WebSocket 的 `sync_hint` 触发增量拉取，不得恢复周期性 HTTP 空拉取。页面导航、抽屉/Dialog 开关等纯 UI 交互不得触发保存或提前同步。标签页隐藏或窗口失焦时必须保持 WebSocket 连接与心跳，但暂停同步 RPC 并让服务端停止向该连接广播提示；重新聚焦后立即补拉增量。仅在离线或显式停止时关闭连接，并始终保留 dirty/outbox。服务端必须保留每用户限流。同步进行中使用 `v-progress-circular`，空闲时显示云端状态图标。
- 新同步端点为同源 `GET /api/v1/sync/ws`，子协议固定为 `stella-sync-v1`；文本帧使用 JSON + Base64 信封 `{ version, requestId, type, protobuf }`，提示帧使用 `{ version, type: "sync_hint", baselineId, serverCursor, serverVersion }`，页面活动控制帧使用 `{ version, type: "activity", active }`。服务端必须独立校验文本信封大小、Base64 合法性与解码后的 Protobuf 大小。旧 `/api/v1/sync/exchange` 与 `/api/v1/sync/resolve` 仅保留一个发布周期兼容旧页面，新浏览器不得自动回退 HTTP。
- 每个本地 campaign 首次初始化时生成独立的基线 ID。同基线按版本游标自动增量合并；异基线必须暂停自动同步，展示本地与云端最近更改时间和进度日期，由用户选择覆盖方向并二次确认。覆盖请求必须携带预期服务端基线与版本进行 CAS 校验，避免确认期间覆盖更新后的云端数据。
- 云端快照必须是相对默认空白数据库的稀疏记录；空数据库为 0 条记录、进度停在 2026-07-13。`server version` 是每个基线的逻辑同步批次版本，不得直接显示逐记录递增的 cursor；更换基线时该基线的 cursor 与逻辑版本重新计数。
- 移动端侧边栏隐藏时，左下角固定显示云同步状态 `v-fab`；同步中使用进度环，其余状态使用云端图标。点击 FAB 从上方打开紧凑 `v-menu` 查看同步状态、最近同步时间和 Linux DO 账号操作；`mdAndUp` 桌面端继续只在侧边栏显示，不重复渲染 FAB。

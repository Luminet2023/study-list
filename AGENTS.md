# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Locked product direction

- 页面统一使用主题纯色背景，不再使用宣纸、水彩、笔刷或转盘插画背景；保留 oversized date、居中祝语与细线学习路径等排版语言。
- 学习目标状态固定按 `待完成 → 已完成 → 未完成警报 → 待完成` 三态循环；第三次点击必须回到待完成，不得直接跳回已完成。
- The app is mobile-first at 390 x 844 and must remain usable at 360 and 430 CSS pixels without horizontal scrolling.
- Use Vue 3 + Vuetify 3 with the `md3` blueprint. Prefer Vuetify components, including Labs `VStepperVertical`, stable `VSnackbarQueue`, and `VFadeTransition`.
- Do not use `VSnackbar`; user feedback belongs in the queue component.
- The campaign is fixed to 2026-07-13 through 2026-08-29. All user content and interaction state are persisted locally.
- Cloudflare Workers 只负责在两个生产域名提供静态 Assets，旧 `/api` 与 `/api/*` 必须稳定返回 HTTP 410。IndexedDB 仍是本地优先的数据源；登录后通过 Protobuf 增量同步到 Go API，MySQL 是唯一权威数据源，Redis 只承载限流、连接租约与跨实例提示。
- Linux DO 是唯一登录入口。Session JWT 只允许放在 31 天有效期的 HttpOnly Cookie 中，OAuth Client Secret 与 Session Secret 只进入 Go 服务端 secret 配置，禁止写入源码、前端存储或镜像。
- Linux DO 登录成功后，必须在 MySQL 用户资料表维护单行 `user_profile`，保存 subject、username、display name、avatar URL、可用的 email、创建/更新时间和最近登录时间；同一哈希 `owner_key` 同时作为资料与学习数据的关联边界，缺少 email 的新登录不得清空已保存 email。
- 保存与同步节奏固定为：业务持久化状态变化后每 1 秒批量保存 IndexedDB、可同步记录产生实际 diff 后每 5 秒最多发起一次上传；前台聚焦时通过同源 Hibernation WebSocket 的 `sync_hint` 触发增量拉取，不得恢复周期性 HTTP 空拉取。页面导航、抽屉/Dialog 开关等纯 UI 交互不得触发保存或提前同步。标签页隐藏或窗口失焦时必须保持 WebSocket 连接与心跳，但暂停同步 RPC 并让服务端停止向该连接广播提示；重新聚焦后立即补拉增量。仅在离线或显式停止时关闭连接，并始终保留 dirty/outbox。服务端必须保留每用户限流。同步进行中使用 `v-progress-circular`，空闲时显示云端状态图标。
- 日视图必须固定使用由本地打包 `page-flip`（StPageFlip）驱动的柔性纸页 Flipbook，不得提供翻页效果设置项，也不得在 IndexedDB 或云同步中保存翻页效果偏好。Flipbook 必须像参考实现一样使用一个长期存活的引擎，一次挂载 2026-07-13 至 2026-08-29 的 48 个稳定物理页壳，页面索引永久等于 campaign date 下标，禁止翻页后归中、重排或批量替换页面；完整 `DayPage` 仅挂载当前页与前后各一页，非 Day 路由释放全部 Day 内容但保留页壳、索引和引擎实例。普通翻页只允许改变前后两个页面的 active/ARIA 状态并提交 URL，不得重算全部 Day model；App 必须缓存按日期的 computed model 并以 `v-memo` 跳过无关隐藏页更新。非当前页必须 `inert` 且不运行打字机或入场动画，StPageFlip 临时副本必须移除重复 ID/ARIA 引用并设为不可访问。单次手势只能导航一天；不得按次翻页或窗口 resize 反复创建引擎，并应在 `read` 空闲状态及非 Day 路由跳过 StPageFlip 每帧重复的 DOM 样式写入。busy 状态不得对全部 48 页切换根 `inert` 或应用 `:deep(*)` 样式，只允许使用轻量 pointer shield。目标日期、URL 与两侧日期耳只能在 `flip` 完成后提交，禁止任意第三日期提前露出；外部日期或非 Day 路由在翻页期间到达时必须先取消旧动画并取得最终控制权，超时/异常恢复必须先终止旧 animation，再对齐目标或源页面。使用 soft page 的动态 `clip-path`、`translate3d`、旋转和内外阴影，内置鼠标手势关闭，由 Day 容器统一处理带方向阈值的滑动。
- Flipbook 的 Day 在任何 viewport 与 resize 路径中都必须保持单页 `portrait`，禁止切入一次跨两个日期的 landscape spread；动画中的 resize 必须在 idle 后补做布局。从动画开始到 `flip` 完成、引擎进入 `read`、日期与 URL 提交结束的整个期间，前后按钮和滑动切换都必须保持锁定；busy 期间的重复输入直接防抖丢弃，不排队也不重入。目标日期与 URL 只能在完整解锁前提交。
- 新同步端点为跨源 `GET https://api.luminet.cn/hifumi/v1/sync/ws`，子协议固定为 `stella-sync-v1`；文本帧使用 JSON + Base64 信封 `{ version, requestId, type, protobuf }`，提示帧使用 `{ version, type: "sync_hint", baselineId, serverCursor, serverVersion }`，页面活动控制帧使用 `{ version, type: "activity", active }`。服务端必须独立校验文本信封大小、Base64 合法性与解码后的 Protobuf 大小。旧 `/api/*` Cloudflare 后端固定返回 `410 Gone`，新浏览器不得自动回退 HTTP。
- 每个本地 campaign 首次初始化时生成独立的基线 ID。同基线按版本游标自动增量合并；异基线必须暂停自动同步，展示本地与云端最近更改时间和进度日期，由用户选择覆盖方向并二次确认。覆盖请求必须携带预期服务端基线与版本进行 CAS 校验，避免确认期间覆盖更新后的云端数据。
- 云端快照必须是相对默认空白数据库的稀疏记录；空数据库为 0 条记录、进度停在 2026-07-13。`server version` 是每个基线的逻辑同步批次版本，不得直接显示逐记录递增的 cursor；更换基线时该基线的 cursor 与逻辑版本重新计数。
- 非极简模式下，移动端侧边栏隐藏时，左下角固定显示云同步状态 `v-fab`；同步中使用进度环，其余状态使用云端图标。点击 FAB 从上方打开紧凑 `v-menu` 查看同步状态、最近同步时间和 Linux DO 账号操作；`mdAndUp` 桌面端继续只在侧边栏显示，不重复渲染 FAB。极简模式隐藏 FAB 与同步状态展示，但 Linux DO 登录/退出和后台同步保持可用。
- 应用以 PWA 方式提供安装与离线启动：构建期生成带内容版本号的 Service Worker 预缓存清单，静态页面与资源可缓存，但同源开发路径 `/v1/` 与退役路径 `/api/` 必须始终绕过 Service Worker，生产 API 跨源直连 `https://api.luminet.cn/hifumi/`，避免 OAuth、Session 和同步响应进入 Cache Storage。2026-07-15 发布使用固定迁移标记 `force-refresh-2026-07-15-v1`，仅对已有旧 Service Worker 的每个浏览器 Origin 强制接管并刷新一次；首次安装和已记录客户端不得重复强刷，未来版本不得更换该标记。PWA 图标沿用暖色宣纸、深梅色笔尖与朱红印记的视觉语言，并保留 maskable 安全区。
- 生产前端同时发布在 `https://stellafortuna.hifumi.luminet.cn/` 与 `https://stellafortuna.luminet.cn/`；所有 API 请求使用 `credentials: "include"`，页面采用 `strict-origin-when-cross-origin` Referer 策略，服务端须精确校验这两个 Origin/Referer。
- 日记编辑器为每个日期维护独立的 `journalDraft` 云草稿记录；输入后先进入本地批量保存与云同步队列，非极简模式下编辑器内提供云图标用于立即写入。极简模式仅隐藏该图标，自动保存逻辑保持不变。再次打开时优先恢复草稿，正式保存日记后清除对应草稿；草稿不得计入学习进度或日记统计。
- 非极简模式的日记编辑器提供 Markdown 格式工具栏、编辑/预览切换与编辑器内渲染预览；极简模式必须隐藏这些 Markdown 功能并固定为纯文本输入。历史 Markdown 数据按原样保存并兼容现有只读展示。
- 极简模式是仅保存在当前浏览器的默认 UI 模式，不新增云同步记录；只有用户在设置页明确关闭后才持续使用普通模式，重新从侧边栏开启时仍需确认。开启后侧边栏隐藏“极简模式”项目，退出入口只保留在设置页；同时隐藏侧边栏品牌标题区及其下方分隔线、侧边栏的本周/总统计入口、所有云同步状态组件、移动端云同步 FAB、日页“本周统计”按钮、日期标题中的 `seal-mark.png`、日视图两侧日期切换按钮、日记状态 Chip、日记编辑器云图标、月视图百分比 Chip 与所选日期详情卡片，以及赠语收藏页“轻触复制，让它陪你去往别处。”提示。极简模式下隐藏未登录态“通过 Linux DO 登录”按钮；已登录态的侧边栏底部账号/退出入口与后台同步照常保留。极简模式允许工作日日记随时填写，并完全移除目标锁定流程：不显示填写提示、锁定按钮或锁定状态，目标无需锁定即可勾选，且第 4、6、7 项保持可编辑。退出时必须解除所有未填写完整的历史工作日锁定，恢复普通模式校验。

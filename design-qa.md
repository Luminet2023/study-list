# Design QA — 暁夕の箋学习清单

## 对照基准

- source visual truth path: `/home/luminet/.codex/attachments/d23e7641-8e6f-476f-b7f1-7c35ae1e7474/codex-clipboard-dd9c5b28-5f7e-4f89-8342-48ba37dd55bf.png`
- selected full visual source path: `/home/luminet/.codex/generated_images/019f5649-545a-7030-8cdd-862a26da36a4/exec-7e520289-a1cb-463a-b635-51b63a5c303b.png`
- implementation screenshot path: `/home/luminet/coding/zako/study-list/qa/implementation-day.png`
- desktop implementation screenshot path: `/home/luminet/coding/zako/study-list/qa/implementation-desktop-day.png`
- viewport: `390 × 844` mobile/touch 与 `1440 × 900` desktop，device scale factor `1`，`Asia/Shanghai`
- state: `2026-07-13` 工作日日视图；第 1 项完成、第 8 项未完成，与视觉稿状态一致
- full-view comparison evidence: `/home/luminet/coding/zako/study-list/qa/comparison-day.png`
- focused region evidence:
  - 完成/未完成状态：`/home/luminet/coding/zako/study-list/qa/implementation-states.png`
  - 周六 1.5 倍任务页：`/home/luminet/coding/zako/study-list/qa/implementation-saturday.png`
  - 活动开始前的抽签禁用态：`/home/luminet/coding/zako/study-list/qa/implementation-raffle.png`
  - 总统计长页：`/home/luminet/coding/zako/study-list/qa/implementation-total.png`
  - PC 三栏日视图：`/home/luminet/coding/zako/study-list/qa/implementation-desktop-day.png`
  - PC 总统计：`/home/luminet/coding/zako/study-list/qa/implementation-desktop-total.png`
  - PC 转盘修复前后并排：`/home/luminet/coding/zako/study-list/qa/comparison-desktop-raffle-fix.png`
  - PC 转盘专属背景：`/home/luminet/coding/zako/study-list/qa/implementation-desktop-raffle.png`
  - Snackbar Queue 折叠态：`/home/luminet/coding/zako/study-list/qa/implementation-desktop-snackbar-queue.png`

## Findings

- 无待修复的 P0 / P1 / P2 问题。
- [P3] 工作日步骤条统一位于左侧，而参考稿采用左右交替排版。
  - Location: `WorkdayView.vue` / `VStepperVertical`
  - Evidence: 参考稿的任务在中轴两侧交替；实现使用 Vuetify 原生垂直步骤条并将长文本统一放在右侧。
  - Impact: 视觉构图略有差异，但在 360–430 px 宽度下，`错题/知识点收集整理` 等长文本不再挤压状态按钮和输入区，可读性与触控稳定性更好。
  - Follow-up: 若后续明确以像素级还原优先，可在 ≥430 px 的宽屏断点增加交替布局；当前不阻塞交付。

## Required Fidelity Surfaces

- Fonts and typography: 主任务与赠语使用本地 `LXGW WenKai`，超大日期使用 `Cormorant Garamond`；字重、行高、字距、换行和小号日期元信息均已在 390 px 实机帧检查。第 7 项前缀、输入、后缀保持同一行，无截断。
- Spacing and layout rhythm: 顶部菜单、超大日期、日期竖线、赠语、操作图标、步骤条和日记区的层级与参考稿一致；390 × 844 画框内无水平滚动。PC 使用 286 px 常驻 Vuetify 导航抽屉、诗句日期列与清单列，1440 × 900 下无横向溢出。
- Colors and visual tokens: 使用米白纸张、墨紫文字、低饱和灰紫与朱砂状态色；完成态降噪划线，未完成态采用珊瑚水彩底与黄色警示图标，语义对比清楚。
- Image quality and asset fidelity: 宣纸水彩背景、转盘专属锦鲤签纸背景、页角、状态笔刷和印章均为独立栅格资产；未用 CSS 绘图、内联 SVG 或占位图替代。转盘背景在 PC 使用 cover、手机使用右侧安全裁切，卡片文字区保持低对比留白，未见光晕、拉伸或压缩块。
- Copy and content: 首日赠语与参考稿一致；48 天赠语均为独立文案。活动日期、统计标签、抽奖概率与开始前禁用文案均可在页面上下文中独立理解。
- Icons: 菜单、收藏、复制、状态、统计、抽签等均使用 MDI 图标，线宽与目标风格一致；关键按钮触控面积不小于 44 px。
- Accessibility: 交互控件具有可读 `aria-label`；输入有可访问名称；支持键盘输入、焦点态、文本缩放与 `prefers-reduced-motion`；禁用态不只依赖颜色表达。

## Comparison History

### Pass 1 — blocked

- [P2] 首日赠语与用户选定参考图不一致。
- [P2] 第 7 项输入区换行，破坏参考稿的连续线条节奏。
- [P2] 邻页页耳的竖排日期在窄屏发生裁切。
- [P2] 翻页退出与进入合计约 880 ms，连续切日显得迟缓。

Fixes made:

- 将 2026-07-13 赠语改为参考稿原文。
- 为第 7 项设置专属短输入宽度和不换行约束。
- 重排页耳标签并收紧窄屏尺寸。
- 将单段翻页过渡调整为 220 ms，并保持 `mode="out-in"` 避免重复可访问页面。

Post-fix visual evidence:

- `/home/luminet/coding/zako/study-list/qa/comparison-day.png`
- `/home/luminet/coding/zako/study-list/qa/implementation-day.png`

### Pass 2 — blocked

- [P2] 活动开始前，抽奖页把不可抽状态错误写成“今日已抽 / 每日机会已使用”。

Fixes made:

- 新增 `before / active / after` 活动阶段；开始前显示“07.13 开放”，结束后显示“本次假期已收官”，并同步禁用试卷登记。

Post-fix visual evidence:

- `/home/luminet/coding/zako/study-list/qa/implementation-raffle.png`

### Pass 3 — passed

- 将参考图与实现统一到 390 × 844、2026-07-13、相同完成/未完成状态后再次并排对照。
- 无新增 P0 / P1 / P2；保留一项不阻塞的 P3 单侧步骤条说明。

### Pass 4 — passed（PC 与路由增量）

- 新增 ≥960 px 桌面响应式纸笺：常驻工具栏、诗句日期区、任务/统计内容区。
- 新增 Vue Router 独立路由并逐页直接打开、刷新复测：日、周、月、本周统计、总统计、赠语收藏、摸鱼大转盘。
- 1440 × 900 实测导航抽屉 `286 px`，无横向溢出。
- Post-fix visual evidence:
  - `/home/luminet/coding/zako/study-list/qa/implementation-desktop-day.png`
  - `/home/luminet/coding/zako/study-list/qa/implementation-desktop-total.png`

### Pass 5 — blocked → passed（全屏、常驻侧栏、Vuetify 4）

- [P1] 路由切换时 `navigateView()` 把 desktop permanent drawer 的 model 设为 false，导致转盘等独立页面侧栏消失。
- [P2] PC 外层仍有 32 px 留白、圆角和投影，不符合用户要求的浏览器全屏工作区。
- 将桌面抽屉状态固定为常驻；每次路由同步时重新保证 drawer 打开。
- PC 壳体改为 `100vw × 100dvh`、无圆角、无边框、无投影。
- 依赖精确锁定 `vuetify@4.1.4`；`VStepperVertical` 与 `VSnackbarQueue` 从 v4 stable component exports 注册，`md3` blueprint 保持生效。
- 1440 × 900 复测：应用宽度 `1440 px`、文档宽度 `1440 px`、导航抽屉 `286 px`；七个路由逐一确认侧栏可见，控制台无错误。
- Post-fix visual evidence:
  - `/home/luminet/coding/zako/study-list/qa/comparison-desktop-raffle-fix.png`
  - `/home/luminet/coding/zako/study-list/qa/implementation-desktop-day.png`

### Pass 6 — blocked → passed（Snackbar Queue 与转盘背景）

- [P2] Snackbar Queue 仅有 `collapsed`，但默认 `totalVisible=1`，不存在可叠放的第二条 toast。
- [P2] 转盘页沿用通用学习背景，PC 大面积区域显得空白，且缺少转盘页自己的视觉识别。
- 使用官方组合：`collapsed`、`total-visible=5`、`display-strategy="hold"`。连续触发 3 条消息时自动化断言确认 3 条 active、至少 2 层 collapsed。
- 以既有宣纸水彩为风格参考，通过 ImageGen 生成独立 `raffle-wash-bg.png`；锦鲤、涟漪与签纸集中在内容安全区之外，PC 与手机分别适配裁切。
- Post-fix visual evidence:
  - `/home/luminet/coding/zako/study-list/qa/implementation-desktop-snackbar-queue.png`
  - `/home/luminet/coding/zako/study-list/qa/implementation-desktop-raffle.png`
  - `/home/luminet/coding/zako/study-list/qa/implementation-raffle.png`

### Pass 7 — passed（工作日目标锁定门禁）

- 工作日第 4、6、7 项未全部填写时，八个状态按钮与日记入口均保持禁用。
- 填写完整后仅开放“核对并锁定今日目标”；确认弹窗逐项展示八个最终目标，并明确区分固定目标与用户填写内容。
- 确认锁定后输入变为只读、状态按钮开放；八项有效状态全部完成后才开放 Markdown 日记编辑器，转盘免项按完成处理。
- IndexedDB 刷新回归确认：填写内容、锁定状态、八项完成状态与日记内容均恢复成功。
- 360 / 390 / 430 px 无水平溢出，1440 px 桌面壳体与 286 px 常驻侧栏保持稳定，浏览器控制台无错误。
- Post-fix visual evidence:
  - `/home/luminet/coding/zako/study-list/qa/implementation-goal-gate.png`
  - `/home/luminet/coding/zako/study-list/qa/implementation-goal-lock-dialog.png`
  - `/home/luminet/coding/zako/study-list/qa/implementation-day.png`

### Pass 8 — blocked → passed（手机页面全屏）

- Source visual truth: `/home/luminet/.codex/attachments/91764573-cb00-4df5-9092-e0df169a9d47/codex-clipboard-95625d11-ecca-4ba7-90a5-d88d5e89e420.png`
- Implementation screenshot: `/home/luminet/coding/zako/study-list/qa/implementation-mobile-fullscreen.png`
- Full-view comparison: `/home/luminet/coding/zako/study-list/qa/comparison-mobile-fullscreen.png`
- Viewport / state: 700 × 844，`/day/2026-07-13`，工作日已锁定完成状态。
- [P1] 原手机壳体被固定在 390 × 844 并居中，较宽的手机/折叠屏视口出现明显白色侧边与底部空区，页面没有直接铺满屏幕。
- Fix: 手机壳体改为 `100vw × 100dvh`，移除居中预览框、边框和投影；viewport 增加 `viewport-fit=cover`，PC ≥960 px 的常驻侧栏规则保持不变。
- Post-fix evidence: 360 / 390 / 430 / 700 px 四档均验证壳体宽高等于视口、无横向溢出；700 px 实现截图中宣纸背景连续覆盖整个屏幕。
- Required fidelity surfaces: 字体、字号、文案、MD3 控件、颜色与水墨资产未改；仅修正页面边界及背景裁切。任务只涉及外层画布，完整对照已足够判断，未另做局部裁切。
- Post-fix findings: 无剩余 P0 / P1 / P2。

### Pass 9 — passed（原企划 2 / 3 / 6 / 7 / 11 收口）

- 工作日第 6 项改为真正的可选计划：留空时不计入计划、状态按钮保持禁用，也不阻塞目标锁定、日结解锁与满勤；填写后则参与完成统计。
- 周六条目严格按工作日视觉基准放大至 1.5 倍，包括行高、状态按钮、图标、正文、输入区与未完成笔刷背景；360 / 390 / 430 / 700 px 均无横向溢出。
- 月视图点击日期先进入所属周，周视图再点击进入当日；周统计页右侧同位置提供“返回日视图”。
- 抽奖加入真实落签动画、动态概率摘要、UTC+8 精确零点刷新；涉及空白第 6 项时提供明确确认分支，中奖免项继续按完成统计。
- 新鲜匿名会话复拍并验证亮色页面无残留抽屉或 Dialog 遮罩；PC 与手机均保持全屏。
- Post-fix visual evidence:
  - `/home/luminet/coding/zako/study-list/qa/latest-mobile-day.png`
  - `/home/luminet/coding/zako/study-list/qa/latest-desktop-day.png`
  - `/home/luminet/coding/zako/study-list/qa/implementation-saturday.png`
  - `/home/luminet/coding/zako/study-list/qa/implementation-raffle-spinning.png`

### Pass 10 — passed（直接翻页与旅程终章）

- 日视图右侧书耳及左滑通过固定的 StPageFlip 3D 翻书切换到下一天；左书耳返回前一天，设置页不再提供效果切换。
- 已移除不属于原计划的“今日收束 / 本周收束”页面及 `/day/:date/summary` 路由。
- 08/29 右书耳保持可用并改为“旅程终章”，进入 `/ending`；终章固定以活动截止日统计，展示完成项、日结字数、完成率、满勤周与中奖次数。
- 终章烟花自动播放且可手动重放，不遮挡操作；`prefers-reduced-motion` 下关闭位移动画。
- 手机 360 / 390 / 430 / 700 px 与 PC 1440 px 均无横向溢出，新增路由刷新保持、PC 常驻侧栏与浏览器控制台均通过。
- Post-fix visual evidence:
  - `/home/luminet/coding/zako/study-list/qa/implementation-ending.png`
  - `/home/luminet/coding/zako/study-list/qa/implementation-desktop-ending.png`

## Primary Interactions Tested

- 任务状态：`pending → completed → missed → completed`，完成划线与未完成警报样式均出现。
- 输入与保存：第 6 项、日结写入后刷新页面，IndexedDB 恢复成功。
- 横滑翻日：真实 `TouchEvent` 左滑从 07/13 翻至 07/14。
- 双指捏合：日 → 周 → 月；反向手势月 → 周 → 日。
- 周六：自动编号新增任务，周六字号和轮廓为工作日约 1.5 倍。
- 工具栏：日、周、月、本周统计、总统计、赠语收藏、摸鱼大转盘均可进入与返回。
- 路由：`/day/:date`、`/week/:date`、`/month/:month`、`/stats/week/:date`、`/stats/total`、`/favorites`、`/raffle` 均可直达并在刷新后保持。
- 响应式：360 / 390 / 430 / 700 px 四档均全屏且无水平溢出。
- PC：1440 × 900 三栏布局、常驻导航、日视图和总统计截图已验收，无水平溢出。
- PC 全屏：应用宽度与 1440 px 视口一致；所有独立路由均保持 286 px 常驻侧栏。
- Snackbar Queue：连续复制 3 次，验证 3 条 active toast 与至少 2 层 collapsed toast。
- Vuetify：浏览器运行版本对应锁定的 `4.1.4` 构建，stable 垂直步骤条与 Snackbar Queue 均正常渲染。
- 工作日门禁：填写 4 / 6 / 7 → 弹窗核对 → 锁定 → 八项完成 → Markdown 日记解锁；刷新后完整恢复。
- browser console errors checked: `none`
- page errors checked: `none`

## Implementation Checklist

- [x] 修复所有 P0 / P1 / P2。
- [x] 生产构建通过。
- [x] 领域测试通过。
- [x] 浏览器交互与手机端响应式回归通过。
- [x] 最终参考图与实现并排复核。

## Follow-up Polish

- [P3] 如用户后续更偏好纯视觉还原，可针对更宽手机增加交替步骤布局；当前原生 `VStepperVertical` 方案优先保证长任务文案与编辑区可用。

final result: passed

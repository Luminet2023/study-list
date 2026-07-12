# Design QA — 朝夕笺学习清单

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

## Primary Interactions Tested

- 任务状态：`pending → completed → missed → completed`，完成划线与未完成警报样式均出现。
- 输入与保存：第 6 项、日结写入后刷新页面，IndexedDB 恢复成功。
- 横滑翻日：真实 `TouchEvent` 左滑从 07/13 翻至 07/14。
- 双指捏合：日 → 周 → 月；反向手势月 → 周 → 日。
- 周六：自动编号新增任务，周六字号和轮廓为工作日约 1.5 倍。
- 工具栏：日、周、月、本周统计、总统计、赠语收藏、摸鱼大转盘均可进入与返回。
- 路由：`#/day/:date`、`#/week/:date`、`#/month/:month`、`#/stats/week/:date`、`#/stats/total`、`#/favorites`、`#/raffle` 均可直达并在刷新后保持。
- 响应式：360 / 390 / 430 px 三档均无水平溢出。
- PC：1440 × 900 三栏布局、常驻导航、日视图和总统计截图已验收，无水平溢出。
- PC 全屏：应用宽度与 1440 px 视口一致；所有独立路由均保持 286 px 常驻侧栏。
- Snackbar Queue：连续复制 3 次，验证 3 条 active toast 与至少 2 层 collapsed toast。
- Vuetify：浏览器运行版本对应锁定的 `4.1.4` 构建，stable 垂直步骤条与 Snackbar Queue 均正常渲染。
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

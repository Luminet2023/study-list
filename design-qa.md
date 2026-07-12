# Design QA — 朝夕笺学习清单

## 对照基准

- source visual truth path: `/home/luminet/.codex/attachments/d23e7641-8e6f-476f-b7f1-7c35ae1e7474/codex-clipboard-dd9c5b28-5f7e-4f89-8342-48ba37dd55bf.png`
- selected full visual source path: `/home/luminet/.codex/generated_images/019f5649-545a-7030-8cdd-862a26da36a4/exec-7e520289-a1cb-463a-b635-51b63a5c303b.png`
- implementation screenshot path: `/home/luminet/coding/zako/study-list/qa/implementation-day.png`
- viewport: `390 × 844`, device scale factor `1`, mobile/touch, `Asia/Shanghai`
- state: `2026-07-13` 工作日日视图；第 1 项完成、第 8 项未完成，与视觉稿状态一致
- full-view comparison evidence: `/home/luminet/coding/zako/study-list/qa/comparison-day.png`
- focused region evidence:
  - 完成/未完成状态：`/home/luminet/coding/zako/study-list/qa/implementation-states.png`
  - 周六 1.5 倍任务页：`/home/luminet/coding/zako/study-list/qa/implementation-saturday.png`
  - 活动开始前的抽签禁用态：`/home/luminet/coding/zako/study-list/qa/implementation-raffle.png`
  - 总统计长页：`/home/luminet/coding/zako/study-list/qa/implementation-total.png`

## Findings

- 无待修复的 P0 / P1 / P2 问题。
- [P3] 工作日步骤条统一位于左侧，而参考稿采用左右交替排版。
  - Location: `WorkdayView.vue` / `VStepperVertical`
  - Evidence: 参考稿的任务在中轴两侧交替；实现使用 Vuetify 原生垂直步骤条并将长文本统一放在右侧。
  - Impact: 视觉构图略有差异，但在 360–430 px 宽度下，`错题/知识点收集整理` 等长文本不再挤压状态按钮和输入区，可读性与触控稳定性更好。
  - Follow-up: 若后续明确以像素级还原优先，可在 ≥430 px 的宽屏断点增加交替布局；当前不阻塞交付。

## Required Fidelity Surfaces

- Fonts and typography: 主任务与赠语使用本地 `LXGW WenKai`，超大日期使用 `Cormorant Garamond`；字重、行高、字距、换行和小号日期元信息均已在 390 px 实机帧检查。第 7 项前缀、输入、后缀保持同一行，无截断。
- Spacing and layout rhythm: 顶部菜单、超大日期、日期竖线、赠语、操作图标、步骤条和日记区的层级与参考稿一致；390 × 844 画框内无水平滚动，页面纵向内容可自然滚动。
- Colors and visual tokens: 使用米白纸张、墨紫文字、低饱和灰紫与朱砂状态色；完成态降噪划线，未完成态采用珊瑚水彩底与黄色警示图标，语义对比清楚。
- Image quality and asset fidelity: 宣纸水彩背景、页角、状态笔刷和印章均为独立栅格资产；未用 CSS 绘图、内联 SVG 或占位图替代。透明边缘和 390 px 缩放下未见光晕、拉伸或压缩块。
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

## Primary Interactions Tested

- 任务状态：`pending → completed → missed → completed`，完成划线与未完成警报样式均出现。
- 输入与保存：第 6 项、日结写入后刷新页面，IndexedDB 恢复成功。
- 横滑翻日：真实 `TouchEvent` 左滑从 07/13 翻至 07/14。
- 双指捏合：日 → 周 → 月；反向手势月 → 周 → 日。
- 周六：自动编号新增任务，周六字号和轮廓为工作日约 1.5 倍。
- 工具栏：日、周、月、本周统计、总统计、赠语收藏、摸鱼大转盘均可进入与返回。
- 响应式：360 / 390 / 430 px 三档均无水平溢出。
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

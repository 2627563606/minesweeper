# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

零依赖、纯浏览器端扫雷游戏。4 个 JS 文件 + 1 个 CSS 文件 + 1 个 HTML 文件，通过经典 `<script>` 标签按依赖顺序加载，无框架、无构建工具、无包管理器。

## 运行方式

直接在浏览器中打开 `index.html`（Chrome/Edge/Firefox 均可）。

> **注意**：不使用 ES Modules（`type="module"`），因为 Chrome 对 `file://` 协议加载 ESM 会触发 CORS 错误。所有符号通过全局作用域在 `<script>` 加载顺序中自然可见。

## 文件架构与加载顺序

```
index.html
  ├── <script src="Engine.js">       ← CellState, createCell, ActionHistory, Minesweeper
  ├── <script src="Renderer.js">     ← 所有渲染函数 + 公告/日志数据 + callbacks 对象
  ├── <script src="Controller.js">   ← 换肤系统 + 事件绑定 + 游戏主循环 + init()
  └── <script src="main.js">         ← DOMContentLoaded → init()
```

- **Engine.js** (~1230 行)：纯数据逻辑。`CellState` 枚举、`createCell` 工厂、`ActionHistory`（环形缓冲区 + localStorage 持久化 + RLE 压缩编码）、`Minesweeper` 类（reveal / flag / chord / flood-fill / 首点安全布雷 / 集合子集推演 / 无死局求解器）。
- **Renderer.js** (~400 行)：纯 UI 渲染。公告/更新日志配置与渲染、`renderBoard`、`renderCell`、`launchMineExplosion`、`launchConfetti`、`renderStatus`、`formatLCD`、`callbacks` 可变对象（供 Controller 挂载 `onGameEnd` 回调）。
- **Controller.js** (~1400 行)：主题系统（`THEME_DEFAULTS` / `THEME_SECTIONS` / `loadTheme` / `saveTheme` / `renderSkinMenu`）、所有事件绑定（鼠标悬停/点击/中键/右键）、高亮锁定系统、计时器、回放、难度与模式偏好持久化、对局记录系统、`init()` 入口函数。
- **main.js** (~10 行)：仅 `document.addEventListener('DOMContentLoaded', init)`。

所有符号均为全局作用域，依赖顺序由 `<script>` 标签顺序保证。

## 核心引擎 — Minesweeper 类

### 首点安全 + 布雷
`reveal(r, c)` 首次调用时触发 `_generateMines(safeR, safeC)`：以首次点击位置为中心标记 3×3 安全区，Fisher-Yates 洗牌后在候选格子中随机选取 `totalMines` 个放置地雷。

### 无死局模式
构造函数 `new Minesweeper(rows, cols, mines, noGuess)` 接受第四个参数。开启后 `_generateMines` 会循环重试（最多 `15 + √(rows×cols) × 2` 次，上限 80），每次调用 `_validateNoGuess(safeR, safeC)` 运行求解器验证棋盘完全可推演。

求解器模拟完美玩家：先基本计数推演（剩余雷=0→安全；剩余雷=隐藏格数→全雷），再集合子集推演（S_B ⊂ S_A 且 M_A=M_B→差集安全；|S_A\S_B|=M_A−M_B→差集全雷），循环至无进展或全部揭开。

### 集合子集推演（安全 + 危险双向）
- `_findSmartSafeCells(r, c, candidateFilter?)`：扫描 N_B 数字格，若 S_B ⊂ S_A 且 M_A = M_B，则 S_A\S_B 绝对安全。可选 `candidateFilter`（Set<坐标键>）限制 N_B 候选范围。
- `_findSmartDangerCells(r, c, candidateFilter?)`：对称逻辑。若 S_B ⊂ S_A 且 |S_A\S_B| = M_A − M_B，则差集中每格均为雷。
- 两方法均含**曼哈顿距离 ≤ 2 剪枝**：若 N_B 离 N_A 超过 2 格，S_B 不可能 ⊆ S_A，直接跳过。
- `smartReveal(r, c)` / `smartFlag(r, c)`：调用上述方法并执行揭开/插旗操作。

## ActionHistory — 持久化与压缩

环形缓冲区（容量 10），每次 `push(type, r, c, gridSnapshot, totalMines)` 去抖写入 localStorage（2 秒合并窗口）；`clear()` 立即清除持久化数据；`flushSave()` 强制立即写入。

### 压缩编码
- **单格 1 字节**：`bit[7]=triggered, bit[6]=mine, bit[5:4]=state, bit[3:0]=adjacentMines+1`
- **游程编码（RLE）**：`encodeGrid(grid)` → `{w, h, d: [value, count, …]}`，相邻同值格合并。一个全隐藏 9×9 网格压缩为 `{w:9, h:9, d:[1,81]}`（4 字节有效载荷）。
- 10 条历史的困难模式棋盘（16×30）约占用 2–8 KB localStorage。

### 静态方法
- `ActionHistory.loadSession(capacity)` — 从 localStorage 恢复实例（当前未在启动时自动调用，按需使用）
- `ActionHistory.clearSession()` / `hasSavedSession()` — 管理持久化数据

## 右键一键插旗 — 优先级链

右键已翻开数字格时按以下顺序尝试，命中即 `return`：

1. **基础条件**：剩余雷数 = 隐藏格数 → 全插旗（数学绝对正确，优先于集合子集以避免只插部分）
2. **集合子集推演**（`smartFlag`）：S_B ⊂ S_A 且 |S_A\S_B| = M_A−M_B → 插旗差集
3. **进阶条件**：排除锁定高亮区后，非高亮格数 = 剩余雷 − 高亮区含雷量 → 插旗非高亮区

全部不满足 → 绿框闪烁 (`cell--flag-reject`) 提示。

## 悬停高亮与锁定系统

- **悬停**（`mouseover`）：`applyHoverHighlight(r, c)` 清除全盘 → 重铺锁定高亮 → 叠加当前悬停高亮（优先级覆盖，数值越小优先级越高）。
- **中键锁定**（`mousedown button=1`）：切换 `lockedCells` 集合，触发 `refreshLockedHighlights()`（清除全部 → 重铺锁定高亮）。
- **智能安全区**（白色 `cell--smart-safe`）：仅在悬定格 3×3 内有锁定高亮时激活，且仅显示由附近锁定格参与推演的安全格（通过 `candidateFilter` 过滤，避免远端无关数字格的偶然推演结果）。

## 回放系统

- `ActionHistory` 在每次状态变更操作时记录网格快照（`recordAction`）。
- 踩雷后爆炸动画与复盘面板**同时启动**（不再等待 1.2s 动画结束），复盘面板 `z-index: 10000` 位于爆炸覆盖层之上。
- 回放面板：◀ 上一步 / ▶ 下一步，焦点格金色呼吸动画（`cell--replay-focus`）。
- `renderReplay` 直接操作 `game.grid` 还原历史状态，不调用 `renderStatus`（避免触发 `onGameEnd` 回调死循环）。

## 对局记录系统

- **自动保存**：每局结束（胜利或踩雷）时，`saveGameRecord()` 将最后 10 步动作（含 RLE 压缩棋盘快照）存入 `minesweeper-records`（localStorage）。未完成的游戏（刷新/关闭/点新游戏）不记录。
- **容量**：最多保留最近 10 局，新记录头部插入，超出自动淘汰。
- **查看回放**：设置菜单 → 📼 对局记录 → 点击记录行进入查看模式。棋盘展示记录的最后一步，◀ ▶ 按钮逐步导航，焦点格金色呼吸描边（`cell--replay-focus`，与失败复盘一致）。
- **退出查看**：查看模式下点击棋盘或"新游戏"按钮自动退出并开始新局。
- **删除**：每条记录有 ✕ 按钮；删除正在查看的记录自动退出查看模式。
- **棋盘守卫**：游戏结束后（`gameOver || won`）所有棋盘点击被忽略，避免重复触发结束动画。

## 偏好持久化

`init()` 启动时从 `minesweeper-preferences` 恢复上次的难度选择和"无死局模式"开关状态，并在每次变更时自动保存。自定义难度的行/列/雷数参数一并持久化。

## 设置菜单层级

三级手风琴结构：

- **一级**：⚙ 齿轮按钮 → `settingsMenu.classList.toggle('open')`
- **二级**：`.submenu-header` → 折叠/展开，含：📢 公告、🎯 难度、🧩 游戏模式（无死局开关）、🎨 换肤、📼 对局记录、📋 更新日志、🐛 Bug 反馈
- **三级**（仅换肤）：`.skin-section-header` → 手风琴式颜色分组

**外部点击关闭**（`document.addEventListener('mousedown', …)`，使用 `mousedown` 而非 `click` 因为棋盘 `renderBoard` 在 mousedown 中替换 DOM 会导致 click 事件丢失）：
1. 第一次 → 优先关闭三级换肤菜单
2. 第二次 → 关闭整个设置面板

## CSS 变量与换肤

`style.css` 在 `[data-theme="classic"]` 块声明 26 个 CSS 自定义属性。换肤系统通过 `<html>` 行内 `style.setProperty` 覆盖，优先级高于 CSS 中的默认值。支持 `#rgb`/`#rrggbb`/`#rrggbbaa`/`transparent` 格式，非法值静默回退。

数字色通过 `[data-num="N"]` 选择器应用，背景色通过 `.cell--revealed[data-num="N"]` 覆盖。7 级悬停高亮 (`cell--hover-1` ~ `cell--hover-7`) 和智能安全区 (`cell--smart-safe`) 使用硬编码 `rgba()` 色值，不在换肤覆盖范围内。

## 性能优化要点

以下优化已实施，修改时注意保持：

- **格子 DOM 缓存**：`cellElements[r][c]` 二维数组（Renderer.js 声明，`renderBoard` 填充），Controller 中所有棋盘格子的 `querySelector` 查找已替换为 O(1) 数组访问。`renderBoard` 重建 DOM 时必须同步重建缓存。
- **高亮集合跟踪**：`highlightedCells`（Set<HTMLElement>）和 `smartSafeCells`（Set<HTMLElement>）替代 `querySelectorAll('[data-highlight-priority]')` 的 DOM 遍历。`applyHighlightToEl`/`removeHighlightFromEl` 自动维护集合。
- **动作历史去抖持久化**：`ActionHistory._scheduleSave()` 将 localStorage 写入延迟 2 秒合并，避免每次操作都触发同步 I/O。`flushSave()` 可强制立即写入。
- **悬停节流**：`mouseover` 使用 `requestAnimationFrame` 节流，每帧最多执行一次高亮重算。`mouseleave` 和新游戏时取消待执行帧回调。
- **CSS 动画 GPU 加速**：`ring-expand` 不再动画化 `border-width`（避免 layout），仅 `transform` + `opacity`。`replay-breathe` 使用 `::after` 伪元素的 `opacity` 替代 `box-shadow` 动画（避免 paint）。

## localStorage 键

| 键 | 用途 | 格式 |
|---|---|---|
| `minesweeper-theme` | 换肤配色 | JSON，键=CSS 变量名，值=hex |
| `minesweeper-history` | 压缩动作历史 | JSON `{v:1, mines, capacity, entries:[{type, r, c, ts, g:{w, h, d:[RLE]}}]}` |
| `minesweeper-preferences` | 难度与模式偏好 | JSON `{difficulty, noGuessMode, customRows?, customCols?, customMines?}` |
| `minesweeper-records` | 对局记录（最近 10 局，每局最后 10 步） | JSON `{v:1, records:[{id, outcome, difficulty, rows, cols, mines, elapsed, date, steps:[{type, r, c, ts, g:{w,h,d:[RLE]}}]}]}` |

## 语言约定

代码注释、UI 文案、公告和更新日志均使用中文（zh-CN）。编写代码时保持中文注释风格。

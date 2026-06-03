/**
 * lapseld.minesweeper · Renderer 模块
 *
 * 包含：
 *   - 公告 / 更新日志配置与渲染
 *   - 棋盘渲染纯函数（createCellElement、renderCell、renderBoard）
 *   - 动画效果（爆炸、撒花）
 *   - 状态栏渲染（renderStatus、formatLCD）
 *
 * 职责：纯 UI 渲染，不涉及游戏状态修改或事件绑定。
 *       通过 CellState 枚举判断格子状态，仅操作传入的快照数据。
 */

// ============================================================
//  公告配置（开发者只需编辑此数组）
// ============================================================

const ANNOUNCEMENTS = [
    {
        date: '2026-06-03',
        text: '新手指引已上线：设置菜单第二项可查看完整操作指南。',
    },
    {
        date: '2026-06-03',
        text: '棋盘支持左键拖动：拖拽游戏区域可任意摆放位置，刷新后复位。',
    },
    {
        date: '2026-06-01',
        text: '智能推演引擎就绪：悬停数字可自动计算安全区与危险区。',
    },
    {
        date: '2026-06-01',
        text: 'Phase 3 上线：死亡回放系统已部署，踩雷后可逐步回溯对局。',
    },
    // 新公告加在最前面，旧公告自动下沉
];

/**
 * 渲染公告列表到 DOM
 */
function renderAnnouncements() {
    const container = document.getElementById('announceList');
    if (!container) return;

    if (ANNOUNCEMENTS.length === 0) {
        container.innerHTML = '<p class="announce-empty">暂无公告</p>';
        return;
    }

    container.innerHTML = ANNOUNCEMENTS.map(a => `
        <div class="announce-item">
            <span class="announce-date">${a.date}</span>
            <p class="announce-text">${a.text}</p>
        </div>
    `).join('');
}

// ============================================================
//  更新日志（开发者只需编辑此数组）
// ============================================================

const CHANGELOG = [
    {
        version: 'v0.4.0',
        date: '2026-06-03',
        entries: [
            '棋盘左键拖动：任意摆放位置，刷新后自动复位',
            '揭开 / 插旗改为松开鼠标时触发，与拖动操作互斥',
            '右键一键插旗重构：子集推演优先，基础条件兜底',
            '集合推演增加旗标溢出防护',
            '新增新手指引面板，设置菜单第二项永久置顶',
            '更新日志固定于菜单倒数第二位置，Bug 反馈更名"联系开发者"',
        ],
    },
    {
        version: 'v0.3.0',
        date: '2026-06-01',
        entries: [
            '新增死亡回放系统，踩雷后可逐步回溯',
            '新增约束推演引擎，跨数字集合减法',
            '新增设置菜单：难度选择、公告、日志、Bug 反馈',
        ],
    },
    {
        version: 'v0.2.0',
        date: '2026-06-01',
        entries: [
            '悬停高亮：3×3 区域按剩余雷数分级变色',
            '中键锁定高亮，支持优先级覆盖',
            '左键数字格一键和弦展开',
            '右键数字格一键插旗',
            '智能交集推演：自动计算安全区',
        ],
    },
    {
        version: 'v0.1.0',
        date: '2026-06-01',
        entries: [
            '核心扫雷逻辑：首点安全、DFS 蔓延、胜负判定',
            '经典主题 CSS 变量换肤',
            '新游戏按钮 + 计时器',
        ],
    },
    // 新版本加在最前面
];

/**
 * 渲染更新日志到 DOM
 */
function renderChangelog() {
    const container = document.getElementById('changelogList');
    if (!container) return;

    if (CHANGELOG.length === 0) {
        container.innerHTML = '<p class="announce-empty">暂无日志</p>';
        return;
    }

    container.innerHTML = CHANGELOG.map(release => `
        <div class="changelog-release">
            <div class="changelog-header">
                <span class="changelog-version">${release.version}</span>
                <span class="changelog-date">${release.date}</span>
            </div>
            <ul class="changelog-entries">
                ${release.entries.map(e => `<li>${e}</li>`).join('')}
            </ul>
        </div>
    `).join('');
}

// ============================================================
//  回调钩子（供 Controller 挂载，避免 ES Module 只读导入问题）
// ============================================================

const callbacks = {
    /** @type {Function|null} 游戏结束时触发（gameOver 或 won） */
    onGameEnd: null,
};

/**
 * 格子 DOM 元素缓存（二维数组 [row][col] → HTMLElement）
 * 由 renderBoard 填充，供 Controller 以 O(1) 访问，避免 querySelector 遍历 DOM
 * @type {HTMLElement[][]}
 */
let cellElements = [];

// ============================================================
//  棋盘渲染
// ============================================================

/**
 * 创建一个 DOM 格子元素
 * @param {number} r  行号
 * @param {number} c  列号
 * @returns {HTMLDivElement}
 */
function createCellElement(r, c) {
    const el = document.createElement('div');
    el.className = 'cell';
    el.dataset.row = r;
    el.dataset.col = c;
    return el;
}

/**
 * 根据游戏快照刷新单个格子的 DOM 状态
 * @param {HTMLDivElement} el   格子 DOM 元素
 * @param {object} cell         单元格数据快照
 */
function renderCell(el, cell) {
    // 重置类名
    el.className = 'cell';
    el.removeAttribute('data-num');
    el.textContent = '';

    if (cell.state === CellState.REVEALED) {
        el.classList.add('cell--revealed');

        if (cell.mine) {
            el.classList.add('cell--mine');
            // 触发雷（踩中的那颗）高亮
            if (cell.triggered) {
                el.classList.add('cell--mine-triggered');
            }
            el.textContent = '💣';
        } else if (cell.adjacentMines > 0) {
            el.dataset.num = cell.adjacentMines;
            el.textContent = cell.adjacentMines;
        } else {
            // 空白格（adjacentMines === 0）：仅 data-num 用于 CSS 选择器 [data-num="0"]
            el.dataset.num = 0;
        }
    } else if (cell.state === CellState.FLAGGED) {
        el.classList.add('cell--flagged');
    }
}

/**
 * 全量渲染棋盘（DocumentFragment 批量插入，单次 DOM 操作）
 * @param {import('./Engine.js').Minesweeper} game
 */
function renderBoard(game) {
    const boardEl = document.getElementById('gameBoard');
    const rows = game.rows;
    const cols = game.cols;
    const grid = game.grid; // 直接读取，避免 getGridSnapshot() 深拷贝开销

    // 仅在列数变化时更新 grid-template（避免冗余样式重算）
    const neededCols = `repeat(${cols}, var(--cell-size))`;
    if (boardEl.style.gridTemplateColumns !== neededCols) {
        boardEl.style.gridTemplateColumns = neededCols;
    }

    // 预分配缓存数组
    cellElements = new Array(rows);

    // 使用 DocumentFragment 批量构建，单次插入 DOM
    const frag = document.createDocumentFragment();
    for (let r = 0; r < rows; r++) {
        const row = cellElements[r] = new Array(cols);
        const gridRow = grid[r];
        for (let c = 0; c < cols; c++) {
            const el = document.createElement('div');
            el.className = 'cell';
            el.dataset.row = r;
            el.dataset.col = c;
            renderCell(el, gridRow[c]);
            row[c] = el;
            frag.appendChild(el);
        }
    }

    boardEl.replaceChildren(frag);
}

// ============================================================
//  动画效果
// ============================================================

/**
 * 震动元素（在现有 transform 之上叠加衰减抖动，结束后恢复原位）
 * @param {HTMLElement} el
 * @param {number} [duration=500] 持续时间 ms
 */
function shakeElement(el, duration = 500) {
    const origTransform = el.style.transform || '';
    const start = performance.now();

    function tick(now) {
        const elapsed = now - start;
        if (elapsed >= duration) {
            el.style.transform = origTransform;
            return;
        }
        const t = elapsed / duration;
        const decay = 1 - t; // 线性衰减
        const sx = Math.sin(t * Math.PI * 7.3) * decay * 8;
        const sy = Math.cos(t * Math.PI * 8.7) * decay * 6;
        const extra = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
        el.style.transform = origTransform ? `${origTransform} ${extra}` : extra;
        requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
}

/**
 * 失败爆炸动画
 * 红色闪光 + 冲击波环 + 屏幕震动 + 暗角，1.2 秒后回调
 * @param {{r:number, c:number}} mineRC 触雷坐标
 * @param {Function} [onDone] 动画结束回调
 */
function launchMineExplosion(mineRC, onDone) {
    // 雷格屏幕坐标
    const cellEl = document.querySelector(
        `.cell[data-row="${mineRC.r}"][data-col="${mineRC.c}"]`
    );
    let mx = window.innerWidth / 2, my = window.innerHeight / 2;
    if (cellEl) {
        const rect = cellEl.getBoundingClientRect();
        mx = rect.left + rect.width / 2;
        my = rect.top + rect.height / 2;
        cellEl.classList.add('cell--mine-hit');
    }

    // 震屏（叠加在拖动偏移之上，使用 JS 驱动避免覆盖 drag transform）
    const container = document.querySelector('.game-container');
    if (container) {
        shakeElement(container, 500);
    }

    // 红色闪光
    const flash = document.createElement('div');
    flash.className = 'explosion-flash';
    document.body.appendChild(flash);

    // 冲击波环
    const ring = document.createElement('div');
    ring.className = 'explosion-ring';
    const ringSize = Math.max(window.innerWidth, window.innerHeight) * 2;
    ring.style.cssText = `left:${mx}px;top:${my}px;width:${ringSize}px;height:${ringSize}px;`;
    document.body.appendChild(ring);

    // 暗角
    const vignette = document.createElement('div');
    vignette.className = 'explosion-vignette';
    document.body.appendChild(vignette);

    // 清理
    setTimeout(() => {
        flash.remove();
        ring.remove();
        vignette.remove();
        if (cellEl) cellEl.classList.remove('cell--mine-hit');
        if (typeof onDone === 'function') onDone();
    }, 1200);
}

function launchConfetti() {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none;';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    // 自适应尺寸
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener('resize', resize);

    // 彩带颜色
    const COLORS = [
        '#ff0000', '#ff8c00', '#ffd700', '#00cc00',
        '#00bfff', '#8a2be2', '#ff69b4', '#00fa9a',
    ];

    // 纸片形状类型
    const SHAPES = ['rect', 'strip', 'circle'];

    // 生成粒子（从屏幕顶部撒下）
    const PARTICLE_COUNT = 300;
    const particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height * -1 - 20,
            w: 6 + Math.random() * 8,
            h: 4 + Math.random() * 6,
            color: COLORS[Math.floor(Math.random() * COLORS.length)],
            shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
            vx: (Math.random() - 0.5) * 2,
            vy: 1 + Math.random() * 2,
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: (Math.random() - 0.5) * 0.08,
            oscillatePhase: Math.random() * Math.PI * 2,
            oscillateSpeed: 0.02 + Math.random() * 0.03,
            opacity: 0.85 + Math.random() * 0.15,
        });
    }

    const DURATION = 2500; // 总时长 ms
    const startTime = performance.now();

    function animate(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / DURATION, 1);

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 整体淡出（最后 30% 时间开始）
        const globalAlpha = progress > 0.7 ? 1 - (progress - 0.7) / 0.3 : 1;

        for (const p of particles) {
            // 物理更新
            p.vy += 0.04; // 重力
            p.vx += Math.sin(p.oscillatePhase) * 0.15; // 横向飘摆
            p.oscillatePhase += p.oscillateSpeed;
            p.x += p.vx;
            p.y += p.vy;
            p.rotation += p.rotationSpeed;

            // 风阻减速
            p.vx *= 0.995;

            // 绘制
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation);
            ctx.globalAlpha = p.opacity * globalAlpha;
            ctx.fillStyle = p.color;

            if (p.shape === 'strip') {
                // 长条彩带
                ctx.fillRect(-p.w / 2, -p.h / 2, p.w * 2.5, p.h * 0.5);
            } else if (p.shape === 'circle') {
                // 圆点纸片
                ctx.beginPath();
                ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
                ctx.fill();
            } else {
                // 方形纸片
                ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            }

            ctx.restore();
        }

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            // 动画结束，清理
            window.removeEventListener('resize', resize);
            canvas.remove();
        }
    }

    requestAnimationFrame(animate);
}

// ============================================================
//  状态栏渲染
// ============================================================

/**
 * 渲染游戏状态栏
 * @param {import('./Engine.js').Minesweeper} game
 */
function renderStatus(game) {
    const counterEl = document.getElementById('mineCounter');
    const resultEl = document.getElementById('gameResult');
    const faceEl = document.getElementById('btnNewGame');

    // 雷数 LCD（三位数，左补零）
    counterEl.textContent = String(Math.max(game.remainingMines, 0)).padStart(3, '0');

    // 表情按钮
    if (game.won) {
        faceEl.textContent = '😎';
        resultEl.textContent = '🎉 胜利！';
        resultEl.className = 'game-result game-result--won';
    } else if (game.gameOver) {
        faceEl.textContent = '😵';
        resultEl.textContent = '💥 游戏结束';
        resultEl.className = 'game-result game-result--lost';
    } else {
        faceEl.textContent = '🙂';
        resultEl.textContent = '';
        resultEl.className = 'game-result';
    }

    // 游戏结束回调（供回放系统挂载）
    if ((game.won || game.gameOver) && typeof callbacks.onGameEnd === 'function') {
        callbacks.onGameEnd();
    }
}

/**
 * 格式化秒数为三位数 LCD 显示
 * @param {number} seconds
 * @returns {string}
 */
function formatLCD(seconds) {
    return String(Math.min(seconds, 999)).padStart(3, '0');
}

/**
 * lapseld.minesweeper · Controller 模块
 *
 * 包含：
 *   - 主题 / 换肤系统（配置、加载、保存、UI 生成）
 *   - 事件绑定与 UI 控制（鼠标、键盘、计时器、回放）
 *   - 高亮锁定与约束传播系统
 *   - 游戏主循环（newGame、执行操作、状态同步）
 *
 * 职责：连接 Engine（数据）与 Renderer（视图），响应用户输入。
 */

// ============================================================
//  主题 / 换肤配置
// ============================================================

const THEME_DEFAULTS = {
    /* 数字色 */
    '--color-num-0': '#000000',
    '--color-num-1': '#0000ff',
    '--color-num-2': '#008000',
    '--color-num-3': '#ff0000',
    '--color-num-4': '#000080',
    '--color-num-5': '#800000',
    '--color-num-6': '#008080',
    '--color-num-7': '#000000',
    '--color-num-8': '#808080',
    /* 格子背景 */
    '--color-bg-cell': '#c0c0c0',
    '--color-bg-cell-revealed': '#d9d9d9',
    '--color-bg-mine': '#d9d9d9',
    '--color-bg-mine-triggered': '#ff0000',
    /* 各数字格独立背景色 */
    '--color-bg-num-0': '#d9d9d9',
    '--color-bg-num-1': '#d9d9d9',
    '--color-bg-num-2': '#d9d9d9',
    '--color-bg-num-3': '#d9d9d9',
    '--color-bg-num-4': '#d9d9d9',
    '--color-bg-num-5': '#d9d9d9',
    '--color-bg-num-6': '#d9d9d9',
    '--color-bg-num-7': '#d9d9d9',
    '--color-bg-num-8': '#d9d9d9',
    /* 边框 / 面板 */
    '--color-border-light': '#ffffff',
    '--color-border-dark': '#808080',
    '--color-bg-board': '#bdbdbd',
    '--color-bg-primary': '#c0c0c0',
};

/**
 * 换肤 UI 分组（驱动 renderSkinMenu 生成 HTML）
 */
const THEME_SECTIONS = [
    {
        title: '数字颜色（空白格 = 0）',
        fields: [
            { var: '--color-num-0', label: '空白格 (0)' },
            { var: '--color-num-1', label: '数字 1' },
            { var: '--color-num-2', label: '数字 2' },
            { var: '--color-num-3', label: '数字 3' },
            { var: '--color-num-4', label: '数字 4' },
            { var: '--color-num-5', label: '数字 5' },
            { var: '--color-num-6', label: '数字 6' },
            { var: '--color-num-7', label: '数字 7' },
            { var: '--color-num-8', label: '数字 8' },
        ],
    },
    {
        title: '数字格背景色',
        fields: [
            { var: '--color-bg-num-0', label: '0 背景' },
            { var: '--color-bg-num-1', label: '1 背景' },
            { var: '--color-bg-num-2', label: '2 背景' },
            { var: '--color-bg-num-3', label: '3 背景' },
            { var: '--color-bg-num-4', label: '4 背景' },
            { var: '--color-bg-num-5', label: '5 背景' },
            { var: '--color-bg-num-6', label: '6 背景' },
            { var: '--color-bg-num-7', label: '7 背景' },
            { var: '--color-bg-num-8', label: '8 背景' },
        ],
    },
    {
        title: '格子颜色',
        fields: [
            { var: '--color-bg-cell', label: '未揭开格子' },
            { var: '--color-bg-cell-revealed', label: '已揭开格子' },
            { var: '--color-bg-mine', label: '地雷格子' },
            { var: '--color-bg-mine-triggered', label: '踩中地雷' },
        ],
    },
    {
        title: '边框 / 面板',
        fields: [
            { var: '--color-border-light', label: '亮边框' },
            { var: '--color-border-dark', label: '暗边框' },
            { var: '--color-bg-board', label: '面板背景' },
            { var: '--color-bg-primary', label: '页面背景' },
        ],
    },
];

/**
 * 运行时主题状态
 */
let currentTheme = { ...THEME_DEFAULTS };

/**
 * 颜色选择器交互追踪：下一次外部点击时优先关闭三级菜单
 */
let colorPickerJustInteracted = false;

/**
 * 应用主题到 <html> 行内样式，覆盖 CSS 默认值
 */
function applyTheme(values) {
    currentTheme = { ...values };
    for (const [key, value] of Object.entries(currentTheme)) {
        document.documentElement.style.setProperty(key, value);
    }
}

/**
 * 从 localStorage 加载主题，校验并合并缺失键
 */
function loadTheme() {
    const raw = localStorage.getItem('minesweeper-theme');
    if (!raw) {
        applyTheme(THEME_DEFAULTS);
        return;
    }
    try {
        const saved = JSON.parse(raw);
        if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
            throw new Error('无效主题数据');
        }
        const merged = { ...THEME_DEFAULTS };
        for (const key of Object.keys(THEME_DEFAULTS)) {
            const val = saved[key];
            if (typeof val === 'string') {
                if (
                    val === 'transparent' ||
                    /^#[0-9a-fA-F]{3}$/.test(val) ||
                    /^#[0-9a-fA-F]{6}$/.test(val) ||
                    /^#[0-9a-fA-F]{8}$/.test(val)
                ) {
                    merged[key] = val.toLowerCase();
                }
            }
        }
        applyTheme(merged);
    } catch (_e) {
        applyTheme(THEME_DEFAULTS);
    }
}

/**
 * 保存当前主题到 localStorage
 */
function saveTheme() {
    try {
        localStorage.setItem('minesweeper-theme', JSON.stringify(currentTheme));
    } catch (_e) {
        /* localStorage 不可用，静默失败 */
    }
}

/**
 * 恢复默认主题并刷新 UI
 */
function resetTheme() {
    applyTheme(THEME_DEFAULTS);
    saveTheme();
    syncSkinMenuUI();
}

/**
 * 将 currentTheme 回填到换肤子菜单的颜色选择器和 hex 文字
 */
function syncSkinMenuUI() {
    document.querySelectorAll('.theme-swatch').forEach(input => {
        const varName = input.dataset.var;
        if (varName && currentTheme[varName] !== undefined && currentTheme[varName] !== 'transparent') {
            input.value = currentTheme[varName];
        }
    });
    document.querySelectorAll('.theme-hex').forEach(span => {
        const varName = span.dataset.for;
        if (varName && currentTheme[varName] !== undefined) {
            span.textContent = currentTheme[varName];
        }
    });
}

/**
 * 关闭所有换肤三级菜单
 */
function closeAllSkinSections() {
    document.querySelectorAll('.skin-section.open').forEach(s => {
        s.classList.remove('open');
    });
}

/**
 * 动态生成换肤子菜单 HTML 并绑定事件
 */
function renderSkinMenu() {
    const body = document.querySelector('.submenu[data-submenu="skin"] .submenu-body');
    if (!body) return;

    let html = '';
    for (let i = 0; i < THEME_SECTIONS.length; i++) {
        const section = THEME_SECTIONS[i];
        html += `
        <div class="skin-section" data-section="${i}">
            <button class="skin-section-header" type="button">
                <span class="skin-section-arrow">▶</span> ${section.title}
            </button>
            <div class="skin-section-body">`;
        for (const field of section.fields) {
            const value = currentTheme[field.var] || THEME_DEFAULTS[field.var];
            const isTransparent = value === 'transparent';
            html += `
                <div class="theme-row">
                    <label class="theme-label" for="skin-${field.var}">${field.label}</label>
                    <input type="color" class="theme-swatch" id="skin-${field.var}"
                           data-var="${field.var}"
                           value="${isTransparent ? THEME_DEFAULTS[field.var] : value}">
                    <span class="theme-hex" data-for="${field.var}">${value}</span>
                </div>`;
        }
        html += `
            </div>
        </div>`;
    }
    html += `
        <div class="theme-actions">
            <button class="theme-reset-btn" id="themeReset" type="button">恢复默认</button>
        </div>`;

    body.innerHTML = html;

    // ---- 三级菜单折叠/展开 ----
    body.querySelectorAll('.skin-section-header').forEach(header => {
        header.addEventListener('click', (e) => {
            e.stopPropagation();
            const section = header.closest('.skin-section');
            const wasOpen = section?.classList.contains('open');

            // 手风琴：关闭其他三级菜单
            closeAllSkinSections();

            // 切换当前（已经关闭的才打开，已经打开的就关闭）
            if (!wasOpen && section) {
                section.classList.add('open');
            }
        });
    });

    // 颜色选择器：input 实时预览，change 持久保存
    body.querySelectorAll('.theme-swatch').forEach(input => {
        // 记录颜色选择器交互：下一次点击外部仅关闭三级菜单，不关二级
        input.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            colorPickerJustInteracted = true;
        });

        input.addEventListener('input', () => {
            const varName = input.dataset.var;
            const hexValue = input.value;
            if (varName && hexValue) {
                document.documentElement.style.setProperty(varName, hexValue);
                currentTheme[varName] = hexValue;
                const hexSpan = body.querySelector(`.theme-hex[data-for="${varName}"]`);
                if (hexSpan) hexSpan.textContent = hexValue;
            }
        });

        input.addEventListener('change', () => {
            saveTheme();
        });
    });

    // 恢复默认按钮
    const resetBtn = document.getElementById('themeReset');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetTheme);
    }
}

// ============================================================
//  初始化入口
// ============================================================

/**
 * 初始化整个应用（注册事件、渲染初始 UI、启动游戏循环）
 *
 * 应在 DOM 加载完成后调用。该函数是原 game.js 中 DOMContentLoaded
 * 回调体的直接迁移，所有局部状态（game、计时器、锁定集合等）均保留
 * 在闭包内，对外不可见。
 */
function init() {
    // ---- 难度预设 ----
    const DIFFICULTY = {
        easy:   { rows: 9,  cols: 9,  mines: 10 },
        medium: { rows: 16, cols: 16, mines: 40 },
        hard:   { rows: 16, cols: 30, mines: 99 },
    };

    // ---- 偏好持久化 ----
    const PREF_KEY = 'minesweeper-preferences';

    /** 保存当前难度和模式偏好到 localStorage */
    function savePreferences() {
        const prefs = { difficulty: currentDifficulty, noGuessMode: noGuessMode, zoomLevel: currentZoom };
        if (currentDifficulty === 'custom') {
            prefs.customRows = Number(document.getElementById('customRows')?.value) || 9;
            prefs.customCols = Number(document.getElementById('customCols')?.value) || 9;
            prefs.customMines = Number(document.getElementById('customMines')?.value) || 10;
        }
        try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (_) { /* 静默失败 */ }
    }

    // 从 localStorage 恢复偏好
    let currentDifficulty = 'easy';
    let noGuessMode = false;
    let savedCustom = null;
    try {
        const raw = localStorage.getItem(PREF_KEY);
        if (raw) {
            const prefs = JSON.parse(raw);
            if (['easy', 'medium', 'hard', 'custom'].includes(prefs.difficulty)) {
                currentDifficulty = prefs.difficulty;
            }
            noGuessMode = !!prefs.noGuessMode;
            if (prefs.difficulty === 'custom' && prefs.customRows && prefs.customCols && prefs.customMines) {
                savedCustom = { rows: prefs.customRows, cols: prefs.customCols, mines: prefs.customMines };
            }
        }
    } catch (_) { /* 静默失败 */ }

    // ---- 棋盘缩放（Ctrl + 滚轮） ----
    const ZOOM_MIN = 16;
    const ZOOM_MAX = 48;
    const ZOOM_DEFAULT = 28;
    const ZOOM_STEP = 2;

    let currentZoom = ZOOM_DEFAULT;
    // 从偏好恢复上次缩放级别
    try {
        const raw = localStorage.getItem(PREF_KEY);
        if (raw) {
            const prefs = JSON.parse(raw);
            if (typeof prefs.zoomLevel === 'number') {
                currentZoom = prefs.zoomLevel;
            }
        }
    } catch (_) { /* 静默失败 */ }

    /**
     * 设置棋盘缩放（更新 CSS 变量 --cell-size 和 --cell-font-size）
     * @param {number} level  px 值
     * @returns {number} 实际应用的缩放级别（clamped）
     */
    function setZoomLevel(level) {
        const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(level)));
        document.documentElement.style.setProperty('--cell-size', `${clamped}px`);
        // 字体按基础比例 16/28 同步缩放
        const fontSize = Math.round(clamped * 16 / 28);
        document.documentElement.style.setProperty('--cell-font-size', `${fontSize}px`);
        currentZoom = clamped;
        return clamped;
    }

    // 立即应用上次保存的缩放级别
    setZoomLevel(currentZoom);

    let game;
    if (savedCustom) {
        game = new Minesweeper(savedCustom.rows, savedCustom.cols, savedCustom.mines, noGuessMode);
    } else {
        const preset = DIFFICULTY[currentDifficulty] || DIFFICULTY['easy'];
        game = new Minesweeper(preset.rows, preset.cols, preset.mines, noGuessMode);
    }

    // ---- 动作历史（按需从 localStorage 恢复，刷新页面始终从新局开始） ----
    const actionHistory = new ActionHistory(10);
    let isReplayMode = false;
    let lastMineRC = null; // 最近一次触雷坐标

    // ---- 对局记录 ----
    const RECORDS_KEY = 'minesweeper-records';
    const MAX_RECORDS = 10;
    let isViewingRecord = false;    // 是否正在查看对局记录
    let viewingRecordId = null;     // 当前查看的记录 ID
    let viewingStepIndex = 0;       // 当前查看的步数索引

    /**
     * 记录一条动作到历史
     * @param {string} type  动作类型：'reveal' | 'flag' | 'unflag' | 'chord' | 'smart' | 'auto-flag'
     * @param {number} r
     * @param {number} c
     */
    function recordAction(type, r, c) {
        if (isReplayMode) return;
        const snapshot = game.grid.map(row => row.map(cell => ({ ...cell })));
        actionHistory.push(type, r, c, snapshot, game.totalMines);
    }

    /**
     * 根据历史记录还原棋盘到指定步骤
     * @param {number} index  历史索引（0 = 最早）
     */
    function renderReplay(index) {
        const action = actionHistory.get(index);
        if (!action) return;

        // 还原网格
        game.grid = action.grid.map(row => row.map(cell => ({ ...cell })));
        renderBoard(game);

        // 回放模式下不调用 renderStatus（避免触发 onGameEnd 死循环）
        // 仅更新雷数显示
        const counterEl = document.getElementById('mineCounter');
        if (counterEl) counterEl.textContent = String(Math.max(game.remainingMines, 0)).padStart(3, '0');

        // 高亮该步骤操作的格子
        const el = cellElements[action.r]?.[action.c];
        if (el) {
            el.classList.add('cell--replay-focus');
        }
    }

    let replayIndex = 0; // 当前回放步骤索引

    /**
     * 更新回放面板步数文字和按钮状态
     */
    function updateReplayUI() {
        const step = document.getElementById('replayStep');
        const prevBtn = document.getElementById('replayPrev');
        const nextBtn = document.getElementById('replayNext');
        if (step) step.textContent = `${replayIndex + 1}/${actionHistory.count}`;
        if (prevBtn) prevBtn.disabled = replayIndex <= 0;
        if (nextBtn) nextBtn.disabled = replayIndex >= actionHistory.count - 1;
    }

    /**
     * 进入/退出回放模式
     * @param {boolean} enter
     */
    function setReplayMode(enter) {
        isReplayMode = enter;
        const panel = document.getElementById('replayPanel');
        if (panel) panel.classList.toggle('visible', enter);
        if (enter) {
            replayIndex = actionHistory.count - 1;
            updateReplayUI();
            renderReplay(replayIndex);
        } else {
            // 退出回放：恢复到实时状态
            const latest = actionHistory.get(actionHistory.count - 1);
            if (latest) {
                game.grid = latest.grid.map(row => row.map(cell => ({ ...cell })));
            }
            renderBoard(game);
            renderStatus(game);
            refreshLockedHighlights();
        }
    }

    // ---- 游戏结束回调 ----
    callbacks.onGameEnd = () => {
        saveGameRecord();
        if (game.won) {
            launchConfetti();
        } else if (game.gameOver) {
            // 爆炸动画播放同时立即显示复盘面板，无需等待 1.2s 动画结束
            launchMineExplosion(lastMineRC || { r: game.rows >> 1, c: game.cols >> 1 });
            if (actionHistory.count > 0) setReplayMode(true);
        }
    };

    // ---- 计时器状态 ----
    let timerInterval = null;
    let elapsedSeconds = 0;

    const timerEl = document.getElementById('gameTimer');
    timerEl.textContent = '000';

    /**
     * 启动计时器（首次点击时调用）
     */
    function startTimer() {
        if (timerInterval) return; // 已启动
        timerInterval = setInterval(() => {
            elapsedSeconds++;
            timerEl.textContent = formatLCD(elapsedSeconds);
        }, 1000);
    }

    /**
     * 停止计时器
     */
    function stopTimer() {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
    }

    /**
     * 重置计时器
     */
    function resetTimer() {
        stopTimer();
        elapsedSeconds = 0;
        timerEl.textContent = '000';
    }

    /**
     * 开始新游戏
     * @param {number} [rows]  可选，指定行数
     * @param {number} [cols]  可选，指定列数
     * @param {number} [mines] 可选，指定雷数
     */
    function newGame(rows, cols, mines) {
        if (isViewingRecord) exitRecordView();
        // 取消待执行的悬停帧回调（避免在重建后的棋盘上误触）
        if (_hoverRafId) { cancelAnimationFrame(_hoverRafId); _hoverRafId = null; }
        resetTimer();
        lockedCells.clear();
        // 先重置游戏状态，再退出回放（否则 setReplayMode 内的 renderStatus
        // 会以旧的 gameOver=true 触发 onGameEnd 动画）
        if (rows !== undefined && cols !== undefined && mines !== undefined) {
            game = new Minesweeper(rows, cols, mines, noGuessMode);
        } else {
            game = new Minesweeper(game.rows, game.cols, game.totalMines, noGuessMode);
        }

        actionHistory.clear();
        setReplayMode(false);

        // 清空高亮跟踪集合（renderBoard 将重建所有 DOM 元素）
        highlightedCells.clear();
        smartSafeCells.clear();

        renderBoard(game);
        renderStatus(game);
    }

    // ---- 事件绑定 ----

    const boardEl = document.getElementById('gameBoard');

    // ---- 可配置按键映射（预留自定义入口） ----
    const INPUT_CONFIG = {
        /** 和弦展开：鼠标按键（0=左, 1=中, 2=右） */
        chordButton: 1,
        /** 揭开：鼠标按键 */
        revealButton: 0,
        /** 旗标：鼠标按键 */
        flagButton: 2,
    };

    // ---- 鼠标状态 ----
    let hoveredCellEl = null;
    let hoverR = -1;
    let hoverC = -1;

    // ---- 常亮锁定集合 ----
    /** @type {Set<string>} 存储 "r,c" 格式的锁定坐标 */
    const lockedCells = new Set();

    /** 所有悬停高亮类名 */
    const HOVER_CLASSES = [
        'cell--hover-safe',
        'cell--hover-1', 'cell--hover-2', 'cell--hover-3',
        'cell--hover-4', 'cell--hover-5', 'cell--hover-6', 'cell--hover-7',
    ];

    /**
     * 生成锁定集合的键
     * @param {number} r
     * @param {number} c
     * @returns {string}
     */
    function lockKey(r, c) {
        return `${r},${c}`;
    }

    /**
     * 根据剩余雷数返回高亮类名
     * @param {number} remaining
     * @returns {string}
     */
    function highlightClassFor(remaining) {
        return remaining === 0
            ? 'cell--hover-safe'
            : `cell--hover-${Math.min(remaining, 7)}`;
    }

    // ---- 高亮跟踪集合（替代 querySelectorAll DOM 扫描） ----
    /** @type {Set<HTMLElement>} 当前带有 highlight-priority 属性的元素 */
    const highlightedCells = new Set();
    /** @type {Set<HTMLElement>} 当前带有 cell--smart-safe 类的元素 */
    const smartSafeCells = new Set();

    /**
     * 给单个 DOM 元素设置高亮（仅当新优先级 >= 现有优先级时覆盖）
     * @param {HTMLElement} el
     * @param {number} priority  数值越小优先级越高（1 最高，0 最低）
     */
    function applyHighlightToEl(el, priority) {
        const current = Number(el.dataset.highlightPriority);
        if (current && current <= priority) return; // 已有更高或同等优先级，不覆盖
        el.classList.remove(...HOVER_CLASSES);
        el.dataset.highlightPriority = priority;
        el.classList.add(highlightClassFor(priority));
        highlightedCells.add(el);
    }

    /**
     * 移除单个 DOM 元素的高亮
     * @param {HTMLElement} el
     */
    function removeHighlightFromEl(el) {
        el.classList.remove(...HOVER_CLASSES);
        delete el.dataset.highlightPriority;
        highlightedCells.delete(el);
    }

    /**
     * 清除棋盘上所有高亮（含智能安全区）
     * 自动检测 DOM 是否已被 renderBoard 重建，跳过对已脱离 DOM 元素的无效操作
     */
    function clearAllHighlights() {
        // 快速检测：若所有元素已脱离 DOM（renderBoard 重建），直接清空集合
        let needDOM = false;
        for (const el of highlightedCells) {
            if (el.isConnected) { needDOM = true; break; }
        }
        if (!needDOM) {
            for (const el of smartSafeCells) {
                if (el.isConnected) { needDOM = true; break; }
            }
        }

        if (needDOM) {
            for (const el of highlightedCells) {
                el.classList.remove(...HOVER_CLASSES);
                delete el.dataset.highlightPriority;
            }
            for (const el of smartSafeCells) {
                el.classList.remove('cell--smart-safe');
            }
        }

        highlightedCells.clear();
        smartSafeCells.clear();
    }

    /**
     * 铺设所有锁定格的高亮（带优先级覆盖）
     */
    function applyAllLockedHighlights() {
        for (const key of lockedCells) {
            const [r, c] = key.split(',').map(Number);
            const cell = game.grid[r][c];
            if (cell.state !== CellState.REVEALED || cell.adjacentMines <= 0) continue;

            const flaggedCount = game._countFlaggedNeighbors(r, c);
            const remaining = cell.adjacentMines - flaggedCount;
            const priority = remaining === 0 ? 0 : remaining;

            // 数字本体
            const srcEl = cellElements[r]?.[c];
            if (srcEl) applyHighlightToEl(srcEl, priority);

            // 邻居隐藏格
            for (const { r: nr, c: nc } of game._getNeighbors(r, c)) {
                if (game.grid[nr][nc].state === CellState.HIDDEN) {
                    const el = cellElements[nr]?.[nc];
                    if (el) applyHighlightToEl(el, priority);
                }
            }
        }
    }

    /**
     * 检查 (r, c) 的 3×3 范围内是否存在其他数字的锁定高亮
     * @param {number} r
     * @param {number} c
     * @returns {boolean}
     */
    function hasAdjacentLockedHighlight(r, c) {
        for (const key of lockedCells) {
            const [lr, lc] = key.split(',').map(Number);
            if (lr === r && lc === c) continue; // 排除自身
            if (Math.abs(lr - r) <= 1 && Math.abs(lc - c) <= 1) return true;
        }
        return false;
    }

    /**
     * 铺设单个悬停格的高亮（带优先级覆盖 + 智能安全区叠加）
     *
     * 智能安全区仅在 3×3 内已存在锁定高亮时才激活：
     *   1. 用户锁定数字 A → 高亮 A 的 3×3
     *   2. 用户悬停相邻数字 B → 比较 B 与 A 的盲区 → 推演安全格
     *
     * @param {number} r
     * @param {number} c
     */
    function applyHoverHighlight(r, c) {
        const cell = game.grid[r][c];
        if (cell.state !== CellState.REVEALED || cell.adjacentMines <= 0) return;

        const flaggedCount = game._countFlaggedNeighbors(r, c);
        const remaining = cell.adjacentMines - flaggedCount;
        const priority = remaining === 0 ? 0 : remaining;

        const srcEl = cellElements[r]?.[c];
        if (srcEl) applyHighlightToEl(srcEl, priority);

        for (const { r: nr, c: nc } of game._getNeighbors(r, c)) {
            if (game.grid[nr][nc].state === CellState.HIDDEN) {
                const el = cellElements[nr]?.[nc];
                if (el) applyHighlightToEl(el, priority);
            }
        }

        // 智能推演：仅当 3×3 内已有锁定高亮时激活
        if (hasAdjacentLockedHighlight(r, c)) {
            // 收集附近锁定格的坐标键，作为 N_B 候选过滤器
            // 确保显示的白色安全区是由附近锁定格参与推演得出的，
            // 而非由远端无关数字格偶然计算出的结果
            const nearbyLockedKeys = new Set();
            for (const key of lockedCells) {
                const [lr, lc] = key.split(',').map(Number);
                if (Math.abs(lr - r) <= 1 && Math.abs(lc - c) <= 1) {
                    nearbyLockedKeys.add(key);
                }
            }
            const smartSafe = game._findSmartSafeCells(r, c, nearbyLockedKeys);
            for (const key of smartSafe) {
                const [sr, sc] = key.split(',').map(Number);
                const el = cellElements[sr]?.[sc];
                if (el) {
                    el.classList.remove(...HOVER_CLASSES);
                    delete el.dataset.highlightPriority;
                    highlightedCells.delete(el);
                    el.classList.add('cell--smart-safe');
                    smartSafeCells.add(el);
                }
            }
        }
    }

    /**
     * 刷新：清除全部 → 重铺锁定（renderBoard / 解锁 / 插旗后调用）
     */
    function refreshLockedHighlights() {
        clearAllHighlights();
        applyAllLockedHighlights();
    }

    /**
     * 检查所有锁定格：若旗数已等于数字，自动解锁
     */
    function checkFlagMatchAutoUnlock() {
        for (const key of Array.from(lockedCells)) {
            const [r, c] = key.split(',').map(Number);
            const cell = game.grid[r][c];

            if (cell.state !== CellState.REVEALED || cell.adjacentMines <= 0) {
                lockedCells.delete(key);
                continue;
            }

            const flaggedCount = game._countFlaggedNeighbors(r, c);
            if (flaggedCount === cell.adjacentMines) {
                lockedCells.delete(key);
            }
        }
    }

    // ---- 悬停高亮事件（事件委托） ----

    // ---- 悬停节流（rAF，每帧最多执行一次） ----
    let _hoverRafId = null;
    let _pendingHoverR = -1;
    let _pendingHoverC = -1;

    boardEl.addEventListener('mouseover', (e) => {
        const cellEl = e.target.closest('.cell');
        if (!cellEl || cellEl === hoveredCellEl) return;

        hoveredCellEl = cellEl;
        _pendingHoverR = Number(cellEl.dataset.row);
        _pendingHoverC = Number(cellEl.dataset.col);

        if (_hoverRafId) return; // 已有待执行的帧回调
        _hoverRafId = requestAnimationFrame(() => {
            _hoverRafId = null;
            hoverR = _pendingHoverR;
            hoverC = _pendingHoverC;
            // 清除全部 → 重铺锁定 → 叠加悬停（悬停优先级自然覆盖锁定）
            clearAllHighlights();
            applyAllLockedHighlights();
            applyHoverHighlight(hoverR, hoverC);
        });
    });

    boardEl.addEventListener('mouseleave', () => {
        // 取消待执行的悬停帧回调
        if (_hoverRafId) {
            cancelAnimationFrame(_hoverRafId);
            _hoverRafId = null;
        }
        // 鼠标移出：清除全部 → 仅恢复锁定高亮
        clearAllHighlights();
        applyAllLockedHighlights();
        hoveredCellEl = null;
        hoverR = -1;
        hoverC = -1;
    });

    // ---- 统一鼠标事件处理 ----

    /**
     * 执行和弦逻辑（含智能安全揭示回退）
     * @param {number} r
     * @param {number} c
     */
    function executeChord(r, c) {
        if (!game.generated) startTimer();

        // 优先尝试标准和弦（旗数 = 数字）
        const result = game.chord(r, c);

        if (result.success) {
            lockedCells.delete(lockKey(r, c));
            recordAction('chord', r, c);
            if (game.gameOver) lastMineRC = { r, c };
            renderBoard(game);
            renderStatus(game);
            refreshLockedHighlights();
            checkFlagMatchAutoUnlock();
            if (game.gameOver || game.won) stopTimer();
            return;
        }

        // 旗数不匹配 → 尝试智能推演安全揭示（仅当 3×3 内有锁定高亮时）
        if (result.reason === 'flag-mismatch') {
            const smartResult = hasAdjacentLockedHighlight(r, c)
                ? game.smartReveal(r, c)
                : { success: false, revealed: 0 };

            if (smartResult.success && smartResult.revealed > 0) {
                lockedCells.delete(lockKey(r, c));
                recordAction('smart', r, c);
                if (game.gameOver) lastMineRC = { r, c };
                renderBoard(game);
                renderStatus(game);
                refreshLockedHighlights();
                checkFlagMatchAutoUnlock();
                if (game.gameOver || game.won) stopTimer();
                return;
            }

            // 无安全格可揭 → 红框震动
            for (const { r: nr, c: nc } of game._getNeighbors(r, c)) {
                const neighbor = game.grid[nr][nc];
                if (neighbor.state === CellState.HIDDEN) {
                    const el = cellElements[nr]?.[nc];
                    if (el) {
                        el.classList.remove('cell--chord-reject');
                        void el.offsetWidth;
                        el.classList.add('cell--chord-reject');
                        el.addEventListener('animationend', () => {
                            el.classList.remove('cell--chord-reject');
                        }, { once: true });
                    }
                }
            }
        }
    }

    // ---- 待处理的格子操作（mousedown 记录，mouseup 执行，拖动时自动取消） ----
    /** @type {{ button: number, r: number, c: number } | null} */
    let pendingCellAction = null;

    boardEl.addEventListener('mousedown', (e) => {
        // 查看对局记录时点击 → 退出查看 + 新游戏
        if (isViewingRecord) {
            exitRecordView();
            newGame();
            pendingCellAction = null;
            return;
        }

        // 游戏已结束，忽略所有棋盘点击
        if (game.gameOver || game.won) {
            pendingCellAction = null;
            return;
        }

        const cellEl = e.target.closest('.cell');
        if (!cellEl) {
            pendingCellAction = null;
            return;
        }

        // 右键 / 中键在 mousedown 阶段阻止默认行为（上下文菜单 / 自动滚动）
        if (e.button === INPUT_CONFIG.flagButton || e.button === INPUT_CONFIG.chordButton) {
            e.preventDefault();
        }

        // 仅记录待处理操作，不执行任何游戏逻辑
        pendingCellAction = {
            button: e.button,
            r: Number(cellEl.dataset.row),
            c: Number(cellEl.dataset.col),
        };
    });

    document.addEventListener('mouseup', () => {
        // 拖动中 / 无待处理操作 → 跳过
        if (!pendingCellAction) return;

        const { button, r, c } = pendingCellAction;
        pendingCellAction = null;

        // 棋盘可能已被 renderBoard 重建，重新获取格子状态
        const cell = game.grid[r]?.[c];
        if (!cell) return;

        // ---- 左键：揭开（隐藏格） / 和弦（数字格） ----
        if (button === INPUT_CONFIG.revealButton) {
            // 已揭开数字格 → 和弦展开
            if (cell.state === CellState.REVEALED && cell.adjacentMines > 0) {
                executeChord(r, c);
                return;
            }

            // 隐藏格 → 揭开
            if (!game.generated) startTimer();

            game.reveal(r, c);
            recordAction(game.gameOver ? 'reveal-death' : 'reveal', r, c);
            if (game.gameOver) lastMineRC = { r, c };
            renderBoard(game);
            renderStatus(game);
            refreshLockedHighlights();
            checkFlagMatchAutoUnlock();

            if (game.gameOver || game.won) stopTimer();
            return;
        }

        // ---- 中键：锁定/解锁数字高亮 ----
        if (button === INPUT_CONFIG.chordButton) {
            if (cell.state !== CellState.REVEALED || cell.adjacentMines <= 0) return;

            const key = lockKey(r, c);

            if (lockedCells.has(key)) {
                lockedCells.delete(key);
                refreshLockedHighlights();
            } else {
                const flaggedCount = game._countFlaggedNeighbors(r, c);
                if (flaggedCount === cell.adjacentMines) return;
                lockedCells.add(key);
                applyHoverHighlight(r, c);
            }
            return;
        }

        // ---- 右键：旗标 / 数字格一键插旗 ----
        if (button === INPUT_CONFIG.flagButton) {
            // 已揭开数字格：智能一键插旗
            if (cell.state === CellState.REVEALED && cell.adjacentMines > 0) {
                const remaining = cell.adjacentMines - game._countFlaggedNeighbors(r, c);
                if (remaining <= 0) return;

                const hiddenNeighbors = game._getNeighbors(r, c)
                    .filter(({ r: nr, c: nc }) => game.grid[nr][nc].state === CellState.HIDDEN);

                if (hiddenNeighbors.length === 0) return;

                let anyFlagged = false;

                // 1️⃣ 集合子集推演 — 数学证明某些格子绝对危险（优先运行）
                const smartFlagResult = game.smartFlag(r, c);
                if (smartFlagResult.success && smartFlagResult.flagged > 0) {
                    anyFlagged = true;
                    // smartFlag 可能仅标识了部分危险格，检查剩余格子是否也全为雷
                    const postRemaining = cell.adjacentMines - game._countFlaggedNeighbors(r, c);
                    const postHidden = game._getNeighbors(r, c)
                        .filter(({ r: nr, c: nc }) => game.grid[nr][nc].state === CellState.HIDDEN);
                    if (postRemaining === postHidden.length && postHidden.length > 0) {
                        for (const { r: nr, c: nc } of postHidden) {
                            game.grid[nr][nc].state = CellState.FLAGGED;
                        }
                    }
                }

                // 2️⃣ 基础条件回退：若 smartFlag 未找到任何危险格，且剩余雷数 = 未揭格数 → 全插旗
                if (!anyFlagged && remaining === hiddenNeighbors.length) {
                    for (const { r: nr, c: nc } of hiddenNeighbors) {
                        game.grid[nr][nc].state = CellState.FLAGGED;
                    }
                    anyFlagged = true;
                }

                if (anyFlagged) {
                    recordAction('auto-flag', r, c);
                    renderBoard(game);
                    renderStatus(game);
                    refreshLockedHighlights();
                    checkFlagMatchAutoUnlock();
                } else {
                    // 条件不满足 → 绿框闪烁 + 震动
                    for (const { r: nr, c: nc } of hiddenNeighbors) {
                        const el = cellElements[nr]?.[nc];
                        if (el) {
                            el.classList.remove('cell--flag-reject');
                            void el.offsetWidth;
                            el.classList.add('cell--flag-reject');
                            el.addEventListener('animationend', () => {
                                el.classList.remove('cell--flag-reject');
                            }, { once: true });
                        }
                    }
                }
                return;
            }

            // 隐藏格：正常切换旗标
            game.toggleFlag(r, c);
            recordAction(game.grid[r][c].state === CellState.FLAGGED ? 'flag' : 'unflag', r, c);
            renderBoard(game);
            renderStatus(game);
            refreshLockedHighlights();
            checkFlagMatchAutoUnlock();
        }
    });

    // 阻止浏览器默认右键菜单
    boardEl.addEventListener('contextmenu', (e) => e.preventDefault());

    // ---- Ctrl + 滚轮缩放棋盘 ----
    let _zoomSaveTimer = null;
    document.addEventListener('wheel', (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const direction = e.deltaY > 0 ? -1 : 1; // 向上滚动 = 放大
        setZoomLevel(currentZoom + direction * ZOOM_STEP);
        // 去抖持久化（500ms 合并窗口）
        clearTimeout(_zoomSaveTimer);
        _zoomSaveTimer = setTimeout(() => savePreferences(), 500);
    }, { passive: false });

    // ---- 新游戏按钮 ----
    document.getElementById('btnNewGame').addEventListener('click', () => {
        newGame();
    });

    // ---- 设置菜单 ----
    const settingsToggle = document.getElementById('settingsToggle');
    const settingsMenu = document.getElementById('settingsMenu');
    const settingsCustom = document.getElementById('settingsCustom');
    const settingsOptions = document.querySelectorAll('.settings-option');

    // 恢复保存的难度 UI 状态
    settingsOptions.forEach(opt => {
        opt.classList.toggle('active', opt.dataset.difficulty === currentDifficulty);
    });
    if (currentDifficulty === 'custom') {
        if (settingsCustom) settingsCustom.style.display = 'flex';
        if (savedCustom) {
            const rowsEl = document.getElementById('customRows');
            const colsEl = document.getElementById('customCols');
            const minesEl = document.getElementById('customMines');
            if (rowsEl) rowsEl.value = savedCustom.rows;
            if (colsEl) colsEl.value = savedCustom.cols;
            if (minesEl) minesEl.value = savedCustom.mines;
        }
    }

    // 开关菜单
    settingsToggle?.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsMenu?.classList.toggle('open');
    });

    // 点击外部：优先关闭三级菜单 → 再次点击才关闭二级菜单
    // 使用 mousedown 而非 click：棋盘 mousedown 中 renderBoard 会替换 DOM 元素，
    // 导致原始元素的 click 事件丢失（目标链断裂），menu 无法关闭。
    document.addEventListener('mousedown', (e) => {
        if (!settingsMenu?.contains(e.target) && e.target !== settingsToggle) {
            // 有颜色选择器交互 或 三级菜单展开中 → 先关三级，保留菜单
            if (colorPickerJustInteracted || document.querySelector('.skin-section.open')) {
                colorPickerJustInteracted = false;
                closeAllSkinSections();
                return;
            }
            settingsMenu?.classList.remove('open');
        }
    });

    // 二级菜单展开/收起
    document.querySelectorAll('.submenu-header').forEach(header => {
        header.addEventListener('click', (e) => {
            e.stopPropagation();
            const submenu = header.closest('.submenu');
            submenu?.classList.toggle('open');
        });
    });

    // 难度选项点击
    settingsOptions.forEach(opt => {
        opt.addEventListener('click', () => {
            const diff = opt.dataset.difficulty;

            // 更新选中态
            settingsOptions.forEach(o => o.classList.remove('active'));
            opt.classList.add('active');

            if (diff === 'custom') {
                // 显示自定义面板
                if (settingsCustom) settingsCustom.style.display = 'flex';
                return;
            }

            // 隐藏自定义面板
            if (settingsCustom) settingsCustom.style.display = 'none';

            // 应用预设难度
            currentDifficulty = diff;
            savePreferences();
            const preset = DIFFICULTY[diff];
            if (preset) newGame(preset.rows, preset.cols, preset.mines);
        });
    });

    // 自定义难度：应用按钮
    document.getElementById('customApply')?.addEventListener('click', () => {
        const rows = Math.max(5, Math.min(30, Number(document.getElementById('customRows')?.value) || 9));
        const cols = Math.max(5, Math.min(50, Number(document.getElementById('customCols')?.value) || 9));
        const maxMines = (rows - 1) * (cols - 1);
        const mines = Math.max(1, Math.min(maxMines, Number(document.getElementById('customMines')?.value) || 10));

        // 回填修正后的值
        document.getElementById('customRows').value = rows;
        document.getElementById('customCols').value = cols;
        document.getElementById('customMines').value = mines;

        currentDifficulty = 'custom';
        savePreferences();
        newGame(rows, cols, mines);
        settingsMenu?.classList.remove('open');
    });

    // ---- 无死局模式开关 ----
    const noGuessToggle = document.getElementById('noGuessToggle');
    if (noGuessToggle) {
        noGuessToggle.checked = noGuessMode;
        noGuessToggle.addEventListener('change', () => {
            noGuessMode = noGuessToggle.checked;
            savePreferences();
        });
    }

    // Bug 反馈：通过 Web3Forms 直接发送邮件
    const WEB3FORMS_KEY = 'b2a80c6e-156a-4a7d-8422-61d210a0f8ea';
    document.getElementById('bugSubmit')?.addEventListener('click', async () => {
        const input = document.getElementById('bugInput');
        const hint = document.getElementById('bugHint');
        const btn = document.getElementById('bugSubmit');
        const desc = input?.value.trim();

        if (!desc) {
            if (hint) {
                hint.textContent = '请先描述问题';
                hint.style.color = '#ff0000';
            }
            return;
        }

        const report = [
            '=== lapseld.minesweeper Bug Report ===',
            `时间: ${new Date().toLocaleString()}`,
            `难度: ${currentDifficulty} (${game.rows}×${game.cols}, ${game.totalMines}雷)`,
            `浏览器: ${navigator.userAgent}`,
            '',
            `问题描述: ${desc}`,
        ].join('\n');

        // 发送中状态
        if (btn) btn.disabled = true;
        if (hint) {
            hint.textContent = '发送中...';
            hint.style.color = '#888';
        }

        try {
            const resp = await fetch('https://api.web3forms.com/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    access_key: WEB3FORMS_KEY,
                    subject: '[Bug Report] lapseld.minesweeper',
                    from_name: 'Minesweeper Bug Report',
                    message: report,
                }),
            });
            const data = await resp.json();
            if (data.success) {
                if (hint) {
                    hint.textContent = '已发送 ✓';
                    hint.style.color = 'var(--color-num-2)';
                }
                input.value = '';
            } else {
                throw new Error(data.message || '发送失败');
            }
        } catch (err) {
            // 降级：复制到剪贴板
            try {
                await navigator.clipboard.writeText(report);
                if (hint) {
                    hint.textContent = '发送失败，已复制到剪贴板';
                    hint.style.color = '#ff8c00';
                }
                input.value = '';
            } catch {
                if (input) {
                    input.value = report;
                    input.select();
                }
                if (hint) {
                    hint.textContent = '发送失败，请手动复制';
                    hint.style.color = '#ff0000';
                }
            }
        } finally {
            if (btn) btn.disabled = false;
        }
    });

    // ---- 回放按钮事件 ----
    document.getElementById('replayPrev')?.addEventListener('click', () => {
        if (replayIndex > 0) {
            replayIndex--;
            renderReplay(replayIndex);
            updateReplayUI();
        }
    });

    document.getElementById('replayNext')?.addEventListener('click', () => {
        if (replayIndex < actionHistory.count - 1) {
            replayIndex++;
            renderReplay(replayIndex);
            updateReplayUI();
        }
    });

    // ---- 对局记录功能 ----

    /** 辅助：统计棋盘中的旗子数 */
    function countFlagsInGrid(grid) {
        let count = 0;
        for (const row of grid) {
            for (const cell of row) {
                if (cell.state === 2) count++; // CellState.FLAGGED
            }
        }
        return count;
    }

    /** 从 localStorage 加载对局记录 */
    function loadGameRecords() {
        try {
            const raw = localStorage.getItem(RECORDS_KEY);
            if (raw) {
                const data = JSON.parse(raw);
                if (data.v === 1 && Array.isArray(data.records)) return data.records;
            }
        } catch (_) {}
        return [];
    }

    /** 保存当前局记录到 localStorage */
    function saveGameRecord() {
        const allActions = actionHistory.getAll();
        if (allActions.length === 0) return;

        // 取最后 10 步
        const lastSteps = allActions.slice(-10);

        // 编码每步的棋盘快照（复用 ActionHistory 的 RLE 压缩）
        const steps = lastSteps.map(a => ({
            type: a.type,
            r: a.r,
            c: a.c,
            ts: a.timestamp,
            g: ActionHistory.encodeGrid(a.grid),
        }));

        const record = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            outcome: game.won ? 'win' : 'loss',
            difficulty: currentDifficulty,
            rows: game.rows,
            cols: game.cols,
            mines: game.totalMines,
            elapsed: elapsedSeconds,
            date: new Date().toISOString(),
            steps,
        };

        // 读取已有记录，头部插入，保留最近 MAX_RECORDS 条
        let records = loadGameRecords();
        records.unshift(record);
        if (records.length > MAX_RECORDS) records = records.slice(0, MAX_RECORDS);

        try { localStorage.setItem(RECORDS_KEY, JSON.stringify({ v: 1, records })); } catch (_) {}
    }

    /** 删除指定 ID 的对局记录 */
    function deleteGameRecord(id) {
        let records = loadGameRecords();
        records = records.filter(r => r.id !== id);
        try { localStorage.setItem(RECORDS_KEY, JSON.stringify({ v: 1, records })); } catch (_) {}
    }

    /** 显示记录的第 stepIndex 步到主棋盘 */
    function viewRecordStep(record, stepIndex) {
        if (stepIndex < 0 || stepIndex >= record.steps.length) return;
        viewingRecordId = record.id;
        viewingStepIndex = stepIndex;

        const step = record.steps[stepIndex];
        game.grid = ActionHistory.decodeGrid(step.g);

        // 临时标记游戏结束，阻止棋盘交互
        game.gameOver = true;
        game.won = false;

        renderBoard(game);
        // 不调用 renderStatus（避免触发 onGameEnd 回调）
        document.getElementById('mineCounter').textContent =
            String(Math.max(record.mines - countFlagsInGrid(game.grid), 0)).padStart(3, '0');

        // 金色描边高亮该步骤操作的格子（与失败复盘一致）
        const focusEl = cellElements[step.r]?.[step.c];
        if (focusEl) focusEl.classList.add('cell--replay-focus');

        updateRecordStepUI(record);
    }

    /** 进入对局记录查看模式 */
    function enterRecordView(record) {
        isViewingRecord = true;
        viewingRecordId = record.id;
        // 从最后一步开始查看
        viewRecordStep(record, record.steps.length - 1);
    }

    /** 退出对局记录查看模式 */
    function exitRecordView() {
        isViewingRecord = false;
        viewingRecordId = null;
        viewingStepIndex = 0;
    }

    /** 更新记录列表中的步数指示器和高亮 */
    function updateRecordStepUI(record) {
        const counter = document.querySelector(`.record-step-counter[data-id="${record.id}"]`);
        if (counter) {
            counter.textContent = `${viewingStepIndex + 1}/${record.steps.length}`;
        }
        document.querySelectorAll('.record-entry').forEach(el => {
            el.classList.toggle('record-entry--active', el.dataset.recordId === record.id);
        });
    }

    /** 渲染对局记录列表到设置菜单 */
    function renderGameRecords() {
        const listEl = document.getElementById('recordsList');
        if (!listEl) return;

        const records = loadGameRecords();
        if (records.length === 0) {
            listEl.innerHTML = '<div class="records-empty">暂无对局记录<br><small>完成一局游戏后自动保存</small></div>';
            return;
        }

        const diffLabelMap = { easy: '简单', medium: '中等', hard: '困难', custom: '自定义' };

        listEl.innerHTML = records.map(rec => {
            const outcomeIcon = rec.outcome === 'win' ? '🏆' : '💥';
            const diffLabel = diffLabelMap[rec.difficulty] || rec.difficulty;
            const dateStr = new Date(rec.date).toLocaleString('zh-CN', {
                month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit',
            });
            const timeStr = String(Math.min(rec.elapsed, 999)).padStart(3, '0');
            const stepCount = rec.steps.length;

            return `
                <div class="record-entry" data-record-id="${rec.id}">
                    <div class="record-summary">
                        <span class="record-outcome">${outcomeIcon}</span>
                        <span class="record-difficulty">${diffLabel} ${rec.rows}×${rec.cols}</span>
                        <span class="record-date">${dateStr}</span>
                        <span class="record-time">⏱ ${timeStr}s</span>
                        <button class="record-delete-btn" data-action="delete" data-id="${rec.id}" title="删除">✕</button>
                    </div>
                    <div class="record-steps">
                        <button class="record-step-btn record-step-prev" data-action="prev" data-id="${rec.id}">◀</button>
                        <span class="record-step-counter" data-id="${rec.id}">${stepCount}/${stepCount}</span>
                        <button class="record-step-btn record-step-next" data-action="next" data-id="${rec.id}">▶</button>
                    </div>
                </div>`;
        }).join('');
    }

    // 对局记录列表事件委托（挂载一次，innerHTML 替换不丢失）
    document.getElementById('recordsList')?.addEventListener('click', (e) => {
        const entry = e.target.closest('.record-entry');
        if (!entry) return;
        const recId = entry.dataset.recordId;
        const records = loadGameRecords();
        const rec = records.find(r => r.id === recId);
        if (!rec) return;

        const action = e.target.dataset.action;
        if (action === 'delete') {
            e.stopPropagation();
            deleteGameRecord(recId);
            renderGameRecords();
            if (viewingRecordId === recId) exitRecordView();
            return;
        }
        if (action === 'prev' || action === 'next') {
            e.stopPropagation();
            // 如果查看的是不同记录，先定位到该记录的末尾/开头
            if (viewingRecordId !== rec.id) {
                const startIdx = action === 'prev' ? rec.steps.length - 1 : 0;
                viewRecordStep(rec, startIdx);
            } else {
                const stepCount = rec.steps.length;
                let newIdx = action === 'prev' ? viewingStepIndex - 1 : viewingStepIndex + 1;
                if (newIdx < 0) newIdx = 0;
                if (newIdx >= stepCount) newIdx = stepCount - 1;
                viewRecordStep(rec, newIdx);
            }
            return;
        }

        // 点击记录行本身 → 进入查看模式
        enterRecordView(rec);
    });

    // ---- 棋盘拖动（左键拖动游戏容器，刷新后复位） ----
    const gameContainer = document.querySelector('.game-container');
    const DRAG_THRESHOLD = 4; // px，超过此距离视为拖动
    let dragActive = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let boardTranslateX = 0;
    let boardTranslateY = 0;

    gameContainer.addEventListener('mousedown', (e) => {
        // 仅左键拖动
        if (e.button !== 0) return;
        // 不在按钮、输入框等交互元素上触发拖动
        if (e.target.closest('button, input, textarea, select, label')) return;

        dragStartX = e.clientX;
        dragStartY = e.clientY;
        dragActive = false;

        const onMouseMove = (ev) => {
            const dx = ev.clientX - dragStartX;
            const dy = ev.clientY - dragStartY;

            if (!dragActive && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
                dragActive = true;
                pendingCellAction = null; // 拖动开始 → 取消格子操作
                gameContainer.classList.add('game-container--dragging');
            }

            if (dragActive) {
                boardTranslateX += dx;
                boardTranslateY += dy;
                gameContainer.style.transform = `translate(${boardTranslateX}px, ${boardTranslateY}px)`;
                dragStartX = ev.clientX;
                dragStartY = ev.clientY;
            }
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            if (dragActive) {
                gameContainer.classList.remove('game-container--dragging');
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    // ---- 初始渲染 ----
    loadTheme();           // 从 localStorage 恢复主题（CSS 变量就位后再渲染棋盘）
    renderSkinMenu();      // 动态生成换肤子菜单
    renderAnnouncements();
    renderChangelog();
    renderGameRecords();
    renderBoard(game);
    renderStatus(game);
}

/**
 * lapseld.minesweeper · Engine 模块
 *
 * 包含：
 *   - 数据模型（CellState 枚举、createCell 工厂）
 *   - 操作历史管理器（ActionHistory 环形缓冲区）
 *   - 核心扫雷引擎（Minesweeper 类）
 *
 * 职责：纯数据逻辑与算法，不涉及任何 DOM 操作。
 */

// ============================================================
//  数据模型层
// ============================================================

/**
 * 单元格状态常量
 */
const CellState = Object.freeze({
    HIDDEN:   0,
    REVEALED: 1,
    FLAGGED:  2,
});

/**
 * 创建一个空白单元格
 * @returns {{ mine: boolean, state: number, adjacentMines: number }}
 */
function createCell() {
    return {
        mine: false,
        state: CellState.HIDDEN,
        adjacentMines: 0,
    };
}

// ============================================================
//  历史记录层
// ============================================================

/**
 * 动作历史管理器（环形缓冲区 + localStorage 持久化）
 *
 * 仅记录改变游戏状态的操作（reveal / flag / chord / smart-reveal / auto-flag），
 * 不记录纯 UI 操作（高亮锁定、悬停等）。
 *
 * 持久化策略：
 *   - 每次 push() 自动序列化并写入 localStorage
 *   - 网格数据使用紧凑二进制编码 + 游程编码（RLE）压缩
 *   - 单格 1 字节（mine + state + adjacentMines + triggered 合入 8 位）
 *   - clear() 同步清除 localStorage 中的会话数据
 */
class ActionHistory {
    // ---- 单格编解码（8 位紧凑表示） ----
    //
    // 位布局（1 字节）：
    //   bit 7   — triggered（是否是踩中的那颗雷）
    //   bit 6   — mine（是否是地雷）
    //   bit 5-4 — state（0=HIDDEN, 1=REVEALED, 2=FLAGGED）
    //   bit 3-0 — adjacentMines + 1（编码范围 0–9，解码后范围 -1–8）

    /**
     * 将单元格对象编码为单字节整数 0–255
     * @param {{mine:boolean, state:number, adjacentMines:number, triggered?:boolean}} cell
     * @returns {number}
     */
    static _encodeCell(cell) {
        let v = 0;
        if (cell.triggered) v |= 0x80;
        if (cell.mine)      v |= 0x40;
        v |= (cell.state & 0x3) << 4;
        // adjacentMines 范围 -1~8，+1 后为 0~9，恰好 4 位
        v |= (cell.adjacentMines + 1) & 0xF;
        return v;
    }

    /**
     * 将单字节整数解码为单元格对象
     * @param {number} v  0–255
     * @returns {{mine:boolean, state:number, adjacentMines:number, triggered:boolean}}
     */
    static _decodeCell(v) {
        return {
            mine:          !!(v & 0x40),
            state:         (v >> 4) & 0x3,
            adjacentMines: (v & 0xF) - 1,
            triggered:     !!(v & 0x80),
        };
    }

    // ---- 网格压缩（RLE 游程编码） ----

    /**
     * 将完整网格压缩为 RLE 数据包
     * @param {Array<Array<object>>} grid  二维网格
     * @returns {{w:number, h:number, d:Array<number>}} 压缩包
     */
    static encodeGrid(grid) {
        const h = grid.length;
        const w = grid[0].length;
        const d = [];          // [value, count, value, count, ...]
        let prev = null;
        let run = 0;

        for (let r = 0; r < h; r++) {
            for (let c = 0; c < w; c++) {
                const v = ActionHistory._encodeCell(grid[r][c]);
                if (v === prev && run < 65535) {
                    run++;
                } else {
                    if (prev !== null) d.push(prev, run);
                    prev = v;
                    run = 1;
                }
            }
        }
        if (prev !== null) d.push(prev, run);
        return { w, h, d };
    }

    /**
     * 从 RLE 数据包解压为二维网格
     * @param {{w:number, h:number, d:Array<number>}} data
     * @returns {Array<Array<object>>}
     */
    static decodeGrid(data) {
        const { w, h, d } = data;
        const grid = [];
        let di = 0;          // RLE 数组索引
        let ri = 0, ci = 0;  // 目标坐标

        for (let r = 0; r < h; r++) {
            grid[r] = [];
        }

        while (di < d.length) {
            const value = d[di];
            const count = d[di + 1];
            const cell = ActionHistory._decodeCell(value);

            for (let i = 0; i < count; i++) {
                grid[ri][ci] = { ...cell };
                ci++;
                if (ci >= w) { ci = 0; ri++; }
            }
            di += 2;
        }
        return grid;
    }

    // ---- localStorage 键名 ----

    static STORAGE_KEY = 'minesweeper-history';

    // ---- 实例 ----

    /**
     * @param {number} capacity  缓冲区容量（默认 10）
     */
    constructor(capacity = 10) {
        this.capacity = capacity;
        /** @type {Array<{type: string, r: number, c: number, timestamp: number, grid: Array}>} */
        this.buffer = new Array(capacity);
        this.head = 0;   // 下一个写入位置
        this.count = 0;   // 当前记录数

        /** 最近一次 push 时记录的总雷数（供会话恢复用） */
        this._totalMines = 0;

        /** localStorage 写入去抖定时器 */
        this._saveTimer = null;
    }

    /**
     * 推入一条动作记录并自动持久化到 localStorage
     * @param {string} type          动作类型
     * @param {number} r             行号
     * @param {number} c             列号
     * @param {Array}  gridSnapshot  网格快照（深拷贝）
     * @param {number} [totalMines]  总雷数（可选，用于会话恢复）
     */
    push(type, r, c, gridSnapshot, totalMines) {
        this.buffer[this.head] = {
            type,
            r,
            c,
            timestamp: Date.now(),
            grid: gridSnapshot,
        };
        this.head = (this.head + 1) % this.capacity;
        if (this.count < this.capacity) this.count++;

        if (totalMines !== undefined) {
            this._totalMines = totalMines;
        }

        // 去抖持久化：延迟 2 秒批量写入，避免高频操作阻塞主线程
        this._scheduleSave();
    }

    /**
     * 去抖调度：合并短时间内的多次 push，延迟写入 localStorage
     */
    _scheduleSave() {
        if (this._saveTimer) return; // 已有待执行的写入
        this._saveTimer = setTimeout(() => {
            this._saveTimer = null;
            this._saveToStorage();
        }, 2000);
    }

    /**
     * 立即持久化（游戏结束时调用，确保不丢数据）
     */
    flushSave() {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        this._saveToStorage();
    }

    /**
     * 按时间顺序获取记录（最旧 → 最新）
     * @returns {Array}
     */
    getAll() {
        const result = [];
        const start = (this.head - this.count + this.capacity) % this.capacity;
        for (let i = 0; i < this.count; i++) {
            result.push(this.buffer[(start + i) % this.capacity]);
        }
        return result;
    }

    /**
     * 获取指定索引的记录（0 = 最旧）
     * @param {number} index
     * @returns {object|null}
     */
    get(index) {
        if (index < 0 || index >= this.count) return null;
        const start = (this.head - this.count + this.capacity) % this.capacity;
        return this.buffer[(start + index) % this.capacity];
    }

    /**
     * 获取存储的总雷数
     */
    get totalMines() {
        return this._totalMines;
    }

    /**
     * 清空历史（内存 + localStorage）
     */
    clear() {
        this.head = 0;
        this.count = 0;
        this._totalMines = 0;
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        try {
            localStorage.removeItem(ActionHistory.STORAGE_KEY);
        } catch (_e) {
            /* localStorage 不可用，静默失败 */
        }
    }

    // ---- 持久化 ----

    /**
     * 将当前缓冲区序列化写入 localStorage
     */
    _saveToStorage() {
        if (this.count === 0) return;
        try {
            const entries = this.getAll().map(entry => ({
                type: entry.type,
                r: entry.r,
                c: entry.c,
                ts: entry.timestamp,
                g: ActionHistory.encodeGrid(entry.grid),
            }));

            const payload = {
                v: 1,                    // 格式版本号
                mines: this._totalMines,
                capacity: this.capacity,
                entries,
            };

            localStorage.setItem(
                ActionHistory.STORAGE_KEY,
                JSON.stringify(payload)
            );
        } catch (_e) {
            /* localStorage 满或不可用，静默失败 */
        }
    }

    /**
     * 从 localStorage 恢复会话数据到当前实例
     *
     * 在构造函数中调用时（内存缓冲区为空），恢复持久化的历史记录。
     * 校验格式版本和数据结构完整性，异常数据静默丢弃。
     */
    _restoreFromStorage() {
        try {
            const raw = localStorage.getItem(ActionHistory.STORAGE_KEY);
            if (!raw) return;

            const payload = JSON.parse(raw);
            if (!payload || payload.v !== 1 || !Array.isArray(payload.entries)) {
                localStorage.removeItem(ActionHistory.STORAGE_KEY);
                return;
            }

            const entries = payload.entries;
            this._totalMines = typeof payload.mines === 'number' ? payload.mines : 0;

            // 恢复环形缓冲区（取最新 N 条，N = 实际条数与容量取小值）
            const toRestore = entries.slice(-this.capacity);
            this.count = toRestore.length;
            this.head = 0;   // 从头开始顺序写入

            for (let i = 0; i < toRestore.length; i++) {
                const e = toRestore[i];
                // 校验必要字段
                if (!e.g || typeof e.g.w !== 'number' || typeof e.g.h !== 'number' || !Array.isArray(e.g.d)) {
                    continue;
                }
                this.buffer[this.head] = {
                    type: e.type || 'unknown',
                    r: typeof e.r === 'number' ? e.r : 0,
                    c: typeof e.c === 'number' ? e.c : 0,
                    timestamp: typeof e.ts === 'number' ? e.ts : Date.now(),
                    grid: ActionHistory.decodeGrid(e.g),
                };
                this.head = (this.head + 1) % this.capacity;
                if (this.head === 0) this.count = this.capacity;
            }

            // 修正 count（可能因校验失败跳过了一些条目）
            this.count = this.buffer.filter(Boolean).length;
        } catch (_e) {
            // 数据损坏，清理
            this.clear();
        }
    }

    // ---- 静态工具 ----

    /**
     * 检查 localStorage 中是否有保存的会话
     * @returns {boolean}
     */
    static hasSavedSession() {
        try {
            return localStorage.getItem(ActionHistory.STORAGE_KEY) !== null;
        } catch (_e) {
            return false;
        }
    }

    /**
     * 从 localStorage 加载并返回一个已恢复的 ActionHistory 实例
     * @param {number} [capacity=10]
     * @returns {ActionHistory|null}  无会话时返回 null
     */
    static loadSession(capacity = 10) {
        try {
            const raw = localStorage.getItem(ActionHistory.STORAGE_KEY);
            if (!raw) return null;

            const payload = JSON.parse(raw);
            if (!payload || payload.v !== 1 || !Array.isArray(payload.entries)) return null;

            const history = new ActionHistory(capacity);
            history._restoreFromStorage();
            return history.count > 0 ? history : null;
        } catch (_e) {
            return null;
        }
    }

    /**
     * 清除 localStorage 中的会话数据
     */
    static clearSession() {
        try {
            localStorage.removeItem(ActionHistory.STORAGE_KEY);
        } catch (_e) {
            /* 静默失败 */
        }
    }
}

// ============================================================
//  核心逻辑层
// ============================================================

class Minesweeper {
    /**
     * @param {number} rows    行数
     * @param {number} cols    列数
     * @param {number} mines   地雷总数
     * @param {boolean} [noGuess=false]  无死局模式（动态棋盘，规避赌点）
     */
    constructor(rows = 9, cols = 9, mines = 10, noGuess = false) {
        this.rows = rows;
        this.cols = cols;
        this.totalMines = mines;
        this.noGuess = noGuess;

        /** @type {Array<Array<{mine:boolean, state:number, adjacentMines:number}>>} */
        this.grid = [];

        /** 是否已执行首次点击（决定是否生成雷） */
        this.generated = false;

        /** 游戏是否结束 */
        this.gameOver = false;

        /** 游戏是否胜利 */
        this.won = false;

        this._initGrid();
    }

    // ---- 初始化 ----

    /**
     * 初始化空矩阵（全 HIDDEN，无雷）
     */
    _initGrid() {
        this.grid = [];
        for (let r = 0; r < this.rows; r++) {
            this.grid[r] = [];
            for (let c = 0; c < this.cols; c++) {
                this.grid[r][c] = createCell();
            }
        }
    }

    // ---- 首点生成算法 ----

    /**
     * 根据首次点击位置生成地雷布局
     *
     * 算法：
     *   1. 以 (safeR, safeC) 为中心，标记周围 3×3 区域为"禁区"
     *   2. 在所有非禁区格子中随机选取 totalMines 个放置地雷
     *   3. 计算每个格子的相邻地雷数
     *
     * @param {number} safeR  首次点击的行号
     * @param {number} safeC  首次点击的列号
     */
    _generateMines(safeR, safeC) {
        // 无死局模式下的最大重试次数
        // 小棋盘多试几次（廉价），大棋盘控制上限（单次验证更贵）
        const maxRetries = this.noGuess
            ? Math.min(80, 15 + Math.floor(Math.sqrt(this.rows * this.cols)) * 2)
            : 1;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            // 收集可布雷的候选格子（排除禁区）
            const candidates = [];
            for (let r = 0; r < this.rows; r++) {
                for (let c = 0; c < this.cols; c++) {
                    if (this._isInSafeZone(r, c, safeR, safeC)) continue;
                    candidates.push({ r, c });
                }
            }

            // Fisher-Yates 洗牌 + 取前 N 个
            this._shuffle(candidates);
            const mineCount = Math.min(this.totalMines, candidates.length);
            for (let i = 0; i < mineCount; i++) {
                const { r, c } = candidates[i];
                this.grid[r][c].mine = true;
            }

            // 计算邻接数字
            this._calculateAdjacency();

            // 无死局模式：运行求解器验证棋盘
            if (!this.noGuess || this._validateNoGuess(safeR, safeC)) {
                this.generated = true;
                return;
            }

            // 本轮未通过验证 → 重置棋盘，重试
            this._initGrid();
        }

        // 所有重试均未通过：以最后一次生成的棋盘为准（极度罕见）
        // 理论上可能因为 maxRetries 不够而触发，棋盘仍可游玩
        if (!this.generated) {
            this._initGrid();
            const candidates = [];
            for (let r = 0; r < this.rows; r++) {
                for (let c = 0; c < this.cols; c++) {
                    if (this._isInSafeZone(r, c, safeR, safeC)) continue;
                    candidates.push({ r, c });
                }
            }
            this._shuffle(candidates);
            const mineCount = Math.min(this.totalMines, candidates.length);
            for (let i = 0; i < mineCount; i++) {
                const { r, c } = candidates[i];
                this.grid[r][c].mine = true;
            }
            this._calculateAdjacency();
            this.generated = true;
        }
    }

    /**
     * 判断 (r, c) 是否在以 (safeR, safeC) 为中心的 3×3 安全区内
     */
    _isInSafeZone(r, c, safeR, safeC) {
        return Math.abs(r - safeR) <= 1 && Math.abs(c - safeC) <= 1;
    }

    // ---- 无死局求解器 ----

    /**
     * 运行求解器验证棋盘是否为"无死局"
     *
     * 从首次点击位置 (safeR, safeC) 出发，模拟一个完美玩家的推理过程：
     *   1. 基本计数：剩余雷 = 0 → 邻居全安全；剩余雷 = 隐藏格数 → 邻居全雷
     *   2. 集合子集推演：复用 _findSmartSafeCells / _findSmartDangerCells 的数学逻辑
     *
     * 若求解器在某一步无法做出任何推论且仍有未揭非雷格 → 死局（返回 false）。
     *
     * @param {number} safeR  首次点击行号
     * @param {number} safeC  首次点击列号
     * @returns {boolean}  该棋盘是否为无死局
     */
    _validateNoGuess(safeR, safeC) {
        const sim = this.grid.map(row => row.map(c => ({ ...c })));
        const rows = this.rows;
        const cols = this.cols;

        // 揭开首点 + 泛洪蔓延
        sim[safeR][safeC].state = CellState.REVEALED;
        if (sim[safeR][safeC].adjacentMines === 0) {
            this._floodFillSim(sim, safeR, safeC);
        }

        // 求解主循环
        let progress = true;
        let iterations = 0;
        const maxIter = rows * cols; // 安全上限

        while (progress && iterations < maxIter) {
            progress = false;
            iterations++;

            // ---- 第一轮：基本计数推演 ----
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    if (sim[r][c].state !== CellState.REVEALED || sim[r][c].adjacentMines <= 0) continue;

                    const ns = this._getNeighbors(r, c);
                    const hidden = ns.filter(n => sim[n.r][n.c].state === CellState.HIDDEN);
                    const flagged = ns.filter(n => sim[n.r][n.c].state === CellState.FLAGGED);
                    const remaining = sim[r][c].adjacentMines - flagged.length;

                    if (remaining === 0 && hidden.length > 0) {
                        // 所有隐藏邻居安全 → 揭开
                        for (const n of hidden) {
                            if (sim[n.r][n.c].mine) return false; // 防御：求解器不应揭雷
                            sim[n.r][n.c].state = CellState.REVEALED;
                            if (sim[n.r][n.c].adjacentMines === 0) {
                                this._floodFillSim(sim, n.r, n.c);
                            }
                        }
                        progress = true;
                    } else if (remaining === hidden.length && hidden.length > 0) {
                        // 所有隐藏邻居是雷 → 插旗
                        for (const n of hidden) {
                            sim[n.r][n.c].state = CellState.FLAGGED;
                        }
                        progress = true;
                    }
                }
            }

            if (progress) continue; // 基本计数有进展，继续循环

            // ---- 第二轮：集合子集推演 ----
            // 收集所有已揭开数字格及其隐藏邻居信息
            const revealedCells = [];
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    if (sim[r][c].state !== CellState.REVEALED || sim[r][c].adjacentMines <= 0) continue;
                    const flaggedCount = this._simCountFlagged(sim, r, c);
                    const remaining = sim[r][c].adjacentMines - flaggedCount;
                    if (remaining <= 0) continue;
                    const hiddenKeys = this._simGetHiddenKeys(sim, r, c);
                    if (hiddenKeys.size === 0) continue;
                    revealedCells.push({ r, c, remaining, hiddenKeys });
                }
            }

            // 遍历所有 (N_A, N_B) 对，检查 S_B ⊂ S_A
            for (let i = 0; i < revealedCells.length; i++) {
                const a = revealedCells[i];
                for (let j = 0; j < revealedCells.length; j++) {
                    if (i === j) continue;
                    const b = revealedCells[j];

                    // 距离剪枝：若 N_B 与 N_A 曼哈顿距离 > 2，S_B 不可能 ⊆ S_A
                    if (Math.abs(a.r - b.r) + Math.abs(a.c - b.c) > 2) continue;

                    if (b.hiddenKeys.size >= a.hiddenKeys.size) continue;

                    // 校验 S_B 是否为 S_A 的真子集
                    let isSubset = true;
                    for (const key of b.hiddenKeys) {
                        if (!a.hiddenKeys.has(key)) { isSubset = false; break; }
                    }
                    if (!isSubset) continue;

                    // 安全推演：M_A == M_B → S_A \ S_B 安全
                    if (a.remaining === b.remaining) {
                        for (const key of a.hiddenKeys) {
                            if (!b.hiddenKeys.has(key)) {
                                const [sr, sc] = key.split(',').map(Number);
                                if (sim[sr][sc].state === CellState.HIDDEN) {
                                    if (sim[sr][sc].mine) return false;
                                    sim[sr][sc].state = CellState.REVEALED;
                                    if (sim[sr][sc].adjacentMines === 0) {
                                        this._floodFillSim(sim, sr, sc);
                                    }
                                    progress = true;
                                }
                            }
                        }
                    }

                    // 危险推演：|S_A \ S_B| == M_A - M_B → 差集全为雷
                    const diffSize = a.hiddenKeys.size - b.hiddenKeys.size;
                    const diffMines = a.remaining - b.remaining;
                    if (diffSize === diffMines && diffSize > 0) {
                        for (const key of a.hiddenKeys) {
                            if (!b.hiddenKeys.has(key)) {
                                const [sr, sc] = key.split(',').map(Number);
                                if (sim[sr][sc].state === CellState.HIDDEN) {
                                    sim[sr][sc].state = CellState.FLAGGED;
                                    progress = true;
                                }
                            }
                        }
                    }
                }
            }
        }

        // 求解结束：检查是否所有非雷格均已揭开
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (!sim[r][c].mine && sim[r][c].state !== CellState.REVEALED) {
                    return false; // 有非雷格未揭开 → 死局
                }
            }
        }
        return true; // 无死局
    }

    /**
     * 在模拟网格上执行泛洪填充（与 _floodReveal 逻辑一致，但作用于独立网格）
     * @param {Array}   grid  模拟网格
     * @param {number}  r
     * @param {number}  c
     */
    _floodFillSim(grid, r, c) {
        const stack = [{ r, c }];
        const visited = new Set([`${r},${c}`]);
        while (stack.length > 0) {
            const { r: cr, c: cc } = stack.pop();
            for (const { r: nr, c: nc } of this._getNeighbors(cr, cc)) {
                const key = `${nr},${nc}`;
                if (visited.has(key)) continue;
                visited.add(key);
                const cell = grid[nr][nc];
                if (cell.state !== CellState.HIDDEN || cell.mine) continue;
                cell.state = CellState.REVEALED;
                if (cell.adjacentMines === 0) stack.push({ r: nr, c: nc });
            }
        }
    }

    /**
     * 统计 (r, c) 周围已插旗的邻居数（作用在指定网格上）
     * @param {Array}  grid
     * @param {number} r
     * @param {number} c
     * @returns {number}
     */
    _simCountFlagged(grid, r, c) {
        let count = 0;
        for (const { r: nr, c: nc } of this._getNeighbors(r, c)) {
            if (grid[nr][nc].state === CellState.FLAGGED) count++;
        }
        return count;
    }

    /**
     * 获取 (r, c) 周围的隐藏格坐标键集合（作用在指定网格上）
     * @param {Array}  grid
     * @param {number} r
     * @param {number} c
     * @returns {Set<string>}
     */
    _simGetHiddenKeys(grid, r, c) {
        const keys = new Set();
        for (const { r: nr, c: nc } of this._getNeighbors(r, c)) {
            if (grid[nr][nc].state === CellState.HIDDEN) {
                keys.add(`${nr},${nc}`);
            }
        }
        return keys;
    }

    /**
     * Fisher-Yates 洗牌（原地随机打乱）
     * @param {Array} arr
     */
    _shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }

    /**
     * 计算所有格子的相邻地雷数
     */
    _calculateAdjacency() {
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (this.grid[r][c].mine) {
                    this.grid[r][c].adjacentMines = -1; // 地雷本身标记为 -1
                    continue;
                }
                this.grid[r][c].adjacentMines = this._countAdjacentMines(r, c);
            }
        }
    }

    /**
     * 统计 (r, c) 周围 8 格的地雷数
     */
    _countAdjacentMines(r, c) {
        let count = 0;
        for (const { r: nr, c: nc } of this._getNeighbors(r, c)) {
            if (this.grid[nr][nc].mine) {
                count++;
            }
        }
        return count;
    }

    /**
     * 获取 (r, c) 的有效邻居坐标列表
     * @returns {Array<{r: number, c: number}>}
     */
    _getNeighbors(r, c) {
        const neighbors = [];
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                const nr = r + dr;
                const nc = c + dc;
                if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) {
                    neighbors.push({ r: nr, c: nc });
                }
            }
        }
        return neighbors;
    }

    // ---- 公共操作接口 ----

    /**
     * 揭开一个格子
     * @param {number} r  行号
     * @param {number} c  列号
     * @returns {{ success: boolean, reason?: string }}
     */
    reveal(r, c) {
        if (this.gameOver || this.won) {
            return { success: false, reason: 'game-ended' };
        }

        const cell = this.grid[r][c];

        if (cell.state !== CellState.HIDDEN) {
            return { success: false, reason: 'already-revealed-or-flagged' };
        }

        // 首次点击：生成雷区
        if (!this.generated) {
            this._generateMines(r, c);
        }

        // 踩雷：揭开所有雷，标记触发雷
        if (cell.mine) {
            cell.state = CellState.REVEALED;
            cell.triggered = true;
            this._revealAllMines();
            this.gameOver = true;
            return { success: true, hitMine: true };
        }

        // 揭开安全格
        cell.state = CellState.REVEALED;

        // 点 0 触发 DFS 连环蔓延
        if (cell.adjacentMines === 0) {
            this._floodReveal(r, c);
        }

        // 胜利判定：所有非雷格均已揭开
        if (this._checkWin()) {
            this.won = true;
            this._revealAllMines();
            return { success: true, hitMine: false, won: true };
        }

        return { success: true, hitMine: false };
    }

    /**
     * DFS 蔓延揭开：从 (r, c) 出发，递归揭开所有连通的空白区域
     *
     * 蔓延规则：
     *   - 当前格为 0 → 继续向 8 邻居蔓延
     *   - 当前格为 1-8 → 揭开但停止蔓延（数字格是边界）
     *   - 已揭开 / 已旗标 / 是地雷 → 不处理
     *
     * @param {number} r  起始行号
     * @param {number} c  起始列号
     */
    _floodReveal(r, c) {
        for (const { r: nr, c: nc } of this._getNeighbors(r, c)) {
            const neighbor = this.grid[nr][nc];

            // 跳过已揭开、已旗标、地雷
            if (neighbor.state !== CellState.HIDDEN || neighbor.mine) {
                continue;
            }

            // 揭开邻居
            neighbor.state = CellState.REVEALED;

            // 仅当邻居也是 0 时才继续蔓延（1-8 是边界，揭开即止）
            if (neighbor.adjacentMines === 0) {
                this._floodReveal(nr, nc);
            }
        }
    }

    /**
     * 揭开所有地雷（失败时展示全雷，胜利时标记全雷）
     */
    _revealAllMines() {
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const cell = this.grid[r][c];
                if (cell.mine) {
                    cell.state = CellState.REVEALED;
                }
            }
        }
    }

    /**
     * 胜利判定：所有非雷格均已揭开
     * @returns {boolean}
     */
    _checkWin() {
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const cell = this.grid[r][c];
                if (!cell.mine && cell.state !== CellState.REVEALED) {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * 统计 (r, c) 周围已插旗的邻居数
     * @param {number} r
     * @param {number} c
     * @returns {number}
     */
    _countFlaggedNeighbors(r, c) {
        let count = 0;
        for (const { r: nr, c: nc } of this._getNeighbors(r, c)) {
            if (this.grid[nr][nc].state === CellState.FLAGGED) {
                count++;
            }
        }
        return count;
    }

    /**
     * 获取 (r, c) 周围的隐藏格集合（坐标键集合）
     * @param {number} r
     * @param {number} c
     * @returns {Set<string>}
     */
    _getHiddenNeighborKeys(r, c) {
        const keys = new Set();
        for (const { r: nr, c: nc } of this._getNeighbors(r, c)) {
            if (this.grid[nr][nc].state === CellState.HIDDEN) {
                keys.add(`${nr},${nc}`);
            }
        }
        return keys;
    }

    /**
     * 智能交集推演：在 N_A 的 3×3 范围内找出可被数学证明为绝对安全的格子
     *
     * 遍历棋盘上所有已揭开数字格 N_B（不限于 N_A 的直接邻居），
     * 检查 N_B 的整个隐藏区 S_B 是否被 N_A 的 3×3 盲区 S_A 完整包含。
     *
     * 数学证明：
     *   若 S_B ⊂ S_A 且 M_A = M_B：
     *   S_B 内有 M_B 颗雷；S_A 需要 M_A = M_B 颗雷，全在 S_B 内；
     *   因此 S_A \ S_B 雷数 = 0，绝对安全。
     *
     * @param {number} r  悬停格行号
     * @param {number} c  悬停格列号
     * @returns {Set<string>}  安全格坐标键集合（均在 N_A 的 3×3 内）
     */
    _findSmartSafeCells(r, c, candidateFilter = null) {
        const cellA = this.grid[r][c];
        if (cellA.state !== CellState.REVEALED || cellA.adjacentMines <= 0) return new Set();

        const mA = cellA.adjacentMines - this._countFlaggedNeighbors(r, c);
        const sA = this._getHiddenNeighborKeys(r, c);

        if (sA.size === 0) return new Set();

        const safeKeys = new Set();

        // 遍历棋盘所有已揭开数字格（N_B 不限于 N_A 的邻居）
        // 若传入 candidateFilter，则仅考虑其中的候选格
        for (let br = 0; br < this.rows; br++) {
            for (let bc = 0; bc < this.cols; bc++) {
                if (br === r && bc === c) continue;

                // 候选过滤器：悬停高亮场景下仅考虑附近锁定格，避免与锁定无关的推演
                if (candidateFilter && !candidateFilter.has(`${br},${bc}`)) continue;

                // 距离剪枝：若 N_B 与 N_A 的曼哈顿距离 > 2，S_B 不可能 ⊆ S_A
                if (Math.abs(br - r) + Math.abs(bc - c) > 2) continue;

                const cellB = this.grid[br][bc];
                if (cellB.state !== CellState.REVEALED || cellB.adjacentMines <= 0) continue;

                const sB = this._getHiddenNeighborKeys(br, bc);
                if (sB.size === 0 || sB.size >= sA.size) continue;

                // 校验：S_B 是否为 S_A 的非空真子集
                let isProperSubset = true;
                for (const key of sB) {
                    if (!sA.has(key)) { isProperSubset = false; break; }
                }
                if (!isProperSubset) continue;

                // 推演：M_A = M_B → S_A \ S_B 绝对安全
                const mB = cellB.adjacentMines - this._countFlaggedNeighbors(br, bc);
                if (mA === mB) {
                    for (const key of sA) {
                        if (!sB.has(key)) safeKeys.add(key);
                    }
                }
            }
        }

        return safeKeys;
    }

    /**
     * 智能安全揭示：揭开所有被推演证明为安全的格子
     * @param {number} r
     * @param {number} c
     * @returns {{ success: boolean, revealed: number, reason?: string }}
     */
    smartReveal(r, c) {
        if (this.gameOver || this.won) return { success: false, revealed: 0, reason: 'game-ended' };

        const safeKeys = this._findSmartSafeCells(r, c);
        if (safeKeys.size === 0) return { success: false, revealed: 0, reason: 'no-safe-cells' };

        for (const key of safeKeys) {
            const [sr, sc] = key.split(',').map(Number);
            const cell = this.grid[sr][sc];
            if (cell.state !== CellState.HIDDEN) continue;

            if (cell.mine) {
                // 不应发生（算法保证安全），防御性处理
                cell.state = CellState.REVEALED;
                cell.triggered = true;
                this._revealAllMines();
                this.gameOver = true;
                return { success: true, revealed: 1, hitMine: true };
            }

            cell.state = CellState.REVEALED;
            if (cell.adjacentMines === 0) this._floodReveal(sr, sc);
        }

        if (this._checkWin()) {
            this.won = true;
            this._revealAllMines();
            return { success: true, revealed: safeKeys.size, won: true };
        }

        return { success: true, revealed: safeKeys.size };
    }

    /**
     * 智能危险推演：在 N_A 的 3×3 范围内找出可被数学证明为绝对危险的格子
     *
     * 遍历棋盘上所有已揭开数字格 N_B，检查 N_B 的隐藏区 S_B 是否为
     * N_A 的 3×3 盲区 S_A 的真子集。
     *
     * 数学证明（危险版）：
     *   若 S_B ⊂ S_A：
     *     S_A 需 M_A 颗雷，S_B 需 M_B 颗雷（全部落在 S_A 内）；
     *     则 S_A \ S_B 需要 M_A − M_B 颗雷；
     *     若 |S_A \ S_B| = M_A − M_B → 差集中每一格都是雷，绝对危险。
     *
     * @param {number} r  右键点击格行号
     * @param {number} c  右键点击格列号
     * @returns {Set<string>}  已证明为雷的格子坐标键集合
     */
    _findSmartDangerCells(r, c, candidateFilter = null) {
        const cellA = this.grid[r][c];
        if (cellA.state !== CellState.REVEALED || cellA.adjacentMines <= 0) return new Set();

        const mA = cellA.adjacentMines - this._countFlaggedNeighbors(r, c);
        const sA = this._getHiddenNeighborKeys(r, c);
        if (sA.size === 0) return new Set();

        const dangerKeys = new Set();

        for (let br = 0; br < this.rows; br++) {
            for (let bc = 0; bc < this.cols; bc++) {
                if (br === r && bc === c) continue;

                // 候选过滤器
                if (candidateFilter && !candidateFilter.has(`${br},${bc}`)) continue;

                // 距离剪枝：若 N_B 与 N_A 的曼哈顿距离 > 2，S_B 不可能 ⊆ S_A
                if (Math.abs(br - r) + Math.abs(bc - c) > 2) continue;

                const cellB = this.grid[br][bc];
                if (cellB.state !== CellState.REVEALED || cellB.adjacentMines <= 0) continue;

                const sB = this._getHiddenNeighborKeys(br, bc);
                if (sB.size === 0 || sB.size >= sA.size) continue;

                // 校验 S_B 是否为 S_A 的真子集
                let isSubset = true;
                for (const key of sB) {
                    if (!sA.has(key)) { isSubset = false; break; }
                }
                if (!isSubset) continue;

                const mB = cellB.adjacentMines - this._countFlaggedNeighbors(br, bc);
                const diffSize = sA.size - sB.size;
                const diffMines = mA - mB;

                // 推演：|S_A \ S_B| = M_A − M_B → 差集全为雷
                if (diffSize === diffMines && diffSize > 0) {
                    for (const key of sA) {
                        if (!sB.has(key)) dangerKeys.add(key);
                    }
                }
            }
        }

        return dangerKeys;
    }

    /**
     * 智能插旗：将数学推演证明为绝对危险的格子全部标旗
     * @param {number} r
     * @param {number} c
     * @returns {{ success: boolean, flagged: number, reason?: string }}
     */
    smartFlag(r, c) {
        if (this.gameOver || this.won) return { success: false, flagged: 0, reason: 'game-ended' };

        const dangerKeys = this._findSmartDangerCells(r, c);
        if (dangerKeys.size === 0) return { success: false, flagged: 0, reason: 'no-danger-cells' };

        let flagged = 0;
        for (const key of dangerKeys) {
            const [dr, dc] = key.split(',').map(Number);
            const cell = this.grid[dr][dc];
            if (cell.state === CellState.HIDDEN) {
                cell.state = CellState.FLAGGED;
                flagged++;
            }
        }

        return { success: flagged > 0, flagged };
    }

    /**
     * 和弦展开：在已揭开的数字格上触发
     *
     * 前提条件：
     *   - 格子已揭开且 adjacentMines > 0
     *   - 周围插旗数 === adjacentMines
     *
     * 行为：揭开周围所有未揭开且未插旗的格子（同 reveal 逻辑，含 DFS 蔓延）
     *
     * @param {number} r
     * @param {number} c
     * @returns {{ success: boolean, hitMine?: boolean, won?: boolean, reason?: string }}
     */
    chord(r, c) {
        if (this.gameOver || this.won) {
            return { success: false, reason: 'game-ended' };
        }

        const cell = this.grid[r][c];

        // 只对已揭开的数字格生效
        if (cell.state !== CellState.REVEALED || cell.adjacentMines <= 0) {
            return { success: false, reason: 'not-a-number-cell' };
        }

        const flaggedCount = this._countFlaggedNeighbors(r, c);

        // 旗数不等于数字 → 拒绝展开
        if (flaggedCount !== cell.adjacentMines) {
            return { success: false, reason: 'flag-mismatch' };
        }

        // 旗数匹配 → 揭开周围所有隐藏格
        let hitMine = false;

        for (const { r: nr, c: nc } of this._getNeighbors(r, c)) {
            const neighbor = this.grid[nr][nc];

            if (neighbor.state !== CellState.HIDDEN) {
                continue;
            }

            // 踩雷
            if (neighbor.mine) {
                neighbor.state = CellState.REVEALED;
                neighbor.triggered = true;
                this._revealAllMines();
                this.gameOver = true;
                hitMine = true;
                return { success: true, hitMine: true };
            }

            // 揭开安全格
            neighbor.state = CellState.REVEALED;

            // DFS 蔓延
            if (neighbor.adjacentMines === 0) {
                this._floodReveal(nr, nc);
            }
        }

        // 胜利判定
        if (this._checkWin()) {
            this.won = true;
            this._revealAllMines();
            return { success: true, hitMine: false, won: true };
        }

        return { success: true, hitMine: false };
    }

    /**
     * 切换旗标状态
     * @param {number} r
     * @param {number} c
     * @returns {{ success: boolean, flagged: boolean }}
     */
    toggleFlag(r, c) {
        if (this.gameOver || this.won) {
            return { success: false, flagged: false };
        }

        const cell = this.grid[r][c];

        if (cell.state === CellState.REVEALED) {
            return { success: false, flagged: false };
        }

        if (cell.state === CellState.HIDDEN) {
            cell.state = CellState.FLAGGED;
            return { success: true, flagged: true };
        }

        // 已旗标 → 取消
        cell.state = CellState.HIDDEN;
        return { success: true, flagged: false };
    }

    /**
     * 获取当前已放置旗标数
     */
    get flagCount() {
        let count = 0;
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (this.grid[r][c].state === CellState.FLAGGED) {
                    count++;
                }
            }
        }
        return count;
    }

    /**
     * 获取剩余雷数（总雷数 - 旗标数）
     */
    get remainingMines() {
        return this.totalMines - this.flagCount;
    }

    /**
     * 重置游戏状态（新游戏）
     */
    reset() {
        this.generated = false;
        this.gameOver = false;
        this.won = false;
        this._initGrid();
    }

    /**
     * 导出当前网格状态（纯数据，供渲染层消费）
     * @returns {Array<Array<{mine:boolean, state:number, adjacentMines:number}>>}
     */
    getGridSnapshot() {
        return this.grid.map(row =>
            row.map(cell => ({ ...cell }))
        );
    }
}

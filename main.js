/**
 * lapseld.minesweeper · 入口文件
 *
 * 零依赖、无构建工具 — 所有模块通过 index.html 的 <script> 标签
 * 按依赖顺序加载（Engine → Renderer → Controller → main），
 * 全局作用域下的函数与类直接引用，无需 import/export。
 */

// DOM 就绪后初始化应用
document.addEventListener('DOMContentLoaded', init);

/**
 * 马克一号 · 进程内 AC 接管探针
 *
 * DSH Desktop 的 host 进程常驻，插件一旦加载失败就不会再重新求值（ESM 模块缓存
 * 按真实路径为键）。为了能在**不重启应用**的前提下排查，探针做两件事：
 *   1. 捕获 target、行为与决策点（哪里决定把某个 entry 判成 failed）；
 *   2. 用内置的微型对象栏暴露出来，让外部（本会话）能读取。
 *
 * 本文件只在 bundle 的排查开关打开时被 import。
 *
 * @module @local/dsh-mark-one/internals
 */

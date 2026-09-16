// cloudfunctions/detectCycle/service.js —— 批次 3 · POC2 BOM 循环引用检测（Service 层纯函数）
//
// ⚠️ 分层铁律：本文件是「纯函数」，只读不写、不碰云 SDK 与前端请求。
//
// 算法：有向图 DFS 递归，检测引用链中是否出现自身（依赖环）。
//   · 节点 = 半成品/菜品成本卡或原料；边 = A 的明细引用了 B（A → B）。
//   · 入参统一为边集合 edges: [{ from, to }]（与契约 detectCycle 一致）。
//   · 最大递归深度 ≤ 5 层（BOM 业务上限 2 层，5 层做冗余兜底，见强制遵守 §3）。
//     深度超过 5 直接判环：抛 BOM_CYCLE_DETECTED（深度受限 = 更保守的兜底）。
//   · 命中依赖环 → throw { code: 'BOM_CYCLE_DETECTED' }（由上层捕获 → fail(code)，数据不入库）。
//   · 无环 → { has_cycle: false }。
//
// 为什么像"半成品不能引用半成品"（2 层限制）下理论上不可环，仍要保留：
//   防"层级限制被绕过 / 未来放开层级"时的隐患，属稳健性兜底，不可删（M3 §3.6）。

const { ERROR_CODES } = require('./common'); // 扁平派生副本；仅取错误码常量（纯用）

const MAX_DEPTH = 5;

/**
 * DFS 判环（带深度上限的递归）。
 * @param {Map<string, string[]>} adj  邻接表 from → [to...]
 * @param {string} node                当前节点
 * @param {string[]} stack             当前从起点到本节点的链（起点在 stack[0]，用于判自身环）
 * @param {Set<string>} visiting       递归栈标记（用于链上回边判环）
 * @param {number} depth               当前递归深度
 * @returns {boolean} 是否检测到环
 */
function dfsHasCycle(adj, node, stack, visiting, depth) {
  if (depth > MAX_DEPTH) return true; // 深度超限 = 判环（冗余兜底）
  visiting.add(node);
  const children = adj.get(node) || [];
  for (const to of children) {
    // 直接回到起点（stack[0]）或递归栈上任何节点 → 依赖环
    if (stack.includes(to) || visiting.has(to)) return true;
    if (dfsHasCycle(adj, to, stack.concat(to), visiting, depth + 1)) return true;
  }
  visiting.delete(node);
  return false;
}

/**
 * 循环引用检测（纯函数）。
 * @param {Array<{from:string,to:string}>} edges 边集合（A 引用 B → {from:A, to:B}）
 * @returns {{ has_cycle:boolean }} has_cycle=true 表示有环
 * @throws {{code:'BOM_CYCLE_DETECTED'}} 命中依赖环时抛出（由 Controller/上层捕获 → fail）
 */
function detectCycle(edges) {
  const adj = new Map();
  const all = new Set();
  for (const e of (edges || [])) {
    if (!e || e.from == null || e.to == null) continue;
    const from = String(e.from);
    const to = String(e.to);
    all.add(from); all.add(to);
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from).push(to);
  }
  // 以每个节点为起点做 DFS，检测从它出发能回到它/递归栈任意点
  for (const start of all) {
    if (dfsHasCycle(adj, start, [start], new Set(), 1)) return { has_cycle: true };
  }
  return { has_cycle: false };
}

// 便捷：给定 「本次要保存的半成品输出虚拟 id」 + 「它所引用的虚拟半成品 childIds」 +
//       「已有『生产者→被引半成品』边集 bomEdges」，判断本次保存是否会产生环。
// 语义：产出半成品 N（其虚拟输出 = ownId）的明细引用了半成品 V（V ∈ childIds）→ 依赖 V，
//       即新增边 ownId → V；若沿已有依存链能从某个 V 回到 ownId（含自引）→ 判环。
//       供 saveCostCard 在 INSERT 前调用（业务上限 2 层，5 层检测做冗余兜底）。
function willCycleBeCreated(ownId, childIds, bomEdges) {
  const edges = (bomEdges || []).slice();
  for (const c of (childIds || [])) {
    if (String(c) === String(ownId)) return true; // 直接引用自身
    edges.push({ from: String(ownId), to: String(c) }); // 新增边：own → c（自身产出依赖被引半成品）
  }
  return detectCycle(edges).has_cycle;
}

module.exports = { detectCycle, willCycleBeCreated, MAX_DEPTH, ERROR_CODES };
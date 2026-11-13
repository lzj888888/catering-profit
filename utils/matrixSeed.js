// utils/matrixSeed.js —— 沙盘页 → 场景矩阵页 的「种子」契约单源
//
// 🔴 R550（李老师 2026-10-28）：矩阵页要有**「读取我填的数据」按钮**，且必须能带
//   **经营类型 / 城市 / 装修 / 设备 / 加盟 / 转让 / 面积 / 人均工资 / 人工总额 / 管理费**。
//   此前（R548）只有一个 URL 传参版，且**根本没带经营类型与城市** ⇒ 老板看不到"读取经营类型"的入口。
//
// 🔴 为什么单独建这个文件：读的写的是两个页面，若各写一份键名映射，
//   一定会出现「首页存了 dcY、矩阵页读 decorY」这种**静默不生效**（本项目反复踩的病）。
//   ⇒ 键名、存储 key、版本号全部在此单源，两边只 require 不复制。
'use strict';
const ss = require('./shopSwitcher.js');

// 存储 key 带版本：种子结构一旦改字段，改版本号即可让旧种子自动失效（不会读到半截数据）。
const KEY = 'SB_MATRIX_SEED_V1';

/**
 * 🔴 R725（2026-11-13）：种子的**按店**存储 key —— 两个页面都只准用这个函数，不许各自拼。
 *
 * 事故形态（修前）：KEY 是全局一格，seed 里既没 shop_id、读时也不校验 ⇒
 *   A 店点「生成矩阵」写种子（房租/装修/加盟/面积/工资/管理费全在里面）→ 切到 B 店进矩阵页
 *   → `applySeed(seed, true)` **静默应用 A 店的投入**算盈亏矩阵，界面上看不出任何异常。
 *   老板会拿 A 店的成本给 B 店做决策 —— 与本项目「算错钱不报错」红线同型。
 *
 * 为什么不用「值里塞 shop_id + 读时比对」（R443 沙盘草稿那种写法）：那样虽然不串，
 *   但两店共用一格 ⇒ B 店保存会**覆盖**A 店的种子（R718/R719 记过的「覆盖丢失」类）。
 *   R720 已把 7 类 key 统一收敛到 shopKey，这里保持一致：按店各占一格。
 *   ⇒ 旧种子读不到（key 变了）当没有，宁丢不串（seedKey 会由「生成矩阵」重建）。
 */
function seedKey() { return ss.shopKey(KEY); }

// 短键 → 矩阵页 `global.*` 字段名。只映射「全局投入」这一类（12 项，含 4 个摊销年限）。
// ⚠️ 年限必须一起带：只带金额不带年限 ⇒ 年限回落默认 ⇒ 月摊销变、保本线跟着变（口径双轨，R548 已记）。
const GK = {
  dcY: 'buildDecorYuan', dcN: 'buildDecorYears',
  eqY: 'buildEquipYuan', eqN: 'buildEquipYears',
  frY: 'buildFranchiseYuan', frN: 'buildFranchiseYears',
  tfY: 'buildTransferYuan', tfN: 'buildTransferYears',
  area: 'area', lu: 'laborUnitYuan', lt: 'laborTotalYuan', mg: 'manageYuan',
};

module.exports = { KEY, GK, seedKey };

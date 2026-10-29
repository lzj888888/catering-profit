// utils/categoryPresets.js —— M3 P0-2 品类默认模板（纯数据单源）
//
// 用途：新建「单品成本卡」时，老板先选品类 → 系统按行业默认预填：
//   ① 制作损耗率（loss_rate，%）② 每行默认出净率（yield_rate，%）③ 调料油火（油盐酱醋+燃料合并一项）每份费用
//   ④ 1~2 个标准主料示例（价格留空，黄标可改）。
// 目标：降填项、降学习成本（方案 §8 / P0-2 行 178；引导式首建 §4.2 行 99-111）。
//
// 🔴 红线：
//   ① 本文件是品类默认值的**唯一声明处**；前端 edit.js 只读不抄（避免双源漂移）。
//   ② 只预填「默认值/示例」，绝不预填真实价格；调料油火行以 `unit_price_yuan` 预填默认单价，
//      用户可见、可改（与 dishTemplates 红线段③一致：模板不掺非示例金额口径，此行是「可改默认值」）。
//   ③ yield_rate / loss_rate 单位均为「百分数整数」（如 85 表示 85%）；引擎侧 yieldRateOf 仍夹 (0,100]。
//
// 📌 决策来源（2026-10-29）：双顾问（DeepSeek 财务视角 + 豆包产品视角）API 当日不可用
//   （TCP 通但 HTTP 响应挂起 >13min，已停），按李老师「你做决策去实施」授权，由巴迪据**已批方案草案**
//   （M3深度优化方案.md 行 53-61 / 101：出净率 冻禽85-90/鲜叶60-70/根茎80-85、损耗 快炒2/卤味3/面点5、
//   调料油火0.8元/份）＋餐饮成本领域常识定稿。待端点恢复将补跑双顾问质证并据其反馈校准。
const units = require('./units.js');

// 调料油火行固定物料名（单源；edit.js 引用，避免两处硬编码）
const CONDIMENT_NAME = '调料油火';

// 11 个主流单品成本卡品类（夫妻店/中小餐饮高频）。
// 字段：key / label / yield_rate(出净率%) / loss_rate(制作损耗率%) / condiment_fen(调料油火 每份 分) / sample_lines(示例主料)
const CATEGORY_PRESETS = [
  {
    key: 'hot_meat', label: '热炒荤菜',
    yield_rate: 85, loss_rate: 2, condiment_fen: 80,
    sample_lines: [{ name: '猪肉', qty: 150, unit: '克' }, { name: '青椒', qty: 100, unit: '克' }],
  },
  {
    key: 'hot_veg', label: '热炒素菜',
    yield_rate: 75, loss_rate: 2, condiment_fen: 60,
    sample_lines: [{ name: '青菜', qty: 300, unit: '克' }, { name: '蒜', qty: 20, unit: '克' }],
  },
  {
    key: 'braise', label: '卤味烧腊',
    yield_rate: 90, loss_rate: 3, condiment_fen: 50,
    sample_lines: [{ name: '五花肉', qty: 200, unit: '克' }],
  },
  {
    key: 'staple', label: '面点主食',
    yield_rate: 95, loss_rate: 5, condiment_fen: 50,
    sample_lines: [{ name: '面粉', qty: 200, unit: '克' }],
  },
  {
    key: 'soup', label: '汤羹',
    yield_rate: 95, loss_rate: 3, condiment_fen: 50,
    sample_lines: [{ name: '骨头', qty: 300, unit: '克' }],
  },
  {
    key: 'drink', label: '饮品奶茶',
    yield_rate: 98, loss_rate: 1, condiment_fen: 30,
    sample_lines: [{ name: '牛奶', qty: 200, unit: '毫升' }],
  },
  {
    key: 'bbq_fry', label: '烧烤炸物',
    yield_rate: 90, loss_rate: 8, condiment_fen: 60,
    sample_lines: [{ name: '鸡翅', qty: 300, unit: '克' }],
  },
  {
    key: 'steam', label: '蒸菜',
    yield_rate: 92, loss_rate: 2, condiment_fen: 40,
    sample_lines: [{ name: '鱼', qty: 1, unit: '条' }],
  },
  {
    key: 'cold', label: '凉拌沙拉',
    yield_rate: 90, loss_rate: 2, condiment_fen: 50,
    sample_lines: [{ name: '黄瓜', qty: 200, unit: '克' }],
  },
  {
    key: 'hotpot', label: '火锅涮品',
    yield_rate: 95, loss_rate: 3, condiment_fen: 30,
    sample_lines: [{ name: '肥牛', qty: 200, unit: '克' }],
  },
  {
    key: 'ricebowl', label: '快餐盖饭',
    yield_rate: 85, loss_rate: 3, condiment_fen: 80,
    sample_lines: [{ name: '米饭', qty: 1, unit: '份' }, { name: '鸡肉', qty: 150, unit: '克' }],
  },
];

function getCategoryPreset(key) {
  const k = String(key == null ? '' : key).trim();
  if (!k) return null;
  return CATEGORY_PRESETS.find((c) => c.key === k) || null;
}

/**
 * 自检：返回错误字符串数组（空 = 全部合法）。
 * 守卫用途：utils/categoryPresets.selftest.js 调用；新人改表时立刻发现非法默认值。
 */
function validatePresets() {
  const errs = [];
  const seen = new Set();
  for (const c of CATEGORY_PRESETS) {
    if (!c || !c.key || seen.has(c.key)) errs.push('品类 key 缺失或重复：' + (c && c.key));
    seen.add(c.key);
    if (!c.label) errs.push('品类 label 缺失：' + c.key);
    if (!(c.yield_rate > 0 && c.yield_rate <= 100)) errs.push(c.key + ' 出净率越界(需 0<y≤100)：' + c.yield_rate);
    if (!(c.loss_rate >= 0 && c.loss_rate <= 100)) errs.push(c.key + ' 损耗率越界(需 0≤l≤100)：' + c.loss_rate);
    if (!(c.condiment_fen > 0)) errs.push(c.key + ' 调料油火费用需 >0(分)：' + c.condiment_fen);
    if (!Array.isArray(c.sample_lines)) { errs.push(c.key + ' sample_lines 非数组'); continue; }
    for (const s of c.sample_lines) {
      if (!s || !s.name) errs.push(c.key + ' 示例主料缺名');
      if (!(Number(s.qty) > 0)) errs.push(c.key + ' 示例主料用量需 >0：' + (s && s.name));
      if (!units.PURCHASE_UNITS.includes(s.unit)) errs.push(c.key + ' 示例主料单位非法：' + (s && s.unit));
    }
  }
  return errs;
}

module.exports = { CATEGORY_PRESETS, getCategoryPreset, validatePresets, CONDIMENT_NAME };

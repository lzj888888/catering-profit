/**
 * R272 堂食建卡 · 全 20 张卡的「生产引擎复算」校验
 *
 * 铁律：锚点复算必 require 生产引擎（不手算、不靠自述）
 *   engine = cloudfunctions/saveCostCard/service.js::calcCostCard
 *
 * 单位契约（与首批 7 道完全一致）：
 *   · net_unit_cost = 万分/克 整数；行成本(元) = quantity(克) × net_unit_cost ÷ 10000
 *   · 克数填「净料重」；单价已含出成率折损（元/斤 × 2000 ÷ 出成率%）
 *   · 无固定克数的 lump-sum 项（骨汤 / 卤料 / 调味）→ quantity=1，nuc = 元 × 10000
 *   · 全部 input_type=2 手工行（无需先录原料档案）
 *
 * 售价口径：实际成交均价 = 销售额 ÷ 份数（不是菜单定价）
 *
 * ⚠️ 本轮修正（R272 复核发现 v5 数据错误）：
 *   v5「②第二批13道」把耙肥肠（四两）的食材成本写成 16.10 元、毛利 31.2%，
 *   但 16.10 实为 v1「我的估算」；豆包 v2 查证值 = 11.55 元（生肥肠 14.5 元/斤 ÷ 出成 55%）。
 *   以实际售价 23.40 元计，正确毛利率 = 50.6%，不是 31.2%。本脚本按 11.55 修正。
 *
 * 用法： node verify_cards_20.js
 */
const path = require('path');
const fs = require('fs');

const SVC = path.join(__dirname, '../../../cloudfunctions/saveCostCard/service.js');

let calcCostCard = null;
try {
  calcCostCard = require(SVC).calcCostCard;
  console.log('ENGINE_LOADED: production calcCostCard');
} catch (e) {
  console.log('ENGINE_LOAD_FAIL:', e && e.message);
  process.exit(1);
}

// nuc = 净料单位成本（万分/克）
const nuc = (priceYuanPerJin, yieldPct) => Math.round(priceYuanPerJin * 2000 / yieldPct);
// 由「小计元 ÷ 克数」反推 nuc（用于豆包已给出小计的项，保证与查证表逐行对齐）
const nucOf = (yuan, grams) => Math.round(yuan * 10000 / grams);
// lump-sum 固定金额项
const fix = (name, yuan) => ({ name, quantity: 1, net_unit_cost: Math.round(yuan * 10000) });

// 首批用「单价×出成率」推 nuc（与已验的 card_payload.json 一致，保持不动）
const L = (name, quantity, priceJin, yieldPct) => ({
  name, quantity, net_unit_cost: nuc(priceJin, yieldPct),
  _src: `${priceJin}元/斤 出成${yieldPct}%`,
});
// 第二批用「豆包查证的逐行小计 ÷ 克数」反推 nuc —— 逐行对齐查证表，
// 避免小克数调味料（1~9g）在 万分/克 整数化时逐行舍入累积出 1~2 分偏差。
// note 仅作审计留痕（原始单价 / 出成率），不参与计算。
const Y = (name, quantity, yuan, note) => ({
  name, quantity, net_unit_cost: nucOf(yuan, quantity), _src: `${yuan}元 ${note || ''}`,
});

const CARDS = [
  // ===================== 首批 7 道（已验，保持不动） =====================
  { name: '小面', category: '面食', price_fen: 743, expect: 2.53, batch: 1,
    lines: [
      L('水面/碱水面', 100, 3, 100), L('油辣子(辣椒+菜油熬)', 20, 15, 100),
      L('花椒面', 2, 25, 100), L('猪油', 10, 10, 100), L('花生碎', 10, 12, 100),
      L('芽菜/榨菜', 15, 8, 100), L('小葱', 10, 5, 100),
      fix('骨汤(猪骨熬制分摊)', 0.30), fix('酱油/醋/蒜泥水/鸡精', 0.15),
    ] },
  { name: '抄手', category: '面食', price_fen: 1253, expect: 6.13, batch: 1,
    lines: [
      L('抄手皮', 120, 4, 100), L('猪前腿肉馅', 120, 13, 100), L('姜葱水/蛋清', 20, 8, 100),
      L('红油/油辣子', 25, 15, 100), fix('骨汤', 0.35),
      L('花生/芝麻/葱花', 20, 12, 100), fix('盐/味精/胡椒等', 0.15),
    ] },
  { name: '韭叶', category: '面食', price_fen: 716, expect: 4.12, batch: 1,
    lines: [
      L('韭叶面', 130, 4, 100), L('肉臊子(肉末)', 50, 15, 100), L('油辣子', 20, 15, 100),
      fix('骨汤', 0.35), L('花生/芝麻/葱花', 20, 12, 100), fix('盐/酱油/花椒等', 0.15),
    ] },
  { name: '米线', category: '面食', price_fen: 714, expect: 4.08, batch: 1,
    lines: [
      L('鲜米线', 200, 3, 100), L('肉臊子(肉末)', 40, 15, 100), fix('骨汤', 0.40),
      L('酸菜/木耳/豆芽等配菜', 50, 5, 100), L('花生/香菜/葱花', 20, 12, 100),
      fix('辣椒油/盐/鸡精等', 0.30),
    ] },
  { name: '耙牛肉（半斤）', category: '招牌菜', price_fen: 3176, aux_fen: 100, expect: 20.40, batch: 1,
    lines: [ L('生牛肉', 250, 26, 67) ] },
  { name: '耙牛筋（半斤）', category: '招牌菜', price_fen: 3243, aux_fen: 80, expect: 13.44, batch: 1,
    lines: [ L('生牛筋', 250, 22, 87) ] },
  { name: '毛血旺', category: '招牌菜', price_fen: 4133, expect: 19.64, batch: 1,
    lines: [
      L('鸭血/血旺', 300, 4, 100), L('毛肚', 80, 25, 100), L('黄喉', 50, 30, 100),
      L('午餐肉', 80, 14, 100), L('豆芽/粉条/豆皮', 200, 3, 100),
      L('火锅底料/红油', 150, 15, 100), L('干辣椒/花椒(炝油)', 30, 30, 100),
      fix('蒜末/姜葱/调味', 0.50),
    ] },

  // ===================== 第二批 13 道（本轮补齐） =====================
  // 8 小料：蘸料台。豆包注明「顾客自助取用，实际用量常高于标准份」
  { name: '小料', category: '蘸料台', price_fen: 440, expect: 1.51, batch: 2,
    lines: [
      Y('干辣椒面（二荆条）', 10, 0.22, '11元/斤'), Y('花椒面', 2, 0.06, '15元/斤'),
      Y('盐', 2, 0.01, '2元/斤'), Y('味精', 2, 0.03, '8元/斤'),
      Y('花生碎（红皮花生）', 5, 0.09, '9元/斤'), Y('熟白芝麻', 3, 0.05, '7.5元/斤'),
      Y('蒜泥', 12, 0.09, '3.75元/斤'), Y('香油（芝麻油）', 25, 0.90, '18元/斤'),
      Y('醋', 8, 0.06, '4元/斤'),
    ] },
  // 9 耙肥肠（四两）：⚠️ 修正 —— 用豆包 v2 查证 11.55 元，非 v1 估算 16.10 元
  { name: '耙肥肠（四两）', category: '招牌菜', price_fen: 2340, expect: 11.55, batch: 2,
    lines: [
      Y('生肥肠', 200, 10.55, '14.5元/斤 ÷ 出成55%（熟200g←生364g）'),
      fix('卤料+清洗（盐醋面粉耗材）', 1.00),
    ] },
  // 10 泡椒酸菜鱼
  { name: '泡椒酸菜鱼', category: '江湖菜', price_fen: 3360, expect: 19.13, batch: 2,
    lines: [
      Y('活草鱼（整鱼）', 750, 16.50, '11元/斤·双福22元/kg'),
      Y('泡酸菜（挤水净重）', 120, 0.84, '3.5元/斤'),
      Y('泡野山椒', 40, 0.24, '3元/斤'), Y('老姜', 15, 0.05, '1.8元/斤'),
      Y('大蒜', 20, 0.15, '3.75元/斤'), Y('蛋清（上浆）', 30, 0.34, '5.6元/斤'),
      Y('玉米淀粉', 10, 0.05, '2.5元/斤'), Y('菜籽油', 30, 0.36, '6元/斤'),
      Y('猪油', 20, 0.20, '5元/斤'), Y('干红花椒', 2, 0.12, '30元/斤'),
      Y('葱花', 10, 0.03, '1.65元/斤'), fix('盐/味精/鸡精/料酒', 0.25),
    ] },
  // 11 肥肠二两（面食口径）
  { name: '肥肠二两', category: '面食', price_fen: 1600, expect: 6.15, batch: 2,
    lines: [
      Y('碱水面', 150, 0.75, '2.5元/斤'),
      Y('熟肥肠（臊子）', 55, 3.20, '生大肠16元/斤 ÷ 出成55% = 29.09元/斤'),
      Y('油辣子', 40, 0.69, '17.3元/kg'), Y('花椒面', 1, 0.03, '14.35元/斤'),
      Y('味精', 4, 0.02, '4元/kg'), Y('芽菜', 8, 0.08, '4.88元/斤'),
      Y('榨菜末', 7, 0.08, '5.62元/斤'), Y('花生碎', 15, 0.21, '7元/斤'),
      Y('复制酱油', 16, 0.08, '5元/升'), Y('猪油', 10, 0.16, '8元/斤'),
      Y('葱花', 7, 0.06, '4元/斤'), Y('姜蒜水', 18, 0.04, '2元/kg'),
      fix('红烧卤料', 0.30), fix('骨汤', 0.45),
    ] },
  // 12 韭菜炒蛋（韭菜采购240g、净料率90% ⇒ 填净料216g）
  { name: '韭菜炒蛋', category: '炒菜', price_fen: 1600, expect: 3.78, batch: 2,
    lines: [
      Y('韭菜（净料）', 216, 1.54, '3.2元/斤·采购240g净料率90%'),
      Y('鸡蛋（3个）', 165, 1.85, '5.6元/斤'), Y('菜籽油', 25, 0.30, '6元/斤'),
      fix('盐/味精', 0.10),
    ] },
  // 13 肥肠三两（面食口径）
  { name: '肥肠三两', category: '面食', price_fen: 1800, expect: 7.97, batch: 2,
    lines: [
      Y('碱水面', 220, 1.10, '2.5元/斤'),
      Y('熟肥肠（臊子）', 75, 4.36, '29.09元/斤'),
      Y('油辣子', 45, 0.78, '17.3元/kg'), Y('花椒面', 1, 0.04, '14.35元/斤'),
      Y('味精', 5, 0.02, '4元/kg'), Y('芽菜', 10, 0.10, '4.88元/斤'),
      Y('榨菜末', 8, 0.09, '5.62元/斤'), Y('花生碎', 20, 0.28, '7元/斤'),
      Y('复制酱油', 20, 0.10, '5元/升'), Y('猪油', 12, 0.19, '8元/斤'),
      Y('葱花', 9, 0.07, '4元/斤'), Y('姜蒜水', 20, 0.04, '2元/kg'),
      fix('红烧卤料', 0.30), fix('骨汤', 0.50),
    ] },
  // 14 刀削（面食口径）
  { name: '刀削', category: '面食', price_fen: 713, expect: 2.43, batch: 2,
    lines: [
      Y('鲜刀削面', 180, 0.83, '2.3元/斤'), Y('猪精瘦肉末（杂酱臊子）', 40, 1.00, '12.5元/斤'),
      Y('骨汤', 250, 0.25, '1元/kg'), Y('油辣子（辣椒油）', 10, 0.17, '17元/kg'),
      Y('花椒面', 1, 0.03, '15元/斤'), Y('盐', 1, 0.01, '2元/斤'),
      Y('味精', 1, 0.02, '8元/斤'), Y('葱花', 5, 0.04, '3.6元/斤'),
      Y('蒜泥（蒜水）', 5, 0.04, '3.75元/斤'), Y('酱油（生抽）', 5, 0.04, '4元/斤'),
    ] },
  // 15 水煮肉片
  { name: '水煮肉片', category: '江湖菜', price_fen: 3800, expect: 12.29, batch: 2,
    lines: [
      Y('猪精瘦肉', 350, 8.75, '12.5元/斤'), Y('黄豆芽（垫底）', 150, 0.34, '1.13元/斤'),
      Y('大白菜（垫底）', 150, 0.29, '0.95元/斤'), Y('郫县豆瓣酱', 30, 0.36, '6元/斤'),
      Y('干辣椒节', 12, 0.38, '16元/斤'), Y('干红花椒', 6, 0.36, '30元/斤'),
      Y('姜末', 10, 0.04, '1.8元/斤'), Y('蒜末', 20, 0.15, '3.75元/斤'),
      Y('蛋清（上浆）', 30, 0.34, '5.6元/斤'), Y('玉米淀粉', 10, 0.05, '2.5元/斤'),
      Y('菜籽油（炒制+泼油）', 80, 0.96, '6元/斤'), Y('葱花', 10, 0.03, '1.65元/斤'),
      fix('盐/味精/鸡精/生抽', 0.25),
    ] },
  // 16 牛肉滑（火锅涮品，加水率35%）
  { name: '牛肉滑', category: '火锅涮品', price_fen: 1803, expect: 12.59, batch: 2,
    lines: [
      Y('牛后腿肉茸（净料）', 150, 12.15, '40.5元/斤·双福81元/kg'),
      Y('打制清水（加水率35%）', 52, 0.00, '不计价，留痕用'),
      Y('蛋清', 25, 0.28, '5.6元/斤'), Y('红薯淀粉', 12, 0.08, '3.4元/斤'),
      Y('盐', 2, 0.01, '2元/斤'), Y('白胡椒粉', 1, 0.04, '20元/斤'),
      Y('味精/鸡精', 2, 0.03, '8元/斤'),
    ] },
  // 17 杂酱二两（面食口径）
  { name: '杂酱二两', category: '面食', price_fen: 1200, expect: 4.19, batch: 2,
    lines: [
      Y('碱水面', 150, 0.75, '2.5元/斤'),
      Y('杂酱（猪肉末炒后）', 50, 1.24, '24.71元/kg（前腿21元/kg ÷85%）'),
      fix('炒制油+甜面酱/豆瓣', 0.30),
      Y('油辣子', 40, 0.69, '17.3元/kg'), Y('花椒面', 1, 0.03, '14.35元/斤'),
      Y('味精', 4, 0.02, '4元/kg'), Y('芽菜', 8, 0.08, '4.88元/斤'),
      Y('榨菜末', 7, 0.08, '5.62元/斤'), Y('花生碎', 15, 0.21, '7元/斤'),
      Y('复制酱油', 16, 0.08, '5元/升'), Y('猪油', 10, 0.16, '8元/斤'),
      Y('葱花', 7, 0.06, '4元/斤'), Y('姜蒜水', 18, 0.04, '2元/kg'),
      fix('骨汤', 0.45),
    ] },
  // 18 红汤大锅（v2 查证，含牛油涨价）
  { name: '红汤大锅', category: '锅底', price_fen: 1873, expect: 11.58, batch: 2,
    lines: [
      Y('牛油', 300, 3.90, '6.5元/斤'), Y('干辣椒', 80, 2.08, '13元/斤'),
      Y('花椒', 40, 2.00, '25元/斤'), Y('豆瓣酱', 80, 0.80, '5元/斤'),
      Y('火锅香料', 30, 1.80, '30元/斤'), Y('姜蒜醪糟冰糖', 500, 1.00, '1元/斤'),
    ] },
  // 19 牛肉三两（面食口径，冻牛腩出成60%）
  { name: '牛肉三两', category: '面食', price_fen: 1800, expect: 10.66, batch: 2,
    lines: [
      Y('碱水面', 220, 1.10, '2.5元/斤'),
      Y('熟牛腩（红烧）', 75, 6.88, '91.67元/kg（冻牛腩55元/kg ÷ 出成60%）'),
      fix('红烧卤料', 0.50),
      Y('油辣子', 45, 0.78, '17.3元/kg'), Y('花椒面', 1, 0.04, '14.35元/斤'),
      Y('味精', 5, 0.02, '4元/kg'), Y('芽菜', 10, 0.10, '4.88元/斤'),
      Y('榨菜末', 8, 0.09, '5.62元/斤'), Y('花生碎', 20, 0.28, '7元/斤'),
      Y('复制酱油', 20, 0.10, '5元/升'), Y('猪油', 10, 0.16, '8元/斤'),
      Y('葱花', 9, 0.07, '4元/斤'), Y('姜蒜水', 20, 0.04, '2元/kg'),
      fix('骨汤', 0.50),
    ] },
  // 20 蛋炒饭
  { name: '蛋炒饭', category: '主食', price_fen: 1000, expect: 1.76, batch: 2,
    lines: [
      Y('生大米（本地籼米）', 140, 0.48, '1.7元/斤'), Y('鸡蛋（1.5个）', 80, 0.90, '5.6元/斤'),
      Y('葱花', 15, 0.05, '1.65元/斤'), Y('菜籽油', 20, 0.24, '6元/斤'),
      fix('盐/味精', 0.10),
    ] },
];

console.log('\n--- 生产引擎 calcCostCard 逐卡复算（共 ' + CARDS.length + ' 张） ---');
let allPass = true;
let b1Pass = 0, b2Pass = 0;
const payloads = [];
const rows = [];
for (const c of CARDS) {
  const r = calcCostCard({
    mode: 'A',
    lines: c.lines,
    auxFen: c.aux_fen || 0,
    lossPct: 0,
    batchOutput: 0,
    priceFen: c.price_fen,
    targetMarginPct: 0,
  });
  const costYuan = r.unit_cost_fen / 100;
  const diff = Math.abs(costYuan - c.expect);
  const pass = diff <= 0.02;
  if (!pass) allPass = false;
  if (pass) { if (c.batch === 1) b1Pass++; else b2Pass++; }
  console.log(
    `${pass ? 'OK  ' : 'FAIL'} ${String(c.name).padEnd(16)} 引擎=${costYuan.toFixed(2)}元 ` +
    `查证=${c.expect.toFixed(2)}元 差=${diff.toFixed(3)} | 售价=${(c.price_fen / 100).toFixed(2)}元 ` +
    `毛利=${r.gross_margin_pct}%`
  );
  payloads.push({
    name: c.name,
    category: c.category || '',
    lines: c.lines.map(l => ({ input_type: 2, name: l.name, quantity: l.quantity, net_unit_cost: l.net_unit_cost })),
    price_fen: c.price_fen,
    aux_fen: c.aux_fen || 0,
    engine_cost_fen: r.unit_cost_fen,
    engine_margin_pct: r.gross_margin_pct,
    check_cost_yuan: c.expect,
  });
  rows.push({
    批次: c.batch === 1 ? '首批' : '第二批',
    菜名: c.name, 类别: c.category || '', 售价元: +(c.price_fen / 100).toFixed(2),
    查证成本元: c.expect, 引擎成本元: +costYuan.toFixed(2),
    差: +diff.toFixed(3), 毛利率: r.gross_margin_pct, 校验: pass ? 'OK' : 'FAIL',
  });
}
console.log(`\nALL_PASS: ${allPass}  | 首批 ${b1Pass}/7  第二批 ${b2Pass}/13`);

if (allPass) {
  const out = path.join(__dirname, 'card_payload_20.json');
  fs.writeFileSync(out, JSON.stringify(payloads, null, 2), 'utf8');
  console.log('PAYLOAD_SAVED:', out);
  fs.writeFileSync(path.join(__dirname, '_verify_rows.json'), JSON.stringify(rows, null, 2), 'utf8');
} else {
  console.log('PAYLOAD_NOT_SAVED（有卡未对上，先修数据）');
}
process.exit(allPass ? 0 : 1);

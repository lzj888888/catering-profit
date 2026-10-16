#!/usr/bin/env node
// review/evidence/r298x_m3/mutate_r298x.js —— R298X 单点变异器
//
// 用法：node review/evidence/r298x_m3/mutate_r298x.js <MUT_ID>
//   把 <MUT_ID> 对应的**单点**改动写进工作树（**就地改**，由 mutation_proof_r298x.sh 用 trap 还原）。
//   🔴 替换字符串**必须**逐字命中，未命中即 exit 2 —— 否则「变异没打上」会被误读成
//      「守卫抓不到」，那是本仓反复出现的「探测器坏了与命中 0 长得一样」。
//
// 设计纪律（沿用 r298w_idem 那轮）：
//   · 一次只改一处（单点），便于把红点精确归因到某条判据；
//   · 不引入新文件、不删文件（避免触发与本次无关的门禁）；
//   · 全部用 fs 读写字符串，不用 shell 重定向（避免 Windows/CRLF 干扰）。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

// 三组守卫各自至少两条变异：一条「复现修前缺陷」，一条「削弱判据本身」。
const MUTS = {
  // ===== A 组：recon 抑制文案（tools/selftest_m3_recon.js）=====
  A1: {
    desc: '复现修前缺陷：单源把 menu_no_price 又映射回「覆盖率不足」文案',
    file: 'utils/reconDerive.js',
    find: "if (r === 'menu_no_price') return 'reconSuppressNoPrice';",
    repl: "if (r === 'menu_no_price') return 'reconSuppressCoverage';",
    expect: 'R298X-③',
  },
  A2: {
    desc: '页面退回内联分派（把 reason→文案 的判定搬回页面）',
    file: 'pages/recon/index.js',
    find: "        suppressText = TERMS.card[suppressKeyOf(rec, actual.reason)] || TERMS.card.reconSuppressGeneric;",
    repl: "        if (rec.reason === 'coverage_missing') suppressText = TERMS.card.reconSuppressNoCount;\n"
      + "        else if (rec.reason === 'menu_no_price') suppressText = TERMS.card.reconSuppressCoverage;\n"
      + "        else suppressText = TERMS.card.reconSuppressGeneric;",
    expect: 'R298X-⑩',
  },
  A3: {
    desc: '文案串味：把「没填售价」的文案改写成覆盖率口径',
    file: 'miniprogram/i18n/terms.js',
    find: "reconSuppressNoPrice: '菜品成本卡还没填售价，算不出标准菜单毛利率。请到菜品成本里把售价补上。',",
    repl: "reconSuppressNoPrice: '覆盖率不足（<60%），差值可能失真，暂不显示。',",
    expect: 'R298X-⑥',
  },

  // ===== B 组：switch key 跨函数同源（cloudfunctions/getShopContext/selftest.js）=====
  B1: {
    desc: '读侧同名键值改坏（menuDishCount 少一个字符）',
    file: 'cloudfunctions/getShopContext/service.js',
    find: "menuDishCount: 'm3_menu_dish_count' }",
    repl: "menuDishCount: 'm3_menu_dish_count_x' }",
    expect: 'R298X-J1',
  },
  B2: {
    desc: '削弱判据：把缺键登记表清空（= 让漂移重新变成"没声明的不对称"）',
    file: 'cloudfunctions/getShopContext/selftest.js',
    find: "const READ_ABSENT = {\n  buffetFoodCostTotal: 'getShopContext 不读该键：消费方是 getDishReview（直读 shop_switch），读侧无需声明。',\n};",
    repl: "const READ_ABSENT = {};",
    expect: 'R298X-J2',
  },
  B3: {
    desc: '新造一个未注册的 switch 键字面量（藏在别的云函数里）',
    file: 'cloudfunctions/getAmortSchedule/index.js',
    find: "  const amortizeSwitchOn = !!((swRows.find((r) => r.switch_key === 'amortize_switch') || {}).enabled);",
    repl: "  const _m3BrandNew = 'm3_brand_new_key';   // 变异注入\n"
      + "  const amortizeSwitchOn = !!((swRows.find((r) => r.switch_key === 'amortize_switch' || r.switch_key === _m3BrandNew) || {}).enabled);",
    expect: 'R298X-J3d',
  },
  B4: {
    desc: '破坏"键必须被引用"：把写侧对 buffetFoodCostTotal 的常量引用换成裸字面量（= 死键）',
    file: 'cloudfunctions/saveShopSetting/index.js',
    find: "    const key = SWITCH_KEYS.buffetFoodCostTotal;",
    repl: "    const key = 'm3_buffet_food_cost_total';",
    expect: 'R298X-J4',
  },

  // ===== C 组：下拉刷新「钩子 ⇒ 开关」（tools/check_pages.js ⑥）=====
  C1: {
    desc: '复现修前形态：给 recon 页加回死钩子（其 json 的 enablePullDownRefresh 是 false）',
    file: 'pages/recon/index.js',
    find: "    this.setData({ saving: false });\n  },\n});",
    repl: "    this.setData({ saving: false });\n  },\n\n  onPullDownRefresh() { this.load(); },\n});",
    expect: '⑥',
  },
  C2: {
    desc: '反向（守卫不得误伤）：C1 之后再把该页 json 的开关打开 ⇒ 应恢复绿',
    file: 'pages/recon/index.json',
    find: '"enablePullDownRefresh": false',
    repl: '"enablePullDownRefresh": true',
    expect: '',
  },
};

const id = process.argv[2];
const mut = MUTS[id];
if (!mut) {
  console.error('未知变异 id：' + id + '（可用：' + Object.keys(MUTS).join(' / ') + '）');
  process.exit(3);
}
const p = path.join(ROOT, mut.file);
if (!fs.existsSync(p)) {
  console.error('❌ 目标文件不存在：' + mut.file);
  process.exit(2);
}
const src = fs.readFileSync(p, 'utf8');
const n = src.split(mut.find).length - 1;
if (n !== 1) {
  // 0 次 = 变异没打上（会把"打不上"误读成"守卫抓不到"）；>1 次 = 命中不唯一（可能改错处）
  console.error(`❌ 替换未唯一命中（命中 ${n} 次）：${mut.file}`);
  process.exit(2);
}
fs.writeFileSync(p, src.split(mut.find).join(mut.repl));
console.log(`✔ [${id}] ${mut.desc}\n   文件：${mut.file}\n   期望红在：${mut.expect || '（应保持全绿）'}`);

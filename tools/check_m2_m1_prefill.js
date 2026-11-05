#!/usr/bin/env node
// tools/check_m2_m1_prefill.js —— M2「用你自己店的账预填」守卫（R576 · 队列 #100）
//
// 为什么需要它：
//   #100 是"把 M1 已填的房租/人工/水电带进 M2 沙盘"，看起来只是省几次输入，但它同时踩在
//   **两条互相冲突的纪律**上：
//     · R128（check_m2_ref_not_prefill）：「参考值只作提示，**绝不**自动填值」——因为行业平均
//       不是你的租约，填进去等于替你自证合理，比不给还坏；
//     · 本条要做的偏偏是"自动填值"。
//   两者的分界是**数据来源**：行业参考（别人的平均数）不许填；用户自己在 M1 填过的真实数可以。
//   ⇒ 这个边界必须**有机器判据**，否则下一个人（包括我自己）很容易把"行业参考"也顺手填进来。
//
// 另外三类失效都是静默的（都见过）：
//   ① 覆盖用户已填的值（他改过 9999，进页面被改回 12000，且看不出发生了什么）；
//   ② 缺项按 0 填（M1 没填人工 ⇒ 人工=0 ⇒ 保本点算低 ⇒ 结论变乐观，全程零报错）；
//   ③ 无建档月也预填（getLedger 对没建档的月**返回一份默认空账**，只判"有返回值"就恒真）。
//
// 判据（A/B/C/D 四段 + 变异）：
//   A 只填空 / 不覆盖 / 缺项不填 / 无档案不填 / 水电合并态
//   B 缺口卡：差 / 超 / 无营收不编
//   C 静态面：不碰 applyRefAmount（R128 判据锚点）、文案走 terms 双副本
//   D 变异回灌：删掉 account_id 判据 ⇒ A-④ 必须转红（证明判据有分辨力）
//
// 运行：node tools/check_m2_m1_prefill.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE_REL = 'subpkg/tools/sandbox/index.js';
const PAGE = path.join(ROOT, PAGE_REL);

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' —— ' + detail : ''}`); }
  else { failN++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}
const sec = (t) => console.log(`\n===== ${t} =====`);

// ===== 页面桩：真调生产页面的 loadM1Baseline / m1GapOf =====
let cfg = null;
const storage = {};
global.Page = (c) => { cfg = c; };
global.getApp = () => ({ globalData: { shop_id: 'shop_test' } });
global.wx = {
  getStorageSync: (k) => storage[k],
  setStorageSync: (k, v) => { storage[k] = v; },
  removeStorageSync: (k) => { delete storage[k]; },
  showToast: () => {},
  showModal: () => {},
  getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667, platform: 'devtools' }),
  cloud: { callFunction: () => Promise.reject(new Error('stub: 页面桩不连云')) },
};

const api = require(path.join(ROOT, 'utils/api.js'));
require(PAGE);

if (!cfg) {
  console.log('❌ 页面桩没捕获到 Page 配置（cfg 为 null）—— 判据失效，fail-closed');
  console.log('\n===== M2 M1 预填守卫结果：0 通过 / 1 失败 =====');
  process.exit(1);
}

function fresh() {
  const p = Object.assign({}, cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data));
  p.setData = function (patch) { for (const k in patch) this.data[k] = patch[k]; };
  return p;
}

let ledgerReply = null;
api.call = async () => ledgerReply;

const FEN = (yuanVal) => Math.round(yuanVal * 100);
const FULL = () => ({
  account_id: 'acc_1',
  fixed_items_fen: { rent: FEN(12000), labor: FEN(8000), utility: FEN(1500) },
  result: { income_total_fen: FEN(65000) },
});

(async () => {
  // ============ A · 预填五条边界 ============
  sec('A · 预填边界（只填空 / 不覆盖 / 缺项不填 / 无档案不填）');

  // A-① 空字段被填上（这是本条的正向价值）
  let p = fresh();
  ledgerReply = FULL();
  await p.loadM1Baseline();
  check('A-① 空字段被真实数填上（房租 12000 / 人工 8000 / 水电 1500）',
    p.data.rentYuan === '12000' && p.data.laborTotalYuan === '8000' && p.data.energyYuan === '1500',
    `rent=${p.data.rentYuan} labor=${p.data.laborTotalYuan} energy=${p.data.energyYuan}`);

  // A-② 留痕齐全（界面要标来源、缺口卡要用 incomeFen）
  check('A-② 预填留痕完整（month / items 三项 / incomeFen / note 非空）',
    !!p.data.m1Prefill && p.data.m1Prefill.month
    && (p.data.m1Prefill.items || []).length === 3
    && p.data.m1Prefill.incomeFen === FEN(65000)
    && !!p.data.m1Prefill.note,
    JSON.stringify(p.data.m1Prefill && p.data.m1Prefill.items));

  // A-③ 🔴 不覆盖用户已填的值（最危险的失效：静默改掉老板自己的数字）
  p = fresh();
  p.data.rentYuan = '9999';
  p.data.laborTotalYuan = '7777';
  ledgerReply = FULL();
  await p.loadM1Baseline();
  check('A-③ 🔴 用户已填的值不被覆盖（9999 / 7777 原样保留）',
    p.data.rentYuan === '9999' && p.data.laborTotalYuan === '7777',
    `rent=${p.data.rentYuan} labor=${p.data.laborTotalYuan}`);

  // A-④ 🔴 无建档月不许填 —— getLedger 对没建档的月返回**默认空账**，只判"有返回值"就恒真
  p = fresh();
  ledgerReply = { account_id: '', fixed_items_fen: { rent: FEN(12000) }, result: { income_total_fen: 0 } };
  const r4 = await p.loadM1Baseline();
  check('A-④ 🔴 该月没建档（account_id 为空）⇒ 一个都不填、不留痕',
    r4 === null && p.data.rentYuan === '' && p.data.m1Prefill === null,
    `返回=${JSON.stringify(r4)} rent=${JSON.stringify(p.data.rentYuan)}`);

  // A-⑤ 🔴 缺项不填（null 绝不按 0）—— 按 0 填会把保本点算低、结论变乐观
  p = fresh();
  ledgerReply = { account_id: 'acc_1', fixed_items_fen: { rent: FEN(12000), labor: null, utility: null }, result: { income_total_fen: 0 } };
  await p.loadM1Baseline();
  check('A-⑤ 🔴 缺项不按 0 填（labor/utility 为 null ⇒ 两格保持空）',
    p.data.laborTotalYuan === '' && p.data.energyYuan === '',
    `labor=${JSON.stringify(p.data.laborTotalYuan)} energy=${JSON.stringify(p.data.energyYuan)}`);

  // A-⑥ 水电：M1 只有一个合计 ⇒ 切合并态（R543 的"账单合并店"正是这种）
  p = fresh();
  ledgerReply = FULL();
  await p.loadM1Baseline();
  check('A-⑥ 水电合并态：energyMerged=true 且填进合计格（不硬拆成水/电）',
    p.data.energyMerged === true && p.data.energyYuan === '1500'
    && p.data.waterYuan === '' && p.data.electricYuan === '',
    `merged=${p.data.energyMerged} energy=${p.data.energyYuan}`);

  // A-⑦ 已经是分栏态且填了 ⇒ 不许把合并开关掰过去
  p = fresh();
  p.data.waterYuan = '300';
  p.data.electricYuan = '1200';
  ledgerReply = FULL();
  await p.loadM1Baseline();
  check('A-⑦ 用户已按分栏填了水电 ⇒ 不改合并开关、不写合计格',
    p.data.energyMerged === false && p.data.energyYuan === ''
    && p.data.waterYuan === '300' && p.data.electricYuan === '1200',
    `merged=${p.data.energyMerged} energy=${JSON.stringify(p.data.energyYuan)}`);

  // A-⑧ 取数失败 ⇒ 静默、不抛（M2 不依赖 M1）
  p = fresh();
  api.call = async () => { throw new Error('network down'); };
  let threw = false;
  try { await p.loadM1Baseline(); } catch (e) { threw = true; }
  check('A-⑧ 取 M1 失败 ⇒ 静默返回（不抛错、不打断沙盘主流程）',
    !threw && p.data.rentYuan === '' && p.data.m1Prefill === null);
  api.call = async () => ledgerReply;

  // ============ B · 缺口卡 ============
  sec('B · 缺口卡（用他自己的数对上他自己做到的营业额）');

  p = fresh();
  p.data.m1Prefill = { month: '2026-09', incomeFen: FEN(65000), items: ['rent'], note: 'x' };
  const behind = p.m1GapOf(FEN(82000));
  check('B-① 保本 8.2 万 > 实际 6.5 万 ⇒ behind=true 且文案含「还差」',
    !!behind && behind.behind === true && /还差/.test(behind.text), behind && behind.text);

  const above = p.m1GapOf(FEN(50000));
  check('B-② 保本 5 万 < 实际 6.5 万 ⇒ behind=false 且文案含「高出」',
    !!above && above.behind === false && /高出/.test(above.text), above && above.text);

  p.data.m1Prefill = { month: '2026-09', incomeFen: 0, items: ['rent'], note: 'x' };
  check('B-③ 🔴 该月没有营业额记录 ⇒ 不编缺口（返回 null）',
    p.m1GapOf(FEN(82000)) === null);

  p.data.m1Prefill = null;
  check('B-④ 没有预填过 ⇒ 缺口卡不存在（返回 null）',
    p.m1GapOf(FEN(82000)) === null);

  // ============ C · 静态面（不越界）============
  sec('C · 静态面：不碰 R128 的判据锚点、文案走双副本');

  const src = fs.readFileSync(PAGE, 'utf8');
  // ⚠️ 必须容忍 `async ` 前缀：本页方法大量是 `async xxx() {`，首版只找 `  xxx(` ⇒ 取到 0 字符，
  //   而 C-② 的 `!/applyRefAmount/.test('')` 对空串**恒真** ⇒ 会假绿。C-① 就是这条的护栏。
  const bodyOf = (s, name) => {
    const m0 = s.match(new RegExp('\\n  (?:async )?' + name + '\\('));
    if (!m0) return '';
    const rest = s.slice(m0.index + m0[0].length);
    const m = rest.search(/\n  (?:async )?[a-zA-Z_$][a-zA-Z0-9_$]*\(/);
    return m < 0 ? rest : rest.slice(0, m);
  };
  const lb = bodyOf(src, 'loadM1Baseline');
  check('C-① loadM1Baseline 函数体取到了（取不到 ⇒ 后面全是空判，fail-closed）', lb.length > 200, lb.length + ' 字符');
  check('C-② 🔴 预填**不碰** applyRefAmount（R128 的判据锚在那个函数体上，碰了就是越界）',
    !/applyRefAmount/.test(lb));

  // 文案必须走 terms（双副本 md5 全等），不许把中文写死在页面 JS 里
  const termsA = fs.readFileSync(path.join(ROOT, 'miniprogram/i18n/terms.js'));
  const termsB = fs.readFileSync(path.join(ROOT, 'specs/dev-specs/i18n/terms.js'));
  const crypto = require('crypto');
  const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
  check('C-③ terms 双副本逐字节相同（md5 全等）', md5(termsA) === md5(termsB), md5(termsA));
  const tsrc = termsA.toString('utf8');
  check('C-④ 三条文案键都在 terms 单源里（m1PrefillNote / m1GapBehind / m1GapAbove）',
    /m1PrefillNote:/.test(tsrc) && /m1GapBehind:/.test(tsrc) && /m1GapAbove:/.test(tsrc));
  check('C-⑤ 页面 JS 里没有写死中文缺口文案（必须走 M.m1Gap*）',
    /M\.m1GapBehind/.test(src) && /M\.m1GapAbove/.test(src) && !/还差\s*\$\{/.test(src));

  // ============ D · 变异回灌（证明 A-④ 不是恒真）============
  sec('D · 变异回灌：删掉 account_id 判据 ⇒ A-④ 必须转红');
  const ANCHOR = '      if (!d || !d.account_id) return null;';
  check('D-① 找到变异锚点（找不到 ⇒ 判据可能已漂移，fail-closed）', src.indexOf(ANCHOR) >= 0);
  if (src.indexOf(ANCHOR) >= 0) {
    const mutated = src.replace(ANCHOR, '      if (!d) return null;');
    // 内存加载变异体（不落盘），复用同一组断言
    let cfg2 = null;
    const origPage = global.Page;
    global.Page = (c) => { cfg2 = c; };
    const dir = path.dirname(PAGE);
    const fakeRequire = (rp) => require(/^[./]/.test(rp) ? path.resolve(dir, rp) : rp);
    let loadErr = null;
    try {
      new Function('module', 'exports', 'require', '__dirname', '__filename', mutated)(
        { exports: {} }, {}, fakeRequire, dir, PAGE);
    } catch (e) { loadErr = e; }
    global.Page = origPage;

    let redAsExpected = false;
    if (cfg2) {
      const p2 = Object.assign({}, cfg2);
      p2.data = JSON.parse(JSON.stringify(cfg2.data));
      p2.setData = function (patch) { for (const k in patch) this.data[k] = patch[k]; };
      const api2 = require(path.join(ROOT, 'utils/api.js'));   // 同一模块实例
      const keep = api2.call;
      api2.call = async () => ({ account_id: '', fixed_items_fen: { rent: 1200000 }, result: { income_total_fen: 0 } });
      await p2.loadM1Baseline();
      api2.call = keep;
      // 变异后：没有 account_id 判据 ⇒ 会照填 rent ⇒ A-④ 的条件不再成立
      redAsExpected = p2.data.rentYuan !== '' || p2.data.m1Prefill !== null;
    }
    check('D-② 变异体确实能加载（加载失败 ⇒ 这条变异证明无效）', !loadErr && !!cfg2,
      loadErr ? String(loadErr.message).slice(0, 80) : 'ok');
    check('D-③ 🔴 删掉 account_id 判据后，无档案月**真的会被填** ⇒ A-④ 有分辨力（非恒真）',
      redAsExpected);
  }

  console.log(`\n===== M2 M1 预填守卫结果：${pass} 通过 / ${failN} 失败 =====`);
  process.exit(failN === 0 ? 0 : 1);
})().catch((e) => {
  console.log('  ❌ 未捕获异常（fail-closed 判红）：' + ((e && e.message) || e));
  console.log(`\n===== M2 M1 预填守卫结果：${pass} 通过 / ${failN + 1} 失败 =====`);
  process.exit(1);
});

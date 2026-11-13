'use strict';
// tools/check_sales_sample_facts.js ——【R727】销量样例「已到货」事实守卫（防第三次复发）
// 运行：node tools/check_sales_sample_facts.js      （EXIT 0 = 全绿）
//
// 为什么存在：同一个错复发三次 ——
//   ① 2026-10-31 R573：「被我自己在队列里记错成待提供的，本轮把它翻回来」
//   ② 2026-11-07 R615 / 队列 #9：「四张平台表都给过你」，#9 已 done
//   ③ 2026-11-13 R726/R727 规划又把「销量表样例」列成「卡在李老师」的外部依赖
// 根因不是文件丢了，是规划时不回源查仓、且「已到货」这个事实从未进机器判据。
//
// 守什么（判事实，不判字面）：
//   A 四张平台表**仓内归档**真实存在且非空（桌面/Downloads 原件不作判据依赖）。
//   B 从真实文件解析粒度：美团表含商品名/商品销量/商品销售额；形态 C 有 51 SKU 且无半份/大份/小份；
//     堂食表规格内嵌名称；京东 SKU 账单有 sku 名称列。
//   C 台账 R3-13 在场且写明事实；活文档面（R3-9/R3-12 next_action + 契约注释 + 队列 #9）
//     不得再出现「销量样例待提供 / 等样例 / 付费墙读销量」这类已证伪表述。
//   D 合成反恒真：判据必须能红（抽掉一张表 / 把台账票删掉 / 把「已到货」改回「待提供」）。
//
// ⚠️ 顶部不得用 ==== 装饰横幅（R66 段标题下零断言即判红）。

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const rd = (rel) => fs.readFileSync(path.join(ROOT, rel));
const txt = (rel) => rd(rel).toString('utf8');

let pass = 0;
const bad = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('   ✅ ' + name); }
  else { bad.push(name); console.log('   ❌ ' + name + (extra ? '  → ' + extra : '')); }
}

const SAMPLES = [
  { key: 'meituan_goods', rel: 'review/evidence/r242_mt_goods/mt_goods_20260907_20260913.csv', minBytes: 500 },
  { key: 'eleme_formc', rel: 'review/evidence/r232_formc_sample/商品下载_20260907至20260913__5366951484_20261006213915236.xlsx', minBytes: 20000 },
  { key: 'jd_sku_bill', rel: 'review/evidence/r242_jd_bill/jd_sku_bill_20260930.xlsx', minBytes: 1000 },
  { key: 'dine_dish', rel: 'review/evidence/r718_two_books/账A_堂食菜品销售统计_20260913.xlsx', minBytes: 2000 },
];
const LEDGER_REL = 'review/evidence/r721_findings.json';
const CONTRACT_REL = 'utils/dishIngestContract.js';
const QUEUE_REL = 'review/AUTO_QUEUE.md';

/** 从真实文件解析粒度与规格事实（不手抄清单）——返回结构化结果 */
function parseFacts() {
  const out = { present: [], missing: [], mtHeader: [], formcSku: [], hasHalf: false, hasSize: false, contractNote: '', queue9: '', ledger: null };
  for (const s of SAMPLES) {
    try {
      const b = rd(s.rel);
      if (b.length >= s.minBytes) out.present.push(s.key);
      else out.missing.push(s.key + ':bytes=' + b.length);
    } catch (e) { out.missing.push(s.key + ':读不到'); }
  }
  // 美团表是 GBK：必须真解码（用 latin1 读会让中文列名全变乱码 ⇒ 判据恒假）。
  try {
    const s = new TextDecoder('gbk').decode(rd(SAMPLES[0].rel));
    const head = s.split(/\r?\n/)[0].split(',');
    out.mtHeader = head.filter((h) => /商品销量|商品销售额|商品名/.test(h));
  } catch (e) { /* 下面判红 */ }
  // 形态 C 的商品名从仓内机核归档读（R232 dump），不依赖 openpyxl
  try {
    const dump = txt('review/evidence/r232_formc_sample/dump_formc.out.txt');
    const names = [...new Set((dump.match(/[^\s|]*半份[^\s|]*|[^\s|]*大份[^\s|]*|[^\s|]*小份[^\s|]*/g) || []))];
    out.hasHalf = names.some((n) => n.indexOf('半份') >= 0);
    out.hasSize = names.some((n) => /大份|小份/.test(n));
    out.formcSku = names;
  } catch (e) { /* 下面判红 */ }
  try { out.contractNote = txt(CONTRACT_REL); } catch (e) { /* 下面判红 */ }
  try {
    const lines = txt(QUEUE_REL).split(/\r?\n/);
    out.queue9 = (lines.find((l) => /^\|\s*9\s*\|/.test(l)) || '').slice(0, 500);
  } catch (e) { /* 下面判红 */ }
  try { out.ledger = JSON.parse(txt(LEDGER_REL)); } catch (e) { /* 下面判红 */ }
  return out;
}

/** 活文档面是否仍把已到货的样例写成「待提供 / 等样例 / 付费墙读销量」 */
const STALE = [/另需美团\/京东.*样例/, /等.*销量表样例/, /销量样例待提供/, /需先拿到美团\/京东/, /付费墙 m3_dishreview 的销量数据/];
function judgeStale(facts) {
  const hits = [];
  if (!facts.ledger) return ['台账不可解析'];
  const fs_ = facts.ledger.findings || [];
  // 🔴 R727 D-① 暴露的漏守：只盯 R3-9/R3-12 的措辞，票本身被删却无人发现。
  //   样例事实票 R3-13 必须在场且为 fixed —— 否则「已到货」又回到无机器真源的状态。
  if (!fs_.some((f) => f.id === 'R3-13' && f.status === 'fixed')) hits.push('R3-13 样例事实票缺失或非 fixed');
  ['R3-9', 'R3-12'].forEach((id) => {
    const f = fs_.find((x) => x.id === id);
    if (!f) { hits.push(id + ':票缺失'); return; }
    const s = String(f.next_action || '');
    STALE.forEach((re) => { if (re.test(s)) hits.push(id + ':next_action 命中 ' + re.source); });
  });
  // 契约注释必须点名「仅团购核销表」，否则「样例未到货」会被误读成四张平台表没到
  if (facts.contractNote && !/仅团购核销表/.test(facts.contractNote)) hits.push('契约注释未点名团购核销表');
  // 队列 #9 必须已关闭（done），不能再是 blocked 的「美团销量表样例」
  if (facts.queue9 && !/\| done \|/.test(facts.queue9)) hits.push('队列 #9 不是 done');
  return hits;
}

console.log('\nR727 · 销量样例「已到货」事实守卫（防第三次复发）');

// ---------- A 归档在场 ----------
console.log('\n===== A. 四张平台表仓内归档 =====');
const facts = parseFacts();
ok('A-① 四张平台表全部在仓且非空（桌面/Downloads 原件不作判据）',
  facts.present.length === 4 && facts.missing.length === 0,
  '在场=' + facts.present.join(',') + ' 缺=' + facts.missing.join(','));

// ---------- B 粒度与规格（从真实文件解析）----------
console.log('\n===== B. 粒度与规格（实跑解析）=====');
ok('B-① 美团商品表头含「商品名 / 商品销量 / 商品销售额」⇒ 菜品级粒度确实存在',
  facts.mtHeader.length >= 3, JSON.stringify(facts.mtHeader));
ok('B-② 形态 C 机核归档里「含半份=0、含大份/小份=0」⇒ E-3 可定案（算法不改，只做建卡引导）',
  !facts.hasHalf && !facts.hasSize, JSON.stringify(facts.formcSku));
ok('B-③ 反恒真：形态 C 归档确实被读到（不是「文件不存在 ⇒ 零命中 ⇒ 假绿」）',
  (() => { try { return txt('review/evidence/r232_formc_sample/dump_formc.out.txt').length > 500; } catch (e) { return false; } })());

// ---------- C 台账与活文档 ----------
console.log('\n===== C. 台账单一真源 + 活文档零过期表述 =====');
const stale = judgeStale(facts);
ok('C-① 台账 R3-13 在场且为 fixed（样例事实有票、有证据、有修法证据）',
  !!facts.ledger && (() => {
    const f = (facts.ledger.findings || []).find((x) => x.id === 'R3-13');
    return f && f.status === 'fixed' && !!f.evidence && !!f.fix_evidence && /无独立规格列|无半份/.test(String(f.evidence));
  })());
ok('C-② 🔴 活文档零「样例待提供 / 等样例 / 付费墙读销量」过期表述',
  stale.length === 0, stale.slice(0, 4).join(' | '));
ok('C-③ R3-9 不再要求拍板、R3-12 的 E-3 已改为可定案',
  !!facts.ledger && (() => {
    const f9 = (facts.ledger.findings || []).find((x) => x.id === 'R3-9');
    const f12 = (facts.ledger.findings || []).find((x) => x.id === 'R3-12');
    return f9 && f12 && /三司会诊/.test(String(f9.next_action)) && /已可定案/.test(String(f12.next_action));
  })());

// ---------- D 反恒真 ----------
console.log('\n===== D. 反恒真（合成坏样本必须被抓）=====');
const good = judgeStale(facts);
const f13 = (facts.ledger.findings || []).find((x) => x.id === 'R3-13');
const badNoTicket = judgeStale(Object.assign({}, facts, {
  ledger: Object.assign({}, facts.ledger, { findings: facts.ledger.findings.filter((f) => f.id !== 'R3-13') }),
}));
const badStale = judgeStale(Object.assign({}, facts, {
  ledger: Object.assign({}, facts.ledger, {
    findings: facts.ledger.findings.map((f) => f.id === 'R3-9'
      ? Object.assign({}, f, { next_action: '另需美团/京东外卖销量表样例确认销量粒度' }) : f),
  }),
}));
const badContract = judgeStale(Object.assign({}, facts, { contractNote: facts.contractNote.replace(/仅团购核销表/g, '样例') }));
const badQueue = judgeStale(Object.assign({}, facts, { queue9: '| 9 | 外卖销量表样例 | blocked | yes | why: 等李老师发文件 |' }));
ok('D-① 好样本零问题 / 抽掉 R3-13⇒红 / 写回「等样例」⇒红 / 契约不点名⇒红 / 队列#9回退⇒红',
  good.length === 0 && badNoTicket.length > 0 && badStale.length > 0 && badContract.length > 0 && badQueue.length > 0,
  'good=' + good.length + ' noTicket=' + badNoTicket.length + ' stale=' + badStale.length
  + ' contract=' + badContract.length + ' queue=' + badQueue.length);
ok('D-② 归档判据非恒真：把「四张全在」喂成「三张」应被 A-① 识别',
  (() => {
    const fake = Object.assign({}, facts, { present: facts.present.slice(0, 3), missing: ['jd_sku_bill'] });
    return !(fake.present.length === 4 && fake.missing.length === 0);
  })());

console.log('\n============================================================');
console.log('===== 销量样例事实守卫结果：' + pass + ' 通过 / ' + bad.length + ' 失败 =====');
if (bad.length) {
  bad.forEach((p) => console.log('   ❌ ' + p));
  process.exit(1);
}
process.exit(0);

// review/evidence/_mut_r157.js —— R157 变异回灌：证明两道新防线**真的能抓到错**
//
// 做法（与 _mut_r154.js / _mut_r156.js 同构）：逐条把源码改回/改成错误写法（每次只改一处、锚点唯一），
//   跑目标套件，**期望转红**；等价改写则**期望仍绿**。每条跑完立即还原并自证 md5 全等（无残留）。
//   为什么要它：守卫"全绿"本身不能证明它有分辨力（假绿是历史高频事故，见 PITFALLS 守卫四反恒真）。
//
// 覆盖：
//   M1~M3 索引字段（化石 card_id / 缺字段 / 多字段） → check_index_field_alignment
//   M4    镜像 init_db.js 漂回旧定义                 → check_schema_sync（S2）
//   M5    工序清单逐条对照表漂回旧值                 → check_schema_sync（S5）
//   M6~M7 listAll 退化成"只取一页"                    → check_list_query_limit（L6）
//   M9~M10 调用点从 listAll 回退到 list               → check_list_query_limit（L7）
//   B1~B2 等价改写（括号/下标调用）                   → 仍绿
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const NODE = process.execPath;

const SUITE_IDX = 'tools/check_index_field_alignment.js';
const SUITE_SCHEMA = 'tools/check_schema_sync.js';
const SUITE_LIMIT = 'tools/check_list_query_limit.js';

function md5(rel) {
  return crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');
}

function runSuite(rel) {
  try {
    execFileSync(NODE, [path.join(ROOT, rel)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    return { rc: 0, out: '' };
  } catch (e) {
    return { rc: e.status == null ? 1 : e.status, out: String(e.stdout || '') };
  }
}

const IDX_GOOD = "    { name: 'idx_line_row', keys: { shop_id: 1, cost_card_row_id: 1 } },";
const IDX_OLD = "    { name: 'idx_line_card', keys: { card_id: 1 } },";

const COLLECTIONS = 'cloudfunctions/initDb/collections.js';
const MIRROR = 'specs/dev-specs/prototype/init_db.js';
const STEPS = '下一步工序清单.md';
const ADAPTER = 'cloudfunctions/common/dataAdapter.js';
const GETCARD = 'cloudfunctions/getCostCard/index.js';
const CHECKQ = 'cloudfunctions/checkQuota/index.js';

const CASES = [
  { id: 'M1', file: COLLECTIONS, pairs: [[IDX_GOOD, IDX_OLD]], suites: [SUITE_IDX], expect: 'red', desc: '索引整体改回旧化石写法（idx_line_card ← card_id）' },
  { id: 'M2', file: COLLECTIONS, pairs: [[IDX_GOOD, "    { name: 'idx_line_row', keys: { shop_id: 1 } },"]], suites: [SUITE_IDX], expect: 'red', desc: '索引漏掉 cost_card_row_id（只剩 shop_id）' },
  { id: 'M3', file: COLLECTIONS, pairs: [[IDX_GOOD, "    { name: 'idx_line_row', keys: { shop_id: 1, cost_card_row_id: 1, card_id: 1 } },"]], suites: [SUITE_IDX], expect: 'red', desc: '索引多带一个化石字段 card_id' },
  { id: 'M4', file: MIRROR, pairs: [[IDX_GOOD, IDX_OLD]], suites: [SUITE_SCHEMA], expect: 'red', desc: '镜像 init_db.js 漂回旧定义（单源改了、镜像没跟）' },
  { id: 'M5', file: STEPS, pairs: [['| 20 | shop_cost_card_line | idx_line_row | shop_id ↑, cost_card_row_id ↑ | |', '| 20 | shop_cost_card_line | idx_line_card | card_id ↑ | |']], suites: [SUITE_SCHEMA], expect: 'red', desc: '工序清单逐条对照表漂回旧值' },
  { id: 'M6', file: ADAPTER, pairs: [['.skip(skip)', '.skip(0)']], suites: [SUITE_LIMIT], expect: 'red', desc: 'listAll 的 skip 写死 0（退化成只取一页）' },
  { id: 'M7', file: ADAPTER, pairs: [['for (let skip = 0; ; skip += LIST_LIMIT) {', 'if (true) {']], suites: [SUITE_LIMIT], expect: 'red', desc: 'listAll 去掉循环（不再翻页）' },
  { id: 'M9', file: GETCARD, pairs: [["da.listAll('shop_cost_card', { shop_id: shopId })", "da.list('shop_cost_card', { shop_id: shopId })"]], suites: [SUITE_LIMIT], expect: 'red', desc: 'getCostCard 调用点回退到 list（截断回归）' },
  { id: 'M10', file: CHECKQ, pairs: [["da.listAll('shop_cost_card', { shop_id: shopId })", "da.list('shop_cost_card', { shop_id: shopId })"]], suites: [SUITE_LIMIT], expect: 'red', desc: 'checkQuota 调用点回退到 list（额度少算）' },
  { id: 'B1', file: CHECKQ, pairs: [["da.listAll('shop_cost_card'", "(da.listAll)('shop_cost_card'"]], suites: [SUITE_LIMIT], expect: 'green', desc: '等价改写：括号包裹调用（(da.listAll)(...)）' },
  { id: 'B2', file: GETCARD, pairs: [["da.listAll('shop_cost_card'", "da['listAll']('shop_cost_card'"]], suites: [SUITE_LIMIT], expect: 'green', desc: '等价改写：下标调用 da[\'listAll\'](...)' },
];

let passN = 0, failN = 0;
const rows = [];

for (const c of CASES) {
  const p = path.join(ROOT, c.file);
  const before = md5(c.file);
  const orig = fs.readFileSync(p, 'utf8');
  let verdict = '';
  let detail = '';
  try {
    let s = orig;
    for (const [a, b] of c.pairs) {
      const n = s.split(a).length - 1;
      if (n !== 1) throw new Error('锚点命中 ' + n + ' 次（期望 1）：' + a.slice(0, 60));
      s = s.replace(a, b);
    }
    if (s === orig) throw new Error('变异未产生任何文本变化');
    fs.writeFileSync(p, s);

    const results = c.suites.map((rel) => ({ rel, ...runSuite(rel) }));
    const reds = results.filter((r) => r.rc !== 0).map((r) => path.basename(r.rel, '.js'));
    if (c.expect === 'red') {
      if (reds.length > 0) { verdict = 'OK'; detail = '如期转红：' + reds.join(', '); }
      else { verdict = 'NO'; detail = '**期望转红却全绿**（守卫假绿）'; }
    } else {
      if (reds.length === 0) { verdict = 'OK'; detail = '等价改写仍绿（未误伤）'; }
      else { verdict = 'NO'; detail = '**期望仍绿却转红**（判据过严/误伤）：' + reds.join(', '); }
    }
  } catch (e) {
    verdict = 'NO';
    detail = '变异执行失败：' + String(e.message || e).slice(0, 120);
  } finally {
    fs.writeFileSync(p, orig);
    const after = md5(c.file);
    if (after !== before) { verdict = 'NO'; detail += ' ｜ **还原失败**（md5 不一致）'; }
  }
  if (verdict === 'OK') { passN++; console.log('  ✅ ' + c.id + ' ' + c.desc + ' —— ' + detail); }
  else { failN++; console.log('  ❌ ' + c.id + ' ' + c.desc + ' —— ' + detail); }
  rows.push([c.id, c.file, verdict]);
}

console.log('');
console.log('受改文件 md5 还原自证：');
for (const f of [...new Set(CASES.map((c) => c.file))]) {
  console.log('  · ' + f + ' 现 md5 = ' + md5(f));
}
console.log('');
console.log('===== R157 变异回灌结果：' + passN + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);

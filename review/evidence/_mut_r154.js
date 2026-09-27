'use strict';
// R154 变异回灌：证明 tools/check_list_query_limit.js 真的能抓错（不是假绿）
//   覆盖 L1 上限值 / L2 两出口 / L3 副本漂移 / L4 裸 get / L5 替身缺 limit 五条判据。
// 铁律：每条独立、锚点强制命中 1 次、跑完立刻还原、还原后 md5 全等。
//   组A = 把源码改回错误写法 ⇒ **必须转红**；组B = 语义等价改写 ⇒ **必须仍绿**（判行为不判文本）。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO = 'C:/Users/lzj/WorkBuddy/Claw/catering-profit';
const GUARD = 'tools/check_list_query_limit.js';
const COMMON = 'cloudfunctions/common/dataAdapter.js';
const ONE_COPY = 'cloudfunctions/getCostCard/cx_dataAdapter.js';
const DBL = 'cloudfunctions/calcAmortize/selftest.js';

const rd = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const wr = (rel, s) => fs.writeFileSync(path.join(REPO, rel), s, 'utf8');
const md5 = (rel) => crypto.createHash('md5').update(fs.readFileSync(path.join(REPO, rel))).digest('hex');

let OUT = '';
function runGuard() {
  let out = '', rc = 0;
  try { out = execFileSync(process.execPath, [GUARD], { encoding: 'utf8', cwd: REPO }); }
  catch (e) { rc = (e.status == null ? -1 : e.status); out = (e.stdout || '') + (e.stderr || ''); }
  return { rc, out };
}
const judge = (out) => out.split(/\r?\n/).filter((l) => l.includes('❌'));

const MUTS = [
  // ---- 组A：错误写法 ⇒ 必须转红 ----
  { id: 'M1', name: 'list() 去掉 .limit（回到截断 100 条的原始缺陷）', file: COMMON,
    from: 'return db.collection(coll).where(cond).limit(LIST_LIMIT).get();',
    to: 'return db.collection(coll).where(cond).get();', expectRed: true, want: 'list 取值没带 .limit(LIST_LIMIT)' },
  { id: 'M2', name: 'LIST_LIMIT 改成 10003（超平台硬上限，真云直接报错）', file: COMMON,
    from: 'const LIST_LIMIT = 1000;', to: 'const LIST_LIMIT = 10003;', expectRed: true, want: '超过平台硬上限 1000' },
  { id: 'M3', name: 'LIST_LIMIT 改成 100（等于没修，仍是默认值）', file: COMMON,
    from: 'const LIST_LIMIT = 1000;', to: 'const LIST_LIMIT = 100;', expectRed: true, want: '不大于默认值 100' },
  { id: 'M4', name: '单份副本回退 ⇒ 42 份不再同源（改一漏 41）', file: ONE_COPY,
    from: 'return db.collection(coll).where(cond).limit(LIST_LIMIT).get();',
    to: 'return db.collection(coll).where(cond).get();', expectRed: true, want: '副本漂移' },
  { id: 'M5', name: 'dataAdapter 新增一条裸 .get() 的列表出口（L4 必须抓到）', file: COMMON,
    from: '  async function list(coll, where, extra) {',
    to: '  async function listRaw(coll) { return db.collection(coll).where({}).get(); }\n  async function list(coll, where, extra) {',
    expectRed: true, want: '没带上限' },
  { id: 'M6', name: '本地替身去掉 limit 实现（回到 TypeError / 本地比平台宽容）', file: DBL,
    from: '            limit(n) { return { get() { return Promise.resolve({ data: arr.slice(0, n) }); } }; },',
    to: '', expectRed: true, want: '替身没有实现 limit(n)' },

  // ---- 组B：语义等价改写 ⇒ 必须仍绿（判行为不判文本）----
  { id: 'B1', name: 'limit 括号里加空格（等价排版）', file: COMMON,
    from: 'return db.collection(coll).where(cond).limit(LIST_LIMIT).get();',
    to: 'return db.collection(coll).where(cond).limit( LIST_LIMIT ).get();', expectRed: false, want: '' },
  { id: 'B2', name: 'LIST_LIMIT 声明加尾注释（等价）', file: COMMON,
    from: 'const LIST_LIMIT = 1000;', to: 'const LIST_LIMIT = 1000; // 平台硬上限', expectRed: false, want: '' },
  { id: 'B3', name: '替身用另一种写法实现 limit（等价行为）', file: DBL,
    from: 'limit(n) { return { get() { return Promise.resolve({ data: arr.slice(0, n) }); } }; },',
    to: 'limit(n) { const capped = arr.slice(0, n); return { get() { return Promise.resolve({ data: capped }); } }; },',
    expectRed: false, want: '' },
];

const files = [...new Set(MUTS.map((m) => m.file))];
const base = {};
files.forEach((f) => { base[f] = md5(f); });

let pass = 0, fail = 0;
const log = [];
log.push('===== R154 变异回灌（守卫 tools/check_list_query_limit.js）=====');

const pre = runGuard();
log.push('[基线] rc=' + pre.rc + ' | ❌ ' + judge(pre.out).length + ' 条');
if (pre.rc !== 0) { log.push('!! 基线非绿，回灌无意义 —— 中止'); fail++; }

for (const m of MUTS) {
  const orig = rd(m.file);
  const cnt = orig.split(m.from).length - 1;
  if (cnt !== 1) { log.push('❌ ' + m.id + ' 锚点命中 ' + cnt + ' 次（期望 1）—— 跳过'); fail++; continue; }
  wr(m.file, orig.replace(m.from, m.to));
  let r;
  try { r = runGuard(); } catch (e) { r = { rc: -1, out: String(e && e.message) }; }
  wr(m.file, orig);
  const restored = md5(m.file) === base[m.file];
  const badLines = judge(r.out);
  const hitWant = m.want ? r.out.includes(m.want) : false;
  const okExpect = (m.expectRed ? (r.rc !== 0) : (r.rc === 0));
  const good = okExpect && restored && (m.expectRed ? hitWant : true);
  if (good) pass++; else fail++;
  log.push((good ? '✅ ' : '❌ ') + m.id + ' ' + m.name
    + ' | rc=' + r.rc + ' | 期望' + (m.expectRed ? '红' : '绿')
    + ' | 点名=' + (badLines.length ? badLines[0].trim().slice(0, 120) : '(无)')
    + ' | 命中关键词[' + m.want + ']=' + hitWant
    + ' | 还原md5全等=' + restored);
}

const post = runGuard();
log.push('[还原后基线] rc=' + post.rc + ' | ❌ ' + judge(post.out).length + ' 条');
const allRestored = files.every((f) => md5(f) === base[f]);
log.push('全部受改文件 md5 全等 = ' + allRestored);
if (!allRestored || post.rc !== 0) fail++;
log.push('');
log.push('===== R154 变异回灌结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');

const dir = 'C:/Users/lzj/WorkBuddy/2026-09-08-22-08-11/_m3';
const target = path.join(REPO, 'review/evidence/mutation_r154.txt');
fs.writeFileSync(target, log.join('\n'), 'utf8');
process.stdout.write(log.join('\n') + '\n');
process.stdout.write('\n[落盘] review/evidence/mutation_r154.txt\n');

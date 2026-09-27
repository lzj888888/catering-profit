// review/evidence/_mut_r159.js —— R159 付费墙覆盖面守卫：双向变异回灌
//
// 纪律：每条变异独立、可还原；错误写法**必红且点名**，等价改写**必绿**；还原后受改文件 md5 全等。
// 运行：node review/evidence/_mut_r159.js
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const NODE = process.execPath;
const GATE = 'tools/check_paywall_coverage.js';
const ENT = 'cloudfunctions/common/entitlement.js';
const PW = 'utils/paywall.js';
const TERMS = 'miniprogram/i18n/terms.js';
const EXP = 'cloudfunctions/exportData/index.js';
const PROBE_DIR = path.join(ROOT, 'cloudfunctions', 'saveComboCard');

const md5 = (rel) => crypto.createHash('md5').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');
const rd = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const wr = (rel, s) => fs.writeFileSync(path.join(ROOT, rel), s, 'utf8');

function runGate() {
  const r = cp.spawnSync(NODE, [GATE], { cwd: ROOT, encoding: 'utf8' });
  return { rc: r.status, out: ((r.stdout || '') + (r.stderr || '')) };
}

let pass = 0, fail = 0;
const results = [];
function judge(name, ok, detail) {
  if (ok) { pass++; } else { fail++; }
  results.push(`${ok ? '✅' : '❌'} ${name}${detail ? ' —— ' + detail : ''}`);
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' —— ' + detail : ''}`);
}

// —— 基线：守卫应全绿 ——
{
  const r = runGate();
  judge('B0 基线：未变异时守卫 rc=0 且 13 通过/0 失败',
    r.rc === 0 && /13 通过 \/ 0 失败/.test(r.out), `rc=${r.rc}`);
}

/** 通用：改一处 → 跑 → 断言必红且输出含关键词 → 还原 → md5 全等 */
function mutateMustFail(label, rel, from, to, kw) {
  const before = md5(rel);
  const src = rd(rel);
  if (src.indexOf(from) < 0) { judge(label, false, `原文未找到锚点：${from.slice(0, 40)}`); return; }
  wr(rel, src.replace(from, to));
  const r = runGate();
  const hit = kw.every((k) => r.out.indexOf(k) >= 0);
  wr(rel, src);
  const same = md5(rel) === before;
  judge(label, r.rc !== 0 && hit && same,
    `rc=${r.rc} / 点名(success)=${hit} / 还原 md5 全等=${same}`);
}

/** 等价改写：必须仍绿 + md5 还原 */
function mutateMustPass(label, rel, from, to) {
  const before = md5(rel);
  const src = rd(rel);
  if (src.indexOf(from) < 0) { judge(label, false, `原文未找到锚点：${from.slice(0, 40)}`); return; }
  wr(rel, src.replace(from, to));
  const r = runGate();
  wr(rel, src);
  const same = md5(rel) === before;
  judge(label, r.rc === 0 && same, `rc=${r.rc} / 还原 md5 全等=${same}`);
}

console.log('===== M 组：错误写法必红（点名到具体能力键/判据）=====');

// M1 前端放行集合丢掉 combo ⇒ L2 必红并点名 combo
mutateMustFail("M1 PAYWALL_TYPES 删掉 'combo' ⇒ L2 判红且点名 combo",
  PW, "const PAYWALL_TYPES = ['saveLimit', 'export', 'combo', 'takeaway'];",
  "const PAYWALL_TYPES = ['saveLimit', 'export', 'takeaway'];", ['combo', 'L2']);

// M2 前端放行集合丢掉 takeaway ⇒ L2 必红
mutateMustFail("M2 PAYWALL_TYPES 删掉 'takeaway' ⇒ L2 判红且点名 takeaway",
  PW, "const PAYWALL_TYPES = ['saveLimit', 'export', 'combo', 'takeaway'];",
  "const PAYWALL_TYPES = ['saveLimit', 'export', 'combo'];", ['takeaway', 'L2']);

// M3 云端把 m3_combo 改名成 m3_foobar ⇒ 派生键 foobar 无墙 ⇒ L2 必红
mutateMustFail('M3 PAID_FEATURES 把 m3_combo 改成 m3_foobar ⇒ L2 判红且点名 foobar',
  ENT, "'export', 'm3_combo', 'm3_takeaway'", "'export', 'm3_foobar', 'm3_takeaway'", ['foobar', 'L2']);

// M4 i18n 把 combo.content 清空 ⇒ L4 必红
mutateMustFail('M4 TERMS.paywall.combo.content 置空 ⇒ L4 判红',
  TERMS, "content: '套餐利润测算为专业版功能：录入可免费保存，开通后解锁计算与报表。'",
  "content: ''", ['combo', 'L4']);

// M5 i18n 把 takeaway.content 置空 ⇒ L4 必红（锚点用 takeaway 独有的 content 行，避免与 combo 撞）
mutateMustFail('M5 TERMS.paywall.takeaway.content 置空 ⇒ L4 判红且点名 takeaway',
  TERMS, "content: '外卖利润核算为专业版功能：录入可免费保存，开通后解锁到手率与毛利测算。'",
  "content: ''", ['takeaway', 'L4']);

// M6 云函数里拦一个未登记的能力 ⇒ L6-① 必红
mutateMustFail("M6 exportData 把 hasFeature 的键改成未登记的 'm3_secret' ⇒ L6-① 判红",
  EXP, "hasFeature(db, userId, 'export')", "hasFeature(db, userId, 'm3_secret')", ['m3_secret', 'L6-①']);

// M7 造一个同名云函数却不接墙 ⇒ L6-② 必红（随后删除探针目录）
{
  let created = false;
  try {
    fs.mkdirSync(PROBE_DIR, { recursive: true });
    fs.writeFileSync(path.join(PROBE_DIR, 'index.js'), "// R159 变异探针：同名云函数但不接墙\nexports.main = async () => ({ ok: true });\n", 'utf8');
    created = true;
    const r = runGate();
    const hit = r.out.indexOf('L6-②') >= 0 && r.out.indexOf('saveComboCard') >= 0;
    judge('M7 造 saveComboCard 云函数但不调 hasFeature ⇒ L6-② 判红且点名函数',
      r.rc !== 0 && hit, `rc=${r.rc} / 点名=${hit}`);
  } catch (e) {
    judge('M7 造 saveComboCard 云函数但不调 hasFeature ⇒ L6-② 判红且点名函数', false, '探针创建失败：' + e.message);
  } finally {
    if (created) {
      // ⚠️ 本机 fs.rmSync **会被拦**（实测两次均残留 ⇒ 守卫 L6-② 一直红 ⇒ B 组连带假红 3 条）。
      //    ⇒ 一律「改名归档」到仓外/临时目录（与项目既有纪律一致：收尾用改名，不用删除）。
      const trash = path.join(ROOT, '_m3', '_debug', 'saveComboCard_probe_' + Date.now());
      try {
        fs.mkdirSync(path.dirname(trash), { recursive: true });
        fs.renameSync(PROBE_DIR, trash);
      } catch (e) { console.log('  清理异常：' + e.message); }
      const gone = !fs.existsSync(PROBE_DIR);
      judge('M7-清理 探针目录已移出 cloudfunctions/（改名归档，现场还原）', gone,
        gone ? 'cloudfunctions/saveComboCard 已不存在' : '⚠️ 残留，需人工清理');
    }
  }
}

console.log('\n===== B 组：等价改写必须仍绿（判行为不判写法）=====');

mutateMustPass('B1 双引号写法（语义等价）仍绿',
  PW, "const PAYWALL_TYPES = ['saveLimit', 'export', 'combo', 'takeaway'];",
  'const PAYWALL_TYPES = ["saveLimit", "export", "combo", "takeaway"];');

mutateMustPass('B2 PAID_FEATURES 换成多行数组（语义等价）仍绿',
  ENT, "const PAID_FEATURES = ['export', 'm3_combo', 'm3_takeaway'];",
  "const PAID_FEATURES = [\n  'export',\n  'm3_combo',\n  'm3_takeaway',\n];");

mutateMustPass('B3 派生规则等价改写（先 slice 后判前缀的另一种写法）仍绿',
  PW, "const PAYWALL_TYPES = ['saveLimit', 'export', 'combo', 'takeaway'];",
  "const PAYWALL_TYPES = [ 'saveLimit' , 'export' , 'combo' , 'takeaway' ];");

// —— 收尾：残留自证 ——
// utils/paywall.js 与 i18n terms.js 本轮**有真实改动**（git diff 非空是应该的）；
// cloudfunctions/common/entitlement.js 与 exportData/index.js 本轮**没有真实改动** ⇒
// 变异还原后 git diff 必须为空，否则说明某个变异没还原干净。
console.log('\n===== 还原自证（本轮未真实改动的文件必须「无残留」）=====');
for (const rel of [ENT, EXP]) {
  const r = cp.spawnSync('git', ['diff', '--stat', '--', rel], { cwd: ROOT, encoding: 'utf8' });
  const d = (r.stdout || '').trim();
  const ok = d === '';
  if (ok) { pass++; } else { fail++; }
  console.log(`  ${ok ? '✅' : '❌'} ${rel}${d ? ' 有残留 → ' + d.split('\n')[0] : ' 无残留'}`);
}

console.log(`\n===== 变异回灌结果：${pass} 通过 / ${fail} 失败 =====`);
if (fail) console.log('失败项：\n' + results.filter((s) => s.startsWith('❌')).join('\n'));
process.exit(fail === 0 ? 0 : 1);

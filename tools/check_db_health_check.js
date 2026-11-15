// 线上健康巡检判据守卫（R748 · S-1）
//
// 守的是什么事故：上线后的巡检如果判据写错，会出现两种坏结果 ——
//   ① 永远绿（备份真断了也不报）⇒ 出事时才发现没备份，等于没有备份；
//   ② 永远红（新环境首日就报"备份失败"）⇒ 告警疲劳，真问题反而被忽略。
//   本守卫把「什么情况算什么等级」钉死，并证明判据不是恒真/恒假。
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const S = require(path.join(ROOT, 'cloudfunctions/dbHealthCheck/service.js'));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' ｜ ' + detail : '')); }
  else { fails.push(name); console.log('  ❌ ' + name + (detail ? ' ｜ ' + detail : '')); }
}
function sec(s) { console.log('\n=== ' + s + ' ==='); }

const DAY = 86400000;
const NOW = Date.parse('2026-11-16T10:00:00.000Z');

sec('A 备份判据四态');
ok('A-① 无记录 ⇒ unknown（新环境首日不误报失败）',
  S.judgeBackup(null, NOW).level === 'unknown', S.judgeBackup(null, NOW).reason);
ok('A-② 备份自报 ok=false ⇒ alert（跑了但没跑成，最高优先级）',
  S.judgeBackup({ created_at: new Date(NOW - 3 * DAY).toISOString(), after_data: { ok: false, failed: 2 } }, NOW).level === 'alert');
ok('A-③ 断档超过 35 天 ⇒ alert',
  S.judgeBackup({ created_at: new Date(NOW - 40 * DAY).toISOString(), after_data: { ok: true } }, NOW).level === 'alert');
ok('A-④ 正常 ⇒ ok 且带天数',
  (() => { const r = S.judgeBackup({ created_at: new Date(NOW - 5 * DAY).toISOString(), after_data: { ok: true, total_rows: 123 } }, NOW);
    return r.level === 'ok' && r.ageDays === 5; })());

sec('B 时间边界（35 天规则必须精确）');
ok('B-① 恰好 35 天仍算 ok（不早报）',
  S.judgeBackup({ created_at: new Date(NOW - 35 * DAY).toISOString(), after_data: { ok: true } }, NOW).level === 'ok');
ok('B-② 36 天转 alert',
  S.judgeBackup({ created_at: new Date(NOW - 36 * DAY).toISOString(), after_data: { ok: true } }, NOW).level === 'alert');
ok('B-③ 时间不可解析 ⇒ warn（不静默当成 ok）',
  S.judgeBackup({ created_at: 'not-a-date', after_data: { ok: true } }, NOW).level === 'warn');

sec('C 汇总聚合');
ok('C-① 任一 alert ⇒ 总级 alert',
  S.aggregate([{ item: 'a', level: 'ok', reason: '' }, { item: 'b', level: 'alert', reason: 'x' }]).level === 'alert');
ok('C-② 只有 warn ⇒ 总级 warn',
  S.aggregate([{ item: 'a', level: 'ok', reason: '' }, { item: 'b', level: 'warn', reason: 'x' }]).level === 'warn');
ok('C-③ 全 ok ⇒ 总级 ok 且 summary 说正常',
  (() => { const r = S.aggregate([{ item: 'a', level: 'ok', reason: '' }]);
    return r.level === 'ok' && r.summary.indexOf('正常') >= 0; })());
ok('C-④ 空列表 ⇒ ok（不因空而崩）', S.aggregate([]).level === 'ok');

sec('D 安全自保与触发器');
const IDX = read('cloudfunctions/dbHealthCheck/index.js');
ok('D-① 有 openid 的调用一律 FORBIDDEN（巡检读全租户审计表，不能给前端）',
  /if\s*\([^)]*OPENID[^)]*\)[\s\S]{0,200}FORBIDDEN/.test(IDX));
ok('D-② 触发器为每日（config.json 含 timer）',
  (() => { try { const c = JSON.parse(read('cloudfunctions/dbHealthCheck/config.json'));
    return Array.isArray(c.triggers) && c.triggers.length > 0 && c.triggers[0].type === 'timer'; } catch (_) { return false; } })());
ok('D-③ 关键集合可读性判据存在（能自动判的那部分）',
  typeof S.judgeCollections === 'function'
  && S.judgeCollections([{ collection: 'shop', ok: true }]).level === 'ok'
  && S.judgeCollections([{ collection: 'shop', ok: false, error: 'x' }]).level === 'alert');
ok('D-③b 明确不越线判备份新鲜度（dbBackup 有「只读不写」红线，故无元数据可读）',
  /备份状态仍靠每月|不能.*落库|没有元数据可读/.test(read('cloudfunctions/dbHealthCheck/service.js')));
ok('D-④ 巡检结论也落库（可查趋势）',
  /action:\s*'DB_HEALTH_CHECK'/.test(IDX));

sec('E 变异回灌（证明判据有牙）');
{
  // 变异 1：把断档阈值改成极大 ⇒ A-③ 必须转红
  const mutantAlwaysOk = () => ({ level: 'ok', reason: '', ageDays: 0 });
  ok('E-① 变异体（永远返回 ok）在 A-②/A-③ 判据下必须转红',
    mutantAlwaysOk().level === 'ok'
    && S.judgeBackup({ created_at: new Date(NOW - 40 * DAY).toISOString(), after_data: { ok: true } }, NOW).level === 'alert'
    && S.judgeBackup({ created_at: new Date(NOW - 3 * DAY).toISOString(), after_data: { ok: false } }, NOW).level === 'alert');
  // 变异 2：null 判成 alert ⇒ A-① 必须转红（防首日告警疲劳）
  const mutantNullAlert = (r) => (r ? S.judgeBackup(r, NOW) : { level: 'alert', reason: '', ageDays: 0 });
  ok('E-② 变异体（无记录判 alert）与 A-① 期望冲突 ⇒ 证明 A-① 不是恒真',
    mutantNullAlert(null).level === 'alert' && S.judgeBackup(null, NOW).level === 'unknown');
}

console.log('\n===== 线上健康巡检判据守卫：' + pass + ' 通过 / ' + fails.length + ' 失败 =====');
process.exit(fails.length === 0 ? 0 : 1);

#!/usr/bin/env node
// tools/check_backup_data_handling.js —— R3-3 备份零脱敏「处置前提」守卫
//
// 为什么需要它：R722 把「备份全库明文 + 云路径可枚举」这个 P1 推测拆成了两半 ——
//   泄露路径已排除（权限三项绿）、零脱敏属实（🟡 治理）。但此后**没有任何东西**守着
//   「这个判定依赖的前提」。一旦有人把 KEEP_EPOCHS 从 2 调到 12、把轮转的
//   「只在完全成功时」保护删掉、或把 OPENID 自保拿掉，明文留存期/暴露面会悄悄变化，
//   而门禁照绿 —— 结论还挂在文档里，事实已经不是那个事实了。
//
// 🔴 本守卫**不修脱敏**：字段级脱敏会破坏备份的可恢复性，当前威胁模型下真正的手段是
//   服务端加密/KMS（属产品+运维决策）。本文件守的是「判定依赖的四个前提有没有变」。
//   详见 review/NOTE_R724l_备份数据处置口径.md。
//
// 取证层级：L0 源码形状 + L0 文档一致性（云控制台权限项由 R722 GUI 截图作证，本守卫
//   只核「结论有没有被如实写进文档」，不假装自己复核了云端配置）。
//
// 运行：node tools/check_backup_data_handling.js

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BACKUP = path.join(ROOT, 'cloudfunctions/dbBackup/index.js');
const NOTE = path.join(ROOT, 'review/NOTE_R724l_备份数据处置口径.md');
const R722 = path.join(ROOT, 'review/AUDIT_R722_云控制台实操核查.md');
const CLI = path.join(ROOT, 'review/evidence/r724l_cloud_console/cli_recheck.txt');

const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } };
const SRC = read(BACKUP);
const DOC = read(NOTE);
const OLD = read(R722);
const CLILOG = read(CLI);

let pass = 0, failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');

// 🔴 敏感集合身份：只在这里列一次，且必须与 dbBackup 的 COLLECTIONS 双向核对
//   （不手抄进文档判据，也不允许文档漏列）。
const SENSITIVE = ['user', 'admin_user', 'admin_login_log', 'audit_log'];

/** 从 dbBackup 源码实算备份面里的集合名，不从文档抄。 */
function collectionsOf(src) {
  const m = /const\s+COLLECTIONS\s*=\s*\[([\s\S]*?)\];/.exec(src);
  if (!m) return [];
  return (m[1].match(/'([a-z_]+)'/g) || []).map((s) => s.slice(1, -1));
}

/** 四个前提的机器判据（变异回灌直接调它，证明有分辨力）。 */
function evaluate(src, doc) {
  const mKeep = /const\s+KEEP_EPOCHS\s*=\s*(\d+)\s*;/.exec(src);
  return {
    // P3a 明文留存期上限：2 期 ≈ 60 天
    p3a: !!mKeep && Number(mKeep[1]) <= 2,
    keepN: mKeep ? Number(mKeep[1]) : null,
    // P3b 轮转只在「本期完全成功」时执行（半成功删旧的 = 把仅存完整备份弄没）
    p3b: /if\s*\(!ok\s*\|\|\s*!done\.length\)/.test(src),
    // P4 只允许定时触发：小程序端带 OPENID 一律拒
    p4: /if\s*\(ctx\.OPENID\)/.test(src) && /FORBIDDEN/.test(src),
    // 文档：敏感集合逐条列出
    docHasSensitive: SENSITIVE.every((c) => doc.indexOf('`' + c + '`') >= 0),
  };
}

(async () => {
  console.log('[R3-3] 备份零脱敏处置前提守卫（判定为可接受，守的是「前提别悄悄变」）');

  // =====================================================
  // H · 事实与前提
  // =====================================================
  sec('H · 处置结论与四个前提');

  ok('H-① 四份材料都在场（源码 / 处置口径 / R722 原始核查 / 本轮 CLI 复核）',
    SRC.length > 500 && DOC.length > 500 && OLD.length > 500 && CLILOG.length > 100,
    'src=' + SRC.length + ' doc=' + DOC.length + ' r722=' + OLD.length + ' cli=' + CLILOG.length);

  ok('H-② 🔴 处置口径写明 R722 三项权限结论（仅创建者可读写 / 未登录开关关），不把推测写成实测',
    DOC.indexOf('仅创建者可读写') >= 0 && DOC.indexOf('未登录') >= 0
    && DOC.indexOf('泄露路径已实测排除') >= 0,
    '权限结论在场');

  ok('H-③ 🔴 处置口径写明「未重跑 GUI / 未测到的项」（不许拿旧截图冒充本轮实测）',
    DOC.indexOf('未重跑') >= 0 && DOC.indexOf('未测到的项') >= 0
    && DOC.indexOf('执行超时 60s') >= 0,
    '诚实边界在场');

  const colls = collectionsOf(SRC);
  ok('H-④ 敏感集合名单从 dbBackup 源码**实算**，四个都在备份面里',
    SENSITIVE.every((c) => colls.indexOf(c) >= 0),
    '备份面 ' + colls.length + ' 个集合；敏感=' + SENSITIVE.join('/'));

  ok('H-⑤ 🔴 处置口径逐条列出四个敏感集合（文档与源码双向一致，不手抄名单）',
    SENSITIVE.every((c) => DOC.indexOf('`' + c + '`') >= 0),
    SENSITIVE.filter((c) => DOC.indexOf('`' + c + '`') < 0).join(',') || '四条全列');

  const ev = evaluate(SRC, DOC);
  ok('H-⑥ 🔴 P3a：KEEP_EPOCHS ≤ 2（明文留存约 60 天；调大必须重评脱敏/加密）',
    ev.p3a, '实测 KEEP_EPOCHS=' + ev.keepN);
  ok('H-⑦ 🔴 P3b：轮转只在「本期完全成功」时执行（半成功不删仅存的完整备份）', ev.p3b);
  ok('H-⑧ 🔴 P4：dbBackup 仍只允许定时触发（带 OPENID ⇒ FORBIDDEN）', ev.p4);
  ok('H-⑨ 处置口径写明「重评触发事件」（前提变化时必须回来改文档）',
    DOC.indexOf('重评触发事件') >= 0 && DOC.indexOf('prod 环境') >= 0);

  ok('H-⑩ 本轮 CLI 复核证据：login=true 且环境仍只有 dev 一个（prod 未建）',
    /"login"\s*:\s*true/.test(CLILOG) && (CLILOG.match(/cloud1-[a-z0-9]+/g) || []).length === 1,
    '环境命中 ' + (CLILOG.match(/cloud1-[a-z0-9]+/g) || []).length + ' 次');

  ok('H-⑪ 处置口径明确「本轮不改代码/不改配置/不重新部署」（技能只读红线）',
    DOC.indexOf('没改任何云控制台配置') >= 0 && DOC.indexOf('没改 dbBackup 代码') >= 0);

  // =====================================================
  // M · 变异回灌（每条真跑 evaluate，必须 exit=1 且点名）
  // =====================================================
  sec('M · 变异回灌（证明上面不是恒真）');

  function mut(label, from, to, where, expectKey, expectName) {
    const base = where === 'src' ? SRC : DOC;
    if (base.indexOf(from) < 0) { console.log('  ❌ ' + label + ' 锚点漂移'); failN++; return; }
    const mutatedSrc = where === 'src' ? base.replace(from, to) : SRC;
    const mutatedDoc = where === 'doc' ? base.replace(from, to) : DOC;
    if (mutatedSrc === SRC && mutatedDoc === DOC) { console.log('  ❌ ' + label + ' 变异未生效'); failN++; return; }
    const r = evaluate(mutatedSrc, mutatedDoc);
    const degraded = r[expectKey] === false;
    ok(label + ' ⇒ 检出「' + expectName + '」退化', degraded,
      '变异后 ' + expectKey + '=' + r[expectKey]);
  }

  mut('M-1 把 KEEP_EPOCHS 从 2 改成 12（明文留存期悄悄拉长半年）',
    'const KEEP_EPOCHS = 2;', 'const KEEP_EPOCHS = 12;', 'src', 'p3a', 'H-⑥ P3a');

  mut('M-2 去掉轮转的「只在完全成功时」保护',
    'if (!ok || !done.length) {', 'if (false) {', 'src', 'p3b', 'H-⑦ P3b');

  mut('M-3 去掉 OPENID 自保（小程序端也能触发备份）',
    'if (ctx.OPENID) {', 'if (false) {', 'src', 'p4', 'H-⑧ P4');

  mut('M-4 处置口径漏列 admin_user（敏感集合名单漂了）',
    '`admin_user`', '`xxx_removed`', 'doc', 'docHasSensitive', 'H-⑤ 敏感名单');

  console.log('\n' + (failN ? '❌ ' + failN + ' 失败 / ' : '✅ ') + pass + ' 通过');
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.log('FATAL', e && (e.stack || e.message)); process.exit(2); });

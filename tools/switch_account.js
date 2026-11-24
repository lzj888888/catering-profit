#!/usr/bin/env node
/**
 * tools/switch_account.js —— 把店算从旧个人号切到新个体户号（「餐饮智算」）的迁移开关。
 *
 * 解决什么：主体从个人换成个体户必须重新注册新号（微信不允许个人→个体户主体变更），
 *   换号后需要改的**代码侧单源只有 3 处**，且历史上多次手抄错环境 ID（漏一个 p / 混 dev-prod）。
 *   本脚本把这 3 处做成参数化 + 前置硬校验 + 默认 dry-run，拿到新号 ID 当天一键切换。
 *
 * 改哪 3 处（全仓扫描实证，业务代码零硬编码 appid / env）：
 *   1) project.config.json        appid                          （全仓唯一硬编码处）
 *   2) miniprogram/config/env.js  ENV_MAP.dev                    （wx.cloud.init 唯一来源）
 *   3) cloudfunctions/initDb/config.json  envVariables.DEV_ENV_ID（云函数侧 dev 白名单）
 *   注：ENV_MAP.prod 保持占位符，等控制台建好 prod 再单独填；ACTIVE_ENV 保持 'dev' 不动。
 *
 * 纪律：
 *   - 默认 dry-run，必须显式 --apply 才写盘。
 *   - 只接受明确传入的 --appid / --env；不猜、不硬编码新号；格式不符直接 exit 1。
 *   - 改前整文件备份到 _bak_switch_account_<时间戳>/，原样可回滚。
 *   - 写后调用 tools/check_env_ready.js 做一致性守卫（env.js ↔ config.json）。
 *   - 不碰云函数源码、不碰业务代码、不碰 git —— 部署/建库/索引由后续步骤单独做。
 *
 * 用法：
 *   node tools/switch_account.js --appid wxNEWID --env cloud1-NEWENV            # 演练
 *   node tools/switch_account.js --appid wxNEWID --env cloud1-NEWENV --apply    # 真改
 *   node tools/switch_account.js --selftest                                     # 自证（不写盘）
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PROJECT_CFG = path.join(ROOT, 'project.config.json');
const ENV_JS = path.join(ROOT, 'miniprogram/config/env.js');
const INITDB_CFG = path.join(ROOT, 'cloudfunctions/initDb/config.json');
const OLD_APPID = 'wx33c110dc57a9c8dc';
const OLD_ENV = 'cloud1-d4gphpoxy337f2a25';
const APPID_RE = /^wx[0-9a-zA-Z]{16}$/;
const ENV_RE = /^cloud1-[0-9a-zA-Z]+$/;

function valOf(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
function has(flag) { return process.argv.includes(flag); }

/** 精确替换，命中数必须 === expect，否则 fail-closed */
function replaceOnce(src, re, replacement, label, expect) {
  // 必须用全局计数：非全局 match() 返回 [完整匹配, 捕获组...]，长度是组数+1，不是命中数
  const globalRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  const hits = src.match(globalRe);
  const n = hits ? hits.length : 0;
  if (n !== expect) {
    throw new Error(label + ' 期望命中 ' + expect + ' 处，实际 ' + n + ' 处 —— 源码形态已变，拒绝盲改');
  }
  return { text: src.replace(re, replacement), hits: n };
}

function readRel(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

function buildPlan(appid, envid) {
  const pc = readRel('project.config.json');
  const ej = readRel('miniprogram/config/env.js');
  const ic = readRel('cloudfunctions/initDb/config.json');

  const r1 = replaceOnce(pc, /"appid"\s*:\s*"wx[0-9a-zA-Z]{16}"/,
    '"appid": "' + appid + '"', 'project.config.json::appid', 1);
  // 只认 ENV_MAP 块内的真实赋值行（行首缩进 + dev:），避开注释里的 dev / cloud1 示例
  const r2 = replaceOnce(ej, /(^[ \t]*dev:[ \t]*')cloud1-[0-9a-zA-Z]+(')/m,
    '$1' + envid + '$2', 'env.js::ENV_MAP.dev', 1);
  const r3 = replaceOnce(ic, /("DEV_ENV_ID"\s*:\s*")cloud1-[0-9a-zA-Z]+(")/,
    '$1' + envid + '$2', 'initDb/config.json::DEV_ENV_ID', 1);

  return [
    { file: PROJECT_CFG, rel: 'project.config.json', before: pc, after: r1.text, hits: r1.hits },
    { file: ENV_JS, rel: 'miniprogram/config/env.js', before: ej, after: r2.text, hits: r2.hits },
    { file: INITDB_CFG, rel: 'cloudfunctions/initDb/config.json', before: ic, after: r3.text, hits: r3.hits },
  ];
}

function shortDiff(before, after) {
  const b = before.split(/\r?\n/), a = after.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < Math.max(b.length, a.length); i++) {
    if (b[i] !== a[i]) {
      if (b[i] !== undefined) out.push('  - ' + b[i].trim());
      if (a[i] !== undefined) out.push('  + ' + a[i].trim());
    }
  }
  return out.join('\n');
}

function selftest() {
  let pass = 0, fail = 0;
  function t(name, cond) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name); }
  }
  console.log('===== switch_account selftest（不写盘）=====');
  const sample = { appid: 'wx0123456789abcdef', env: 'cloud1-abc123def456' };
  t('新 AppID 格式合法', APPID_RE.test(sample.appid));
  t('新环境 ID 格式合法', ENV_RE.test(sample.env));
  t('旧 ID 不会被当作新 ID 传入', !APPID_RE.test(OLD_APPID) || OLD_APPID !== sample.appid);
  t('replaceOnce 命中 0 处时抛错', (() => {
    try { replaceOnce('abc', /zzz/, 'x', 't', 1); return false; } catch (e) { return /拒绝盲改/.test(e.message); }
  })());
  t('replaceOnce 命中 2 处时抛错', (() => {
    try { replaceOnce('aa', /a/g, 'b', 't', 1); return false; } catch (e) { return /拒绝盲改/.test(e.message); }
  })());
  t('replaceOnce 命中 1 处时成功', replaceOnce('abc', /b/, 'X', 't', 1).text === 'aXc');
  // 真读三个单源文件，确认形态匹配（这是脚本能不能用的前提）
  try {
    const plan = buildPlan(sample.appid, sample.env);
    t('三处单源都能命中且各 1 处', plan.length === 3 && plan.every(p => p.hits === 1));
    t('切换后 appid 换成新值', plan[0].after.includes('"appid": "' + sample.appid + '"'));
    t('切换后 env.js dev 换成新值', plan[1].after.includes("dev: '" + sample.env + "'"));
    t('切换后 DEV_ENV_ID 换成新值', plan[2].after.includes('"DEV_ENV_ID": "' + sample.env + '"'));
    t('prod 占位符未被触碰', plan[1].after.includes('catering-prod-xxxxxxxx'));
    t('ACTIVE_ENV 未被触碰', /ACTIVE_ENV:\s*'dev'/.test(plan[1].after));
    t('原文件未被 selftest 改写', readRel('project.config.json').includes(OLD_APPID));
  } catch (e) {
    t('三处单源可解析：' + e.message, false);
  }
  console.log('===== selftest：' + pass + ' 通过 / ' + fail + ' 失败 =====');
  process.exit(fail ? 1 : 0);
}

(function main() {
  if (has('--selftest')) return selftest();
  const appid = valOf('--appid');
  const envid = valOf('--env');
  const apply = has('--apply');

  if (!appid || !envid) {
    console.error('缺参数：必须传 --appid wxNEWID --env cloud1-NEWENV');
    console.error('例：node tools/switch_account.js --appid wxabcdef0123456789 --env cloud1-xxxxxxxx');
    process.exit(2);
  }
  if (!APPID_RE.test(appid)) { console.error('AppID 格式不符（应 wx + 16 位）：' + appid); process.exit(1); }
  if (!ENV_RE.test(envid)) { console.error('环境 ID 格式不符（应 cloud1- 开头）：' + envid); process.exit(1); }
  if (appid === OLD_APPID || envid === OLD_ENV) {
    console.error('拒绝：新 ID 与旧号相同，没有实际切换'); process.exit(1);
  }

  let plan;
  try { plan = buildPlan(appid, envid); }
  catch (e) { console.error('前置校验失败：' + e.message); process.exit(1); }

  console.log('===== 账号切换计划 ' + (apply ? '【真改】' : '【演练 dry-run】') + ' =====');
  console.log('新 AppID：' + appid + '   新 dev 环境：' + envid);
  plan.forEach(p => {
    console.log('\n--- ' + p.rel + '（命中 ' + p.hits + ' 处）---');
    console.log(shortDiff(p.before, p.after));
  });

  if (!apply) {
    console.log('\n[dry-run] 未写盘。确认无误后加 --apply 真改。');
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const bakDir = path.join(ROOT, '_bak_switch_account_' + stamp);
  fs.mkdirSync(bakDir, { recursive: true });
  plan.forEach(p => {
    const bak = path.join(bakDir, path.basename(p.rel));
    fs.writeFileSync(bak, p.before, 'utf8');
    fs.writeFileSync(p.file, p.after, 'utf8');
    console.log('  已写 ' + p.rel + '（备份 → ' + path.relative(ROOT, bak) + '）');
  });

  console.log('\n===== 调用一致性守卫 check_env_ready.js =====');
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'check_env_ready.js')],
    { cwd: ROOT, encoding: 'utf8' });
  console.log((r.stdout || '') + (r.stderr || ''));
  console.log('守卫退出码：' + r.status + (r.status === 0 ? '（通过）' : '（失败，请按备份回滚或修复）'));
  process.exit(r.status === 0 ? 0 : 1);
})();

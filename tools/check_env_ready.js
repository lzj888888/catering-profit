// tools/check_env_ready.js —— 环境 ID 就绪守卫（第 66 套件）
// 运行： node tools/check_env_ready.js
//
// 背景（2026-09-19 本轮发现并收口）：
//   `miniprogram/config/env.js` 是 wx.cloud.init 环境 ID 的**唯一来源**（core/06 §1.3.1）。
//   此前 `getEnv()` 写作 `return this.ENV_MAP[this.ACTIVE_ENV] || this.ENV_MAP.dev;` ——
//   对「ACTIVE_ENV 指向的环境 ID 仍是占位符」**没有任何防护**：
//     一旦有人把 ACTIVE_ENV 切成 'prod'，而真实 prod 环境尚未建 / ID 未填，
//     getEnv() 会把 'catering-prod-xxxxxxxx' 这个**不存在的环境 ID** 交给 wx.cloud.init
//     ⇒ 全站云调用失败，且**无任何告警**（静默瘫痪）。
//   这与 initDb 侧「DEV_ENV_ID 精确白名单」（H 组门禁）是**两个面**：H 组只守云函数侧，
//   **不覆盖小程序端 env.js** —— 本守卫补的正是这个面。
//
// 规则：
//   E1 单源：业务代码（pages/ utils/ app.js）不得出现环境 ID 字面量（cloud1- / catering-dev- / catering-prod-）。
//   E2 防护存在：env.js 的 getEnv() 函数体内必须有占位符判定（isPlaceholder）+ 告警（console.error）。
//   E3 实跑 fail-closed：**getEnv() 的返回值永远不得是占位符**（可用 envStatus() 佐证）。
//
// 边界（明写，别高估本守卫）：
//   · 只证「不会因为占位符而把坏环境 ID 交给 wx.cloud.init」，**证不了该环境真实存在/可连通**
//     （环境是否真在控制台建好，只能靠真云调用验证）。
//   · 不替李老师决定 prod 何时建、ID 填什么 —— 那属于人工面（见重启键「上线阻塞」）。
(function () {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const ROOT = path.resolve(__dirname, '..');
  const ENV_REL = 'miniprogram/config/env.js';

  let pass = 0, failN = 0;
  const bad = [];
  function check(name, cond, detail) {
    if (cond) { pass++; console.log('✅ ' + name + (detail ? ' · ' + detail : '')); }
    else { failN++; bad.push(name + (detail ? ' · ' + detail : '')); console.log('❌ ' + name + (detail ? ' · ' + detail : '')); }
  }

  // ---------- 工具 ----------
  const ID_LITERAL = /(cloud1-[A-Za-z0-9]+|catering-(?:dev|prod)-[A-Za-z0-9x]+)/;
  const PLACEHOLDER_RE = /xxxxxxxx|^\s*$/;
  const isPlaceholder = (id) => typeof id !== 'string' || PLACEHOLDER_RE.test(id);

  /** 静默加载一份 env.js（屏蔽其 console.error，避免污染守卫输出） */
  function loadQuiet(abs) {
    const origErr = console.error;
    let errCount = 0;
    console.error = function () { errCount++; };
    try {
      const m = require(abs);
      // 实跑取值（同样屏蔽告警）
      const envId = m.getEnv();
      const st = typeof m.envStatus === 'function' ? m.envStatus() : null;
      return { mod: m, envId, st, errCount };
    } finally {
      console.error = origErr;
    }
  }

  /** 对一份 env.js 源码做 E3 判定：返回 {ok, why} */
  function judgeEnv(abs) {
    const r = loadQuiet(abs);
    const st = r.st || {};
    const issues = [];
    if (isPlaceholder(r.envId)) {
      issues.push('getEnv() 返回了占位符/非法环境 ID（' + JSON.stringify(r.envId) + '）—— 会被交给 wx.cloud.init ⇒ 全站云调用静默失败');
    }
    if (st.isPlaceholder && !st.fellBack) {
      issues.push('目标环境是占位符但未回落（fellBack=false）—— 缺少兜底');
    }
    if (st.isPlaceholder && r.errCount === 0) {
      issues.push('回落到 dev 但没有 console.error 告警 —— 静默回落，等于问题不可见');
    }
    if (!st.devReady) {
      issues.push('ENV_MAP.dev 本身也是占位符/缺失 —— 连 dev 都不可用');
    }
    return { ok: issues.length === 0, why: issues.join('；'), envId: r.envId, st, errCount: r.errCount };
  }

  /** 生成一份"改了 ACTIVE_ENV"的临时副本，用于正负样本自证 */
  function makeVariant(activeEnv) {
    const src = fs.readFileSync(path.join(ROOT, ENV_REL), 'utf8');
    const out = src.replace(/ACTIVE_ENV:\s*'[^']*'/, "ACTIVE_ENV: '" + activeEnv + "'");
    if (out === src) throw new Error('未能改写 ACTIVE_ENV（源码形态已变，守卫需同步）');
    const tmp = path.join(os.tmpdir(), 'env_ready_variant_' + activeEnv + '_' + Date.now() + '.js');
    fs.writeFileSync(tmp, out, 'utf8');
    return tmp;
  }

  // ---------- S · 自失效护栏 ----------
  console.log('===== S · 自失效护栏 =====');
  const envAbs = path.join(ROOT, ENV_REL);
  const envExists = fs.existsSync(envAbs);
  check('S1 单源文件存在', envExists, ENV_REL);
  if (!envExists) { console.log('\n环境守卫无法继续：找不到 ' + ENV_REL); process.exit(1); }

  const envSrc = fs.readFileSync(envAbs, 'utf8');
  const mapKeys = (envSrc.match(/ENV_MAP:\s*\{[\s\S]*?\}/) || [''])[0];
  check('S2 ENV_MAP 至少含 dev/prod 两个键（防结构变化导致守卫空跑）',
    /dev\s*:/.test(mapKeys) && /prod\s*:/.test(mapKeys),
    '解析出 ' + (mapKeys.match(/\b(dev|prod)\s*:/g) || []).join(' , '));

  // ---------- N · 规则自证（正负样本互证，防恒绿/恒红）----------
  console.log('\n===== N · 规则自证（正负样本互证）=====');
  // N1 负样本：ACTIVE_ENV 切到尚未配置的 prod ⇒ getEnv() 不得交出占位符，且必须告警
  const tmpBad = makeVariant('prod');
  const badRes = judgeEnv(tmpBad);
  fs.unlinkSync(tmpBad);
  check('N1 负样本（ACTIVE_ENV=prod 且 ID 仍是占位符）未交出占位符',
    !isPlaceholder(badRes.envId),
    'getEnv() 实际返回 ' + JSON.stringify(badRes.envId) + '（应回落到 dev）');
  check('N2 负样本回落时必须有 console.error 告警（不得静默）',
    badRes.errCount > 0, '告警次数 = ' + badRes.errCount);

  // N3 正样本：当前真实配置（ACTIVE_ENV=dev，dev 为真实 ID）⇒ 应就绪、零回落、零告警
  const goodRes = judgeEnv(envAbs);
  check('N3 正样本（当前真实配置）应完全就绪', goodRes.ok,
    'active=' + (goodRes.st.active || '?') + ' · envId=' + JSON.stringify(goodRes.envId) +
    ' · fellBack=' + goodRes.st.fellBack + ' · devReady=' + goodRes.st.devReady);
  check('N4 正样本不应有多余回落告警（不该红时不红）',
    goodRes.errCount === 0 && goodRes.st.fellBack === false,
    '告警 ' + goodRes.errCount + ' 次，fellBack=' + goodRes.st.fellBack);

  // ---------- E1 · 环境 ID 单源 ----------
  console.log('\n===== E1 · 环境 ID 单源（业务代码不得硬编码）=====');
  const SCAN = ['pages', 'utils'];
  const files = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|wxml|json)$/.test(e.name)) files.push(p);
    }
  }
  SCAN.forEach((d) => walk(path.join(ROOT, d)));
  const appJs = path.join(ROOT, 'app.js');
  if (fs.existsSync(appJs)) files.push(appJs);
  const relOf = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

  let literalHits = 0;
  files.forEach((f) => {
    let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { return; }
    const m = txt.match(ID_LITERAL);
    if (m) {
      literalHits++;
      console.log('   ⚠️ ' + relOf(f) + ' 出现环境 ID 字面量：' + m[0]);
    }
  });
  check('E1 业务代码零硬编码环境 ID', literalHits === 0,
    '扫描 ' + files.length + ' 个文件，命中 ' + literalHits + ' 处');

  // ---------- E2 · 占位符防护存在 ----------
  console.log('\n===== E2 · getEnv() 必须有占位符防护 =====');
  const lines = envSrc.split(/\r?\n/);
  // ⚠️ 只认**函数定义形态**，不认裸名：注释里出现 "getEnv() 会把…交给 wx.cloud.init" 不算定义
  //    （第一版用 /getEnv\s*\(/ 命中了第 15 行注释 —— 那是守卫误报，按纪律改守卫、不改业务代码）
  const gi = lines.findIndex((l) => /^\s*getEnv\s*\(\s*\)\s*\{/.test(l));
  let body = '';
  if (gi >= 0) {
    // 取到下一个同缩进的 '};' 或下一个顶层键为止（简易函数体切片，够用且稳定）
    for (let i = gi; i < lines.length; i++) {
      body += lines[i] + '\n';
      if (i > gi && /^\s*\},?\s*$/.test(lines[i]) && lines[i].length <= 4) break;
      if (i > gi && /^\s{2}\},/.test(lines[i])) break;
    }
  }
  check('E2.1 getEnv() 存在', gi >= 0, gi >= 0 ? '第 ' + (gi + 1) + ' 行' : '未找到');
  check('E2.2 getEnv() 内有占位符判定（isPlaceholder）', /isPlaceholder\s*\(/.test(body),
    gi >= 0 ? '函数体 ' + body.split('\n').length + ' 行' : '');
  check('E2.3 getEnv() 内回落时有 console.error 告警', /console\.error\(/.test(body), '');

  // ---------- E3 · 实跑 fail-closed ----------
  console.log('\n===== E3 · 实跑：getEnv() 返回值不得是占位符 =====');
  check('E3 当前配置下 getEnv() 返回真实环境 ID', goodRes.ok,
    goodRes.ok ? JSON.stringify(goodRes.envId) : goodRes.why);

  console.log('\n===== 环境就绪守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
  if (failN) {
    bad.forEach((b) => console.log('   ❌ ' + b));
    console.log('\n修复指引：');
    console.log('  1) 在 getEnv() 内先判 isPlaceholder(id)，命中则回落 dev 并 console.error(\'[ENV_FALLBACK] ...\')；');
    console.log('  2) 上线前在控制台建 prod 环境，把 ENV_MAP.prod 换成真实 ID 后再把 ACTIVE_ENV 切 \'prod\'。');
  }
  process.exit(failN === 0 ? 0 : 1);
})();

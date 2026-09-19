#!/usr/bin/env node
// tools/check_terms_forbidden.js —— 禁用词表守卫（把 TERMS.forbidden 从「一张没人查的表」变成每次门禁必跑）
//
// 为什么需要它（2026-09-20 round56 发现，round55 已点名缺口）：
//   `miniprogram/i18n/terms.js::TERMS.forbidden` 记着 6 条禁用词（投资回报/ROI、回本周期、收益率/利润率、
//   盈利/赚钱/躺赚、投资/理财/股、付费/订阅/会员费），理由是「金融类目红线 / 触发虚拟支付审核 / 收益承诺」——
//   但全仓 `tools/` 与 `specs/dev-specs/prototype/` **零处引用 forbidden**，`verify_all.js` 的 SUITES
//   也没有术语套件 ⇒ 这 13 个关键词**没有任何机器判据在查**，写进文案也不会有人知道。
//   同族病：R86「索引已建 ≠ 生效」、round53「verify_docx.py 是权威判据却从未挂 SUITES」。
//   ⇒ **判据存在 ≠ 判据被自动执行**。本文件的唯一职责 = 把它变成每次门禁都跑。
//
// 扫描面（两个面，缺一不可 —— 只扫一个会漏）：
//   A. 文案源（真正的文案在这里）：`TERMS.*` + `ERROR_MESSAGES.*` 的**叶子字符串值**。
//      ⚠️ round55 设计的判据是「只扫 wxml 可见文案」——**方向不够**：本仓 wxml 已全面走 `{{t.xxx}}`
//      数据绑定，裸扫 `pages/*.wxml` 只有 1 处「付费」且还在 `<!-- -->` 注释里 ⇒ 「盈利」零命中，
//      而真正的文案「月度盈利核算」躺在 terms.js 里。只扫 wxml = 扫了个空壳。
//   B. 硬编码文案（防页面绕过 TERMS）：`pages/**/*.wxml` 剥掉 `<!-- -->` 注释后的可见文案
//      （含属性值，如 placeholder）。这条同时守「页面文案禁止硬编码」的纪律。
//
// 排除（每条都写明理由，不是静默放宽）：
//   · `TERMS.forbidden` 子树 —— 那是**判据本体**（word 字段里当然装着"盈利"），扫它恒红，无意义。
//   · `*.internal` —— 术语双轨里的内部术语，**不对外渲染**。实证：`grep -rn "internal" pages admin-h5`
//     零命中，页面只用 `.display` / `.subtitle` / `.navTitle`（见 pages/index/index.js:11-16）。
//
// 三档处置（关键：不静默放宽，也不把「待裁决」伪装成「没问题」）：
//   · EXEMPT   = 有拍板依据的豁免，必须带 by/date/reason 三件套，缺一即红（T7）。
//   · DEFERRED = 真实冲突、我方无权自决，**明确打印 ⚠️ 但不判红**，等李老师裁决。
//   · 其余命中 = 硬违规，判红。
//   🔒 双向防腐（T6）：EXEMPT∪DEFERRED 里**没有对应实际命中**的条目会转红（僵尸豁免）
//      ⇒ 词表收紧或文案改掉后，豁免表不会悄悄烂在库里；同时任何**新命中**必然落到「其余」⇒ 判红。
//      ⇒ 命中集合 ≡ 处置集合，两边都动不得，这正是「豁免显式且不腐」的机械保证。
//
// 运行：node tools/check_terms_forbidden.js   （由 verify_all.js 的 [terms-forbidden] 套件调用）

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TERMS_REL = 'miniprogram/i18n/terms.js';
const TERMS_MIRROR_REL = 'specs/dev-specs/i18n/terms.js'; // K11 双副本单源

// ===== 豁免：有拍板依据（by/date/reason 三件套缺一即红）=====
const EXEMPT = [
  { path: 'TERMS.modules.m1.display', word: '盈利',
    by: '李老师', date: '2026-09-20',
    reason: '真机走查后拍板：模块名「月度盈利核算」为 forbidden[3] 的唯一例外（同源记载于 terms.js forbidden[3].exception）' },
  { path: 'TERMS.modules.m1.navTitle', word: '盈利',
    by: '李老师', date: '2026-09-20',
    reason: '同上：导航栏短版沿用拍板模块名' },
  { path: 'TERMS.modules.m1.cardTitle', word: '盈利',
    by: '李老师', date: '2026-09-20',
    reason: '同上：首页卡片沿用拍板模块名' },
];

// ===== 待裁决：真实冲突，我方无权自决 —— 打印 ⚠️ 不判红，等李老师拍板 =====
const DEFERRED = [
  { path: 'TERMS.auditSafe.disclaimer', word: '投资',
    by: 'WorkBuddy', date: '2026-09-20',
    reason: '官方免责话术「不构成任何投资、经营决策建议」与 forbidden[4]「投资」字面冲突；改词会削弱免责效力。' +
            '待裁：收窄词表（投资回报/理财/股票）还是改话术。' },
  { path: 'TERMS.m2.redAlert', word: '盈利',
    by: 'WorkBuddy', date: '2026-09-20',
    reason: '「当前结构无法盈利」是否定式风险提示，与 forbidden[3] 的 reason「收益承诺」实质不符。' +
            '待裁：否定式表述是否整体豁免。' },
  { path: 'TERMS.sandboxResult.redAlert', word: '盈利',
    by: 'WorkBuddy', date: '2026-09-20',
    reason: '同上（沙盘结果页同一句红字提示）' },
  { path: 'ERROR_MESSAGES.ERR.M2_RED_ALERT', word: '盈利',
    by: 'WorkBuddy', date: '2026-09-20',
    reason: '「当前结构下难以盈利」同上，否定式表述' },
  { path: 'TERMS.pay.subscribeTip', word: '订阅',
    by: 'WorkBuddy', date: '2026-09-20',
    reason: '「订阅消息」是微信官方能力名（授权接收服务通知），非付费订阅。' +
            '待裁：词表收窄为「订阅会员/付费订阅」。' },
  { path: 'TERMS.exp.switchHint', word: '付费',
    by: 'WorkBuddy', date: '2026-09-20',
    reason: '「不会触发任何付费弹窗」是否定式安抚表述，非付费入口文案。待裁：否定式是否豁免。' },
];

function collectStrings(obj, prefix, out) {
  if (typeof obj === 'string') { out.push([prefix, obj]); return; }
  if (Array.isArray(obj)) { obj.forEach((v, i) => collectStrings(v, prefix + '[' + i + ']', out)); return; }
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) collectStrings(obj[k], prefix ? prefix + '.' + k : k, out);
  }
}

// 剥 wxml 注释（HTML 注释里的字不渲染 ⇒ 不算可见文案）
function stripComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, '');
}

function main() {
  const pass = [];
  const bad = [];
  // ⚠️ check() 必须当场打印 ✅/❌：verify_all.js 的 R66 审计要求「每个段标题下至少一个 ✅」。
  const check = (name, ok, detail) => {
    (ok ? pass : bad).push(name + (detail ? ' · ' + detail : ''));
    process.stdout.write((ok ? '✅ ' : '❌ ') + name + (detail ? ' · ' + detail : '') + '\n');
  };
  const info = (s) => process.stdout.write('   ' + s + '\n');

  // ===== T1 前置：单源可读 + 双副本逐字节一致 =====
  process.stdout.write('\n===== T1 前置：术语单源可读且双副本一致 =====\n');
  let mod = null;
  try {
    mod = require(path.join(ROOT, TERMS_REL));
  } catch (e) {
    check('T1 ' + TERMS_REL + ' 可 require', false, String(e.message || e).slice(0, 120));
    process.stdout.write('\n===== 禁用词表守卫结果：0 通过 / 1 失败 =====\n');
    process.exit(1);
  }
  check('T1 ' + TERMS_REL + ' 可 require', true);
  const a = fs.readFileSync(path.join(ROOT, TERMS_REL));
  const b = fs.existsSync(path.join(ROOT, TERMS_MIRROR_REL)) ? fs.readFileSync(path.join(ROOT, TERMS_MIRROR_REL)) : null;
  check('T1b 双副本逐字节一致（K11 同族）', !!b && a.equals(b),
    b ? (a.equals(b) ? 'identical' : 'DRIFT: ' + TERMS_REL + ' ' + a.length + 'B vs ' + TERMS_MIRROR_REL + ' ' + b.length + 'B')
      : '镜像缺失 ' + TERMS_MIRROR_REL);

  // ===== T2 判据本体：forbidden 表结构完整 =====
  process.stdout.write('\n===== T2 判据本体：TERMS.forbidden 结构完整 =====\n');
  const T = mod.TERMS || {};
  const fb = T.forbidden;
  check('T2 forbidden 是数组且非空', Array.isArray(fb) && fb.length > 0,
    Array.isArray(fb) ? fb.length + ' 条' : typeof fb);
  if (!Array.isArray(fb) || !fb.length) {
    process.stdout.write('\n===== 禁用词表守卫结果：' + pass.length + ' 通过 / ' + bad.length + ' 失败 =====\n');
    process.exit(1);
  }
  const shapeBad = fb.filter((x) => !x || typeof x.word !== 'string' || !x.reason || !x.replace);
  check('T2b 每条含 word/reason/replace', shapeBad.length === 0, shapeBad.length ? shapeBad.length + ' 条缺字段' : fb.length + '/' + fb.length);
  // 关键词从 word 派生，不写死清单（词表改了这里自动跟）
  const KEYWORDS = [];
  fb.forEach((x, i) => {
    String(x.word).split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean)
      .forEach((w) => KEYWORDS.push({ w, idx: i, replace: x.replace }));
  });
  check('T2c 从 word 派生出关键词', KEYWORDS.length > 0, KEYWORDS.length + ' 个关键词：' + KEYWORDS.map((k) => k.w).join('/'));

  // ===== T3 扫描面 A：文案源（terms.js 的叶子字符串）=====
  process.stdout.write('\n===== T3 扫描面 A：文案源 TERMS.* / ERROR_MESSAGES.* =====\n');
  const rows = [];
  collectStrings({ TERMS: T, ERROR_MESSAGES: mod.ERROR_MESSAGES || {} }, '', rows);
  const scanned = rows.filter(([p]) => !/^TERMS\.forbidden(\[[0-9]+\])?\./.test(p) && !/\.internal$/.test(p));
  const coversTerms = scanned.some(([p]) => p.indexOf('TERMS.') === 0);
  const coversErr = scanned.some(([p]) => p.indexOf('ERROR_MESSAGES.') === 0);
  // ⚠️ 这条必须是 check（当场打印 ✅）：verify_all.js 的 R66 审计要求「每个段标题下至少一个 ✅」，
  //    只 info() 不打印 ⇒ 被判「断言疑似静默未跑」而转红（本文件首次接入 SUITES 时踩到）。
  check('T3 扫描面非空且两个文案源都覆盖到', scanned.length > 0 && coversTerms && coversErr,
    '叶子 ' + rows.length + ' 条 / 纳入扫描 ' + scanned.length + ' 条（排除 forbidden 判据本体 + *.internal 内部术语）');
  const hits = [];
  for (const [p, v] of scanned) {
    for (const k of KEYWORDS) if (v.indexOf(k.w) !== -1) hits.push({ path: p, word: k.w, text: v, idx: k.idx });
  }
  info('面 A 命中 ' + hits.length + ' 处');

  // ===== T4 扫描面 B：pages/**/*.wxml 可见文案（防硬编码绕过 TERMS）=====
  process.stdout.write('\n===== T4 扫描面 B：pages/**/*.wxml 可见文案（剥注释）=====\n');
  const wxmlHits = [];
  let wxmlN = 0;
  (function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.name.endsWith('.wxml')) {
        wxmlN++;
        const txt = stripComments(fs.readFileSync(fp, 'utf8'));
        txt.split(/\r?\n/).forEach((line, i) => {
          for (const k of KEYWORDS) if (line.indexOf(k.w) !== -1) {
            wxmlHits.push({ file: path.relative(ROOT, fp).replace(/\\/g, '/'), line: i + 1, word: k.w, text: line.trim().slice(0, 80) });
          }
        });
      }
    }
  })(path.join(ROOT, 'pages'));
  check('T4 扫到 wxml 文件', wxmlN > 0, wxmlN + ' 个');
  // 🔴 admin-h5 是内部管理后台，**不进小程序审核** ⇒ 显式声明范围外，不静默放过也不误报。
  info('范围外（显式声明）：admin-h5/** 为内部后台，不进小程序审核，故不纳入本守卫扫描面。');
  check('T4b wxml 可见文案零违规', wxmlHits.length === 0,
    wxmlHits.length ? wxmlHits.map((h) => h.file + ':' + h.line + ' <<' + h.word + '>>').join(' | ') : '0 命中');
  // 🔴 T4c：T3 排除 `*.internal` 的**前提是「页面从不渲染 internal」**。前提一破，那条排除就成了漏网
  //    （禁用词写进 internal、页面照样渲染出来，而面 A 不扫它、面 B 只扫 wxml 字面量 ⇒ 两头都空）。
  //    ⇒ 排除项必须连它的前提一起守，否则「排除」就是开后门。与 R86「索引已建≠生效」同族。
  const internalUse = [];
  const walkJs = function (dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) { walkJs(fp); continue; }
      if (!/\.(js|wxml|html)$/.test(e.name)) continue;
      fs.readFileSync(fp, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (/\.internal\b/.test(line)) {
          internalUse.push(path.relative(ROOT, fp).replace(/\\/g, '/') + ':' + (i + 1) + ' ' + line.trim().slice(0, 60));
        }
      });
    }
  };
  // ⚠️ 扫描面只限**渲染面** `pages/` + `admin-h5/`（守卫自身与 specs/ 里当然会提到 internal 这个词）。
  [path.join(ROOT, 'pages'), path.join(ROOT, 'admin-h5')].forEach((d) => walkJs(d));
  check('T4c 页面/后台从不渲染 *.internal（T3 排除项的前提）', internalUse.length === 0,
    internalUse.length ? internalUse.join(' | ') : '0 处引用 internal');

  // ===== T5 硬违规：命中里既没 EXEMPT 也没 DEFERRED 的 =====
  process.stdout.write('\n===== T5 硬违规判定（命中 ∉ 豁免 ∪ 待裁决 ⇒ 红）=====\n');
  const isCovered = (h, list) => list.some((x) => x.path === h.path && x.word === h.word);
  const hard = hits.filter((h) => !isCovered(h, EXEMPT) && !isCovered(h, DEFERRED));
  check('T5 无未处置的禁用词命中', hard.length === 0,
    hard.length ? hard.length + ' 处：' + hard.map((h) => h.path + ' <<' + h.word + '>> ' + h.text.slice(0, 30)).join(' | ')
                : '面 A ' + hits.length + ' 处命中全部落在豁免/待裁决');

  // ===== T6 双向防腐：僵尸豁免（登记了但已无对应命中）=====
  process.stdout.write('\n===== T6 双向防腐：EXEMPT/DEFERRED 无僵尸条目 =====\n');
  const zombies = EXEMPT.concat(DEFERRED).filter((x) => !hits.some((h) => h.path === x.path && h.word === x.word));
  check('T6 无僵尸豁免/待裁决条目', zombies.length === 0,
    zombies.length ? zombies.map((z) => z.path + ' <<' + z.word + '>>').join(' | ') : '登记 ' + (EXEMPT.length + DEFERRED.length) + ' 条全部有对应命中');

  // ===== T7 豁免元信息完整（防静默放宽）=====
  process.stdout.write('\n===== T7 豁免/待裁决元信息完整（by/date/reason）=====\n');
  const metaBad = EXEMPT.concat(DEFERRED).filter((x) => !x.by || !x.date || !x.reason);
  check('T7 每条均带 by/date/reason', metaBad.length === 0,
    metaBad.length ? metaBad.length + ' 条缺元信息' : (EXEMPT.length + DEFERRED.length) + ' 条齐全');

  // ===== T8 待裁决清单明示（不判红，但不许看不见）=====
  process.stdout.write('\n===== T8 待裁决清单（真实冲突，等李老师拍板）=====\n');
  const def = hits.filter((h) => isCovered(h, DEFERRED));
  if (def.length === 0) {
    check('T8 无待裁决项', true, '0 项');
  } else {
    def.forEach((h) => {
      const d = DEFERRED.find((x) => x.path === h.path && x.word === h.word);
      process.stdout.write('   ⚠️ ' + h.path + ' <<' + h.word + '>> ' + h.text.slice(0, 60) + '\n');
      process.stdout.write('      · 登记人 ' + d.by + ' / ' + d.date + ' · ' + d.reason + '\n');
    });
    check('T8 待裁决项已全部明示（不判红）', true, def.length + ' 项待李老师裁决');
  }

  const failN = bad.length;
  process.stdout.write('\n===== 禁用词表守卫结果：' + pass.length + ' 通过 / ' + failN + ' 失败 =====\n');
  if (failN) {
    bad.forEach((x) => process.stdout.write('   ❌ ' + x + '\n'));
    process.stdout.write('\n修复指引：\n');
    process.stdout.write('  1) T5 红 = 新增了禁用词文案：改文案（用 forbidden[i].replace 指明的替代表达），\n');
    process.stdout.write('     别改词表、别往 EXEMPT 里塞（塞了也要 by/date/reason 且须李老师拍板）。\n');
    process.stdout.write('  2) T6 红 = 豁免表腐了：文案或词表已变，把失效条目删掉。\n');
    process.stdout.write('  3) T4b 红 = 页面硬编码了禁用词：文案一律走 TERMS，不要写死在 wxml。\n');
  }
  process.exit(failN === 0 ? 0 : 1);
}

main();

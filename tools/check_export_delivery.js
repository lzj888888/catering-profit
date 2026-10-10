// tools/check_export_delivery.js ——【R265】「导出文件真能拿到手」守卫
// 运行： node tools/check_export_delivery.js      （EXIT 0 = 全绿）
//
// 背景（李老师 2026-10-10 真机反馈，原文）：
//   「经营结果里 导出月度报表 点击后显示 导出完成，然后没有反馈了，不知道去哪里看导出的文件，
//     格式也不知道」；「菜品成本毛利核算 那里 的 导出 打印 点击后显示 导出完成，然后没有反应」。
//
// 根因（不是没生成，是**用户永远拿不到**）：
//   云函数 exportData 默认落 **CSV**，前端 `wx.openDocument({ fileType: 'csv' })`；
//   而微信 fileType 合法值只有 doc/docx/xls/xlsx/ppt/pptx/pdf —— **csv/json 一律打不开** ⇒ 必走 fail；
//   当时三处 fail 回调**全是空的** ⇒ 用户只看到一句「导出完成」，文件躺在小程序沙箱里。
//
// 为什么必须机器守（失效方式是**静默**的，且肉眼看不出来）：
//   · 把默认 format 改回 'excel'（=CSV）⇒ 界面照样弹「导出完成」，零报错，用户又回到原点；
//   · 在 OPENABLE 里加 'csv' ⇒ 自以为"支持了"，实际 openDocument 照样 fail（白名单必须由官方合法值钉死）；
//   · `showMenu: true` 被删 ⇒ 文件能打开但**存不下也转不走**；
//   · fail 回调写回 `() => {}` ⇒ 打不开时**完全无声**，正是本轮事故形态；
//   · 云函数漏装 xlsx 依赖却**静默回退 CSV** ⇒ 部署环境一变就退化，且不报错。
//
// 判据四组（S 扫描面 / A 云函数出真档 / B 前端投递 / C 文案三处 / D 自检）：
//   S1 六个扫描面文件存在且非空          S2 关键锚点在场（SheetJS + openDocument + deliver）
//   A1 默认 format = xlsx                A2 SheetJS 生成且 bookType=xlsx + base64 输出
//   A3 返回 encoding（xlsx ⇒ base64）    A4 文件名后缀随 format（.xlsx）
//   A5 package.json 声明 xlsx 依赖       A6 依赖缺失必须响亮失败（SYSTEM_ERROR），不许静默回退 CSV
//   B1 投递单源存在且导出 deliver         B2 OPENABLE 恰为官方 7 值且**不含 csv/json**
//   B3 三处调用点全走单源（无第二份实现） B4 三处请求 format='xlsx'
//   B5 openDocument 必带 showMenu        B6 fail 回调非空（打不开 ⇒ 转发兜底）
//   B7 pages/utils 内不得残留 csv/json 的 fileType 字面
//   C1 两份 terms.js md5 全等            C2 expFile 七键齐全非空
//   C3 两个页面 t:{} 登记 exportHint      C4 两个 wxml 真渲染 exportHint
//   D1 OPENABLE 正负样本（csv/json/txt 必 undefined；xlsx/pdf 必命中）
//   D2 判据非退化：断言数 ≥ 实测保守下沿
(function () {
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');

  const ROOT = path.resolve(__dirname, '..');
  const P = {
    fn: path.join(ROOT, 'cloudfunctions', 'exportData', 'index.js'),
    pkg: path.join(ROOT, 'cloudfunctions', 'exportData', 'package.json'),
    util: path.join(ROOT, 'utils', 'exportFile.js'),
    m1: path.join(ROOT, 'pages', 'month', 'result.js'),
    m3: path.join(ROOT, 'pages', 'card', 'index.js'),
    m2: path.join(ROOT, 'pages', 'sandbox', 'list.js'),
    m1w: path.join(ROOT, 'pages', 'month', 'result.wxml'),
    m3w: path.join(ROOT, 'pages', 'card', 'index.wxml'),
    termsA: path.join(ROOT, 'miniprogram', 'i18n', 'terms.js'),
    termsB: path.join(ROOT, 'specs', 'dev-specs', 'i18n', 'terms.js'),
  };

  let pass = 0, failN = 0;
  const bad = [];
  function check(name, cond, detail) {
    if (cond) { pass++; console.log('✅ ' + name + (detail ? ' · ' + detail : '')); }
    else { failN++; bad.push(name); console.log('❌ ' + name + (detail ? ' · ' + detail : '')); }
  }
  function md5(p) { return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex'); }
  // 剥注释：注释里写着老写法（正是被禁的反例），不剥会自伤
  function stripComments(s) { return String(s).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1'); }
  function read(p) { return fs.readFileSync(p, 'utf8'); }

  const fnSrc = read(P.fn);
  const fnCode = stripComments(fnSrc);
  const utilSrc = read(P.util);
  const utilCode = stripComments(utilSrc);
  const TERMS = require(P.termsA).TERMS;
  const expFileTerms = TERMS.expFile || {};

  // ================= S 扫描面（自失效护栏）=================
  console.log('\n===== S · 扫描面非退化（防"扫空 ⇒ 恒绿"）=====');
  const faces = [P.fn, P.pkg, P.util, P.m1, P.m3, P.m2];
  // ⚠️ package.json 本就只有百来字节 ⇒ 按类型分档：json 只要求「存在且可解析」，js 要求 >200 字节
  const facesOk = faces.every((p) => {
    try {
      if (/\.json$/.test(p)) { JSON.parse(read(p)); return true; }
      return fs.statSync(p).size > 200;
    } catch (e) { return false; }
  });
  check('S1 六个扫描面文件存在且非空', facesOk, 'exportData/index.js · package.json · exportFile.js · month/result.js · card/index.js · sandbox/list.js');
  const anchors = [
    ['aoa_to_sheet', fnCode.includes('aoa_to_sheet')],
    ['wx.openDocument', utilCode.includes('wx.openDocument')],
    ['deliver', utilCode.includes('function deliver')],
  ];
  const anchorsOk = anchors.every((a) => a[1]);
  check('S2 三个关键锚点在场（证明根路径没写错、判据真跑了）', anchorsOk,
    anchors.map((a) => a[0] + (a[1] ? '(在)' : '(缺)')).join(' / '));

  // ================= A 云函数：必须出真 xlsx =================
  console.log('\n===== A · 云函数默认产真 xlsx（不是 CSV）=====');
  // A1：不传 format / 传未知值 ⇒ 落到 xlsx（显式 else 分支，不允许隐式兜底）
  const fmtLine = /const format = [^;]*'xlsx'[^;]*;/.exec(fnCode);
  check('A1 默认 format 为 xlsx（‘excel’=CSV 只作旧兼容通道）',
    !!fmtLine && /v\.format === 'excel' \? 'excel' : 'xlsx'/.test(fmtLine[0]), fmtLine ? fmtLine[0].slice(0, 80) : '未找到 format 判定行');
  check('A2 SheetJS 生成：bookType=xlsx + base64 输出',
    /bookType:\s*'xlsx'/.test(fnCode) && /type:\s*'base64'/.test(fnCode), 'aoa_to_sheet → write(base64)');
  check('A3 返回 encoding 字段，且 xlsx 时为 base64（前端据此按二进制落盘）',
    /^\s*encoding,/m.test(fnCode) && /encoding = 'base64';/.test(fnCode));
  // ⚠️ 模板串 `${...}` 里的美元花括号不适合写进正则（转义易错）⇒ 取行后做子串判定
  const fnLine = /const filename = .*/.exec(fnCode);
  check('A4 文件名后缀由 format 推出（xlsx ⇒ .xlsx）',
    /const ext = [^;]*'xlsx'[^;]*;/.test(fnCode) && !!fnLine && fnLine[0].includes('fileBase') && fnLine[0].includes('{ext}'),
    fnLine ? fnLine[0] : '未找到 filename 行');
  let pkgDeps = {};
  try { pkgDeps = JSON.parse(read(P.pkg)).dependencies || {}; } catch (e) { pkgDeps = {}; }
  check('A5 package.json 已声明 xlsx 依赖（require 与依赖声明必须同源）',
    Object.prototype.hasOwnProperty.call(pkgDeps, 'xlsx'), JSON.stringify(Object.keys(pkgDeps)));
  // A6：依赖缺失 ⇒ 响亮失败；绝不能静默回退成 CSV（那正是本轮事故的原点）
  const guardLine = /if \(!content\) return fail\(ERROR_CODES\.SYSTEM_ERROR/.test(fnCode);
  check('A6 xlsx 依赖缺失 ⇒ 响亮失败（禁止静默回退 CSV）', guardLine);

  // ================= B 前端投递单源 =================
  console.log('\n===== B · 前端投递单源（落盘 + 打开 + 转发兜底）=====');
  let OPENABLE = {};
  let deliverFn = null;
  try {
    const mod = require(P.util);
    OPENABLE = mod.OPENABLE || {};
    deliverFn = mod.deliver;
  } catch (e) { /* 由 B1 报红 */ }
  check('B1 utils/exportFile.js 可加载且导出 deliver + OPENABLE', typeof deliverFn === 'function' && !!OPENABLE);
  const keys = Object.keys(OPENABLE).sort();
  const OFFICIAL = ['doc', 'docx', 'pdf', 'ppt', 'pptx', 'xls', 'xlsx'];   // 微信官方合法值全集
  const sameSet = keys.length === OFFICIAL.length && keys.every((k, i) => k === OFFICIAL[i]);
  check('B2 OPENABLE 恰为微信官方 7 个合法值（多一个就假、少一个就漏）', sameSet, keys.join('/'));
  check('B2-② OPENABLE 不含 csv / json / txt（加了也是白加：openDocument 照样 fail）',
    !('csv' in OPENABLE) && !('json' in OPENABLE) && !('txt' in OPENABLE));
  const callers = [
    ['M1', read(P.m1)], ['M3', read(P.m3)], ['M2', read(P.m2)],
  ];
  const requireOk = callers.every((c) => /require\('[^']*utils\/exportFile\.js'\)/.test(c[1]));
  const deliverOk = callers.every((c) => /exportFile\.deliver\(/.test(c[1]));
  check('B3 三处导出调用点全走单源（require + deliver 都到位）', requireOk && deliverOk,
    callers.map((c) => c[0] + (/exportFile\.deliver\(/.test(c[1]) ? '(单源)' : '(未接)')).join(' / '));
  const noSecondImpl = callers.every((c) => !/downloadContent\s*\(/.test(stripComments(c[1])));
  check('B3-② 页面内不得残留第二份投递实现（downloadContent）', noSecondImpl);
  const fmtOk = callers.every((c) => /format:\s*'xlsx'/.test(c[1]));
  check('B4 三处请求 format 均为 xlsx（不是 ‘excel’=CSV）', fmtOk);
  check('B5 openDocument 必带 showMenu: true（不给「…」= 存不下也转不走）', /showMenu:\s*true/.test(utilCode));
  // B6：fail 必须真做事（fallbackShare），不能是空回调
  const failBody = /fail:\s*\(\)\s*=>\s*\{\s*\}/.test(utilCode);
  check('B6 打开失败的回调非空（打不开 ⇒ 转发兜底，不许静默）',
    !failBody && /fail:\s*\(\)\s*=>\s*fallbackShare\(/.test(utilCode));
  check('B6-② 兜底走 wx.shareFileMessage（既有路可走：发给自己 / 电脑）', /wx\.shareFileMessage\(/.test(utilCode));
  // B7：反向查残留
  const dirs = ['pages', 'utils'];
  const leftovers = [];
  dirs.forEach((d) => {
    const abs = path.join(ROOT, d);
    (function walk(dir) {
      fs.readdirSync(dir).forEach((f) => {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) { walk(p); return; }
        if (!/\.(js|wxml)$/.test(f)) return;
        const code = stripComments(read(p));
        if (/fileType:\s*'(csv|json|txt)'/.test(code) || /fileType,\s*fail:\s*\(\)\s*=>\s*\{\s*\}/.test(code)) leftovers.push(d + '/' + f);
      });
    })(abs);
  });
  check('B7 pages/ 与 utils/ 内无 csv/json/txt 的 fileType 残留', leftovers.length === 0, leftovers.join(', ') || '零残留');

  // ================= C 文案三处齐 =================
  console.log('\n===== C · 文案三处齐（i18n 双副本 + 页面登记 + wxml 渲染）=====');
  check('C1 两份 terms.js md5 全等（i18n 双副本不得漂移）', md5(P.termsA) === md5(P.termsB), md5(P.termsA).slice(0, 8));
  const need = ['opened', 'openFailTitle', 'openFailContent', 'forward', 'close', 'forwardFail', 'writeFail', 'hint'];
  const miss = need.filter((k) => !expFileTerms[k] || String(expFileTerms[k]).trim() === '');
  check('C2 TERMS.expFile 八键齐全且非空', miss.length === 0, miss.length ? '缺：' + miss.join('/') : need.length + ' 键齐');
  check('C2-② 兜底文案含文件名占位符 {name}（用户得知道文件叫什么）', /\{name\}/.test(String(expFileTerms.openFailContent)));
  const tOk = [/exportHint:\s*TERMS\.expFile\.hint/.test(read(P.m1)), /exportHint:\s*TERMS\.expFile\.hint/.test(read(P.m3))];
  check('C3 两个导出页 t:{} 均登记 exportHint', tOk[0] && tOk[1], 'month/result.js ' + (tOk[0] ? '在' : '缺') + ' / card/index.js ' + (tOk[1] ? '在' : '缺'));
  const wOk = [/\{\{t\.exportHint\}\}/.test(read(P.m1w)), /\{\{t\.exportHint\}\}/.test(read(P.m3w))];
  check('C4 两个 wxml 真渲染 exportHint（登记了不用 = 静默空白）', wOk[0] && wOk[1],
    'result.wxml ' + (wOk[0] ? '渲染' : '未渲染') + ' / card/index.wxml ' + (wOk[1] ? '渲染' : '未渲染'));

  // ================= D 自检（证明判据有分辨力）=================
  console.log('\n===== D · 判据自检（正负样本）=====');
  const neg = ['csv', 'json', 'txt', 'CSV'].every((f) => OPENABLE[f] === undefined);
  const pos = ['xlsx', 'pdf', 'doc'].every((f) => OPENABLE[f] === f);
  check('D1 OPENABLE 有分辨力：csv/json/txt 判否 · xlsx/pdf/doc 判是', neg && pos);
  check('D2 判据非退化：本守卫断言数 ≥ 20（实测 24 的保守下沿）', pass + failN >= 20, '累计 ' + (pass + failN) + ' 条');

  console.log('\n===== R265 导出投递守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
  if (failN) bad.forEach((b) => console.log('   ❌ ' + b));
  process.exit(failN === 0 ? 0 : 1);
})();

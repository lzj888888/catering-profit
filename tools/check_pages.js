#!/usr/bin/env node
/**
 * R44 · 小程序页面声明守卫
 *
 * 背景：pages/dish/ 曾作为 batch 0 占位页留在仓库，app.json 未声明它，
 * 但它的 8 条 i18n 词条（terms.js 的 dish 块）只被它自己消费 —— 删页面时若不同步删词条，
 * 就会留下无主词条，而 K11 只校验双副本 MD5、不管有没有消费者 ⇒ 静默污染。
 * 根因是：此前没有任何门禁校验「页面声明 ↔ 文件存在」是否一致。
 *
 * 本守卫双向校验：
 *   ① 声明了但文件缺失/不全 → 页面打不开（编译期或运行期才炸）
 *   ② 有文件但未被声明     → 孤儿页（进不了包体，或混进包体但不可达）
 *
 * 用法：node tools/check_pages.js      （已登记为 verify_all.js 的第 40 个套件）
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** 显式白名单：允许存在但不被 app.json 声明的页面（需写明理由，不要随意加） */
const ORPHAN_WHITELIST = [
  // 例：'pages/_shared/preview',  // 仅供开发者工具预览，不发布
];

/** 四件套中必须存在的（.json/.wxss 可选，.js/.wxml 缺一不可） */
const REQUIRED_EXT = ['.js', '.wxml'];

const problems = [];
const fail = (msg) => problems.push(msg);

// —— 读 app.json ——
const appJsonPath = path.join(ROOT, 'app.json');
if (!fs.existsSync(appJsonPath)) {
  console.error('❌ 找不到 app.json：' + appJsonPath);
  process.exit(1);
}
let app;
try {
  app = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
} catch (e) {
  console.error('❌ app.json 解析失败：' + e.message);
  process.exit(1);
}

const declared = Array.isArray(app.pages) ? app.pages.slice() : [];
// R423 分包化：声明集合必须含分包页（按 root 拼回完整路径，与 walkPages 的文件路径形式一致）
for (const sp of (app.subpackages || app.subPackages || [])) {
  const root = String(sp.root || '').replace(/\/+$/, '');
  for (const p of (sp.pages || [])) declared.push(root ? root + '/' + p : p);
}
// tabBar 也会引用页面，一并纳入「已声明」
if (app.tabBar && Array.isArray(app.tabBar.list)) {
  for (const it of app.tabBar.list) {
    if (it && typeof it.pagePath === 'string' && !declared.includes(it.pagePath)) {
      declared.push(it.pagePath);
    }
  }
}

// —— ① 声明 → 文件 ——
const declaredSet = new Set();
for (const p of declared) {
  declaredSet.add(p);
  for (const ext of REQUIRED_EXT) {
    const fp = path.join(ROOT, p + ext);
    if (!fs.existsSync(fp)) {
      fail(`app.json 声明了 "${p}"，但缺少 ${p}${ext}`);
    }
  }
}

// —— ② 文件 → 声明 ——
const found = [];
function walkPages(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      walkPages(abs);
    } else if (name.endsWith('.js')) {
      const rel = path.relative(ROOT, abs).split(path.sep).join('/');
      found.push(rel.slice(0, -3)); // 去掉 .js
    }
  }
}
walkPages(path.join(ROOT, 'pages'));
// R423 分包化：页面不再全在 pages/ 下（下界 20 不变：两个根合起来仍在 27 个页面量级）
if (fs.existsSync(path.join(ROOT, 'subpkg'))) walkPages(path.join(ROOT, 'subpkg'));

const orphans = found.filter(
  (p) => !declaredSet.has(p) && !ORPHAN_WHITELIST.includes(p)
);
for (const p of orphans.sort()) {
  fail(
    `pages/ 下存在 "${p}" 但 app.json 未声明 → 孤儿页` +
      `（若确需保留请加进 ORPHAN_WHITELIST 并写明理由；否则连同其专属 i18n 词条一并删除）`
  );
}

// ===== ③④⑤ R297 补挂 · 页面「静默失效」三族（原为守卫盲区）=====
//
// 为什么挂在**本文件**：本文件已是「页面面」守卫且已在 verify_all.js 的 SUITES 里，
//   又**不在**「套件断言数口径」声明名单 ⇒ 扩展它不触发 check_suite_assert_counts /
//   check_suite_count_claims 两座元守卫，也不改套件数（与 R297 M2 轮扩展 check_m2_matrix 同一取舍）。
//
// 为什么这三族要守：它们全部是**编译期与运行期都不报错**的静默失效 ——
//   ③ 死绑定：微信不校验 `bindtap` 指向的方法是否存在，点了没反应、控制台干净；
//   ④ 幽灵调用：`api.call('typo')` 会在真机上抛「函数不存在」，而静态无人核；
//   ⑤ 重复 id：`pageScrollTo({selector})` / `createSelectorQuery` 取到**错的那个**元素，
//      典型症状是「点吸底条没滚动」（R297 M2-B12 的真实形态）。
//
// 🔴 本段自带**反恒真**：正负样本互证 + 四条扫描面下界。缺任一条，
//    「判据被改坏而输出仍绿」就会重新变成盲区。

const stripWxmlC = (s) => s.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
// 去注释必须**保留换行数**，否则报错行号错位
const stripJsC = (s) => {
  const t = s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return t.replace(/(^|[^:\\])\/\/[^\n]*$/gm, '$1');
};
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** ③ 判据纯函数：返回 wxml 里绑定了但 js 里没有定义的 handler 名（已排序） */
function missingHandlers(wxml, js) {
  const hits = new Set();
  const re = /\b(?:bind|catch)(?::)?[a-zA-Z]*\s*=\s*"([^"{}]+)"/g;
  let m;
  while ((m = re.exec(wxml)) !== null) hits.add(m[1].trim());
  const miss = [];
  for (const h of hits) {
    // 方法定义：名字后跟 ( 或 :（对象字面量写法）；前面不能是 . 或 $（避免匹配调用点）
    const defRe = new RegExp('(^|[^A-Za-z0-9_.$])' + escRe(h) + '\\s*[(:]', 'm');
    if (!defRe.test(js)) miss.push(h);
  }
  return miss.sort();
}

/** ⑤ 判据纯函数：返回同页重复出现的 id（已排序） */
function dupIds(wxml) {
  const seen = Object.create(null);
  const re = /\bid\s*=\s*"([^"{}]+)"/g;
  let m;
  while ((m = re.exec(wxml)) !== null) seen[m[1]] = (seen[m[1]] || 0) + 1;
  return Object.keys(seen).filter((k) => seen[k] > 1).sort();
}

// —— 反恒真 · 正负样本互证（判据坏掉时先红自己，再谈全仓）——
{
  const p1 = missingHandlers('<view bindtap="__ghost__"></view>', 'Page({ onTap() {} });');
  if (p1.length !== 1) fail('③ 判据自证失败：正样本（不存在的 handler）未被命中 ⇒ 判据已失效');
  const p2 = missingHandlers('<view bindtap="onTap"></view>', 'Page({ onTap() {} });');
  if (p2.length !== 0) fail('③ 判据自证失败：负样本（已定义 handler）被误杀 ⇒ 判据过严');
  const p3 = dupIds('<view id="a"></view><view id="a"></view>');
  if (p3.length !== 1) fail('⑤ 判据自证失败：重复 id 未被命中');
  const p4 = dupIds('<view id="a"></view><view id="b"></view>');
  if (p4.length !== 0) fail('⑤ 判据自证失败：唯一 id 被误判为重复');
}

// —— 扫描面下界（面退化即判据失效）——
if (found.length < 20) fail(`③④⑤ 扫描面退化：pages/ 下只找到 ${found.length} 个页面（应 ≥20）`);

const cfDir = path.join(ROOT, 'cloudfunctions');
const cfSet = new Set(
  (fs.existsSync(cfDir) ? fs.readdirSync(cfDir) : []).filter((d) =>
    fs.statSync(path.join(cfDir, d)).isDirectory()
  )
);
if (cfSet.size < 30) fail(`④ 扫描面退化：cloudfunctions/ 下只找到 ${cfSet.size} 个函数（应 ≥30）`);

const callMap = new Map(); // fn -> ['page:line']
let boundTotal = 0;
let pullBound = 0;         // ⑥ 有 onPullDownRefresh 且 json 已开启的页数（下界用）

for (const p of found.sort()) {
  const wxmlPath = path.join(ROOT, p + '.wxml');
  const jsPath = path.join(ROOT, p + '.js');
  const rawJs = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf8') : '';
  const js = stripJsC(rawJs);

  // ④ 幽灵调用（扫去注释后的 js）
  {
    // ⚠️ 函数名首字符放宽到 `[A-Za-z_]`：真实云函数都以字母开头，但**拼错成下划线开头**时
    //    一样要抓（变异回灌 M2 组曾用 `__ghostFn__` 当场把这个盲区证出来）
    const re = /api\.call\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g;
    let m;
    while ((m = re.exec(js)) !== null) {
      if (!callMap.has(m[1])) callMap.set(m[1], []);
      callMap.get(m[1]).push(p + ':' + js.slice(0, m.index).split('\n').length);
    }
  }

  // ⑥ 下拉刷新：定义了钩子 ⇒ 该页 json 必须开启（R298X）
  //   根因：仓内曾有 **3 页**（`subpkg/biz/card/edit.js` 成本卡编辑表单 / `subpkg/biz/takeaway/index.js`
  //   外卖试算 / `subpkg/tools/metrics/impact.js` 影响面）各自复制了一段一模一样的
  //   `onPullDownRefresh() { this.load().then(() => wx.stopPullDownRefresh()); },`，
  //   而它们三页的 json `enablePullDownRefresh` 全是 **false** ⇒ 钩子**永不触发**（死槽）。
  //   这类"假功能"页面照常渲染、零报错、控制台干净，人工走查极易放过 ⇒ 只能靠不变量守。
  //   ⚠️ 判据方向刻意选「钩子 ⇒ 开关必须开」：反过来（开关开而钩子缺）微信正常跑、不产生
  //      「看不到效果」的错觉，故不判红。本轮处置＝**删掉三处死钩子**（零行为变更；且 card/edit
  //      与 takeaway 是表单页，给表单页开下拉刷新＝刷新即冲掉未保存输入，属数据丢失隐患）。
  if (/\bonPullDownRefresh\s*\(/.test(js)) {
    const jsonPath = path.join(ROOT, p + '.json');
    let pageJson = null;
    try { pageJson = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch (e) { pageJson = null; }
    if (!pageJson) {
      fail(`⑥ "${p}.js" 定义了 onPullDownRefresh，但 "${p}.json" 读取/解析失败 → 无法确认开关已开`);
    } else if (pageJson.enablePullDownRefresh !== true) {
      fail(`⑥ "${p}.js" 定义了 onPullDownRefresh，但 "${p}.json" 的 enablePullDownRefresh 不是 true → 下拉钩子永不触发（死槽）`);
    } else {
      pullBound++;
    }
  }

  if (!fs.existsSync(wxmlPath)) continue;
  const wxml = stripWxmlC(fs.readFileSync(wxmlPath, 'utf8'));

  // ③ 死绑定
  const boundHere = new Set();
  {
    const re = /\b(?:bind|catch)(?::)?[a-zA-Z]*\s*=\s*"([^"{}]+)"/g;
    let m;
    while ((m = re.exec(wxml)) !== null) boundHere.add(m[1].trim());
  }
  boundTotal += boundHere.size;
  for (const h of missingHandlers(wxml, js)) {
    fail(`③ "${p}.wxml" 绑定了 "${h}"，但 "${p}.js" 里没有该方法定义 → 点击无反应（静默死按钮）`);
  }

  // ⑤ 重复 id
  for (const id of dupIds(wxml)) {
    fail(`⑤ "${p}.wxml" 出现重复 id="${id}" → pageScrollTo / selectorQuery 会取到错元素`);
  }
}

// ③ 绑定面下界（全仓绑定数应远超 100；过小说明正则或扫描面已坏）
if (boundTotal < 100) fail(`③ 扫描面退化：全仓事件绑定总数仅 ${boundTotal}（应 ≥100）`);
// ④ 调用面下界
let callTotal = 0;
callMap.forEach((v) => { callTotal += v.length; });
if (callTotal < 20) fail(`④ 扫描面退化：全仓 api.call 命中仅 ${callTotal}（应 ≥20）`);
for (const [fn, where] of callMap) {
  if (!cfSet.has(fn)) {
    fail(`④ "${where[0]}" 调用云函数 "${fn}"，但 cloudfunctions/${fn}/ 不存在 → 真机必报「函数不存在」`);
  }
}
// ⑥ 下拉刷新面下界（全仓当前有 17 页用下拉刷新；骤降说明 ⑥ 的扫描面/正则已坏）
if (pullBound < 10) fail(`⑥ 扫描面退化：全仓"钩子+开关"齐备的页仅 ${pullBound} 个（应 ≥10）`);

// —— 结论 ——
if (problems.length) {
  console.log('❌ 页面声明校验失败 ' + problems.length + ' 处：');
  problems.forEach((m) => console.log('   ' + m));
  process.exit(1);
}

console.log(
  '✅ 页面声明校验通过（app.json 声明 ' +
    declared.length +
    ' 页，pages/ 下实到 ' +
    found.length +
    ' 页；四件套必需项 .js/.wxml 齐全，无孤儿页；' +
    '③ 死绑定 ' +
    boundTotal +
    ' 个绑定 0 命中、④ ' +
    callMap.size +
    ' 个云函数调用 0 幽灵、⑤ 0 重复 id、⑥ 下拉钩子 ' +
    pullBound +
    ' 页全部已开启）'
);

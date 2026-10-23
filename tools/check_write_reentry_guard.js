#!/usr/bin/env node
// tools/check_write_reentry_guard.js —— 「追加型写」前端重入保护守卫（R408 · 队列 #20）
//
// 为什么必须机器守（这是个**修了但没修好**的典型）：
//   R73 给 `syncCostCard` 加了服务端幂等，注释里明写要挡「网络重试 / 双击」。但
//   `common/idempotency.js::findPriorResult` 是按 `(shop_id, idempotency_key)` 去审计表查，
//   而前端 38 处幂等键**全部**是 `前缀 + Date.now()` —— 每次点击都重新取时间戳。
//   于是双击 = 两个不同的键 ⇒ 服务端认成两次不同请求 ⇒ 照样 INSERT 第二个版本。
//   ⇒ 幂等键真正挡住的只有「同一次请求被网络层原样重投」；「用户点了两次」它挡不住。
//
//   为什么 `wx.showLoading({ mask: true })` 也不算数：遮罩是**渲染后**才拦点击的，
//   同一帧派发的第二个 tap 早已进事件队列，等它执行时遮罩还没上屏。这不是概率问题，是时序问题。
//
//   后果不是"多一个版本"这么轻：成本卡是老板定价的依据，版本链上多出内容完全相同的版本后，
//   他自己也分不清哪版是"真的改过"，久而久之只信第一版。
//
// 哪些是「追加型写」（本守卫的适用面，**逐条有源码依据**，不是按函数名猜）：
//   · `syncCostCard/index.js:163-167` 自述「第 8 步每次都 INSERT 新版本，天然非幂等」；
//   · `saveCostCard` 带 `card_code` ⇒ 新版本（`card/version.js:198` 注释自述"生成新版本"）；
//   · `saveCostCard` 不带 `card_code` ⇒ 新卡（`card/index.js:399` 注释自述"全新 card_code"）。
//   对照：`saveLedger` 按 `(shop_id, month)` upsert、`importSalesBill` 按 `_id` 覆盖写 ⇒
//   终态幂等，双击不会算错账 ⇒ **刻意不纳入本守卫**（收窄判据面，避免"凡写必守"变成噪音）。
//
// 判据（每个目标五条腿，缺一不可，方向互不重复）：
//   ① **函数仍在**：按函数名抽到非空函数体 ⇒ 防改名/删除后守卫静默失效；
//   ② **仍在写**：函数体（剥注释后）仍含 `api.call('<写函数>'` ⇒ 防"把写调用挪走/掏空"后守卫照绿；
//   ③ **守卫在首个 await 之前**：`if (this.data.<flag>) return` 的位置必须早于函数体内第一个 `await`。
//      ⚠️ 放在 await 之后等于没放 —— 那时请求已经发出去了。这是本守卫的**核心语义判据**；
//   ④ **标志真被置位**：`<flag>: true` 出现 ⇒ 防"守卫写了但从不置位" ⇒ `this.data.flag` 恒为假
//      ⇒ **判据恒假、永不拦截**（本仓 R299 恒真④ 的反向形态）；
//   ⑤ **标志真被复位**：`<flag>: false` 出现 ⇒ 防"一次网络失败就永久锁死按钮"（老板只能杀进程）。
//
// 反恒真（本仓强制）：判据抽成纯函数 `analyzeBody`，喂 **5 段合成样本** 证明它既抓得到、也放得过：
//   完整 / 无守卫 / 守卫在 await 之后 / 从不置位 / **守卫只写在注释里**（验 stripComments 真生效）。
//   没有这一段，stripComments 写坏时五条腿会一起恒真。
//
// ⚠️ 本文件**不用正则**（本机落盘会把反斜杠转义坏）—— 一律 indexOf + 切片。
//
// 运行：node tools/check_write_reentry_guard.js   （由 verify_all.js 的 [write-reentry] 套件调用）

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// 反斜杠一律用字符码构造，避免任何转义（本机 tools/ 落盘规则）
const BS = String.fromCharCode(92);

// 目标清单：只有「追加型写 + 用户可点 + 无重入保护」才进这里。
// write 字段用于 ② 判据；flag 字段用于 ③④⑤。
const TARGETS = [
  { file: 'subpkg/biz/card/index.js', fn: 'onSync', flag: 'syncing', write: 'syncCostCard' },
  { file: 'subpkg/biz/card/index.js', fn: 'onBatchSyncRun', flag: 'syncing', write: 'syncCostCard' },
  { file: 'subpkg/biz/card/index.js', fn: 'onCopy', flag: 'copying', write: 'saveCostCard' },
  { file: 'subpkg/biz/card/version.js', fn: 'doRestore', flag: 'restoring', write: 'saveCostCard' },
];

let pass = 0;
const problems = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name); return true; }
  problems.push(name + (detail ? '：' + detail : ''));
  console.log('❌ ' + name + (detail ? '：' + detail : ''));
  return false;
}

// ================= 基础工具（indexOf / 切片，零正则） =================

/** 剥掉 `//` 与块注释，**保留字符串内容**（写调用是字面量，必须留着；注释必须剥掉防恒真）。 */
function stripComments(src) {
  const s = String(src == null ? '' : src);
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s.charAt(i);
    const c2 = i + 1 < n ? s.charAt(i + 1) : '';
    if (c === '/' && c2 === '/') {
      while (i < n && s.charAt(i) !== '\n') i++;
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(s.charAt(i) === '*' && s.charAt(i + 1) === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        const d = s.charAt(i);
        out += d;
        i++;
        if (d === BS) { if (i < n) { out += s.charAt(i); i++; } continue; }
        if (d === quote) break;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** 从 `openIdx`（指向 `{`）起花括号配平。返回含首尾括号的整块；失败 ⇒ ''。 */
function bracesFrom(s, openIdx) {
  if (openIdx < 0) return '';
  let i = openIdx;
  let depth = 0;
  while (i < s.length) {
    const c = s.charAt(i);
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < s.length) {
        const d = s.charAt(i);
        if (d === BS) { i += 2; continue; }
        i++;
        if (d === quote) break;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return s.slice(openIdx, i + 1); }
    i++;
  }
  return '';
}

/**
 * 取**函数定义体**：`name(` 且前一字符不是 `.`（排除 `this.name(` 调用），
 * 且 `{` 必须在下一个 `;` 之前（否则那是"调用 + 别处的块"）。
 * 🔴 R299 实测：只按 `name(` 找首个出现位置会锚到**调用点**，窗口整段错位 ⇒ 判据全假。
 */
function defBodyOf(src, name) {
  const s = String(src || '');
  let i = 0;
  while (i < s.length) {
    const k = s.indexOf(name + '(', i);
    if (k < 0) return '';
    const prev = k > 0 ? s.charAt(k - 1) : '';
    if (prev !== '.') {
      const semi = s.indexOf(';', k);
      const brace = s.indexOf('{', k);
      if (brace >= 0 && (semi < 0 || brace < semi)) {
        const body = bracesFrom(s, brace);
        if (body) return body;
      }
    }
    i = k + name.length + 1;
  }
  return '';
}

/**
 * 核心判据（**纯函数**，合成样本也走这里 ⇒ 反恒真才有意义）。
 * 入参是**未剥注释的原始函数体**；内部先剥。
 * 返回 { guard, beforeAwait, setTrue, setFalse, hasWrite } 五项事实，不在这里下结论。
 */
function analyzeBody(rawBody, flag, write) {
  const body = stripComments(rawBody);
  const guardNeedle = 'if (this.data.' + flag + ') return';
  const guard = body.indexOf(guardNeedle) >= 0;
  const awaitIdx = body.indexOf('await ');
  // 守卫位置：取**第一处**；await 缺失 ⇒ -1（后面判为"无 await，无法定位"）
  const guardIdx = body.indexOf(guardNeedle);
  const beforeAwait = guardIdx >= 0 && awaitIdx >= 0 && guardIdx < awaitIdx;
  const setTrue = body.indexOf(flag + ': true') >= 0;
  const setFalse = body.indexOf(flag + ': false') >= 0;
  const hasWrite = body.indexOf("api.call('" + write + "'") >= 0
    || body.indexOf('api.call("' + write + '"') >= 0;
  return { guard, beforeAwait, setTrue, setFalse, hasWrite, hasAwait: awaitIdx >= 0 };
}

// ================= 主判据 =================

let total = 0;
function tick(n) { total += n; }

for (const t of TARGETS) {
  const full = path.join(ROOT, t.file);
  let src = '';
  try { src = fs.readFileSync(full, 'utf8'); } catch (e) { src = ''; }
  const body = defBodyOf(src, t.fn);
  const tag = t.file + ' :: ' + t.fn;

  // ① 函数仍在
  tick(1);
  const alive = ok('① ' + tag + ' 函数体可抽到', body !== '', '函数改名/删除 ⇒ 守卫静默失效');
  if (!alive) continue;

  const f = analyzeBody(body, t.flag, t.write);

  // ② 仍在写
  tick(1);
  ok('② ' + tag + ' 仍真调用 ' + t.write, f.hasWrite, '写调用被挪走/注释掉 ⇒ 重入保护失去对象');

  // ③ 守卫在首个 await 之前（核心语义）
  tick(1);
  ok('③ ' + tag + ' 守卫在首个 await 之前（flag=' + t.flag + '）', f.beforeAwait,
    f.hasAwait ? '守卫缺失或位于 await 之后 ⇒ 请求已发出，拦不住双击' : '函数体内没有 await，无法定位');

  // ④ 标志真被置位（防"判据恒假"）
  tick(1);
  ok('④ ' + tag + ' 标志 ' + t.flag + ' 真被置为 true', f.setTrue,
    '只写 if 不置位 ⇒ this.data.' + t.flag + ' 恒为假 ⇒ 永不拦截');

  // ⑤ 标志真被复位（防"一次失败永久锁死"）
  tick(1);
  ok('⑤ ' + tag + ' 标志 ' + t.flag + ' 真被复位为 false', f.setFalse,
    '不复位 ⇒ 一次网络失败后按钮永久失效');

  // ⑥ 幂等键仍在传（本轮不是靠它挡双击，但拆掉它连"网络重投"也失守）
  tick(1);
  ok('⑥ ' + tag + ' 仍传 client_request_id', body.indexOf('client_request_id') >= 0,
    '幂等键被移除 ⇒ 网络层重投会重复写');
}

// ⑦ data 初始化里必须声明这些标志（防"引用一个从未声明的键"靠 undefined 的 falsy 巧合工作）
for (const t of TARGETS) {
  const full = path.join(ROOT, t.file);
  let src = '';
  try { src = fs.readFileSync(full, 'utf8'); } catch (e) { src = ''; }
  tick(1);
  ok('⑦ ' + t.file + ' data 里显式声明 ' + t.flag + ': false', src.indexOf(t.flag + ': false') >= 0,
    '未显式声明 ⇒ 靠 undefined 的 falsy 工作，语义上不是"有意的状态位"');
}

// ================= 反恒真：5 段合成样本 =================
// 全部走同一个 analyzeBody ⇒ 证明判据本身既能抓、也能放。
const SAMPLES = [
  {
    name: 'S1 完整实现 ⇒ 五条全真',
    src: [
      '  async onSync(e) {',
      '    if (this.data.syncing) return;',
      '    this.setData({ syncing: true });',
      '    try {',
      "      await api.call('syncCostCard', { card_code: cc, client_request_id: 'x_' + Date.now() });",
      '    } catch (err) { api.toastError(err); }',
      '    finally { this.setData({ syncing: false }); }',
      '  },',
    ].join('\n'),
    expect: { guard: true, beforeAwait: true, setTrue: true, setFalse: true, hasWrite: true },
  },
  {
    name: 'S2 无守卫 ⇒ guard=false（判红）',
    src: [
      '  async onSync(e) {',
      "    await api.call('syncCostCard', { card_code: cc, client_request_id: 'x_' + Date.now() });",
      '    this.setData({ syncing: true, syncing: false });',
      '  },',
    ].join('\n'),
    expect: { guard: false, beforeAwait: false, setTrue: true, setFalse: true, hasWrite: true },
  },
  {
    name: 'S3 守卫在 await 之后 ⇒ beforeAwait=false（判红）',
    src: [
      '  async onSync(e) {',
      '    this.setData({ syncing: true });',
      "    await api.call('syncCostCard', { card_code: cc });",
      '    if (this.data.syncing) return;',
      '    this.setData({ syncing: false });',
      '  },',
    ].join('\n'),
    expect: { guard: true, beforeAwait: false, setTrue: true, setFalse: true, hasWrite: true },
  },
  {
    name: 'S4 从不置位 ⇒ setTrue=false（判据恒假）',
    src: [
      '  async onSync(e) {',
      '    if (this.data.syncing) return;',
      "    await api.call('syncCostCard', { card_code: cc });",
      '    this.setData({ syncing: false });',
      '  },',
    ].join('\n'),
    expect: { guard: true, beforeAwait: true, setTrue: false, setFalse: true, hasWrite: true },
  },
  {
    name: 'S5 守卫只写在注释里 ⇒ 剥注释后 guard=false（恒真③）',
    src: [
      '  async onSync(e) {',
      '    // 已加保护：if (this.data.syncing) return;',
      "    await api.call('syncCostCard', { card_code: cc });",
      '    this.setData({ syncing: true, syncing: false });',
      '  },',
    ].join('\n'),
    expect: { guard: false, beforeAwait: false, setTrue: true, setFalse: true, hasWrite: true },
  },
];

for (const s of SAMPLES) {
  const f = analyzeBody(s.src, 'syncing', 'syncCostCard');
  for (const k of ['guard', 'beforeAwait', 'setTrue', 'setFalse', 'hasWrite']) {
    tick(1);
    ok('S ' + s.name + ' · ' + k + '=' + s.expect[k], f[k] === s.expect[k], '实得 ' + f[k]);
  }
}

// ================= R443：本地草稿必须按店隔离（6 条） =================
// 为什么纳入本守卫：草稿写盘也是「覆盖型写」，但它的后果比「多出一版」更重 ——
//   三个草稿键（sandbox_draft_v1 / draft_month_input_+月 / draft_month_inv_+月）**都不带 shop 维度**，
//   切店后老草稿仍躺在本地 ⇒ M1 填表页会把 A 店填了一半的数当 B 店的初始值，
//   老板一点保存就把 A 店数据写进 B 店账本（跨店污染，事后极难查出）。
//   修法不是改键名（老草稿会变孤儿、旧键还永远删不干净），而是**草稿体记 shop_id + 恢复时严格相等校验**。
// 两条腿（缺一不可，方向互不重复）：
//   ① 写盘：setStorageSync(DRAFT_...) 之后 20 行内，**剥注释后**必须有 `shop_id:`；
//   ② 恢复：getStorageSync(DRAFT_...) 之后 20 行内，必须有 `shop_id ===/!== x.currentShopId()`
//      （两种写法都要认 —— M1 走 `===` 正向分支，沙箱页走 `!==` 的 fail 分支）。
//   剥注释是必须的：注释里就写着 shop_id，不剥 ⇒ 代码删光判据照绿（R299 恒真形态③）。
function stripLineComments(src) {
  return src.split('\n').map(function (ln) {
    const i = ln.indexOf('//');
    return i >= 0 ? ln.slice(0, i) : ln;
  }).join('\n');
}

const DRAFT_TARGETS = [
  { name: 'M1 填表草稿', p: 'subpkg/biz/month/input.js' },
  { name: 'M1 盘点草稿', p: 'subpkg/biz/month/inventory.js' },
  { name: 'M2 测算草稿', p: 'subpkg/tools/sandbox/index.js' }
];

for (const t of DRAFT_TARGETS) {
  const L = stripLineComments(fs.readFileSync(path.join(ROOT, t.p), 'utf8')).split('\n');
  const wi = L.findIndex(function (ln) { return /setStorageSync\(DRAFT_/.test(ln); });
  const ri = L.findIndex(function (ln) { return /getStorageSync\(DRAFT_/.test(ln); });
  const wWin = wi < 0 ? '' : L.slice(wi, wi + 20).join('\n');
  const rWin = ri < 0 ? '' : L.slice(ri, ri + 20).join('\n');
  tick(2);
  ok(t.name + ' · 写盘带 shop_id', /shop_id\s*:/.test(wWin),
    wi < 0 ? '没找到 setStorageSync(DRAFT_)' : '');
  ok(t.name + ' · 恢复校验 shop_id', /shop_id\s*(?:===|!==)\s*\w+\.currentShopId\(\)/.test(rWin),
    ri < 0 ? '没找到 getStorageSync(DRAFT_)' : '');
}

// ================= 汇总 =================
console.log('');
if (problems.length === 0) {
  console.log('总览：' + pass + '/' + total + ' 通过');
  process.exit(0);
}
console.log('总览：' + pass + '/' + total + ' 通过 · 失败 ' + problems.length + ' 项');
for (const p of problems) console.log('  - ' + p);
process.exit(1);

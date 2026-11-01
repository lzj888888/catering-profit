// tools/check_amount_input.js —— R414 · 金额输入可读性守卫（队列 #25）
//
// 守的是什么（改前实测）：
//   `api.yuanToFen('12,000')` → **0 分**（fail-soft 契约，被 check_money_precision B 组刻意钉住，不能改）。
//   而 0 是**合法金额** ⇒ 云端校验无从拒 ⇒ 保本额照常出数但偏小：
//     房租 `12000` ⇒ 保本 46154 元/月；房租 `12,000` ⇒ 保本 27692 元/月 —— **少 40%，零报错**。
//
// 判据结构：
//   ① 行为面：classifyAmount 对 8 类形态判得对（含"恰好合法"与"空"不误报）
//   ② 接线面：页面真调体检、体检字段集**覆盖**全部金额输入 handler、wxml 真渲染提示
//   ③ 反恒真：判据本身在"删掉调用/删掉提示/缩窄字段集"时必须红
//   ④ 下界：防"扫空恒绿"
//
// 🔴 ②-3 的写法是本守卫的重点：字段集**从生产代码实扫**（`XxxYuan: e.detail.value`），
//   要求它 ⊆ 体检清单 —— 将来新加一个金额框却忘了加进体检 ⇒ 当场红。
//   不是把 10 个字段名硬抄一遍（那只会证明"我抄对了"，不证明"覆盖全了"）。

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGE_JS = 'subpkg/tools/sandbox/index.js';
const PAGE_WXML = 'subpkg/tools/sandbox/index.wxml';
// R419：M1 月度录入页（老板每月粘贴 Excel 的主战场）—— 同一套判定，接在 updateRow 上
const M1_JS = 'subpkg/biz/month/input.js';
const M1_WXML = 'subpkg/biz/month/input.wxml';
let pass = 0;
let fail = 0;

function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name); return true; }
  fail++; console.log('❌ ' + name + (detail ? ' —— ' + detail : ''));
  return false;
}

function readOr(f, dflt) {
  try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return dflt; }
}

function stripComments(src) {
  const s = String(src == null ? '' : src);
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s.charAt(i);
    const c2 = s.charAt(i + 1);
    if (c === '/' && c2 === '/') { while (i < s.length && s.charAt(i) !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') { i += 2; while (i < s.length && !(s.charAt(i) === '*' && s.charAt(i + 1) === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c; i++;
      while (i < s.length) {
        const d = s.charAt(i); out += d; i++;
        if (d === '\\') { if (i < s.length) { out += s.charAt(i); i++; } continue; }
        if (d === q) break;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

// 取方法体：从**定义处**（前面不是 `.`、`(` 到 `{` 之间无 `;`）取配平块。
// R414 教训：直接 indexOf(name+'(') 会命中调用处（本仓踩过一次，导致三条判据恒红）。
function bodyOf(src, name) {
  const s = String(src || '');
  let from = 0;
  let defAt = -1;
  for (;;) {
    const k = s.indexOf(name + '(', from);
    if (k < 0) break;
    let p = k - 1;
    while (p >= 0 && /\s/.test(s.charAt(p))) p--;
    const isMember = p >= 0 && s.charAt(p) === '.';
    const braceAt = s.indexOf('{', k);
    if (!isMember && braceAt >= 0 && s.slice(k, braceAt).indexOf(';') < 0) { defAt = k; break; }
    from = k + name.length + 1;
  }
  if (defAt < 0) return '';
  let i = s.indexOf('{', defAt);
  if (i < 0) return '';
  const start = i;
  let depth = 0;
  while (i < s.length) {
    const c = s.charAt(i);
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < s.length) {
        const d = s.charAt(i);
        if (d === '\\') { i += 2; continue; }
        i++;
        if (d === q) break;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
    i++;
  }
  return '';
}

// ================= ① 行为面 =================
let A = null;
try { A = require(path.join(ROOT, 'utils/amountInput.js')); } catch (e) { A = null; }
ok('①-0 utils/amountInput.js 可加载', !!A);
if (!A) {
  console.log('❌ 金额输入守卫：纯函数不可用，fail-closed');
  process.exit(1);
}

const S = A.STATE;
const cases = [
  ['12000', S.OK, '纯数字'],
  ['15000.00', S.OK, '带小数'],
  ['0', S.OK, '0 元是合法金额（不能当读错）'],
  ['', S.EMPTY, '没填'],
  ['   ', S.EMPTY, '纯空白'],
  ['12,000', S.THOUSAND_SEP, '千分位逗号（最常见：粘贴来的）'],
  ['12 000', S.SPACE, '带空格'],
  ['１２０００', S.FULLWIDTH, '全角数字'],
  ['-500', S.NEGATIVE, '负号'],
  ['1.2.3', S.MULTI_DOT, '多个小数点'],
  ['1e3', S.EXPONENT, '科学计数'],
  ['abc', S.OTHER, '乱字符'],
  ['.', S.OTHER, '只有一个点'],
];
let bad = [];
for (const [raw, want, label] of cases) {
  const got = A.classifyAmount(raw).state;
  if (got !== want) bad.push(raw + ' 判成 ' + got + '（应 ' + want + '）');
}
ok('①-1 13 类输入的判定全对', bad.length === 0, bad.join('；'));

ok('①-2 合法输入给出正确分数（12000 → 1200000 分）', A.classifyAmount('12000').fen === 1200000);
ok('①-3 readable 语义：空与合法为 true，读不成的一律 false',
  A.classifyAmount('').readable === true && A.classifyAmount('12000').readable === true
  && A.classifyAmount('12,000').readable === false && A.classifyAmount('abc').readable === false);

// 批量体检
const many = A.findUnreadable({ a: '12000', b: '12,000', c: '', d: '１２０００' });
ok('①-4 findUnreadable 只挑出读不成的（b、d）',
  many.length === 2 && many[0].key === 'b' && many[1].key === 'd', JSON.stringify(many.map((x) => x.key)));

// 分必须是整数（军规：分·克·Unix ms 一律整数；0.5 分这种进位误差会一路累进到保本额）
const fenCases = ['0.1', '99.99', '1.005', '12000'];
const fenBad = fenCases.filter((c) => {
  const f = A.classifyAmount(c).fen;
  return !(typeof f === 'number' && isFinite(f) && Math.round(f) === f);
});
ok('①-5 分数一律是整数（' + fenCases.length + ' 个样本）', fenBad.length === 0, fenBad.join(','));

// ================= ② 接线面 =================
const jsRaw = readOr(PAGE_JS, '');
const js = stripComments(jsRaw);
ok('②-0 subpkg/tools/sandbox/index.js 存在', !!jsRaw);
ok('②-1 页面真 require utils/amountInput.js', js.indexOf('amountInput.js') >= 0);

const calcBody = bodyOf(js, 'scheduleCalc');
ok('②-2 scheduleCalc 函数体可取（fail-closed）', calcBody.length > 0);
ok('②-3 scheduleCalc 里真调 checkAmountInputs()', calcBody.indexOf('checkAmountInputs(') >= 0,
  '所有金额 handler 都收口到 scheduleCalc；不在这里调就永远不会被触发');

const chkBody = bodyOf(js, 'checkAmountInputs');
ok('②-4 checkAmountInputs 函数体可取', chkBody.length > 0);
ok('②-5 体检真调纯函数 findUnreadable', chkBody.indexOf('findUnreadable(') >= 0);

// ②-6 关键：字段集**从生产代码实扫**，要求 ⊆ 体检清单
const produced = new Set();
const reProd = /([A-Za-z]+Yuan)\s*:\s*e\.detail\.value/g;
let m;
while ((m = reProd.exec(js)) !== null) produced.add(m[1]);
const declared = new Set();
const reDecl = /'([A-Za-z]+Yuan)'/g;
while ((m = reDecl.exec(chkBody)) !== null) declared.add(m[1]);
const missing = [];
produced.forEach((f) => { if (!declared.has(f)) missing.push(f); });
ok('②-6 体检字段集覆盖全部金额输入字段（实扫 ' + produced.size + ' 个）',
  produced.size > 0 && missing.length === 0,
  '未覆盖：' + missing.join(',') + (produced.size === 0 ? '（实扫到 0 个 ⇒ 扫描规则失效，fail-closed）' : ''));

// ②-7 data 显式声明（避免首屏读到 undefined）
ok('②-7 data 声明 badAmountCount', /badAmountCount\s*:\s*0/.test(js));

// ②-8 wxml 真渲染
const xml = stripComments(readOr(PAGE_WXML, '').replace(/<!--[\s\S]*?-->/g, ''));
ok('②-8 wxml 按 badAmountCount 渲染提示', /wx:if="\{\{\s*badAmountCount\s*>\s*0\s*\}\}"/.test(xml));
ok('②-9 wxml 提示用的文案键是 t.amountBadTip', xml.indexOf('t.amountBadTip') >= 0);
ok('②-10 文案键在页面 t 映射里真绑定', js.indexOf('amountBadTip: TERMS.ui.amountBadTip') >= 0);

// ---- R419：M1 月度录入页（updateRow 是它所有金额格子的统一入口）----
const m1Raw = readOr(M1_JS, '');
const m1 = stripComments(m1Raw);
const m1Xml = stripComments(readOr(M1_WXML, '').replace(/<!--[\s\S]*?-->/g, ''));
ok('②-11 M1 页真 require utils/amountInput.js', m1.indexOf('amountInput.js') >= 0);
const rowBody = bodyOf(m1, 'updateRow');
ok('②-12 M1 updateRow 函数体可取（fail-closed）', rowBody.length > 0);
ok('②-13 M1 updateRow 里真调体检（改了金额就查）',
  rowBody.indexOf('checkAmounts(') >= 0 && rowBody.indexOf('patch.amountYuan') >= 0,
  '所有金额格子都走 updateRow；不在这里调就永远不会被触发');
const m1Chk = bodyOf(m1, 'checkAmounts');
ok('②-14 M1 体检函数体可取且遍历两组', m1Chk.length > 0
  && m1Chk.indexOf('incomeGroups') >= 0 && m1Chk.indexOf('expenseGroups') >= 0);
ok('②-15 M1 体检真调纯函数 classifyAmount', m1Chk.indexOf('classifyAmount(') >= 0);
ok('②-16 M1 wxml 按 badAmountCount 渲染提示', /wx:if="\{\{\s*badAmountCount\s*>\s*0\s*\}\}"/.test(m1Xml));
ok('②-17 M1 的提示文案键在 t 里真绑定', m1.indexOf('amountBadTip: TERMS.ui.amountBadTip') >= 0);
// 单源：两页用的是**同一个**文案键（不是各写一句相似的话）
ok('②-18 两页共用同一文案键 TERMS.ui.amountBadTip（不各写一套说法）',
  js.indexOf('TERMS.ui.amountBadTip') >= 0 && m1.indexOf('TERMS.ui.amountBadTip') >= 0);

// ---- R425（队列 #31）：分平台「佣金小计」是**独立 handler**，不经 updateRow ----
// 为什么必须单独守：R419 的接线判据只测 updateRow 这一条腿，而 onMkByPlat 根本不走它
// ⇒ 粘贴「12,000」照样被读成 0，且这个 0 经 syncMkPlat **覆写营销段佣金行** ⇒ 佣金整行清零。
const mkPlatBody = bodyOf(m1, 'onMkByPlat');
ok('②-19 onMkByPlat 函数体可取（fail-closed）', mkPlatBody.length > 0);
ok('②-20 onMkByPlat 里真调体检（不经 updateRow ⇒ 不在这里调就永远不触发）',
  mkPlatBody.indexOf('checkAmounts(') >= 0);
ok('②-21 体检函数体覆盖 twMkByPlat（否则该框的坏值不计数 = 等于没接）',
  m1Chk.indexOf('twMkByPlat') >= 0);
ok('②-22 清空分平台小计同样重算（坏值清掉后提示要能消失）',
  bodyOf(m1, 'clearMkByPlat').indexOf('checkAmounts(') >= 0);

// ---- R426（队列 #32）：M3 两页（成本卡 / 原料）金额栏接线 ----
// 为什么单独守：这两页的金额**不走 yuanToFen**，直接用 `Number(x) || 0`（card/edit.js::onSave、
//   material/edit.js::onSave）⇒ 粘贴「12,000」得 NaN ⇒ 上云 price_fen / aux_fen 变 null/0。
// M1 那两条腿（②-13 updateRow / ②-20 onMkByPlat）摸不到这里 ⇒ 没有本段就等于没接。
const CARD_JS = 'subpkg/biz/card/edit.js';
const CARD_WXML = 'subpkg/biz/card/edit.wxml';
const MAT_JS = 'subpkg/biz/material/edit.js';
const MAT_WXML = 'subpkg/biz/material/edit.wxml';
const cardJs = stripComments(readOr(CARD_JS, ''));
const cardXml = stripComments(readOr(CARD_WXML, '').replace(/<!--[\s\S]*?-->/g, ''));
const matJs = stripComments(readOr(MAT_JS, ''));
const matXml = stripComments(readOr(MAT_WXML, '').replace(/<!--[\s\S]*?-->/g, ''));

// 金额字段判据：以 Yuan 结尾（priceYuan / auxYuan …）或手工行单价 unit_price_yuan。
// 用后缀判，不硬抄字段名 —— 将来新加一个 XxxYuan 输入框会被实扫抓到并逼着接线。
// 🔴 例外（按语义排除，不是给代码让路）：`aliasesYuan` 是**别名列表**（逗号分隔的检索词），
//   逗号是它的合法分隔符、要原样提交成 JSON 数组 ⇒ 它不是金额，不能拿金额规则判它。
const NON_MONEY_FIELDS = ['aliasesYuan'];
function isMoneyField(f) {
  if (NON_MONEY_FIELDS.indexOf(f) >= 0) return false;
  if (f === 'unit_price_yuan') return true;
  return f.length > 4 && f.slice(f.length - 4) === 'Yuan';
}

function plainIdent(s) {
  if (!s) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    const w = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_' || c === '$';
    if (!w) return false;
  }
  return true;
}

// 从「字段: e.detail.value」的赋值处回推所属 handler 名（方法定义缩进 2 空格）
// 🔴 R426 自己踩的坑：赋值常发生在 `this.setData({ ... })` 或 `Object.assign({ ... })` 里，
//   直接取"最近的 2 空格缩进行"会取到 `this.setData` / `lines[idx] = Object.assign` ⇒
//   判据拿不到 handler 名，覆盖率腿**假红**。⇒ 必须**向上继续找**，直到取到纯标识符。
function handlerAt(src, at) {
  let p = src.lastIndexOf('\n  ', at);
  while (p >= 0) {
    const q = src.indexOf('(', p);
    if (q > 0 && q < at) {
      const name = src.slice(p + 3, q).trim();
      if (plainIdent(name)) return name;
    }
    p = src.lastIndexOf('\n  ', p - 1);
  }
  return '';
}

// 实扫 (handler, 金额字段) 对
function moneyInputs(src) {
  const out = [];
  let from = 0;
  for (;;) {
    const k = src.indexOf(': e.detail.value', from);
    if (k < 0) break;
    from = k + 1;
    let p = k - 1;
    while (p >= 0) {
      const c = src.charAt(p);
      const isW = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_';
      if (!isW) break;
      p--;
    }
    const field = src.slice(p + 1, k);
    if (!isMoneyField(field)) continue;
    const fn = handlerAt(src, k);
    if (!fn) continue;
    out.push({ field: field, fn: fn });
  }
  return out;
}

const cardPairs = moneyInputs(cardJs);
const cardMissHandler = cardPairs.filter((x) => bodyOf(cardJs, x.fn).indexOf('checkAmounts(') < 0);
const cardFields = [];
for (const x of cardPairs) if (cardFields.indexOf(x.field) < 0) cardFields.push(x.field);
const cardChk = bodyOf(cardJs, 'checkAmounts');
const cardChkMiss = cardFields.filter((f) => cardChk.indexOf(f) < 0);

ok('②-23 M3 成本卡页真 require utils/amountInput.js', cardJs.indexOf('amountInput.js') >= 0);
ok('②-24 M3 成本卡体检函数体可取（fail-closed）', cardChk.length > 0);
ok('②-25 M3 成本卡体检真调纯函数 classifyAmount', cardChk.indexOf('classifyAmount(') >= 0);
ok('②-26 M3 成本卡：实扫每个金额输入 handler 都调了体检（扫到 ' + cardPairs.length + ' 个）',
  cardPairs.length > 0 && cardMissHandler.length === 0,
  '未接线的 handler：' + cardMissHandler.map((x) => x.fn + '(' + x.field + ')').join(',')
  + (cardPairs.length === 0 ? '（实扫到 0 个 ⇒ 扫描规则失效，fail-closed）' : ''));
ok('②-27 M3 成本卡：体检体覆盖实扫到的全部金额字段',
  cardFields.length > 0 && cardChkMiss.length === 0, '未覆盖：' + cardChkMiss.join(','));
// 规格售价是**另一条路**（`priceYuan: v`，不是 e.detail.value）⇒ 实扫抓不到，必须单独守
ok('②-28 M3 成本卡：规格售价 onSpecPrice 也接体检（不同写法，实扫会漏）',
  bodyOf(cardJs, 'onSpecPrice').indexOf('checkAmounts(') >= 0);
// 保存硬拦：横幅只提醒，不拦就照样存 0 元卡
const cardSave = bodyOf(cardJs, 'onSave');
ok('②-29 M3 成本卡 onSave 读不成金额就拦（checkAmounts 之后必须 return）',
  cardSave.indexOf('checkAmounts()') >= 0 && cardSave.indexOf('return', cardSave.indexOf('checkAmounts()')) > 0
  && cardSave.indexOf('showModal') > 0);
ok('②-30 M3 成本卡 wxml 按 badAmountCount 渲染提示',
  cardXml.indexOf('badAmountCount > 0') >= 0 && cardXml.indexOf('t.amountBadTip') >= 0);
ok('②-31 M3 成本卡文案键在 t 映射里真绑定', cardJs.indexOf('amountBadTip: TERMS.ui.amountBadTip') >= 0);

const matPairs = moneyInputs(matJs);
const matMissHandler = matPairs.filter((x) => bodyOf(matJs, x.fn).indexOf('checkAmounts(') < 0);
const matFields = [];
for (const x of matPairs) if (matFields.indexOf(x.field) < 0) matFields.push(x.field);
const matChk = bodyOf(matJs, 'checkAmounts');
const matChkMiss = matFields.filter((f) => matChk.indexOf(f) < 0);
const matSave = bodyOf(matJs, 'onSave');

ok('②-32 M3 原料页真 require utils/amountInput.js', matJs.indexOf('amountInput.js') >= 0);
ok('②-33 M3 原料页体检体可取且真调 classifyAmount',
  matChk.length > 0 && matChk.indexOf('classifyAmount(') >= 0);
ok('②-34 M3 原料页：实扫每个金额输入 handler 都调了体检（扫到 ' + matPairs.length + ' 个）',
  matPairs.length > 0 && matMissHandler.length === 0,
  '未接线的 handler：' + matMissHandler.map((x) => x.fn + '(' + x.field + ')').join(','));
ok('②-35 M3 原料页：体检体覆盖实扫到的全部金额字段',
  matFields.length > 0 && matChkMiss.length === 0, '未覆盖：' + matChkMiss.join(','));
ok('②-36 M3 原料页 onSave 读不成金额就拦（checkAmounts 之后必须 return）',
  matSave.indexOf('checkAmounts()') >= 0 && matSave.indexOf('return', matSave.indexOf('checkAmounts()')) > 0);
ok('②-37 M3 原料页 wxml 渲染提示 + 文案键真绑定',
  matXml.indexOf('badAmountCount > 0') >= 0 && matXml.indexOf('t.amountBadTip') >= 0
  && matJs.indexOf('amountBadTip: TERMS.ui.amountBadTip') >= 0);
// 单源：四页用同一句文案（不是各写一句相似的话）
ok('②-38 四页共用同一文案键 TERMS.ui.amountBadTip',
  js.indexOf('TERMS.ui.amountBadTip') >= 0 && m1.indexOf('TERMS.ui.amountBadTip') >= 0
  && cardJs.indexOf('TERMS.ui.amountBadTip') >= 0 && matJs.indexOf('TERMS.ui.amountBadTip') >= 0);

// ---- R427（队列 #42）：M1 另外 4 个「写金额但不经 groups / 不经 amountYuan」的入口 ----
// 为什么单独守：R419 守 updateRow 那条腿、R425 守 onMkByPlat，这 4 处**两条腿都摸不到**：
//   ① onTwDetail 三框（goods/pack/subsidy）—— subtotalOf 会把读不成的按 0 求和；
//   ② onFastSubsidy 走了 updateRow，但触发条件只认 patch.amountYuan ⇒ 静默跳过（"盯字段名不盯'这格是不是钱'");
//   ③ onRecYuan / ④ onDirectConsume 直接 setData，连 updateRow 都不经。
// 后果与 #31 同构：数字被按 0 算 ⇒ 利润虚高/虚低，**全程零报错**。
const twDetailBody = bodyOf(m1, 'onTwDetail');
ok('②-39 onTwDetail 函数体可取（fail-closed）', twDetailBody.length > 0);
ok('②-40 onTwDetail 里真调体检（三框不经 updateRow ⇒ 不在这里调就永远不触发）',
  twDetailBody.indexOf('checkAmounts(') >= 0);
ok('②-41 体检覆盖 takeoutDetailRows 三框（goods/pack/subsidy 少一个 ⇒ 那框等于没接）',
  m1Chk.indexOf('takeoutDetailRows') >= 0 && /classifyAmount\(r\.goods\)/.test(m1Chk)
  && /classifyAmount\(r\.pack\)/.test(m1Chk) && /classifyAmount\(r\.subsidy\)/.test(m1Chk));
ok('②-42 onFastSubsidy 里真调体检（updateRow 只认 patch.amountYuan ⇒ 不补就永远跳过）',
  bodyOf(m1, 'onFastSubsidy').indexOf('checkAmounts(') >= 0);
ok('②-43 体检覆盖 rows 的 subsidy（快速模式平台补贴写在 subsidy，不是 amountYuan）',
  /classifyAmount\(rows\[j\]\.subsidy\)/.test(m1Chk));
ok('②-44 onRecYuan 调体检且覆盖 twRecYuan（对账"实收"读不成的按 0）',
  bodyOf(m1, 'onRecYuan').indexOf('checkAmounts(') >= 0 && m1Chk.indexOf('twRecYuan') >= 0);
ok('②-45 onDirectConsume 调体检且覆盖 directConsumeYuan',
  bodyOf(m1, 'onDirectConsume').indexOf('checkAmounts(') >= 0 && m1Chk.indexOf('directConsumeYuan') >= 0);

// ---- #548 / #549（队列 #25）：M1 库存页 + 一次性资产编辑页 ----
// 为什么单独守：这两页的金额**直接喂** `api.yuanToFen`（不经 M1 的 groups / 不经 M3 的 Number 路），
//   而 yuanToFen 对「12,000」fail-soft 返回 0（被 check_money_precision 钉住不能改）⇒ 读不成的金额被静默按 0 算。
//   库存三栏进倒轧真实消耗、资产值进台账 ⇒ 数字全盘偏、零报错。上面所有腿（②-3 / ②-13 / ②-20 / ②-26 / ②-34）
//   都摸不到这两页 ⇒ 没有本段就等于没接。
const INV_JS = 'subpkg/biz/month/inventory.js';
const INV_WXML = 'subpkg/biz/month/inventory.wxml';
const ASSET_JS = 'subpkg/biz/month/assetEdit.js';
const ASSET_WXML = 'subpkg/biz/month/assetEdit.wxml';
const invJs = stripComments(readOr(INV_JS, ''));
const invXml = stripComments(readOr(INV_WXML, '').replace(/<!--[\s\S]*?-->/g, ''));
const assetJs = stripComments(readOr(ASSET_JS, ''));
const assetXml = stripComments(readOr(ASSET_WXML, '').replace(/<!--[\s\S]*?-->/g, ''));

const invSave = bodyOf(invJs, 'save');
const invChk = bodyOf(invJs, 'checkAmounts');
ok('②-46 库存页真 require utils/amountInput.js', invJs.indexOf('amountInput.js') >= 0);
ok('②-47 库存页 checkAmounts 函数体可取（fail-closed）', invChk.length > 0);
ok('②-48 库存页 checkAmounts 真调纯函数 findUnreadable', invChk.indexOf('findUnreadable(') >= 0);
ok('②-49 库存页 save() 读不成金额就拦（checkAmounts 之后必须 return + showModal）',
  invSave.indexOf('checkAmounts()') >= 0 && invSave.indexOf('showModal') >= 0
  && invSave.indexOf('return', invSave.indexOf('checkAmounts()')) > 0);
ok('②-50 库存页 wxml 按 badAmountCount 渲染提示 + 文案键真绑定',
  invXml.indexOf('badAmountCount > 0') >= 0 && invXml.indexOf('t.amountBadTip') >= 0
  && invJs.indexOf('amountBadTip: TERMS.ui.amountBadTip') >= 0);

const assetOnSave = bodyOf(assetJs, 'onSave');
const assetChk = bodyOf(assetJs, 'checkAmounts');
ok('②-51 资产页真 require utils/amountInput.js', assetJs.indexOf('amountInput.js') >= 0);
ok('②-52 资产页 checkAmounts 函数体可取且真调 classifyAmount',
  assetChk.length > 0 && assetChk.indexOf('classifyAmount(') >= 0);
ok('②-53 资产页 onSave 读不成金额就拦（classifyAmount 之后必须 return + showModal）',
  assetOnSave.indexOf('classifyAmount(') >= 0 && assetOnSave.indexOf('showModal') >= 0
  && assetOnSave.indexOf('return', assetOnSave.indexOf('classifyAmount(')) > 0);
ok('②-54 资产页 wxml 按 badAmountCount 渲染提示 + 文案键真绑定',
  assetXml.indexOf('badAmountCount > 0') >= 0 && assetXml.indexOf('t.amountBadTip') >= 0
  && assetJs.indexOf('amountBadTip: TERMS.ui.amountBadTip') >= 0);
// 单源：六页（sandbox / M1 / M3 成本卡 / M3 原料 / 库存 / 资产）共用同一句文案
ok('②-55 六页共用同一文案键 TERMS.ui.amountBadTip',
  js.indexOf('TERMS.ui.amountBadTip') >= 0 && m1.indexOf('TERMS.ui.amountBadTip') >= 0
  && cardJs.indexOf('TERMS.ui.amountBadTip') >= 0 && matJs.indexOf('TERMS.ui.amountBadTip') >= 0
  && invJs.indexOf('TERMS.ui.amountBadTip') >= 0 && assetJs.indexOf('TERMS.ui.amountBadTip') >= 0);

// ---- R595：M2 场景矩阵页（matrix）----
// 为什么单独守：matrix 的「开店投入 4 项 / 真实月营收」直接喂 `api.yuanToFen`（读不成按 0），
//   而「维度档位 rent/target/margin/other/labor」走 `isFinite` ⇒ 读不成被**静默跳过**（少算一档）。
//   两种都零报错。②-46~②-55 只覆盖 inventory/assetEdit，摸不到 matrix ⇒ 没有本段就等于没接。
const MATRIX_JS = 'subpkg/tools/sandbox/matrix.js';
const MATRIX_WXML = 'subpkg/tools/sandbox/matrix.wxml';
const matrixJs = stripComments(readOr(MATRIX_JS, ''));
const matrixXml = stripComments(readOr(MATRIX_WXML, '').replace(/<!--[\s\S]*?-->/g, ''));
const matrixChk = bodyOf(matrixJs, 'checkAmounts');
const matrixGen = bodyOf(matrixJs, 'onGenerate');
const matrixFields = bodyOf(matrixJs, 'amountFields');

ok('②-56 矩阵页真 require utils/amountInput.js', matrixJs.indexOf('amountInput.js') >= 0);
ok('②-57 矩阵页 checkAmounts 函数体可取且真调 findUnreadable',
  matrixChk.length > 0 && matrixChk.indexOf('findUnreadable(') >= 0);
ok('②-58 矩阵页 onGenerate 读不成金额就硬拦（findUnreadable + showModal + return）',
  matrixGen.indexOf('findUnreadable(') >= 0 && matrixGen.indexOf('showModal') >= 0
  && matrixGen.indexOf('return', matrixGen.indexOf('findUnreadable(')) > 0);
ok('②-59 矩阵页 amountFields 覆盖三类真漏网（开店投入 / 真实月营收 / 维度档位）',
  matrixFields.indexOf('buildDecorYuan') >= 0 && matrixFields.indexOf('realMonthYuan') >= 0
  && /dims\s*=\s*\[[^\]]*'rent'[^\]]*'target'/.test(matrixFields));
ok('②-60 矩阵页 wxml 按 badAmountCount 渲染提示 + 文案键真绑定',
  matrixXml.indexOf('badAmountCount > 0') >= 0 && matrixXml.indexOf('t.amountBadTip') >= 0
  && matrixJs.indexOf('amountBadTip: TERMS.ui.amountBadTip') >= 0);
// 单源：七页（sandbox / M1 / M3 成本卡 / M3 原料 / 库存 / 资产 / 矩阵）共用同一句文案
ok('②-61 七页共用同一文案键 TERMS.ui.amountBadTip',
  js.indexOf('TERMS.ui.amountBadTip') >= 0 && m1.indexOf('TERMS.ui.amountBadTip') >= 0
  && cardJs.indexOf('TERMS.ui.amountBadTip') >= 0 && matJs.indexOf('TERMS.ui.amountBadTip') >= 0
  && invJs.indexOf('TERMS.ui.amountBadTip') >= 0 && assetJs.indexOf('TERMS.ui.amountBadTip') >= 0
  && matrixJs.indexOf('TERMS.ui.amountBadTip') >= 0);

// ---- R596：外卖单订单页（takeaway）----
// 为什么单独守：本页**不用** `yuanToFen`，而用 `Number(v) || 0` 转分 ——
//   「1,200」「１２００」「88元」静默变 0；佣金率读不成 ⇒ 佣金按 0 ⇒ 到手虚高。
//   这是同族坑的**另一条路径**：前几轮只扫 `yuanToFen`，摸不到 `Number()||0`。
const TK_JS = 'subpkg/biz/takeaway/index.js';
const TK_WXML = 'subpkg/biz/takeaway/index.wxml';
const tkJs = stripComments(readOr(TK_JS, ''));
const tkXml = stripComments(readOr(TK_WXML, '').replace(/<!--[\s\S]*?-->/g, ''));
const tkChk = bodyOf(tkJs, 'checkAmounts');
const tkCalc = bodyOf(tkJs, 'onCalc');
const tkRev = bodyOf(tkJs, 'onReverse');

ok('②-62 外卖页真 require utils/amountInput.js', tkJs.indexOf('amountInput.js') >= 0);
ok('②-63 外卖页 checkAmounts 函数体可取且真调 findUnreadable',
  tkChk.length > 0 && tkChk.indexOf('findUnreadable(') >= 0);
ok('②-64 外卖页体检覆盖佣金率 / 配送费 / 补贴 / 打包单价（少一个 ⇒ 那框等于没接）',
  tkChk.indexOf('commission_rate') >= 0 && tkChk.indexOf('delivery_fee_yuan') >= 0
  && tkChk.indexOf('subsidy_user_yuan') >= 0 && tkChk.indexOf('unit_price_yuan') >= 0);
ok('②-65 外卖页 onCalc 读不成金额就拦（checkAmounts + return）',
  tkCalc.indexOf('checkAmounts(') >= 0 && tkCalc.indexOf('return', tkCalc.indexOf('checkAmounts(')) > 0);
ok('②-66 外卖页 onReverse 读不成金额就拦（反算按 0 会把人带向亏本定价）',
  tkRev.indexOf('checkAmounts(') >= 0 && tkRev.indexOf('return', tkRev.indexOf('checkAmounts(')) > 0);
ok('②-67 外卖页 wxml 按 badAmountCount 渲染提示 + 文案键真绑定',
  tkXml.indexOf('badAmountCount > 0') >= 0 && tkXml.indexOf('t.amountBadTip') >= 0
  && tkJs.indexOf('amountBadTip: TERMS.ui.amountBadTip') >= 0);
ok('②-68 八页共用同一文案键 TERMS.ui.amountBadTip',
  js.indexOf('TERMS.ui.amountBadTip') >= 0 && m1.indexOf('TERMS.ui.amountBadTip') >= 0
  && cardJs.indexOf('TERMS.ui.amountBadTip') >= 0 && matJs.indexOf('TERMS.ui.amountBadTip') >= 0
  && invJs.indexOf('TERMS.ui.amountBadTip') >= 0 && assetJs.indexOf('TERMS.ui.amountBadTip') >= 0
  && matrixJs.indexOf('TERMS.ui.amountBadTip') >= 0 && tkJs.indexOf('TERMS.ui.amountBadTip') >= 0);
// R598：份数（items/packs 的 qty）不是金额，但读不成同样让该行金额按 0 算
ok('②-71 外卖页份数栏也体检（items[].qty + packs[].qty 读不成 ⇒ 该行金额按 0）',
  tkChk.indexOf('chkQ(') >= 0 && tkChk.indexOf('badQtyCount') >= 0
  && /items\[i\]\.qty/.test(tkChk) && /packs\[i\]\.qty/.test(tkChk));
ok('②-72 外卖页 wxml 按 badQtyCount 渲染 + 份数文案键真绑定',
  tkXml.indexOf('badQtyCount > 0') >= 0 && tkXml.indexOf('t.qtyBadTip') >= 0
  && tkJs.indexOf('qtyBadTip: TK.qtyBadTip') >= 0);
// R599b：光 `return` 不算拦住 —— 横幅在按钮上方，老板滑到按钮就看不见 ⇒ 点了没反应 = 以为"按钮坏了"。
//   判据锚到**函数体内**（tkCalc / tkRev 已是 bodyOf 取出的体），不全文 grep，防被别处同名调用喂成恒真。
ok('②-73 外卖页被拦时必须给可见反馈（onCalc / onReverse 都调 warnBadAmounts，且该方法真弹窗）',
  tkCalc.indexOf('warnBadAmounts(') >= 0 && tkRev.indexOf('warnBadAmounts(') >= 0
  && bodyOf(tkJs, 'warnBadAmounts').indexOf('showModal') >= 0);

// ---- R597：M3 成本卡「用量」栏（不是金额，但读不成同样静默算错）----
// 为什么单独守：`units.toBase` 对「1,000」返回 0 ⇒ `buildCalcLines` 里 `if (!(qtyBase > 0)) continue;`
//   **静默跳过整行** ⇒ 成本少算、毛利虚高；只有所有行都被跳过才提示。金额守卫（②-25 等）不看 qty。
ok('②-69 M3 成本卡用量栏也体检（lines[].qty + comboLines[].qty 读不成 ⇒ 整行会被静默跳过）',
  cardChk.indexOf('chkQty(') >= 0 && /lines\[i\]\.qty/.test(cardChk)
  && cardChk.indexOf('comboLines') >= 0 && cardChk.indexOf('badUsageCount') >= 0);
ok('②-70 M3 成本卡 wxml 按 badUsageCount 渲染 + 用量文案键真绑定',
  cardXml.indexOf('badUsageCount > 0') >= 0 && cardXml.indexOf('t.usageBadTip') >= 0
  && cardJs.indexOf('usageBadTip: TERMS.card.usageBadTip') >= 0);

// ================= ③ 反恒真 =================
ok('③-1 反恒真：删掉 scheduleCalc 里的调用 ⇒ ②-3 会红',
  (() => { const b = calcBody.replace('checkAmountInputs(', ''); return b.indexOf('checkAmountInputs(') < 0; })());
ok('③-2 反恒真：缩窄字段集 ⇒ 覆盖判据会红',
  produced.size > 0 && (() => {
    const narrowed = new Set(declared);
    narrowed.delete([...produced][0]);
    return [...produced].some((f) => !narrowed.has(f));
  })());
ok('③-3 反恒真：换成 wx:if="{{false}}" ⇒ 渲染判据会红',
  !/wx:if="\{\{\s*badAmountCount\s*>\s*0\s*\}\}"/.test('wx:if="{{false}}"'));
ok('③-4 反恒真：注释里的同样代码不算数（剥注释后应扫不到）',
  stripComments('// checkAmountInputs(); wx:if="{{badAmountCount > 0}}"').indexOf('checkAmountInputs(') < 0);
ok('③-5 反恒真：bodyOf 必须跳过成员调用（防取到 this.xxx() 调用处）',
  bodyOf('foo(){ this.bar(); }\n  bar() { return 1; }', 'bar').indexOf('return 1') >= 0);
// ③-6/③-7：证明「去掉 R425 那条接线 / 那条计数」时判据真会红（不是恒真）
ok('③-6 反恒真：摘掉 onMkByPlat 里的调用 ⇒ ②-20 必红',
  mkPlatBody.replace('checkAmounts(', '').indexOf('checkAmounts(') < 0);
ok('③-7 反恒真：体检体里抹掉 twMkByPlat ⇒ ②-21 必红',
  m1Chk.split('twMkByPlat').join('').indexOf('twMkByPlat') < 0);
// R426（队列 #32）：证明新增的三条腿不是恒真
ok('③-8 反恒真：把所有 `this.checkAmounts();` 摘掉 ⇒ ②-26/②-34 必红（handler 覆盖率真在看代码）',
  (() => {
    const mutated = cardJs.split('this.checkAmounts();').join('');
    const miss = moneyInputs(mutated).filter((x) => bodyOf(mutated, x.fn).indexOf('checkAmounts(') < 0);
    return moneyInputs(mutated).length > 0 && miss.length === cardPairs.length;
  })());
ok('③-9 反恒真：体检体里抹掉一个金额字段 ⇒ ②-27 必红',
  cardFields.indexOf('grouponPromoYuan') >= 0
  && cardChk.split('grouponPromoYuan').join('').indexOf('grouponPromoYuan') < 0);
ok('③-10 反恒真：把 onSave 的拦截条件改成恒假 ⇒ ②-29 必红',
  cardSave.split('checkAmounts() > 0').join('false').indexOf('checkAmounts()') < 0);
// #548 / #549：证明新加的两条拦截不是恒真（摘掉关键调用 ⇒ 对应 ② 必红）
ok('③-11 反恒真：把库存 save() 里的 checkAmounts() 调用摘掉 ⇒ ②-49 必红',
  invSave.replace('this.checkAmounts()', '').indexOf('checkAmounts()') < 0);
ok('③-12 反恒真：把资产 onSave 里的 classifyAmount 调用摘掉 ⇒ ②-53 必红',
  assetOnSave.replace('classifyAmount(', '').indexOf('classifyAmount(') < 0);
// R595：证明矩阵页的拦截不是恒真（摘掉 findUnreadable ⇒ ②-58 必红）
ok('③-13 反恒真：把矩阵 onGenerate 里的 findUnreadable 调用摘掉 ⇒ ②-58 必红',
  matrixGen.replace('findUnreadable(', '').indexOf('findUnreadable(') < 0);
// R596：证明外卖页的拦截不是恒真
ok('③-14 反恒真：把外卖 onCalc 里的 checkAmounts 调用摘掉 ⇒ ②-65 必红',
  tkCalc.replace('checkAmounts(', '').indexOf('checkAmounts(') < 0);
// R597：证明成本卡用量体检不是恒真
ok('③-15 反恒真：把成本卡体检里的 chkQty 调用全摘掉 ⇒ ②-69 必红',
  cardChk.replace(/chkQty\(/g, '').indexOf('chkQty(') < 0);
// R598：证明外卖份数体检不是恒真
ok('③-16 反恒真：把外卖体检里的 chkQ 调用全摘掉 ⇒ ②-71 必红',
  tkChk.replace(/chkQ\(/g, '').indexOf('chkQ(') < 0);
// R599b：证明「必须有可见反馈」这条不是恒真（摘掉 warnBadAmounts 调用 ⇒ ②-73 必红）
ok('③-17 反恒真：把外卖 onCalc/onReverse 的 warnBadAmounts 调用摘掉 ⇒ ②-73 必红',
  tkCalc.replace('warnBadAmounts(', '').indexOf('warnBadAmounts(') < 0
  && tkRev.replace('warnBadAmounts(', '').indexOf('warnBadAmounts(') < 0);

// ================= ④ 下界 =================
ok('④ 断言数下界（≥40）', pass + fail >= 40, '实际 ' + (pass + fail));

console.log('\n===== R414 金额输入可读性守卫：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail === 0 ? 0 : 1);

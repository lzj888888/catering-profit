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
const PAGE_JS = 'pages/sandbox/index.js';
const PAGE_WXML = 'pages/sandbox/index.wxml';
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
ok('②-0 pages/sandbox/index.js 存在', !!jsRaw);
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

// ================= ④ 下界 =================
ok('④ 断言数下界（≥26）', pass + fail >= 26, '实际 ' + (pass + fail));

console.log('\n===== R414 金额输入可读性守卫：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail === 0 ? 0 : 1);

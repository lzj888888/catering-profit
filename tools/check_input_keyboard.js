#!/usr/bin/env node
// tools/check_input_keyboard.js —— 输入框键盘类型必须能表达该字段的**定义域**（R412 · 队列 #23）
//
// 为什么必须机器守：
//   小程序 `<input type="number">` 调出的是**纯整数键盘**（没有小数点），`type="digit"` 才有。
//   而这几类字段的**真值天然带小数**，且有源码/常识双重依据：
//     · 刷卡/扫码费率 —— 单源默认值就是 `0.6`（`pages/sandbox/index.js` data.channel.cardRate）；
//     · 外卖平台抽成率 —— 从门店后台抄下来常见 21.5 / 22.5（该区文案自己写着"按门店后台实际填"）；
//     · 整包换算量 —— 「一件 12.5 公斤」（同组就是斤/公斤/升的单位选择器）。
//   ⇒ 老板在真机上**填不进真值**：只能填 6 / 22 / 13，或改填克数 12500。
//   后果不是"不好用"：刷卡费率 0.6 被填成 6 ⇒ **放大 10 倍**；抽成 22.5 填成 22 ⇒ 少 0.5 个点。
//   这两项都直接进「挂钩费率」参与保本额计算 ⇒ **结论静默失真、全程零报错**。
//   ⇒ 定性：这不是样式问题，是「输入域不可表达」——和 R406「文案与机制不一致」同族：
//     界面允许你表达的东西 ≠ 你真正需要表达的东西。
//
// 判据（两条语义腿 + 两条防伪腿，方向互不重复）：
//   A **百分比框必须 digit**：input 与*同一父容器内*的 `%` 单位文本配对 ⇒ type 必须是 digit。
//      ⚠️ 窗口取「input 结束 → 下一个 `</view>`」，**不是**"往后 N 个字符"——
//      后者会把下一行的百分号算进来，让上一行的整数框被误判（那是判据错，不是代码错）。
//   B **换算量必须 digit**：`convQty`（「1 件 = [N] 公斤」里的 N）必须 digit ——
//      它同组就是单位 picker（斤/公斤/升…），单位不是克时值天然可为小数。
//   C **反向防误判**：纯计数字段（人数/桌数/座位数/年限）必须**不被**判成百分比框 ——
//      否则守卫会逼人把整数框也改成 digit，属判据过宽。
//   D **防扫空**：已知 9 个百分比字段必须**全部**被扫到（少一个 ⇒ 说明窗口/切片判据失效）。
//      空集会让 A 腿恒真 —— 本仓 R299 记过的恒真形态①（腿锚错地方）。
//
// 反恒真（本仓强制）：判据抽纯函数 `analyzeText`，喂 **7 段合成样本**证明它既抓得到、也放得过：
//   正例 / 反例 / 相邻行不串味 / 整数框不误判 / 换算量正反 / 多行标签 / 空文本扫空。
//
// ⚠️ 本文件**不用正则**（本机落盘会把反斜杠转义坏）—— 一律 indexOf + 切片。
//
// 运行：node tools/check_input_keyboard.js   （由 verify_all.js 的 [input-keyboard] 套件调用）

const fs = require('fs');
const path = require('path');

const problems = [];
let pass = 0;
let total = 0;
function ok(name, cond, detail) {
  total++;
  if (cond) {
    pass++;
    console.log('  ✅ ' + name);
  } else {
    console.log('  ❌ ' + name + (detail ? ' —— ' + detail : ''));
    problems.push(name + (detail ? ' —— ' + detail : ''));
  }
}
const SEP = String.fromCharCode(92);   // 反斜杠（不写字面量，避免本机落盘时被转义坏）

// 单位是「%」的三种写法：字面量 / 绑定名以 Pct 结尾 / 绑定名以 Percent 结尾
const PCT_MARKS = ['>%<', 'Pct}}', 'Percent}}'];
// 已知的百分比字段（下界锚点：少一个就说明判据扫漏了，必须 fail-closed 而不是静默放行）
const PCT_ANCHORS = [
  'channel.takeawayRatio', 'channel.platformRate', 'channel.packRate',
  'channel.groupRatio', 'channel.groupPlatformRate', 'channel.discountRate',
  'channel.cardRate', 'promoRealPct', 'promoCostPct',
];
// 纯计数字段（反向锚点：它们出现在百分比命中集里 ⇒ 判据过宽）
const INT_BINDS = ['headcountNum', 'tablesNum', 'seatsPerTableNum', 'item.years'];
// 换算量（「1 件 = [N] 公斤」）
const CONV_BIND = 'convQty';

function attrOf(tag, name) {
  const key = name + '="';
  const k = tag.indexOf(key);
  if (k < 0) return null;
  const q = tag.indexOf('"', k + key.length);
  if (q < 0) return null;
  return tag.slice(k + key.length, q);
}

function innerBind(v) {
  if (!v) return '';
  const a = v.indexOf('{{');
  const b = v.indexOf('}}');
  return (a >= 0 && b > a) ? v.slice(a + 2, b) : v;
}

// 判据主体（纯函数，合成样本与真实文件共用同一份逻辑）
function analyzeText(text) {
  const src = String(text || '');
  const pctViolations = [];   // 百分比框里 type 不是 digit 的
  const pctBinds = [];        // 被判成百分比框的绑定名
  const intMisjudged = [];    // 纯计数框被误判成百分比框的
  let pctCount = 0;
  let convType = null;
  let convFound = false;
  let inputCount = 0;

  let i = 0;
  while (true) {
    const k = src.indexOf('<input', i);
    if (k < 0) break;
    const e = src.indexOf('>', k);
    if (e < 0) break;
    const tag = src.slice(k, e + 1);
    i = e + 1;
    inputCount++;

    // 同一父容器的窗口：input 结束 → 下一个 </view>
    const vEnd = src.indexOf('</view>', e);
    const win = vEnd < 0 ? src.slice(e) : src.slice(e, vEnd);
    let isPct = false;
    for (const m of PCT_MARKS) if (win.indexOf(m) >= 0) isPct = true;

    const bind = innerBind(attrOf(tag, 'value'));
    const type = attrOf(tag, 'type');

    if (bind === CONV_BIND) { convFound = true; convType = type; }

    if (isPct) {
      pctCount++;
      pctBinds.push(bind);
      if (INT_BINDS.indexOf(bind) >= 0) intMisjudged.push(bind);
      if (type !== 'digit') pctViolations.push({ bind: bind, type: type || '(缺省)' });
    }
  }
  return { inputCount, pctCount, pctBinds, pctViolations, intMisjudged, convFound, convType };
}

// ============ 1. 合成样本：证明判据既抓得到、也放得过 ============
const S_PCT_GOOD = '<view class="row-in-wrap"><input class="ipt" type="digit" value="{{channel.platformRate}}" /><text class="unit">{{t.channelPct}}</text></view>';
const S_PCT_BAD = S_PCT_GOOD.split('type="digit"').join('type="number"');
// 相邻两行：上一行是整数框（单位「人」），下一行是百分比框 —— 用来证明窗口不串味
const S_NEIGHBOR =
  '<view class="row"><input class="row-in" type="number" value="{{headcountNum}}" /><text class="unit">人</text></view>'
  + '<view class="row"><input class="ipt-num" type="number" value="{{channel.cardRate}}" /><text class="unit">{{t.channelPct}}</text></view>';
const S_CONV_BAD = '<view class="conv-wrap"><text class="conv-eq">{{convertLeft}}</text><input class="conv-input" type="number" value="{{convQty}}" /><picker range="{{convUnits}}"><view class="conv-unit">{{convUnit}}</view></picker></view>';
const S_CONV_GOOD = S_CONV_BAD.split('type="number"').join('type="digit"');
// 多行标签（属性换行）——真机可读，切片不能只认单行
const S_MULTILINE = '<input\n  class="ipt-num"\n  type="number"\n  value="{{channel.packRate}}"\n/>\n<text class="unit">{{t.channelPct}}</text>';

const R1 = analyzeText(S_PCT_GOOD);
ok('S1 百分比框 + digit ⇒ 不判红', R1.pctCount === 1 && R1.pctViolations.length === 0,
  'pct=' + R1.pctCount + ' 违例=' + JSON.stringify(R1.pctViolations));
const R2 = analyzeText(S_PCT_BAD);
ok('S2 百分比框 + number ⇒ 判红（正样本，证明判据非恒真）',
  R2.pctViolations.length === 1 && R2.pctViolations[0].bind === 'channel.platformRate',
  JSON.stringify(R2.pctViolations));
const R3 = analyzeText(S_NEIGHBOR);
ok('S3 相邻行不串味：整数框(人) 不被判成百分比框', R3.intMisjudged.length === 0,
  '误判=' + JSON.stringify(R3.intMisjudged));
ok('S3b 相邻行不串味：下面的百分比框仍被抓到', R3.pctViolations.length === 1,
  JSON.stringify(R3.pctViolations));
const R4 = analyzeText(S_CONV_BAD);
ok('S4 换算量 + number ⇒ 判红', R4.convFound === true && R4.convType === 'number',
  'found=' + R4.convFound + ' type=' + R4.convType);
const R5 = analyzeText(S_CONV_GOOD);
ok('S5 换算量 + digit ⇒ 放行', R5.convFound === true && R5.convType === 'digit', 'type=' + R5.convType);
const R6 = analyzeText(S_MULTILINE);
ok('S6 多行标签仍能被切片抓到', R6.pctCount === 1 && R6.pctViolations.length === 1,
  'pct=' + R6.pctCount);
const R7 = analyzeText('');
ok('S7 空文本 ⇒ 扫到 0 个（空集必须由锚点腿兜住，不能自己算通过）',
  R7.pctCount === 0 && R7.inputCount === 0, 'pct=' + R7.pctCount);

// ============ 2. 真实文件 ============
function walk(dir, out) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (f.slice(-5) === '.wxml') out.push(p.split(SEP).join('/'));
  }
  return out;
}
// R423 分包化：页面不再全在 pages/ 下（material/edit 已进 subpkg/biz）
const files = walk('pages', []).concat(walk('subpkg', []));
ok('P1 扫描面：pages 下 wxml 文件数 ≥ 10（防 walk 失效后空集恒真）', files.length >= 10,
  '实得 ' + files.length);

const allBinds = [];
const allViolations = [];
const allMisjudged = [];
let convHit = null;
let convHitFile = '';
let pctTotal = 0;
let inputTotal = 0;
for (const fp of files) {
  const r = analyzeText(fs.readFileSync(fp, 'utf8'));
  inputTotal += r.inputCount;
  pctTotal += r.pctCount;
  for (const b of r.pctBinds) allBinds.push(b);
  for (const v of r.pctViolations) allViolations.push({ file: fp, bind: v.bind, type: v.type });
  for (const b of r.intMisjudged) allMisjudged.push({ file: fp, bind: b });
  if (r.convFound) { convHit = r.convType; convHitFile = fp; }
}

ok('P2 输入框总数 ≥ 40（防切片中途断掉，只扫到一小段）', inputTotal >= 40, '实得 ' + inputTotal);

// 腿 D：锚点全命中（少一个 ⇒ 判据扫漏，A 腿会变空集恒真）
let anchorMiss = 0;
for (const a of PCT_ANCHORS) {
  const hit = allBinds.indexOf(a) >= 0;
  if (!hit) anchorMiss++;
  ok('D 锚点字段被扫到：' + a, hit, '未命中 ⇒ 窗口/切片判据失效');
}
ok('D0 百分比框合计 = 锚点数（没有多余命中 ⇒ 判据不过宽）',
  pctTotal === PCT_ANCHORS.length, '实得 ' + pctTotal + '，锚点 ' + PCT_ANCHORS.length);

// 腿 A：百分比框必须 digit
ok('A1 百分比框 type 非 digit 的个数 = 0',
  allViolations.length === 0,
  allViolations.map((v) => v.file + ' :: ' + v.bind + '=' + v.type).join('；'));

// 腿 B：换算量必须 digit
ok('B1 换算量输入被扫到：' + CONV_BIND, convHit !== null, '未命中 ⇒ 判据扫漏');
ok('B2 换算量 type = digit（单位可为公斤/升 ⇒ 值可为小数）', convHit === 'digit',
  '实得 ' + convHit + '（' + convHitFile + '）');

// 腿 C：反向防误判
ok('C1 纯计数字段被误判成百分比框的个数 = 0', allMisjudged.length === 0,
  JSON.stringify(allMisjudged));
for (const b of INT_BINDS) {
  ok('C2 反向锚点「' + b + '」不在百分比命中集里', allBinds.indexOf(b) < 0, '被判成百分比框了');
}

// ============ 3. 汇总 ============
console.log('');
if (problems.length === 0) {
  console.log('总览：' + pass + '/' + total + ' 通过');
  process.exit(0);
}
console.log('总览：' + pass + '/' + total + ' 通过 · 失败 ' + problems.length + ' 项');
for (const p of problems) console.log('  - ' + p);
process.exit(1);

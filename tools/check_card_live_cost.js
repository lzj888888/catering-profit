// tools/check_card_live_cost.js —— R624 成本卡「自动重算」守卫（第 251 套件）
//
// 这一轮只做一件事：老板改完某一行的用量/单价，吸底条的成本与毛利率**自己变**，
// 不用再往左上角点一下。填表本来就枯燥，多一步就多一层放弃的理由。
//
// 它最容易坏在三个地方，所以三条都钉住：
//   ① **真的在算**：仍然只调 calcBom（引擎单源），本页不复制成本公式（R131 副本等价）；
//   ② **不打扰**：静默跑，不弹 toast / 不弹 loading / 不改标题（他只是改个数）；
//   ③ **不崩不假**：明细不完整就什么都不做（保留上次的数），失败也不清空、不弹错。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const P = (rel) => path.join(ROOT, rel);
let pass = 0, failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? ' ｜ ' + detail : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? ' ｜ ' + detail : '')); }
}
function sec(t) { console.log('\n===== ' + t + ' ====='); }
function stripComments(s) {
  return String(s).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const RAW = fs.readFileSync(P('subpkg/biz/card/edit.js'), 'utf8');
const SRC = stripComments(RAW);

function fnBody(name) {
  // 🔴 必须按「方法定义」定位（行首两空格 + 名字 + 括号），不能用裸 indexOf ——
  //   裸查会先命中 `this.commitLines(...)` 这类**调用处**，抠出来的段落是错的，
  //   于是断言全红而代码其实是对的（本轮真踩过：C-⑦/C-⑧/D 组四连红）。
  const at = SRC.indexOf('\n  ' + name + '(');
  if (at < 0) return '';
  const open = SRC.indexOf('{', at);
  if (open < 0) return '';
  let d = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === '{') d++;
    else if (SRC[i] === '}') { d--; if (d === 0) return SRC.slice(open + 1, i); }
  }
  return '';
}

const LIVE = fnBody('async liveCost');
const SCHED = fnBody('scheduleLive');
const PAYLOAD = fnBody('buildCalcPayload');
const COMMIT = fnBody('commitLines');
const BUILD = fnBody('buildCalcLines');

// ============ A 结构 ============
sec('A 结构（三个函数各司其职）');
ok('A-① 有节流调度 scheduleLive', SCHED.length > 30, '段长=' + SCHED.length);
ok('A-② 有静默重算 liveCost', LIVE.length > 60, '段长=' + LIVE.length);
ok('A-③ 入参由 buildCalcPayload 单点构造（避免与反算/保存各拼一套而漂移）',
  PAYLOAD.length > 80 && /\blines\b/.test(PAYLOAD) && /\bmode\b/.test(PAYLOAD)
  && /loss_pct/.test(PAYLOAD) && /auxYuan/.test(PAYLOAD));
ok('A-④ 节流 900ms（连打「200」不该算三次）', /setTimeout\([\s\S]{0,80}900/.test(SCHED), '');
ok('A-⑤ 重复触发会先 clearTimeout（不会堆一串定时器）',
  /clearTimeout\(this\._liveTimer\)/.test(SCHED) && /this\._liveTimer\s*=/.test(SCHED));

// ============ B 纪律（本页不许自己算成本）============
sec('B 纪律（成本只认引擎，展示层只做换算）');
ok('B-① 🔴 liveCost 必须调云函数 calcBom（本页不复制成本公式）',
  /api\.call\(\s*['"]calcBom['"]/.test(LIVE));
ok('B-② 🔴 liveCost 里不得出现成本公式（÷ 换算系数、出成率折算、× 100 之类）',
  !/yield_rate|出成率|convertFactor|net_unit_cost\s*=/.test(LIVE),
  '命中=' + /yield_rate|出成率|convertFactor/.test(LIVE));
ok('B-③ 毛利率换算用既有 marginTextOf（展示层既有单源，不新写一套）',
  /marginTextOf\(/.test(LIVE));
ok('B-④ 🔴 liveCost 不得改写用户输入（售价/用量/单价一个都不能动）',
  !/priceYuan\s*:/.test(LIVE) && !/qty\s*:/.test(LIVE) && !/unit_price_yuan\s*:/.test(LIVE));

// ============ C 不打扰 ============
sec('C 不打扰（他只是改了个数，不该被打断）');
ok('C-① 🔴 静默：不弹 toast', !/showToast/.test(LIVE));
ok('C-② 🔴 静默：不弹 loading', !/showLoading|hideLoading/.test(LIVE));
ok('C-③ 🔴 静默：不改页面标题', !/setTitle/.test(LIVE));
ok('C-④ 失败不清空、不弹错（保留上次试算值）',
  /catch/.test(LIVE) && !/previewCostFen\s*:\s*0/.test(LIVE),
  '有 catch=' + /catch/.test(LIVE));
ok('C-⑤ 有并发闸（上一轮没回来不叠着发）', /_liveBusy/.test(LIVE));
ok('C-⑥ 空明细直接 return（不清空已有结果、不送空数组给引擎）',
  /if\s*\(!payload\)\s*return/.test(LIVE) && /silent:\s*true/.test(LIVE));
ok('C-⑦ buildCalcLines 支持 silent，且静默时走 warn 而不是直接 showToast',
  /buildCalcLines\(opts\)/.test(SRC) && /const warn\s*=/.test(BUILD) && /if\s*\(!silent\)\s*wx\.showToast/.test(BUILD));
ok('C-⑧ 🔴 buildCalcLines 的默认行为没变（不传参时仍然会提示）',
  (BUILD.match(/wx\.showToast/g) || []).length === 1,
  'showToast 出现 ' + (BUILD.match(/wx\.showToast/g) || []).length + ' 次（应只剩 warn 里那一处）');

// ============ D 接线 ============
sec('D 接线（改料就走这条路）');
ok('D-① commitLines 末尾挂 scheduleLive（所有行编辑都经它）',
  /scheduleLive\(\)/.test(COMMIT));
ok('D-② 损耗率变更挂 scheduleLive', /onLoss\(e\)\s*\{[^\n]*scheduleLive/.test(SRC));
ok('D-③ 辅料金额变更挂 scheduleLive', /onAux\(e\)\s*\{[^\n]*scheduleLive/.test(SRC));
ok('D-④ 套餐卡暂不走这条链路（子卡聚合另算，避免半成品）',
  /cardType === '3'\)\s*return/.test(SCHED));
ok('D-⑤ 既有"改售价即时算毛利率"未被破坏（onPrice 仍用 marginTextOf）',
  /onPrice\(e\)[\s\S]{0,200}marginTextOf/.test(SRC));

console.log('\n===== 自动重算守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);

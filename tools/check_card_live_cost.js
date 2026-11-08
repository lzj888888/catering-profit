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
  // 兼容 `async xxx(` 定义（R628 踩到：showSavedReceipt 是 async，裸查名字取不到 → G-①②③ 全红）
  let at = SRC.indexOf('\n  ' + name + '(');
  if (at < 0) at = SRC.indexOf('\n  async ' + name + '(');
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

// ============ E 「还差哪个数」（R625）============
// 空态原来只说「还没算成本」—— 告诉老板没数，却不告诉下一步，他会反复点然后放弃。
// 这一组判两件事：**顺序对不对**（一次只指一个缺口）、**话是不是人话**（不是报错）。
sec('E 还差哪个数（一次只说一个缺口）');

const TERMS_ALL = require(P('miniprogram/i18n/terms.js')).TERMS;
const CARD = TERMS_ALL.card;
const HINT = fnBody('liveHint');
const WXML = fs.readFileSync(P('subpkg/biz/card/edit.wxml'), 'utf8');

ok('E-① 三条提示文案齐备（缺哪条都是空白，等于没提示）',
  ['hintNeedLine', 'hintNeedQty', 'hintNeedPrice'].every((k) => typeof CARD[k] === 'string' && CARD[k].length >= 6),
  ['hintNeedLine', 'hintNeedQty', 'hintNeedPrice'].map((k) => String(CARD[k] || '').slice(0, 6)).join(' / '));

ok('E-② 提示里不出现「必填 / 错误 / 校验失败」这类报错口径（这里是提示，不是拦人）',
  !/必填|错误|校验失败|非法/.test([CARD.hintNeedLine, CARD.hintNeedQty, CARD.hintNeedPrice].join('')));

// 真跑：把页面里的 liveHint 原文抽出来，注入 data 跑一遍
function runHint(data) {
  // 页面里用的是 TERMS.card.xxx ⇒ 这里必须注入完整 TERMS，不能只给 .card（本轮真踩过）
  const f = new Function('TERMS', 'return function liveHint() {' + HINT + '};')(TERMS_ALL);
  return f.call({ data });
}
const L = (o) => Object.assign({ material_name: '', qty: '', material_id: '', input_type: 2 }, o);

ok('E-③ 一行都没有 ⇒ 提示「先加一行配料」',
  runHint({ cardType: '1', lines: [], previewCostFen: 0, priceYuan: '' }) === CARD.hintNeedLine);

ok('E-④ 🔴 只有空行（点了「添加」还没填）⇒ 也说「先加一行配料」，不能报「第 1 行还差用量」',
  runHint({ cardType: '1', lines: [L({})], previewCostFen: 0, priceYuan: '' }) === CARD.hintNeedLine);

ok('E-⑤ 有配料名但没用量 ⇒ 具体指出哪一行',
  runHint({ cardType: '1', lines: [L({ qty: '100' }), L({ material_name: '牛腩' })], previewCostFen: 0, priceYuan: '' })
    === CARD.hintNeedQty.replace('{n}', '2'));

ok('E-⑥ 配料齐了但成本还没回来 ⇒ 说「还没算成本 · 试算成本」（不许催他填售价）',
  runHint({ cardType: '1', lines: [L({ material_name: '牛腩', qty: '200' })], previewCostFen: 0, priceYuan: '' })
    === CARD.stickyEmpty + ' · ' + CARD.stickyRecalc);

ok('E-⑦ 成本有了、没售价 ⇒ 提示「填上售价就能看毛利」',
  runHint({ cardType: '1', lines: [L({ material_name: '牛腩', qty: '200' })], previewCostFen: 1200, priceYuan: '' })
    === CARD.hintNeedPrice);

ok('E-⑧ 全齐 ⇒ 不啰嗦，提示清空（此时该显示成本与毛利率）',
  runHint({ cardType: '1', lines: [L({ material_name: '牛腩', qty: '200' })], previewCostFen: 1200, priceYuan: '38' }) === '');

ok('E-⑨ 套餐卡暂不提示（子卡聚合另做，避免半成品误导）',
  runHint({ cardType: '3', lines: [], previewCostFen: 0, priceYuan: '' }) === '');

ok('E-⑩ 吸底条真的用 stickyHint 渲染（写了不接 = 白写）',
  /\{\{stickyHint\s*\|\|/.test(WXML));

ok('E-⑪ 三处会改变缺口的地方都刷了提示（改料 / 改售价 / 成本回来）',
  (SRC.match(/refreshHint\(\)/g) || []).length >= 4,
  'refreshHint 出现 ' + (SRC.match(/refreshHint\(\)/g) || []).length + ' 次（含定义处）');

// ============ F 团购价归位（R626）============
// 团购价是**渠道属性**，不是菜品属性：同一个菜可能堂食 28、单独上团购 19.9、套餐里又一个价。
// 实测（真引擎）：把单品团购价 19.9 改成 9.9，套餐团购毛利一分不动（都 10.75）
// ⇒ 它放在菜品卡上只多出一个"这个菜团购到底多少钱"的第二个答案，没有用途。
// 这一组守两件事：**菜品卡上不许再有它**、**团购页仍是唯一入口**。
sec('F 团购价归位（渠道的归渠道）');

const HUB = fs.readFileSync(P('pages/m3/hub.js'), 'utf8');
const GRP_WXML = fs.readFileSync(P('subpkg/biz/groupon/index.wxml'), 'utf8');

ok('F-① 🔴 菜品卡不再有团购价/佣金率/推广费输入（渠道属性不塞进菜品）',
  !/bindinput="onGrouponPrice"|bindinput="onGrouponRate"|bindinput="onGrouponPromo"/.test(WXML),
  '残留=' + /bindinput="onGroupon(Price|Rate|Promo)"/.test(WXML));

ok('F-② 菜品卡给出指路（删了入口不给出路 = 把人堵死）',
  /bindtap="goGrouponPage"/.test(WXML) && typeof CARD.grouponGoLink === 'string' && CARD.grouponGoLink.length > 8);

ok('F-③ 跳转路由与 hub 完全一致（不另造第二条路径）',
  (() => {
    const m1 = HUB.match(/url:\s*'(\/subpkg\/biz\/groupon[^']*)'/);
    const m2 = SRC.match(/goGrouponPage\(\)\s*\{\s*wx\.navigateTo\(\{\s*url:\s*'([^']+)'/);
    return !!m1 && !!m2 && m1[1] === m2[1];
  })());

ok('F-④ 团购页仍是唯一可填入口（价 + 费率都在那儿）',
  /bindinput="onPrice"/.test(GRP_WXML) && /bindinput="onRate"/.test(GRP_WXML));

ok('F-⑤ 删界面不动数据：菜品卡本来就不提交 groupon 字段（无 groupon_price 落库键）',
  !/groupon_price\s*:/.test(SRC) && !/groupon_rate\s*:/.test(SRC),
  '残留=' + /groupon_price\s*:/.test(SRC));

ok('F-⑥ 死代码已清干净（界面上没了的输入，js 里也不许留处理函数与字段）',
  !/onGrouponPrice|onGrouponRate|onGrouponPromo|calcGroupon\b|grouponView|grouponPriceYuan/.test(SRC),
  '残留=' + /onGrouponPrice|calcGroupon\b|grouponView/.test(SRC));

// ============ G 保存回执里的「排第几」（R628）============
// 这是给老板的回报，不是评价。它最危险的坏法只有一个：**在残缺数据上算名次** ——
// 卡多时 getCostCard 会截断且无排序，名次直接是错的，而老板会拿它当依据。
sec('G 保存回执 · 排第几（数据不全宁可不说）');

const RECEIPT = fnBody('showSavedReceipt');
const RANK = fnBody('rankLine');

ok('G-① 🔴 只在「数据未被截断」时才给排名（截断 = 名次错，宁可闭嘴）',
  /dh\.isTruncated\(/.test(RECEIPT) && /!\s*dh\.isTruncated\(/.test(RECEIPT));

ok('G-② 取不到就只说回执（失败静默，不弹错、不影响「已保存」）',
  /catch/.test(RECEIPT) && !/showToast/.test(RECEIPT) && !/toastError/.test(RECEIPT));

ok('G-③ 回执弹窗在排名逻辑之外 —— 排名失败也不许吞掉「已保存」',
  /wx\.showModal\(/.test(RECEIPT) && RECEIPT.indexOf('showModal') > RECEIPT.indexOf('catch'));

ok('G-④ 只统计已定价的卡（未定价若按 0% 算，会把所有人都"抬"到前面）',
  /price_fen\)\s*>\s*0/.test(RANK) && /gross_margin_pct\s*!=\s*null/.test(RANK));

ok('G-⑤ 少于 2 张不说排名（只有自己一张，说排第 1 没有意义）',
  /arr\.length\s*<\s*2/.test(RANK));

// 真跑：把页面里的 rankLine 原文抽出来，注入 TERMS 跑
function runRank(myMargin, list) {
  const self = {};
  const f = new Function('TERMS', 'return function rankLine(myMargin, list) {' + RANK + '};')(TERMS_ALL);
  return f.call(self, myMargin, list);
}
const L2 = (p, m) => ({ price_fen: p, gross_margin_pct: m });

ok('G-⑥ 真跑：我的 74.7% 在 [82, 74.7, 60] 里排第 2',
  runRank(74.7, [L2(3800, 82), L2(2500, 74.7), L2(1990, 60)]) === CARD.rankTpl.replace('{k}', '2').replace('{n}', '3'),
  runRank(74.7, [L2(3800, 82), L2(2500, 74.7), L2(1990, 60)]));

ok('G-⑦ 真跑：最高时说「最高的一道」，不说排第 1',
  runRank(88, [L2(3800, 88), L2(2500, 74.7)]) === CARD.rankFirst.replace('{n}', '2'),
  runRank(88, [L2(3800, 88), L2(2500, 74.7)]));

ok('G-⑧ 真跑：未定价（price_fen=0）不参与 —— 它不该被当成 0% 垫底',
  runRank(50, [L2(0, null), L2(3800, 88), L2(2500, 40)]) === CARD.rankTpl.replace('{k}', '2').replace('{n}', '2'),
  runRank(50, [L2(0, null), L2(3800, 88), L2(2500, 40)]));

ok('G-⑨ 真跑：只有自己一张 ⇒ 不返回排名（空字符串）',
  runRank(74.7, [L2(2500, 74.7)]) === '');

ok('G-⑩ 真跑：并列而非第一时，取较前名次（不人为分出高低）',
  runRank(50, [L2(3800, 88), L2(2500, 50)]) === CARD.rankTpl.replace('{k}', '2').replace('{n}', '2'),
  runRank(50, [L2(3800, 88), L2(2500, 50)]));

ok('G-⑪ 真跑：并列第一时说「最高的一道」（它确实是最高的，不必说"并列第 1"）',
  runRank(74.7, [L2(2500, 74.7), L2(2400, 74.7)]) === CARD.rankFirst.replace('{n}', '2'),
  runRank(74.7, [L2(2500, 74.7), L2(2400, 74.7)]));

console.log('\n===== 自动重算守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);

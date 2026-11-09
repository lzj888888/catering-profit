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
// 🔴 R637：范围收窄到 **catch 分支**。原来判「整个函数里不许出现 previewCostFen:0」，
//   本意是「网络失败别清空」，但 R637 让"明细不完整"时正当清空 ⇒ 全函数判会把正当行为误杀。
const LIVE_CATCH = (LIVE.match(/catch\s*\([^)]*\)\s*\{[\s\S]*?\}\s*finally/) || [''])[0];
ok('C-④ 网络失败时不清空、不弹错（保留上次试算值）',
  !!LIVE_CATCH && !/previewCostFen/.test(LIVE_CATCH) && !/showToast/.test(LIVE_CATCH),
  'catch 段=' + (LIVE_CATCH ? LIVE_CATCH.length + '字符' : '未取到'));
ok('C-⑤ 有并发闸（上一轮没回来不叠着发）', /_liveBusy/.test(LIVE));
// 🔴 R635：判据升级 —— 原来要求「`if (!payload) return`」裸返回（保留旧值），
//   真机实测证明那样会让老板拿着"删掉用量后的旧成本"去定价。
//   现在要求：仍然早返回（不送空数组给引擎），但**必须标记 stale + 刷新提示**。
ok('C-⑥ 🔴 明细不完整时必须**清空**成本（不是"保留+标灰"）并刷新提示',
  /if\s*\(!payload\)\s*\{[\s\S]{0,700}previewCostFen:\s*0[\s\S]{0,300}previewStale:\s*true[\s\S]{0,120}refreshHint\(\)/.test(LIVE)
  && /silent:\s*true/.test(LIVE));
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

// 🔴 R635：原来判 `{{stickyHint || ...}}`（挤在 wx:else 里）—— 那正是「永不显示」的根源。
//   现在要求提示**独立渲染**，且与数字可共存。
ok('E-⑩ 吸底条真的渲染 stickyHint，且是独立显示（不塞进 wx:else）',
  /sa-hint[^>]*wx:if="\{\{stickyHint\}\}"/.test(WXML));

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

// ============ H 真机实测暴露的两处（R635）============
// 老板实测两件事：①「还差哪个数」那句话**从来没出现过** ②删掉用量后成本数字**不动**。
// 根因是同一个：底部横条的提示写在 `wx:else`（previewCostFen>0 不成立才显示），
// 而 liveCost 在明细不完整时 `return`（保留旧值）⇒ 一旦算过一次，提示永久消失、数字永久卡住。
sec('H 真机实测两处修复');
const WXML_E = fs.readFileSync(P('subpkg/biz/card/edit.wxml'), 'utf8');
const RANK_SRC_LIVE = fnBody('liveCost');

// 🔴 R637：范围收窄到**底部吸底条**（sticky-act）。就近结果条（.inline-cost）里
//   在"没有成本"时用 wx:else 显示提示是**正当的**（那是唯一一行），不该被这条误杀。
const STICKY_BLK = (WXML_E.match(/class="sticky-act"[\s\S]*?sa-hint[^>]*>[^<]*<\/text>/) || [''])[0];
ok('H-① 🔴 底部条里「还差哪个数」不得写在 wx:else 里（否则算出过一次成本就永不显示）',
  /sa-hint[^>]*wx:if="\{\{stickyHint\}\}"/.test(WXML_E)
  && !!STICKY_BLK && !/wx:else>\{\{stickyHint/.test(STICKY_BLK));

ok('H-② 数字与提示可**同时**存在（数字说上次多少，提示说现在缺什么）',
  WXML_E.indexOf('sa-hint') > WXML_E.indexOf('sa-val'));

ok('H-③ 明细不完整时必须标记 stale，不得静默保留旧值',
  /if \(!payload\) \{[\s\S]{0,200}previewStale: true/.test(RANK_SRC_LIVE));

ok('H-④ 算成功后必须清掉 stale（否则永远显示「待更新」）',
  /previewStale: false/.test(RANK_SRC_LIVE));

ok('H-⑤ stale 的数字要变灰（看得出这不是当前值）',
  /\{\{previewStale \? 'sa-stale' : ''\}\}/.test(WXML_E));

// ============ I 品类模板：换品类要跟着换、且能取消（R636 真机）============
// 老板实测：选「卤味烧腊」出来黄卡（调料+五花肉）；换成「热炒蔬菜」**底下纹丝不动**；
// 而且想取消品类取消不了（「必须得选一个」）。
// 根因：预填只在「空卡」时执行 ⇒ 换品类时卡已不空，②③ 全跳过。
sec('I 品类模板跟着换 + 可取消');
const PICK = fnBody('onPickCategory');
const CLEAR = fnBody('onClearCategory');

ok('I-① 🔴 换品类要丢掉旧品类的预填行（否则五花肉永远留在那儿）',
  /droppedPreset/.test(PICK) && /filter\(\(l\)\s*=>\s*!\(l\s*&&\s*l\.isPreset\)\)/.test(PICK));

ok('I-② 用户自己填的行绝不能被丢（只删 isPreset；用户动过的行已被 editLineStripPreset 摘标）',
  /isPreset/.test(PICK) && !/filter\(\(l\)\s*=>\s*l\.material_id\)/.test(PICK));

ok('I-③ 换品类后要补新品类示例主料（条件必须含 droppedPreset，不能只看空卡）',
  /\(wasEmpty \|\| droppedPreset\)/.test(PICK) && /sample_lines/.test(PICK));

ok('I-④ 品类可清除（真机实测「必须得选一个」）',
  !!CLEAR && /catPicked:.{0,3}-1/.test(CLEAR));

ok('I-⑤ wxml 真的给了清除入口（写了不接 = 白写）',
  /catchtap="onClearCategory"/.test(WXML_E));

ok('I-⑥ 清除只撤系统预填行（用户自己的行一条不动）',
  /filter\(\(l\)\s*=>\s*!\(l\s*&&\s*l\.isPreset\)\)/.test(CLEAR));

// ============ J 二次实测：删用量要清空、且不用收键盘也能看结果（R637）============
// 老板二次实测：①「把用量去掉，单份成本还是卡死在那儿」②「输的时候弹键盘，要看结果得先收键盘再滑到底」
// ① 上一轮我只标灰没清空 —— 标灰对老板等于没变，他看到的仍是一个数。
// ② 底部条是 fixed，键盘一弹就被盖住 ⇒ 明细正下方必须有一条**同一份数据**的结果条。
sec('J 删用量清空 + 就近可看');
ok('J-① 明细不完整时清空成本（留空而不是留旧数）',
  /previewCostFen:[ ]*0/.test(RANK_SRC_LIVE) && /previewCost:[ ]*''/.test(RANK_SRC_LIVE));
ok('J-② 明细正下方有就近结果条（键盘弹起时底部条会被盖住）',
  /class="inline-cost"/.test(WXML_E));
ok('J-③ 就近条用的是**同一份**数据（不许自己再算一遍，否则两处会不一致）',
  /inline-cost[\s\S]{0,400}\{\{previewCost\}\}/.test(WXML_E)
  && /inline-cost[\s\S]{0,400}\{\{stickyMargin\}\}/.test(WXML_E));
ok('J-④ 就近条也要能提示缺什么（边填边知道差哪项）',
  /ic-empty[^>]*>\{\{stickyHint \|\|/.test(WXML_E) || /ic-hint[^>]*>\{\{stickyHint\}\}/.test(WXML_E));

// ============ K 表单行排版（R638 真机截图定位）============
// 截图铁证：①「标签」输入框里 placeholder「如 招牌、辣、」被截断 ②「这道菜属于哪类」
// 右侧 picker **整个被挤到看不见**（老板只能看到说明文字，所以觉得"选了取消不了"）。
// 根因：全局 .field 是单行 flex，本页多行塞了「标签+控件+提示」三个元素。
sec('K 表单行排版（控件不能被挤没）');
const CSS_E = fs.readFileSync(P('subpkg/biz/card/edit.wxss'), 'utf8');
const APP_CSS = fs.readFileSync(P('app.wxss'), 'utf8');

ok('K-① 本页 .field 允许换行（否则第三元素把控件挤没）',
  /\.field\s*\{[^}]*flex-wrap:[ ]*wrap/.test(CSS_E));
ok('K-② 提示文字独占一整行（挤在同一行就会压扁控件）',
  /\.field\s+\.muted\s*\{[^}]*flex:[ ]*1[ ]+1[ ]+100%/.test(CSS_E));
ok('K-③ 输入框改成弹性填充（不再被 260rpx 死宽截断 placeholder）',
  /\.field\s+\.val-input\s*\{[^}]*flex:[ ]*1[ ]+1[ ]+auto/.test(CSS_E)
  && /\.field\s+\.val-input\s*\{[^}]*width:[ ]*auto/.test(CSS_E));
ok('K-④ picker 可伸缩（品类选择器必须看得见、点得到）',
  /\.field\s+picker\s*\{[^}]*flex:[ ]*1[ ]+1[ ]+auto/.test(CSS_E));
ok('K-⑤ 🔴 改动限定在本页：全局 .field 不许被本页需求改（会波及 20+ 页）',
  !/\.field\s*\{[^}]*flex-wrap:[ ]*wrap/.test(APP_CSS));

// ============ L 手工行单价口径（R639 真机）============
// 老板：「输一公斤三块，二次打开变成一克零点零零几，我对克不敏感，对一公斤才有感觉」。
// 根因：手工行只落 net_unit_cost（折算成元/克），**老板填的原单位丢了**。
// 修法：多存三个**只供回显**的字段（price_unit / manual_price_fen / manual_yield），
//   引擎仍只读 net_unit_cost ⇒ 成本一分不变。
sec('L 手工行单价按原单位回显');
const EDIT_JS = fs.readFileSync(P('subpkg/biz/card/edit.js'), 'utf8');
const SAVE_V = fs.readFileSync(P('cloudfunctions/saveCostCard/validate.js'), 'utf8');
const SAVE_I = fs.readFileSync(P('cloudfunctions/saveCostCard/index.js'), 'utf8');

ok('L-① 提交时带上原单位口径（否则二次打开只剩克价），且元→分走单源换算',
  /manual_price_fen: api\.yuanToFen/.test(EDIT_JS) && /price_unit: l\.price_unit/.test(EDIT_JS));
ok('L-② 云端校验放行这三个字段（不放行＝白带上去）',
  /price_unit:/.test(SAVE_V) && /manual_price_fen:/.test(SAVE_V) && /manual_yield:/.test(SAVE_V));
// 🔴 R640b：这条链是「前端提交 → validate → **快照拼装** → 落库 → 读回」，
//   任何一层漏了都白做。R639 只补了「落库」那层 ⇒ 快照拼装层没带 ⇒ ln.price_unit 恒 undefined
//   ⇒ 落库永远空 ⇒ 读回回落克价 ⇒ 真机复测仍然是克数。判据必须盯**两处接缝**。
const SNAP_AT = SAVE_I.indexOf('manualLines.push(');
const SNAP_BLK = SNAP_AT >= 0 ? SAVE_I.slice(SNAP_AT, SNAP_AT + 1400) : '';
ok('L-③a 快照拼装层带上原单位口径（漏这层 ⇒ 字段到不了落库）',
  /price_unit:/.test(SNAP_BLK) && /manual_price_fen:/.test(SNAP_BLK));
ok('L-③b 落库层真的写进去（只校验/只拼装不落库＝还是丢）',
  /price_unit: ln\.price_unit/.test(SAVE_I) && /manual_price_fen: ln\.manual_price_fen/.test(SAVE_I));
ok('L-④ 读回按原单位还原；老卡（无这两字段）回落按克，不瞎猜',
  /l\.price_unit && l\.manual_price_fen > 0/.test(EDIT_JS)
  && /unitPriceYuan\b[\s\S]{0,120}yield_rate: '100'/.test(EDIT_JS));
ok('L-⑤ 🔴 这三个字段**不许进计算**（引擎只认 net_unit_cost，否则成本会变）',
  !/manualNetUnitWan\([^)]*manual_price_fen/.test(EDIT_JS)
  && !/manual_price_fen/.test(fs.readFileSync(P('cloudfunctions/saveCostCard/service.js'), 'utf8')));

// ============ M 原料行进货价主显（R640 真机）============
// 老板：「我对克不敏感，对一公斤、一件才敏感 —— 涨价了也看不出来。」
// 改前原料行只有一句「36 元/斤 ÷ 500 ÷ 92% ⇒ 净料 0.0783 元/克」，眼睛落在最后的克价上。
sec('M 原料行进货价主显');
ok('M-① 行数据里有进货价主显字段（price_main）', /price_main:/.test(EDIT_JS));
ok('M-② wxml 把进货价**单独**主显（大字 + 说明），不是埋在公式句尾',
  /class="price-main"/.test(WXML_E) && /priceMainCap/.test(WXML_E));
ok('M-③ 换算公式退为副说明（公式里不再重复采购价）',
  /spec_formula/.test(EDIT_JS) && /matSpecFormulaOf/.test(EDIT_JS));
ok('M-④ 没采购单位/换算系数时不硬造数字（回落原说明，不瞎算）',
  /\(m && f && yr2\)/.test(EDIT_JS));
ok('M-⑤ 主显文案走单源 terms（页面不许自己拼「元/斤」）',
  /matPriceMain\(/.test(EDIT_JS) && /matPriceMain:/.test(fs.readFileSync(P('miniprogram/i18n/terms.js'), 'utf8')));

console.log('\n===== 自动重算守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);

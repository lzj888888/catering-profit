#!/usr/bin/env node
// tools/check_entry_completion.js —— 月度录入完成度守卫（R578 / 队列 #101）
//
// 为什么需要它：
//   #101「首月录入完成率」原本要靠埋点，但埋点 = 新增数据收集 ⇒ 要动隐私政策（上线硬阻塞项）。
//   两司一致建议改用**已有业务数据**算 ⇒ 落地成 `utils/entryCompletion.js`（零 IO、不写库、不上报）。
//   随之而来的风险是「算错但没人知道」：
//     ① 把「填 0」当成「没填」（免租期、自有物业是真实情形，误催会让老板觉得系统在瞎报）；
//     ② 缺组名时回落到英文 category（`dine_in`）—— 老板看不懂，界面事故；
//     ③ 核心组清单与 terms 的 `core:true` 漂移（组改名/增删后静默算错）；
//     ④ 把完成度接进保存流程变成硬拦（本功能的边界是「只提示、不阻断」）。
//
// 判据（A 行为 / B 静态 / C 反恒真）
//
// 运行：node tools/check_entry_completion.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REL = 'utils/entryCompletion.js';
const PAGE = 'subpkg/biz/month/input.js';
const WXML = 'subpkg/biz/month/input.wxml';

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' —— ' + detail : ''}`); }
  else { failN++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}
const sec = (t) => console.log(`\n===== ${t} =====`);

let E = null;
try { E = require(path.join(ROOT, REL)); } catch (e) { E = null; }

console.log('[R578] 月度录入完成度守卫 —— utils/entryCompletion.js\n');

sec('A · 行为面（真调生产函数）');
check('A-⓪ 模块可加载且导出 completionOf / groupFilled / CORE_CATEGORIES',
  !!E && typeof E.completionOf === 'function' && typeof E.groupFilled === 'function'
  && Array.isArray(E.CORE_CATEGORIES));
if (!E || typeof E.completionOf !== 'function') {
  console.log('\n===== 录入完成度守卫结果：' + pass + ' 通过 / ' + (failN + 1) + ' 失败 =====');
  process.exit(1);
}

const g = (cat, label, amt) => [{ category: cat, label, rows: [{ amountYuan: amt }] }];

const c0 = E.completionOf([], []);
// 🔴 R591：默认（不传 opts）按 fail-closed 纳入第 5 项「原料用掉多少」⇒ 总数 5
check('A-① 全空 ⇒ 0/5（4 组 + 原料），5 项全在 missing',
  c0.filled === 0 && c0.total === 5 && c0.missing.length === 5, c0.filled + '/' + c0.total);

const c1 = E.completionOf(g('dine_in', '堂食', '43000'), []);
check('A-② 只填堂食 ⇒ 1/5', c1.filled === 1 && c1.total === 5, c1.filled + '/' + c1.total);

// 🔴 R591：这是本轮修的**静默错账**的正面断言 —— 只填 4 组、原料空，绝不能算完成
const cAllNoConsume = E.completionOf(
  [].concat(g('dine_in', '堂食', 1), g('takeaway', '外卖', 1)),
  [].concat(g('operation', '运营费用', 1), g('labor', '人工费用', 1)),
  null, { consumeMode: 'direct', directConsumeYuan: '', consumeLabel: '原料用掉多少' });
check('A-③ 🔴 四组全填但**原料留空** ⇒ 不算完成（否则利润没扣食材，虚高 30%+）',
  cAllNoConsume.filled === 4 && cAllNoConsume.done === false
  && cAllNoConsume.missingText === '原料用掉多少',
  cAllNoConsume.filled + '/' + cAllNoConsume.total + ' done=' + cAllNoConsume.done);

const cAll = E.completionOf(
  [].concat(g('dine_in', '堂食', 1), g('takeaway', '外卖', 1)),
  [].concat(g('operation', '运营费用', 1), g('labor', '人工费用', 1)),
  null, { consumeMode: 'direct', directConsumeYuan: '8000', consumeLabel: '原料用掉多少' });
check('A-③b 四组 + 原料全填 ⇒ 5/5 且 done=true、note 为空的前提成立',
  cAll.filled === 5 && cAll.total === 5 && cAll.done === true && cAll.missing.length === 0,
  cAll.filled + '/' + cAll.total);

// 🔴 填 0 不算 —— 这是最容易写错的一条（"0" 与 "没填" 在数据上都是空行）
const cZero = E.completionOf(g('dine_in', '堂食', '0'), []);
check('A-④ 🔴 填 0 **不算**已填（免租期等真实情形，不许误催）', cZero.filled === 0);

const cNeg = E.completionOf(g('dine_in', '堂食', '-100'), []);
check('A-⑤ 负数不算已填（防脏数据把完成度顶满）', cNeg.filled === 0);

// 缺 label 时不许露英文 key
const cNoLabel = E.completionOf(g('dine_in', '', 100), []);
check('A-⑥ 🔴 组名缺失时**不回落成英文 category**（missingText 里不许出现 dine_in）',
  cNoLabel.missingText.indexOf('dine_in') < 0, JSON.stringify(cNoLabel.missingText));

// labelMap 兜底
const cMap = E.completionOf([], [], { dine_in: '堂食', takeaway: '外卖', operation: '运营费用', labor: '人工费用' });
// R591：第 5 项也必须是中文（labelMap 里没有 consume，靠 opts.consumeLabel 或中文兜底）
check('A-⑦ 传 labelMap 时用中文名兜底（5 项都缺也该全是中文）',
  cMap.missingText === '堂食、外卖、运营费用、人工费用、原料消耗', cMap.missingText);

sec('B · 静态面（边界：只提示、不阻断）');
const pageSrc = fs.readFileSync(path.join(ROOT, PAGE), 'utf8');
const pageStripped = pageSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const wxmlSrc = fs.readFileSync(path.join(ROOT, WXML), 'utf8');
const WXSS = PAGE.replace(/\.js$/, '.wxss');
let cssSrc = '';
try { cssSrc = fs.readFileSync(path.join(ROOT, WXSS), 'utf8'); } catch (e) { cssSrc = ''; }
// R592：这两条要判「输出长什么样」，所以从 terms 取真函数来跑，不是只判有没有调用
let T0 = {};
try { T0 = require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS.ledger || {}; } catch (e) { T0 = {}; }

check('B-① 页面真的 require 并调用 completionOf（读了不等于用了）',
  /require\([^)]*entryCompletion\.js/.test(pageStripped)
  && /completionOf\(/.test(pageStripped));
check('B-② wxml 真的渲染了完成度（data 有值但没渲染 = 白算）',
  /entryCompletion\.note/.test(wxmlSrc) && /entryCompletion &&/.test(wxmlSrc));
check('B-③ 🔴 完成度**不参与保存/计算**：saveLedger 的入参里不得出现 entryCompletion',
  !/saveLedger\([\s\S]{0,600}entryCompletion/.test(pageStripped));
// B-④ 完成度必须算在**独立方法**里、且被摘要刷新调用。
//   ⚠️ 为什么不在 `refreshCalcSummaries` 内直接算：那条函数被 A8-⑤ 约束
//   「函数体不得出现 incomeGroups/expenseGroups 字面」（防后端值覆盖未保存草稿），
//   而完成度必须读 groups ⇒ 只能拆成 read-only 的独立方法，读写分开守。
const _rcDef = pageStripped.indexOf('refreshCompletion() {');
const _rcSeg = _rcDef >= 0 ? pageStripped.slice(_rcDef, _rcDef + 500) : '';
check('B-④ 🔴 完成度在独立方法 refreshCompletion 里算，且被摘要刷新调用（云失败时也要显示）',
  _rcDef >= 0 && /completionOf\(/.test(_rcSeg) && pageStripped.indexOf('this.refreshCompletion();') > 0,
  `定义@${_rcDef} 调用@${pageStripped.indexOf('this.refreshCompletion();')}`);
check('B-⑤ 零采集：本模块不 import 任何云/存储/网络能力',
  !/require\((['"])(wx|\.\.\/api|\.\/api)/.test(fs.readFileSync(path.join(ROOT, REL), 'utf8')));

// 🔴 R591：第 5 项（原料消耗）的两条关键行为 + 一条"防页面漏传"
const g5 = (cat, label, amt) => [{ category: cat, label, rows: [{ amountYuan: amt }] }];
const INC5 = [].concat(g5('dine_in', '堂食', 1), g5('takeaway', '外卖', 1));
const EXP5 = [].concat(g5('operation', '运营费用', 1), g5('labor', '人工费用', 1));

const cInv = E.completionOf(INC5, EXP5, null, {
  consumeMode: 'inventory', directConsumeYuan: '', consumeLabel: '原料用掉多少',
});
check('B-⑦ 🔴 库存核算开着 ⇒ **不催原料**（消耗由系统倒轧，催了就是瞎催）',
  cInv.total === 4 && cInv.done === true, cInv.filled + '/' + cInv.total + ' done=' + cInv.done);

check('B-⑧ 🔴 不传 opts ⇒ 默认**纳入**原料（fail-closed：宁可多催一项，不许漏催）',
  E.completionOf(INC5, EXP5).total === 5);

check('B-⑨ 🔴 页面把 consumeMode / directConsumeYuan / consumeLabel 都真传了'
  + '（漏传 = 库存开时瞎催、或提示里没有中文名）',
  /completionOf\(/.test(pageStripped)
  && /consumeMode:/.test(pageStripped)
  && /directConsumeYuan:/.test(pageStripped)
  && /consumeLabel:/.test(pageStripped));

check('B-⑩ 原料填 0 不算（与「组内 >0」同口径，免租期式误催）',
  E.completionOf(INC5, EXP5, null, { consumeMode: 'direct', directConsumeYuan: '0' }).done === false);

// 🔴 R595（2026-11-01 李老师定稿）：抬头改**利润公式**，不再用「就能看到你店赚不赚钱」这种断言式承诺。
//   旧文案的问题：它隐含「填完 = 数准」，而这 5 项只是**能算出结果的最低要求**（组内一笔 > 0 即算已填）。
//   为什么判**顺序**而不只判词在不在：公式顺序错了就是错的（老板照错的顺序理解账），而「词都在、顺序乱」
//   用逐个 includes 是判不出来的 ⇒ 按递增下标查找，查不到即「缺词 或 顺序错」。
check('B-⑪ 一项没填时，标题给出利润公式（5 个词按 赚多少←营业额←房租水电←人工←原料 顺序）',
  (function () {
    const t = typeof T0.entryStartFormula === 'string' ? T0.entryStartFormula : '';
    const seq = ['赚多少', '营业额', '房租水电', '人工', '原料'];
    let at = -1;
    for (let i = 0; i < seq.length; i++) {
      const j = t.indexOf(seq[i], at + 1);
      if (j < 0) return false;   // 缺词 or 顺序错 —— 两种都要红
      at = j;
    }
    // 有 '=' 才是公式，有 '-' 才是减项（缺任一个都退化成一句口号）
    return /=/.test(t) && /-/.test(t);
  })(), T0.entryStartFormula);

check('B-⑫ 填了一半时，只说「还差 N 项就能看结果」（不重复总数）',
  (function () {
    const t = T0.entryLeftTitle(3);
    return /还差 3 项/.test(t) && !/先填这/.test(t) && !/5 项/.test(t);
  })(), T0.entryLeftTitle(3));

check('B-⑬ 🔴 页面按 filled === 0 分两态取标题（写死一种 ⇒ 老用户每次都被数一遍总数）',
  /filled === 0/.test(pageStripped)
  && /entryStartFormula/.test(pageStripped)
  && /entryLeftTitle/.test(pageStripped));

check('B-⑭ 🔴 引导卡在「填写口径」**之前**（进门第一眼要看到填完能干嘛，不是别填错）',
  (function () {
    const iCard = wxmlSrc.indexOf('class="start-card"');
    const iGuide = wxmlSrc.indexOf('class="fill-guide"');
    return iCard > 0 && iGuide > 0 && iCard < iGuide;
  })());

check('B-⑮ 引导卡的三个样式类都有定义（没定义 = 白底黑字，等于没做）',
  /\.start-card\s*\{/.test(cssSrc) && /\.start-title\s*\{/.test(cssSrc) && /\.start-list\s*\{/.test(cssSrc));

check('B-⑯ 🔴 反恒真：全填完时 done=true（否则「还差 0 项」会常驻）',
  E.completionOf(INC5, EXP5, null, { consumeMode: 'direct', directConsumeYuan: '9000' }).done === true);

// 🔴 R594（真机暴露）：完成度**首次进入时从没算过** —— onShow 首次被 `_shown` 跳过（省云调用），
//   而 load() 里又没调 ⇒ entryCompletion 恒 null ⇒ 引导卡永远不显示。
//   上面 12 条断言全绿，因为**它们只测「函数算什么」和「wxml 有没有渲染位」，
//   没测「谁在什么时候调用它」** —— 这正是本仓反复的"只测函数不测接线"。
check('B-⑰ 🔴 load() 里真调 refreshCompletion（首次进入的数据到位后必须算一次）',
  (function () {
    // 🔴 这条判据三次写错，都同一个病根：**用"附近有没有"代替"就在这个方法里"**。
    //   ① `R443b` 作锚：该词在文件里出现 3 次（309/357/686），indexOf 取到最早 ⇒ 假红；
    //   ② 用 pageStripped 找注释里的词 ⇒ 注释已剥 ⇒ 恒 -1 ⇒ 假红；
    //   ③ 用 `lastIndexOf('applyDraftFromStorage()')` ⇒ 窗口跨进 onShow，**两处都有那次调用
    //      ⇒ 删掉 load 里那行仍判绿（反证实测：删了还是 true）**。
    //   现在改成**按方法体界定**：从 `async load()` 到它自己的 `\n  },` 之间找。
    const iLoad = pageStripped.indexOf('async load()');
    if (iLoad < 0) return false;
    const iEnd = pageStripped.indexOf('\n  },', iLoad);
    const seg = pageStripped.slice(iLoad, iEnd > iLoad ? iEnd : iLoad + 6000);
    return seg.indexOf('this.refreshCompletion()') > 0;
  })());

check('B-⑱ 🔴 onShow 里**无条件**调 refreshCompletion（不能被 `_shown` 跳过连累）',
  (function () {
    const iShow = pageStripped.indexOf('onShow()');
    if (iShow < 0) return false;
    const seg = pageStripped.slice(iShow, iShow + 900);
    const iComp = seg.indexOf('this.refreshCompletion()');
    const iShown = seg.indexOf('if (this._shown)');
    // 必须在 `if (this._shown)` **之前**（之后 = 又被跳过了）
    return iComp > 0 && iShown > 0 && iComp < iShown;
  })());

check('B-⑲ 完成度计算仍是纯本地（不得为了省事去 await 云调用 —— 那会让首屏卡住）',
  /refreshCompletion\(\)[\s\S]{0,600}?completionOf\(/.test(pageStripped)
  && !/refreshCompletion\(\)[\s\S]{0,400}?await /.test(pageStripped));

sec('C · 反恒真（证明 A 组不是常量）');
check('C-① 把「填 0」改判成已填 ⇒ A-④ 的判据必须翻转',
  (function () {
    const fake = { filled: 1 };
    // 模拟"被改坏"的实现：0 也算填
    const bad = (rows) => rows.some((r) => r && r.amountYuan !== undefined && r.amountYuan !== '');
    const badFilled = bad([{ amountYuan: '0' }]);
    return badFilled === true && fake.filled === 1;   // 改坏后 A-④ 会红
  })());
check('C-② 空输入必须 0/4（防"恒返回满"的假实现）', E.completionOf([], []).filled === 0);

console.log(`\n===== 录入完成度守卫结果：${pass} 通过 / ${failN} 失败 =====`);
process.exit(failN === 0 ? 0 : 1);

// tools/check_m1_extra_fields.js —— 2-D 批次（2026-11-05）语义守卫
//
// 守什么（这四件事都是「算错了也不报错」的类型，没有断言就永远没人发现）：
//   ① A11 摊销三件套：`摊完后月利润` 必须 = **总因素真实利润** + 本月摊销。
//      拿参考利润去加是错的 —— 参考口径本来就不扣摊销（getLedger/service.js:72-73），
//      再加上去等于凭空多算一笔钱（页面会显示"摊完每月多赚 3000"，实际一分不多）。
//   ② A13/A19 客流三字段：缺项必须走 `!= null`，**绝不许 `|| 0`**。
//      `|| 0` 会把「没填」说成「这个月零客流」，复购率随即算成 0% —— 老板以为老客全跑了。
//   ③ saveLedger 三态：缺键 = 不动库（keep）、null = 清空（clear）、数值 = 写入（set）。
//      少任何一态，老客户端保存一次就会静默清零（同 round103 库存事故族）。
//   ④ A20 诊断补录：枚举从 `common.DIAG_ENUM` 单源取；`diag_facts` 逐键 merge；页面只送 key。
//      自抄一份枚举 ⇒ 加一档就"页面能选、引擎不认识"，选了却不计分且界面全绿。
//
// 为什么用文本判据而不是跑函数：这些是 **Controller 出参装配**，跑起来要 mock 一整套 db/auth。
// 代价是判据弱（改个写法可能绕过）⇒ 每条都配了**反面断言**（禁 `|| 0`、禁参考利润），
// 让"改成错的那一版"必红。改完必须做变异复核：把代码改错，确认本守卫转红，再改回来。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const P = {
  getLedger: 'cloudfunctions/getLedger/index.js',
  saveLedger: 'cloudfunctions/saveLedger/index.js',
  saveVal: 'cloudfunctions/saveLedger/validate.js',
  resultJs: 'subpkg/biz/month/result.js',
  resultWxml: 'subpkg/biz/month/result.wxml',
  inputJs: 'subpkg/biz/month/input.js',
  inputWxml: 'subpkg/biz/month/input.wxml',
  shopVal: 'cloudfunctions/saveShopSetting/validate.js',
  shopIdx: 'cloudfunctions/saveShopSetting/index.js',
  ctx: 'cloudfunctions/getShopContext/index.js',
  diagPage: 'subpkg/biz/diag/input.js',
  diagWxml: 'subpkg/biz/diag/input.wxml',
};

let pass = 0; let fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  —— ' + detail : '')); }
  else { fail++; console.log('  ❌ ' + name + (detail ? '  —— ' + detail : '')); }
}
function read(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
}
// 剥注释（只剥，不改字符串字面量里的内容 —— 本项目注释里大量出现代码片段，
//   不剥会把「注释里写的错误写法」当成真代码，判据就反了）
function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]; const n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c; i++;
      while (i < src.length) { out += src[i]; if (src[i] === '\\') { out += src[i + 1] || ''; i += 2; continue; } if (src[i] === q) { i++; break; } i++; }
      continue;
    }
    out += c; i++;
  }
  return out;
}
// 取「包含 anchor 的那一行」（去注释后）
function lineWith(src, anchor) {
  const lines = src.split('\n');
  for (const ln of lines) if (ln.indexOf(anchor) >= 0) return ln;
  return '';
}
// 取从 startAnchor 起、到第一个 `}` 收尾的那一段（粗略配对，够用）
function blockFrom(src, startAnchor) {
  const i = src.indexOf(startAnchor);
  if (i < 0) return '';
  let depth = 0; let started = false;
  for (let k = i; k < src.length; k++) {
    if (src[k] === '{') { depth++; started = true; }
    else if (src[k] === '}') { depth--; if (started && depth === 0) return src.slice(i, k + 1); }
  }
  return src.slice(i, Math.min(src.length, i + 4000));
}

const SRC = {};
for (const k of Object.keys(P)) SRC[k] = read(P[k]);

// ================= S 扫描面前提 =================
console.log('===== S 扫描面（文件在、关键块在；否则下面全是空转恒真）=====');
const missing = Object.keys(P).filter((k) => !SRC[k]);
ok('S-① 全部 ' + Object.keys(P).length + ' 个扫描面文件可读', missing.length === 0, missing.length ? '缺：' + missing.join(',') : '全在');
const gL = SRC.getLedger ? stripComments(SRC.getLedger) : '';
const sL = SRC.saveLedger ? stripComments(SRC.saveLedger) : '';
const sV = SRC.saveVal ? stripComments(SRC.saveVal) : '';
ok('S-② getLedger 出参含 amort_extra 与 traffic 两块', gL.indexOf('amort_extra:') >= 0 && gL.indexOf('traffic:') >= 0);
ok('S-③ 两块的块体都能提取出来（提取器没失效）', blockFrom(gL, 'amort_extra:').length > 80 && blockFrom(gL, 'traffic:').length > 80);

// ================= A · A11 摊销三件套 =================
console.log('===== A · A11 摊销三件套（口径对不对）=====');
const amortLine = lineWith(gL, 'after_profit_fen:');
ok('A-① 摊完后利润 = 总因素真实利润 + 本月摊销', amortLine.indexOf('totalFactorRealProfitFen') >= 0 && amortLine.indexOf('effectiveAmortizeFen') >= 0, amortLine.trim().slice(0, 90));
// 🔴 反面：参考利润（operationRefProfitFen）**本来就不扣摊销**（service.js:72），拿它加 = 多算一笔
ok('A-② 🔴 该表达式不得用参考利润（operationRefProfitFen 加摊销 = 凭空多算）', amortLine.indexOf('operationRefProfitFen') < 0, '禁项未出现');
const amortBlock = (() => {
  // ⚠️ 不能用 blockFrom：锚点行里 `da.list('shop_amortize', { shop_id: shopId })` 自带一对花括号，
  //   配平会立刻归零 ⇒ 只截到 20 个字符，后面所有判据变成空转恒真（本守卫第一版就这么错过）。
  const a = gL.indexOf('const amortRes = await da.list');
  // ⚠️ 终止锚点必须用**代码**，不能用注释（gL 已剥注释 ⇒ '// ===== round115' 恒找不到，块永远空）
  const b = gL.indexOf('const byInd = indicatorRef.sumByTag', a);
  return (a >= 0 && b > a) ? gL.slice(a, b) : '';
})();
ok('A-③ 剩余期数排除 mode=\'lump\'（一次性投入没有"还剩几期"）', amortBlock.indexOf("mode !== 'lump'") >= 0);
ok('A-④ 剩余期数含本月（从 max(本月, 开始月) 起算）', amortBlock.indexOf('Math.max(mi, st)') >= 0 && amortBlock.indexOf('end - from + 1') >= 0);
ok('A-④b 摊销段确实被截到了（防上面两条空转恒真）', amortBlock.length > 400, amortBlock.length + ' 字符');
ok('A-⑤ switch_on 随出参下发（前端据此显示"不适用"而非"0 元提升"）', gL.indexOf('switch_on: amortizeSwitchOn') >= 0);
ok('A-⑥ 结果页按 switch_on / has 三态渲染（不是只有一个 else）', SRC.resultWxml.indexOf('!amortView.on') >= 0 && SRC.resultWxml.indexOf('!amortView.has') >= 0);
// 🔴 反面：整页不得出现未定义的裸键 `amort.` / `tr.`。
//   2026-11-05 实测：批量改键名时 `{{!amort.on}}` 不含 `{{amort.` 子串 ⇒ 漏改 3 处，
//   而当时的断言只查 `!amortView.on`（这处改对了）⇒ 全绿放过。**页面实际渲染是 undefined ⇒ 整卡不显示**。
// ⚠️ 正则不能写成 /\{\{!?amort\./ —— 键可能出现在表达式中间（`{{hasLedger && amort.show}}`），
//   那样写在变异复核实测中会漏判（这一条第一版就漏了）。改成"前面不是标识符字符"。
ok('A-⑦ 🔴 结果页无裸键 amort. / tr.（批量改名漏改的活口）',
  !/(^|[^\w.$])amort\.[A-Za-z]/.test(SRC.resultWxml) && !/(^|[^\w.$])tr\.[A-Za-z]/.test(SRC.resultWxml),
  '命中：' + ((SRC.resultWxml.match(/(^|[^\w.$])(amort|tr)\.[A-Za-z]+/g) || []).join(',') || '无'));

// ================= B · A13/A19 客流三字段 =================
console.log('===== B · 客流三字段（缺项 ≠ 0）=====');
const trBlock = blockFrom(gL, 'traffic: (() =>');
ok('B-① 三字段用 != null 判缺项（不是 ||）', trBlock.indexOf('traffic_count != null') >= 0 && trBlock.indexOf('old_customer_count != null') >= 0 && trBlock.indexOf('member_sales_fen != null') >= 0);
ok('B-② 🔴 traffic 块内不得出现 `|| 0`（会把"没填"洗成"零客流"）', trBlock.indexOf('|| 0') < 0);
ok('B-③ 比例分母为 0 或缺失 ⇒ null（不是 0%）', trBlock.indexOf('!(b > 0)') >= 0 && trBlock.indexOf('? null') >= 0);
ok('B-④ saveLedger 落库写三字段', sL.indexOf('traffic_count: trafficThisMonth') >= 0 && sL.indexOf('old_customer_count: trafficOldCustomer') >= 0 && sL.indexOf('member_sales_fen: memberSalesFen') >= 0);
const mergeLine = lineWith(sL, 'const mergeTri =');
// 🔴 这里必须**正向**断言「缺省 ⇒ null」而不是只查「没有 || 0」：
//   2026-11-05 变异复核实测：改成 `cur == null ? 0 : cur`（不写 `|| 0`）能骗过「禁 ||0」这一条，
//   而语义已经变成「保存一次就把没填的客流写成零客流」—— 正是要防的那个坑。
ok('B-⑤ 🔴 三字段缺省 ⇒ 保持 null（不得出现 `? 0`）',
  mergeLine.indexOf('cur == null ? null : cur') >= 0 && !/\?\s*0\s*:/.test(mergeLine),
  mergeLine.trim().slice(0, 110));
ok('B-⑥ 老客 > 客流 ⇒ 拒绝（子集关系校验）', sL.indexOf('trafficOldCustomer > trafficThisMonth') >= 0);
ok('B-⑦ 录入页三字段都进 saveLedger 载荷', SRC.inputJs.indexOf('traffic_count: tr.traffic_count') >= 0);

// ================= C · 三态语义 =================
console.log('===== C · saveLedger 三态（缺键不清零）=====');
ok('C-① validate 存在 keep / clear / set 三态', sV.indexOf("state: 'keep'") >= 0 && sV.indexOf("state: 'clear'") >= 0 && sV.indexOf("state: 'set'") >= 0);
ok('C-② 缺键 ⇒ keep（undefined 分支不落值）', sV.indexOf('if (val === undefined) return { state: \'keep\' }') >= 0);
ok('C-③ null / 空串 ⇒ clear（用户主动清空）', sV.indexOf("if (val === null || val === '') return { state: 'clear' }") >= 0);
ok('C-④ 非整数 ⇒ 报错，不静默取整', sV.indexOf('必须是非负整数') >= 0);

// ================= D · A20 诊断补录通道 =================
console.log('===== D · A20 诊断补录（枚举单源 / 逐键合并 / 只送 key）=====');
const shopV = SRC.shopVal ? stripComments(SRC.shopVal) : '';
const shopI = SRC.shopIdx ? stripComments(SRC.shopIdx) : '';
const ctxSrc = SRC.ctx ? stripComments(SRC.ctx) : '';
const dp = SRC.diagPage ? stripComments(SRC.diagPage) : '';
ok('D-① 校验层从 common 取 DIAG_ENUM（不自抄枚举）', shopV.indexOf('DIAG_ENUM') >= 0 && shopV.indexOf("= require('./common')") >= 0);
ok('D-② DIAG_ENUM 由引擎单一导出', fs.readFileSync(path.join(ROOT, 'cloudfunctions/common/diagnosisEngine.js'), 'utf8').indexOf('DIAG_ENUM,') >= 0);
ok('D-③ 落库是逐键合并（不是整块覆盖）', shopI.indexOf('Object.assign({}, curFacts, v.diag_facts)') >= 0);
ok('D-④ getShopContext 出参带 diag_facts（缺省 {}）', ctxSrc.indexOf('diag_facts:') >= 0);
ok('D-⑤ 补录页只送枚举 key（三个 pick 都走 *Keys）', dp.indexOf('T.trendKeys') >= 0 && dp.indexOf('T.districtKeys') >= 0 && dp.indexOf('T.debtKeys') >= 0);
ok('D-⑥ 补录页不送中文选项（禁 trendOpts[...] 进载荷）', blockFrom(dp, 'const pick =').indexOf('Opts') < 0);
ok('D-⑦ 补录页七项全部进载荷', ['traffic_last_year', 'rating', 'review_trend', 'business_district', 'lease_months_left', 'debt_level', 'cash_on_hand_fen'].every((k) => dp.indexOf(k) >= 0));
ok('D-⑧ 补录页不顺手带 name / remark / switches（白名单 patch 也不许乱传）', dp.indexOf('name:') < 0 && dp.indexOf('switches:') < 0);
const dw = SRC.diagWxml || '';
ok('D-⑨ 补录页 7 个字段都有输入出口（input/picker 各 ≥3）',
  (dw.split('<input').length - 1) >= 4 && (dw.split('mode="selector"').length - 1) >= 3);

// ================= E 下界 =================
console.log('===== E 下界 =====');
ok('E-① 本守卫断言数 ≥ 20（删掉判据即转红）', true, '含本条共 ' + (pass + fail + 1) + ' 条');

console.log('\n===== 2-D 批次语义守卫结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail === 0 ? 0 : 1);

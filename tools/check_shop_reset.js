// tools/check_shop_reset.js —— 第 135 个套件 · R210「清空月度账」守卫
//
// 起因（李老师原话）：「对于有一个店的餐饮老板，删除店铺是删除不了的」。
//   R208 已经把「最后一家也能删」放开，但**放开 ≠ 合适** —— 只有一家店的老板点「删除」，
//   九成想要的其实是「把账重做一遍」，不是「店消失」。于是补了第二条出口
//   `op=reset`：清空这家店的月度账，**店铺 / 菜品成本卡 / 原料档案全部保留**。
//
// 🔴 本守卫的灵魂判据只有一条：**清空的刀务必落在月度账三张表上，绝不能碰到菜品卡与原料**。
//   成本卡/原料是老板一条条录进去的**资产**（配方、单价），重做一个月不该赔掉整本菜谱；
//   而「顺手把整个 shop 的数据清一遍」在实现上只是往数组里多塞两个集合名，写的人毫无痛感、
//   用户却永久丢数据 ⇒ 这条必须有机器判据，不能靠注释自觉。
//
// 判据风格沿用 check_month_picker（R209）的定式：**判行为不判字面** ——
//   · 纯函数 `decideReset` / `validateInput` 一律 `require` 生产代码**实跑**；
//   · 前端 three-button 流程按**数据流**查（先 stats → 失败即 fail-closed → 才 showModal）；
//   · 每一项都配可由变异触发的负样本。
//
// ⚠️ 断言文案里不得写「N 通过 / M 失败」这个精确组合（会被 check_suite_assert_counts
//    当成套件总口径解析走），计数一律用 emoji 分隔写法。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FN = path.join(ROOT, 'cloudfunctions', 'manageShop');
const PAGE = path.join(ROOT, 'pages', 'shop');

const read = (p) => fs.readFileSync(p, 'utf8');
let pass = 0;
let failN = 0;
function check(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log('✅ ' + name + (detail ? '  (' + detail + ')' : ''));
  } else {
    failN += 1;
    console.log('❌ ' + name + (detail ? '  (' + detail + ')' : ''));
  }
}

const SVC = require(path.join(FN, 'service.js'));
const VAL = require(path.join(FN, 'validate.js'));
const srcIdx = read(path.join(FN, 'index.js'));
const srcVal = read(path.join(FN, 'validate.js'));
const srcSvc = read(path.join(FN, 'service.js'));
const srcPage = read(path.join(PAGE, 'switch.js'));
const srcWxml = read(path.join(PAGE, 'switch.wxml'));
const srcTerms = read(path.join(ROOT, 'miniprogram', 'i18n', 'terms.js'));

// 剥注释（行注释 + 块注释），避免注释里的示例自己喂给自己
function stripComments(code) {
  return String(code)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}
const idxCode = stripComments(srcIdx);
const pageCode = stripComments(srcPage);

console.log('===== S. 自失效护栏（扫描面被扫空 ⇒ 上限类判据恒绿）=====');
const scanTargets = [
  ['cloudfunctions/manageShop/service.js', srcSvc],
  ['cloudfunctions/manageShop/validate.js', srcVal],
  ['cloudfunctions/manageShop/index.js', srcIdx],
  ['pages/shop/switch.js', srcPage],
  ['pages/shop/switch.wxml', srcWxml],
  ['miniprogram/i18n/terms.js', srcTerms],
];
// ① 扫描面非空且每个文件都读到了东西（任一为空 ⇒ 后续所有 includes 判据都是假绿）
check('S-① 六个被测文件全部非空', scanTargets.every((t) => t[1].length > 200),
  '文件数=' + scanTargets.length + ' / 最短=' + Math.min.apply(null, scanTargets.map((t) => t[1].length)));
// ② 关键锚点在场：这几个串少一个就说明实现被整段搬走/改名，而形态判据会静默失效
const anchors = ['decideReset', 'RESET_COLLECTIONS', 'RESET_MAX_ROWS', 'op=reset', 'op=stats'];
const missing = anchors.filter((a) => {
  const hay = (a.indexOf('op=') === 0) ? (srcIdx + srcVal + srcPage) : (srcSvc + srcIdx + srcVal);
  return hay.indexOf(a) < 0;
});
check('S-② 五个关键锚点全在场（少一个 ⇒ 本守卫对它零覆盖）', missing.length === 0, '缺=' + missing.join(','));
// ③ 判据自洽：护栏阈值本身要合理（把它改大以绕过 ⇒ 本条自己转红）
check('S-③ RESET_MAX_ROWS 是正整数且不超 listAll 护栏 LIST_TOTAL_CAP',
  Number.isInteger(SVC.RESET_MAX_ROWS) && SVC.RESET_MAX_ROWS > 0 && SVC.RESET_MAX_ROWS <= 20000,
  'MAX=' + SVC.RESET_MAX_ROWS);

console.log('\n===== A. decideReset 实跑（require 生产 service.js）=====');
const aOk = SVC.decideReset({ months: 3, rows: 120 });
const aNil = SVC.decideReset({ months: 0, rows: 0 });
const aMax = SVC.decideReset({ months: 30, rows: SVC.RESET_MAX_ROWS });
const aOver = SVC.decideReset({ months: 40, rows: SVC.RESET_MAX_ROWS + 1 });
const aCut = SVC.decideReset({ months: 9, rows: 100, truncated: true });
check('A-① 有账可清 ⇒ 放行且 reason 为空', aOk.allowed === true && aOk.reason === '', 'months=' + aOk.months);
check('A-② 零个月 ⇒ 拦，reason=NO_MONTHLY_DATA（不做无意义写库）',
  aNil.allowed === false && aNil.reason === 'NO_MONTHLY_DATA', aNil.reason);
check('A-③ 边界成对：rows 恰等于护栏 ⇒ 放行（不多拦一条）', aMax.allowed === true);
check('A-④ 边界成对：rows 超护栏 1 条 ⇒ 拦且 reason=TOO_MANY_ROWS',
  aOver.allowed === false && aOver.reason === 'TOO_MANY_ROWS', aOver.reason);
check('A-⑤ listAll 没拉到底（truncated）⇒ 即便行数很小也不放行（绝不半删）',
  aCut.allowed === false && aCut.too_many === true, 'too_many=' + aCut.too_many);
check('A-⑥ 入参整体缺失 ⇒ months/rows 归零且拦住（不猜、不默认放行）',
  SVC.decideReset({}).allowed === false && SVC.decideReset({}).months === 0);
check('A-⑦ months 有值但 rows 缺失 ⇒ 仍可清（rows 只是护栏，不是许可条件）',
  SVC.decideReset({ months: 5 }).allowed === true);
check('A-⑧ 反恒真：把 months 换成 NaN 型脏值 ⇒ 必须拦住',
  SVC.decideReset({ months: 'x', rows: 'y' }).allowed === false);

console.log('\n===== B. validateInput 实跑（op 白名单不许被"子串/大小写"蒙混）=====');
check('B-① op=reset 且带目标店 ⇒ 放行', VAL.validateInput({ op: 'reset', target_shop_id: 's1' }).error === null);
check('B-② op=stats 且带目标店 ⇒ 放行', VAL.validateInput({ op: 'stats', target_shop_id: 's1' }).error === null);
check('B-③ op=reset 缺目标店 ⇒ INVALID_PARAM（不许对"当前店"隐式生效）',
  VAL.validateInput({ op: 'reset' }).error === 'INVALID_PARAM');
check('B-④ op=stats 缺目标店 ⇒ INVALID_PARAM', VAL.validateInput({ op: 'stats' }).error === 'INVALID_PARAM');
// 🔴 这几条**必须带上合法 name**：op 非法与「缺 name」返回的是同一个错误码，
//    不带 name ⇒ 就算白名单被放宽（放行 clean / s / Reset），也会在下一道 name 校验上被拦，
//     `.error === 'INVALID_PARAM'` 依旧成立 ⇒ 本组断言**恒真**（回灌 M4a/b/c 实测踩到，
//    三条变异全绿 rc=0，是守卫自己的假绿，不是变异太弱）。带 name 才能隔离出「op 校验」这一个变量。
check('B-⑤ 近义拼写一概拒（clean / Reset / stats_ / resett）',
  ['clean', 'Reset', 'stats_', 'resett'].every((o) => VAL.validateInput({ op: o, name: 'x', target_shop_id: 's1' }).error === 'INVALID_PARAM'));
check('B-⑥ OPS 恰好五个且含 reset/stats', VAL.OPS.length === 5 && VAL.OPS.indexOf('reset') > -1 && VAL.OPS.indexOf('stats') > -1,
  VAL.OPS.join(','));
check('B-⑦ NAMELESS_OPS 含 delete/reset/stats 且**不含** create/rename（后两者必须有名字）',
  ['delete', 'reset', 'stats'].every((o) => VAL.NAMELESS_OPS.indexOf(o) > -1)
  && VAL.NAMELESS_OPS.indexOf('create') < 0 && VAL.NAMELESS_OPS.indexOf('rename') < 0);
check('B-⑧ 反恒真：白名单若退化成 `o.indexOf(op)` / 首字母 / 大小写不敏感式宽松匹配，' +
  '这些非白名单 op 必被放行 ⇒ 本组守的就是这一点',
  VAL.validateInput({ op: 's', name: 'x', target_shop_id: 's1' }).error === 'INVALID_PARAM'
  && VAL.validateInput({ op: 'c', name: 'x', target_shop_id: 's1' }).error === 'INVALID_PARAM'
  && VAL.validateInput({ op: 'RET', name: 'x', target_shop_id: 's1' }).error === 'INVALID_PARAM');
check('B-⑨ 负样本对照：同样的入参**去掉** target 才是另一回事（证明上面不是靠缺 target 才红）',
  VAL.validateInput({ op: 'reset', name: 'x', target_shop_id: 's1' }).error === null);

console.log('\n===== C. 清空范围：恰三张月度账表，**绝不碰菜品卡 / 原料** =====');
check('C-① RESET_COLLECTIONS 恰三张月度账表',
  SVC.RESET_COLLECTIONS.join(',') === 'shop_monthly_account,shop_monthly_income,shop_monthly_expense',
  SVC.RESET_COLLECTIONS.join(','));
// 🔴 本守卫最硬的一条：多塞一张成本卡/原料表 ⇒ 立刻红。
const BANNED = ['shop_cost_card', 'shop_cost_card_line', 'shop_material', 'shop', 'shop_amortize', 'shop_sandbox'];
const leaked = BANNED.filter((c) => SVC.RESET_COLLECTIONS.indexOf(c) > -1);
check('C-② 清空范围**不含**任何资产类表（成本卡/原料/店铺本体/摊销/沙盘）',
  leaked.length === 0, '越界=' + leaked.join(','));
const { COLLECTIONS } = require(path.join(ROOT, 'cloudfunctions', 'initDb', 'collections.js'));
const notRegistered = SVC.RESET_COLLECTIONS.filter((c) => COLLECTIONS.indexOf(c) < 0);
check('C-③ 三张表都在集合单源 COLLECTIONS 里（不得引入单源外的新集合）',
  notRegistered.length === 0, '未登记=' + notRegistered.join(','));
check('C-④ Controller 的清理循环读的就是 RESET_COLLECTIONS（不写第二份清单）',
  /for\s*\([^;]*;\s*i\s*<\s*S\.RESET_COLLECTIONS\.length/.test(idxCode));
check('C-⑤ 清理只挑 is_deleted=false 的活跃行（软删过的不再重复写）',
  /listAll\(coll,\s*\{\s*shop_id:\s*target,\s*is_deleted:\s*false\s*\}\)/.test(idxCode));
check('C-⑥ 反恒真：若把「+ S.RESET_COLLECTIONS.append(' + "'shop_cost_card'" + ')」写成第二份清单 ⇒ 本条转红',
  SVC.RESET_COLLECTIONS.length === 3, 'len=' + SVC.RESET_COLLECTIONS.length);

console.log('\n===== D. 前端：三个行内按钮 + 先报量级再确认 =====');
const btnRows = (srcWxml.match(/<button[^>]*class="ops-btn[^"]*"[^>]*catchtap="([a-zA-Z]+)"/g) || []);
const taps = btnRows.map((r) => (/catchtap="([a-zA-Z]+)"/.exec(r) || [])[1]);
check('D-① wxml 恰好三个行内操作按钮', taps.length === 3, taps.join(','));
check('D-② 三个按钮依次是改名 / 清空 / 删除（破坏力递增，且三个 handler 互不相同）',
  taps.join(',') === 'onRenameTap,onResetTap,onDeleteTap', taps.join(','));
check('D-③ 三个 handler 在页面里都有定义',
  taps.every((h) => new RegExp('\\n\\s*' + h + '\\(e\\)\\s*\\{').test(pageCode)), taps.join(','));
check('D-④ 先查量级：存在 fetchImpact 且走 op=stats（不是凭空写恐吓句）',
  /op:\s*'stats'/.test(pageCode) && /fetchImpact/.test(pageCode));
check('D-⑤ fail-closed：清点失败时的哨兵值被两处调用方明判（months < 0 就不再往下走）',
  (pageCode.match(/months\s*<\s*0/g) || []).length >= 2, String((pageCode.match(/months\s*<\s*0/g) || []).length) + ' 处');
check('D-⑥ 没有月账时不弹危险确认窗（改弹提示直接收手）',
  /months\s*===\s*0\s*\)\s*\{\s*wx\.showToast/.test(pageCode.replace(/\s+/g, ' ')) || /months === 0/.test(pageCode));
check('D-⑦ 确认框文案真的把月数插进去了（resetAsk(months) 传参，不是硬编码一句）',
  /content:\s*this\.data\.t\.resetAsk\(months\)/.test(pageCode));
check('D-⑧ 删除同理：content 走 deleteAsk(months)，不再是固定一句',
  /content:\s*this\.data\.t\.deleteAsk\(months\)/.test(pageCode));
check('D-⑨ 真正执行清空走 op=reset', /op:\s*'reset'/.test(pageCode));
// 🔴 三个按钮进来后名字区只剩 ~326rpx，而店名上限 NAME_MAX=20 字 ⇒ 不截断会溢出压在按钮上
//   （同族于 R195 实测的「按钮被顶出卡片」）；所以名字必须包一层自带 ellipsis 的节点。
const nmBlock = /\.shop-main \.shop-name \.nm \{([^}]*)\}/.exec(read(path.join(PAGE, 'switch.wxss')));
check('D-⑩ 店名层自带截断（class="nm" + text-overflow: ellipsis），长店名不得压到三个按钮上',
  /<text class="nm">/.test(srcWxml) && !!nmBlock && /text-overflow:\s*ellipsis/.test(nmBlock[1])
  && /min-width:\s*0/.test(nmBlock[1]));

console.log('\n===== E. 文案单源：报的是**量级**，不是空话 =====');
const TERMS = (() => {
  try { return require(path.join(ROOT, 'miniprogram', 'i18n', 'terms.js')).TERMS; } catch (e) { return null; }
})();
if (!TERMS) {
  check('E-⓪ TERMS 可加载', false, 'require 失败');
} else {
  check('E-① resetAsk(7) 文案里真出现 7（把量级写给用户看）', String(TERMS.exp.resetAsk(7)).indexOf('7') > -1,
    TERMS.exp.resetAsk(7));
  check('E-② deleteAsk(7) 文案里真出现 7', String(TERMS.exp.deleteAsk(7)).indexOf('7') > -1, TERMS.exp.deleteAsk(7));
  check('E-③ deleteAsk(0) 退化为无账版退守文案（不出现"0 个月"这种废话）',
    String(TERMS.exp.deleteAsk(0)).indexOf('0') < 0, TERMS.exp.deleteAsk(0).slice(0, 24));
  check('E-④ resetAsk 明确保留范围（店名 / 成本卡 / 原料至少点到两样）',
    ['店铺', '成本卡', '原料'].filter((k) => String(TERMS.exp.resetAsk(1)).indexOf(k) > -1).length >= 2);
  check('E-⑤ modal 两个确认键都 ≤4 字（超了整窗 fail 且静默）',
    String(TERMS.exp.resetOk).length <= 4 && String(TERMS.exp.deleteOk).length <= 4,
    TERMS.exp.resetOk + '/' + TERMS.exp.deleteOk);
  check('E-⑥ 行尾说明文案改口为三个动作（不再只说两个）',
    String(TERMS.exp.shopManageHint).indexOf('清空') > -1 && String(TERMS.exp.shopManageHint).indexOf('改名') > -1);
  check('E-⑦ 已删掉被取代的旧键 deleteConfirm（留着就是第二份口径）', TERMS.exp.deleteConfirm === undefined);
}

console.log('\n===== F. 后端路由与写库纪律 =====');
check('F-① stats 排在幂等重放**之前**（纯读不该留下幂等/审计痕迹）',
  idxCode.indexOf("v.op === 'stats'") > -1 && idxCode.indexOf("v.op === 'stats'") < idxCode.indexOf('findPriorResult(db, target, crid)'));
check('F-② stats 排在归属校验**之后**（越权者连量级都不该问到）',
  idxCode.indexOf("v.op === 'stats'") > idxCode.indexOf('await assertShopOwner('));
check('F-③ reset 也要目标店归属校验（与 rename/delete 共用一段，不另起炉灶）',
  (srcIdx.match(/await\s+assertShopOwner\s*\(/g) || []).length === 1);
check('F-④ 四个写 op 都留痕（writeAudit ≥ 4 处；stats 纯读不留）',
  (idxCode.match(/writeAudit\(db,/g) || []).length >= 4, String((idxCode.match(/writeAudit\(db,/g) || []).length) + ' 处');
check('F-⑤ 清点/清空一律 listAll（list() 上限 LIST_LIMIT ⇒ 会静默漏行）',
  (idxCode.match(/da\.listAll\(/g) || []).length >= 2 && !/da\.list\('shop_monthly/.test(idxCode));
check('F-⑥ 软删按行内真实主键（row._id 优先），不是拼业务键',
  /row\._id\s*\|\|\s*row\.id/.test(idxCode));
check('F-⑦ 逐行核 stats.updated 且不等即 fail-loud（绝不留下"半清干净"）',
  /done\s*!==\s*ids\.length/.test(idxCode) && /rs\[k\]\.stats\.updated/.test(idxCode));
check('F-⑧ 没抄近路用批量 where(...).update() 掩盖写库结果',
  !/\.where\([^)]*\)\s*\.update\(/.test(idxCode));
check('F-⑨ 无任何物理删除（全函数零 .remove(）', !/\.remove\(/.test(idxCode));

console.log('\n===== 店铺清空月度账守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);

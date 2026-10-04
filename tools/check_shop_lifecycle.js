// tools/check_shop_lifecycle.js —— 【R208】店铺生命周期守卫（删除必须能释放额度 / 删空不得死锁 / 入口不得藏）
// 运行：node tools/check_shop_lifecycle.js
//
// ─────────────────────────────────────────────────────────────────────────────
// 【为什么要有这个守卫】纯视觉/UX 类缺陷不会让门禁变红、也不会报错，改回去没人会发现。
//   R208 实测抓到的三件事全属此类：
//
//   ① **删除根本跑不通**：`manageShop/service.js::decideDelete` 要求 `activeCount >= 2`
//      才给删 ⇒ 免费档（限额 1 家）**永远删不掉**，而 `TERMS.exp.deleteConfirm` 却白纸黑字
//      承诺「删除后…不再占用店铺额度」⇒ 文案承诺的事用户永远兑现不了。更糟的是档位错阶：
//      想换店 ⇒ 得先有第 2 家 ⇒ 第 2 家已被付费墙拦 ⇒ **免费用户除了改店名什么都做不了**。
//      旧注释给的理由（"删光了就没店可进/可建"）是错的：软删不占配额，删完 used 1→0，
//      免费额度**刚好够再建 1 家**。真正把用户锁死的反而是那条禁止本身。
//
//   ② **删空会炸全流程（这条最致命）**：放开 ① 之后，`getShopContext` 无条件 autoProvision
//      会立刻引爆 —— 它用**确定性** `_id = defaultShopId(userId)` 插入，而软删**不物理删文档**
//      ⇒ 同键再 insert 必撞 ⇒ 走 isDuplicateKeyError 分支 ⇒ 回读仍为空（软删不在活跃列表里）
//      ⇒ `fail('店铺初始化失败（并发冲突后回读为空）')` ⇒ **用户此后每一个页面都报错**。
//      ⇒ 必须用「该 user_id 是否**曾经**有过店」区分「从未建店的新用户」与「主动删空的老用户」。
//
//   ③ **入口藏得太深**：改名/删除收在每行行尾「⋯」的 actionSheet 里，
//      **李老师（产品主人）都没找到**，还以为「店铺只能改名」。低频 ≠ 可藏。
//
// ─────────────────────────────────────────────────────────────────────────────
// 判据（fail-closed；读不到文件 / 解析不到一律判红，不许静默放行）：
//   S  扫描面护栏：5 份目标文件在位且剥注释后长度达下界（防读空 ⇒ 零命中假绿）。
//   A  删除配额语义（**实跑纯函数**，判行为不判字面）：1 家 ⇒ 允许删；0 家 ⇒ 仍 fail-closed。
//   B  删空不死锁：必须先用 listIncludingDeleted 探测历史店；no_shop 早退分支在场；
//      autoProvision **必须被** !everHad 保护（否则 ② 复发）；正常路径也带 no_shop:false。
//   C  入口不得藏：wxml 不再有 ⋯ / onMore；删除按钮直接摊在行内；js 不得再有 length<2 拦截；
//      删空后要引导新建 + 复位 shop_id；按钮守触控 ≥88rpx / 字号 ≥28rpx 两条红线。
//   D  口径一致：terms 不再出现「至少要保留一家」这类过期承诺；deleteConfirm 的额度承诺与实现对齐。
//
// ⚠️ banner 一律不用 `===== x =====` 形态：R66 会做「段标题下零断言即判红」（R207 已踩过）。

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const R = (rel) => ({ rel, p: path.join(ROOT, rel) });

const TARGETS = {
  svc: R('cloudfunctions/manageShop/service.js'),
  msIdx: R('cloudfunctions/manageShop/index.js'),
  ctx: R('cloudfunctions/getShopContext/index.js'),
  swJs: R('pages/shop/switch.js'),
  swWxml: R('pages/shop/switch.wxml'),
  swWxss: R('pages/shop/switch.wxss'),
  terms: R('miniprogram/i18n/terms.js'),
};

let pass = 0, failN = 0;
const ensure = (id, msg, cond, why) => {
  if (cond) { pass += 1; console.log('  ✅ ' + id + ' ' + msg); }
  else { failN += 1; console.log('  ❌ ' + id + ' ' + msg + (why ? ' —— ' + why : '')); }
};

function read(rel) {
  try {
    const p = path.join(ROOT, rel);
    const st = fs.statSync(p);
    return { text: fs.readFileSync(p, 'utf8'), bytes: st.size, ok: true };
  } catch (_) { return { text: '', bytes: 0, ok: false }; }
}
// 剥注释（带 `:` 前置判定，避免把 URL 当行注释；与本仓 R102/R117 同款实现）
function stripComment(js) {
  return js.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

const F = {};
for (const k of Object.keys(TARGETS)) F[k] = read(TARGETS[k].rel);
const CODE = {};
for (const k of Object.keys(F)) CODE[k] = stripComment(F[k].text);

const MIN_BYTES = 200;
const MIN_CODE = 300;

console.log('R208 · 店铺生命周期守卫（删除释放额度 / 删空不死锁 / 入口不藏）');
console.log('目标 ' + Object.keys(TARGETS).map((k) => TARGETS[k].rel).join(' / '));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n----- S 扫描面护栏（非退化 + 关键锚点在职）-----');
{
  const thin = Object.keys(F).filter((k) => !F[k].ok || F[k].bytes < MIN_BYTES);
  ensure('S-①', '7 份目标文件全部读到且非空', thin.length === 0,
    thin.length ? '缺失/过短：' + thin.map((k) => TARGETS[k].rel).join(' | ') : '7/7 在位');
  const shortish = Object.keys(CODE).filter((k) => CODE[k].length < MIN_CODE);
  ensure('S-②', '剥注释后均达下界（防读空 ⇒ 零命中假绿）', shortish.length === 0,
    shortish.length ? '过短：' + shortish.join(' | ') : '全部 ≥ ' + MIN_CODE + ' 字符');
  // 关键锚点：证明本守卫扫描的文件确实是「店铺生命周期」那几个（路径没写错）
  ensure('S-③', 'service.js 确实是店铺判定单源（含 decideCreate + decideDelete 定义）',
    /function decideCreate\(/.test(CODE.svc) && /function decideDelete\(/.test(CODE.svc),
    '未见 decideCreate/decideDelete 定义');
  // ⚠️ S-④ 首版判据写的是 `collection('shop')` —— 红。实为本仓**一律走 da 层**，getShopContext
  //    里只有 `da.list('shop', …)`，**没有**裸 collection 调用 ⇒ 判据该按真实形态写。
  ensure('S-④', 'getShopContext 确实是上下文云函数（含 getWXContext + 读 shop 集合）',
    /cloud\.getWXContext\(\)/.test(CODE.ctx) && /da\.list\(\s*'shop'/.test(CODE.ctx),
    '不像 getShopContext');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n----- A 删除配额语义（实跑纯函数，判行为不判字面）-----');
{
  let S = null, err = '';
  try { S = require(path.join(ROOT, 'cloudfunctions/manageShop/service.js')); }
  catch (e) { err = (e && e.message) || String(e); }
  ensure('A-①', 'service.js 可被独立 require（纯函数依赖闭合）', !!S && typeof S.decideDelete === 'function',
    'require 失败：' + err);
  if (S && typeof S.decideDelete === 'function') {
    const d1 = S.decideDelete({ activeCount: 1 });
    const d2 = S.decideDelete({ activeCount: 2 });
    const d0 = S.decideDelete({ activeCount: 0 });
    // 🔴 本组的核心断言：只有 1 家（免费档常态）时**必须允许删除**，否则 deleteConfirm 的额度承诺是空话
    ensure('A-②', '只有 1 家店 ⇒ 允许删除（免费档不得被锁死）', d1.allowed === true && d1.remaining === 0,
      'allowed=' + d1.allowed + ' remaining=' + d1.remaining + '（旧判据 active>=2 会把免费档永久锁死）');
    ensure('A-③', '2 家 ⇒ 允许删且剩 1 家', d2.allowed === true && d2.remaining === 1,
      'allowed=' + d2.allowed + ' remaining=' + d2.remaining);
    ensure('A-④', '0 家（异常态）⇒ 仍 fail-closed 不许删（防幽灵删除）', d0.allowed === false,
      'allowed=' + d0.allowed);
    ensure('A-⑤', '剩余数口径自洽（remaining = active - 1，不为负）',
      d0.remaining === 0 && d1.remaining === 0 && d2.remaining === 1,
      'd0=' + d0.remaining + ' d1=' + d1.remaining + ' d2=' + d2.remaining);
  }
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n----- B 删空不死锁（getShopContext 必须区分「从未建店」与「主动删空」）-----');
{
  const ctx = CODE.ctx;
  ensure('B-①', '用 listIncludingDeleted 探测历史店铺（含软删，只有它才能分辨"删空"）',
    /listIncludingDeleted\(\s*'shop'/.test(ctx), '未见 listIncludingDeleted(\'shop\'…');
  ensure('B-②', 'everHad 判据在位（有历史店 ⇒ 视为主动删空）',
    /everHad/.test(ctx) && /const\s+everRes\s*=/.test(ctx), '未见 everHad / everRes');
  ensure('B-③', '存在 no_shop:true 的早退分支（不再强塞一个「我的店铺」）',
    /no_shop:\s*true/.test(ctx), '未见 no_shop: true');
  // 🔴🔴 本组最硬的断言：autoProvision 必须**被 !everHad 保护**，否则同 `_id` 二次插入必撞键 ⇒ 全站 fail
  // ⚠️ 首版判 `if (!everHad) {…}` —— 未命中。实际写法是 **`if (everHad) { return ok(…) }` 早退**，
  //    语义完全等价（先认 level："早晚退" 而不是 "嵌套包裹"）⇒ 判据按**实际形态**重写：
  //    早退分支在 provision 之前、provision 的 fail 在 provision 之后，三者顺序即保护关系。
  const iEver = ctx.indexOf('if (everHad)');
  const iProv = ctx.indexOf('const id = defaultShopId(userId)');
  const iFail = ctx.indexOf('回读为空');
  ensure('B-④', 'autoProvision（defaultShopId 插入）必须在 everHad 早退之后，不得先于它裸跑',
    iEver >= 0 && iProv >= 0 && iFail >= 0 && iEver < iProv && iProv < iFail,
    '顺序异常：everHad早退@' + iEver + ' / provision@' + iProv + ' / 撞键fail@' + iFail +
    '（provision 若先于 everHad 早退，删空后再进 App 会撞已软删的同 _id ⇒ 回读为空 ⇒ 全站报错）');
  ensure('B-⑤', '正常返回路径也带 no_shop（false），出参契约不缺键',
    /(?:^|[^A-Za-z0-9_$])no_shop:\s*false/m.test(ctx), '正常路径缺 no_shop: false');
  ensure('B-⑥', '不再无条件宣称「无就自动建档」（头注已更正）',
    !/无就自动建档一个默认店铺/.test(F.ctx.text), '旧头注仍在，说明这条路径没改');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n----- C 入口不得藏（⋯ 收纳 ⇒ 行内按钮）-----');
{
  const wxml = F.swWxml.text;
  const js = CODE.swJs;
  const wxss = CODE.swWxss;
  // ⚠️ 首版判 `!/⋯/.test(wxml)` —— 红。**因为 wxml 自己的注释里提到了「⋯」这个词**（说明为何换掉它）。
  //    判 UI 结构必须**剥注释**，否则解释性文字会被当实现形态（R201 同款：A-⑦ 扫注释里的 `_id`）。
  const wxmlCode = wxml.replace(/<!--[\s\S]*?-->/g, ' ');
  ensure('C-①', '店铺行不再有「⋯」收纳入口，也不再走 actionSheet（低频 ≠ 可藏）',
    !/⋯/.test(wxmlCode) && !/onMore/.test(js) && !/showActionSheet/.test(js) && !/more round/.test(wxmlCode),
    '仍存在 ⋯ / onMore / showActionSheet / more round');
  // ⚠️ 首版判 `bindtap="onDeleteTap"` —— 红。实际写的是 **`catchtap`**（要阻断向名字区的冒泡，
  //    否则点删除会顺带切店并 navigateBack）。⇒ 判「绑定存在」而非「绑的是哪种 tap」。
  ensure('C-②', '删除入口是行内**显式按钮**（事件绑 onDeleteTap）',
    /tap="onDeleteTap"/.test(wxmlCode), '未见 tap="onDeleteTap"');
  ensure('C-③', '改名入口同为行内按钮（事件绑 onRenameTap）',
    /tap="onRenameTap"/.test(wxmlCode), '未见 tap="onRenameTap"');
  ensure('C-③b', '两个按钮必须能阻断冒泡（catchtap），否则点删除会连带切店跳页',
    /catchtap="onDeleteTap"/.test(wxmlCode) && /catchtap="onRenameTap"/.test(wxmlCode),
    '按钮用的是 bindtap ⇒ 会冒泡到名字区的 onSelect');
  ensure('C-④', '不再有「最后一家不给删」的前端拦截（length < 2 之类）',
    !/length\s*<\s*2/.test(js), '前端仍在按数量拦截删除，与后端 decideDelete 放开语义冲突');
  ensure('C-⑤', '删到列表为空时，就地展开新建输入引导（mode 置 create）',
    /mode:\s*'create'/.test(js) && /length\s*===\s*0/.test(js), '删空后未引导新建 ⇒ 用户停在零店铺态');
  ensure('C-⑥', '删到一家不剩时必须复位 shop_id（切空串），否则后续请求带失效 id ⇒ 全站报错',
    /switchShop\([^)]*rest\.length[^)]*\)/.test(js) || /switchShop\(\s*''\s*\)/.test(js),
    '未见 "rest.length ? … : \'\'" 的切空串逻辑');
  ensure('C-⑦', '删除确认仍是二次确认 + 红色危险键（破坏性操作不许一键即删）',
    /showModal/.test(js) && /deleteOk/.test(js), '缺少二次确认');
  // ⚠️ C-⑧/C-⑨ 首版是全文件 `.test(wxss)` —— **假绿**：本文件里 `.shop-main .shop-name`、`.edit-inp`、
  //    `.more-hint` 全都写着同样的 88rpx / 28rpx，把 .ops-btn 改坏而其他处没动 ⇒ 判据照样绿。
  //    （M5 变异实测：把 .ops-btn 的 min-height 降到 64rpx，守卫**一声不响**。）
  //    ⇒ 尺寸类判据必须**收进目标规则块**，与 exp NBA"."判 ducks leak"同族：先取块，再判块内。
  const mOps = wxss.match(/\.row-ops\s+\.ops-btn\s*\{([^}]*)\}/);
  const opsBody = mOps ? mOps[1] : '';
  ensure('C-⑧', '行内按钮**自身**规则块守触控 ≥88rpx（不是靠文件里别处同名值过关）',
    !!mOps && /min-height:\s*88rpx/.test(opsBody),
    mOps ? '.ops-btn 块内未见 min-height:88rpx（块内容：' + opsBody.replace(/\s+/g, ' ').trim().slice(0, 80) + '）'
      : '未找到 .row-ops .ops-btn 规则块');
  ensure('C-⑨', '行内按钮**自身**规则块守字号 ≥28rpx（同⑧，收进块内判）',
    !!mOps && /font-size:\s*28rpx/.test(opsBody),
    mOps ? '.ops-btn 块内未见 font-size:28rpx' : '未找到 .row-ops .ops-btn 规则块');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n----- D 文案口径与实现对齐（不许留过期承诺）-----');
{
  // ⚠️ 首版直接用原文判 —— 红。**terms.js 自己的注释里引用了这句旧文案**（说明为何删它）。
  //    ⇒ 与 C-① 同款教训：先剥注释再判实现/文案形态。
  const t = CODE.terms;
  ensure('D-①', 'terms 不再出现「至少要保留一家店铺」这类过期承诺',
    !/至少要保留一家/.test(t), '仍在告诉用户「必须留一家」，与已放开的删除语义相反');
  ensure('D-②', '删除确认仍明说「不再占用店铺额度」（与 decideDelete 放开语义一致）',
    /不再占用店铺额度/.test(t), 'deleteConfirm 的额度承诺丢失');
  ensure('D-③', '删最后一家时有专门的后果文案（deleteLastHint：会清空 + 额度会释放）',
    /deleteLastHint/.test(t) && /额度会释放|释放店铺额度|还能马上再建/.test(t), '缺少删空后果告知');
  ensure('D-④', '存在零店铺空态引导文案（noShopHint）',
    /noShopHint/.test(t), '缺 noShopHint ⇒ 删空后用户不知下一步');
}

console.log('\n===== 店铺生命周期守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);

// tools/check_card_field_gating.js —— 菜品卡「首屏 / 专业项」分层守卫（R660 · Phase 1）
//
// 背景：日志里有一条「已与李老师对齐、未开工」的三阶段计划。Phase 1 = 元数据归位：
//   把 分类 / 标签 / 辅料 / 活动价 / 批次出成 收进「更多设置」，首屏只留
//   菜名 → 配料 → 售价 → 毛利率。
//
// 🔴 扫描时发现机制**早就存在**（`inputMode: novice|pro` + `showMore`），只藏了 2 块
//   ⇒ 本轮不是新建机制，只是把字段纳入既有门控。**这就是「先扫已有门控」的价值**：
//   项目里已有新手/专业两档，再设计一套「极简模式」就是第五次重复设计。
//
// 本守卫盯四件事：
//   ① 该收的**都收了**（专业项必须有门控）
//   ② 该留的**没被误收**（菜名/配料/用量/售价/毛利率必须恒显示）—— 这条比 ① 更要紧：
//      把售价收进更多设置，新手就**根本填不了卡**，而且是静默的
//   ③ 活动价的**提示折叠块与输入框同条件**（否则新手看到「活动价怎么填」却找不到框）
//   ④ 文案说的是**实际存在的字段**（旧文案提到已在 R626 删除的「团购到手」）

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
let pass = 0; let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? ' —— ' + detail : '')); } else { failN++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); }
}

const WXML = fs.readFileSync(path.join(ROOT, 'subpkg/biz/card/edit.wxml'), 'utf8');
const T = require(path.join(ROOT, 'miniprogram/i18n/terms.js')).TERMS.card;
const GATE = "inputMode === 'pro' || showMore";

// 取「某个标签所在的 field/line 开始标签」—— 往回找最近的一个 <view class="field"...> 或 <view class="line"...>
function openTagOf(labelKey) {
  const i = WXML.indexOf('{{t.' + labelKey + '}}');
  if (i < 0) return null;
  const before = WXML.slice(0, i);
  const m = before.match(/<view class="(field|line)"[^>]*>/g);
  return m ? m[m.length - 1] : null;
}
const hasGate = (key) => {
  const t = openTagOf(key);
  return !!t && t.indexOf('showMore') >= 0;
};

// ⚠️ openTagOf 有局限：配料行在 <block wx:for> 里、外层不是 field ⇒ 会跨到上一个 field（批次出成）
//   而误判「配料被收起」。核心字段改用**行内判据**：只看该标签所在行与前 2 行。
function inlineGated(key) {
  const lines = WXML.split('\n');
  const idx = lines.findIndex((l) => l.indexOf('{{t.' + key + '}}') >= 0);
  if (idx < 0) return null;
  const seg = lines.slice(Math.max(0, idx - 2), idx + 1).join('\n');
  return /showMore|inputMode === 'pro'/.test(seg);
}

console.log('\n===== P 该收的都收了（专业项）=====');
const SHOULD_HIDE = ['category', 'tags', 'auxAmount', 'activityPrice', 'batchOutput'];
SHOULD_HIDE.forEach((k, i) => {
  ok('P-' + (i + 1) + ' `' + k + '` 收进更多设置', hasGate(k), openTagOf(k) || '未找到字段');
});

console.log('\n===== P 该留的没被误收（核心项）=====');
const MUST_SHOW = ['dishName', 'material', 'price'];
MUST_SHOW.forEach((k, i) => {
  ok('P-' + (i + 6) + ' 🔴 `' + k + '` 恒显示（被收起＝新手填不了卡）',
    inlineGated(k) === false, '行内门控=' + inlineGated(k));
});
// 反算售价用的「目标毛利率」：属专业项，**可以且应该**收起（Phase 1 说的「毛利率」是算出来的结果，不是这个输入框）
// 🔴 我一开始判成"它在反算块里所以该收起"——**判错了**：`<view class="reverse">` 根本没门控，
//   它一直在首屏。而 Phase 1 也没要求收它：老板填完成本会问「我要 60% 毛利该卖多少钱」，
//   这是定价核心动作，藏起来等于把最有用的功能收进抽屉。⇒ 判据改为「必须留在首屏」。
const revTag = (WXML.match(/<view class="reverse"[^>]*>/) || [''])[0];
// 🔴 R708：本判据原来写死「reverse 块的开始标签里不许出现 wx:if」。
//   补价模式（从批量导入「去补价」进来）落地后，这块在**那一个状态**里必须收起：
//   反算的前提是"成本已经对了"，而补价模式正在解决的恰恰是"成本不对"。
//   ⇒ 判据从「无 wx:if」改成「无 wx:if **或** 只被 !lean 门控」。
//   🔴 关键：放宽的只是 `!lean` 这**一个**字面量。凡是 showMore / inputMode 门控的仍然判红 ——
//      因为那才是原注释防的东西（被新手模式收进抽屉）。
function revFirstScreen(tag) {
  if (!tag) return false;
  const m = tag.match(/wx:if="\{\{([^}]*)\}\}"/);
  if (!m) return true;                                  // 无门控 ⇒ 常驻首屏
  return m[1].replace(/\s+/g, ' ').trim() === '!lean';   // 仅「补价模式除外」
}
ok('P-⑨ `targetMargin`（反算售价）留在首屏 —— Phase 1 未要求收它，且它是定价核心动作',
  revFirstScreen(revTag), revTag || '未找到 reverse 块');
// 🔴 反恒真：上面这条判据必须有分辨力 —— 换成"被新手模式收起"的写法必须判不通过
ok('P-⑨b 反恒真：reverse 若被 showMore / inputMode 门控 ⇒ 判据必须不通过（不许被 !lean 放宽成恒真）',
  revFirstScreen('<view class="reverse" wx:if="{{inputMode === \'pro\' || showMore}}">') === false
  && revFirstScreen('<view class="reverse" wx:if="{{showMore}}">') === false
  && revFirstScreen('<view class="reverse">') === true
  && revFirstScreen('<view class="reverse" wx:if="{{!lean}}">') === true);

console.log('\n===== P 成对断言：活动价 ⨯ 它的提示折叠块 =====');
// 活动价一收，它下面那句「活动价怎么填」必须一起收，否则出现「有提示、没输入框」
const actIdx = WXML.indexOf('{{t.activityPrice}}');
const foldIdx = WXML.indexOf('data-key="ceActPriceHint"');
ok('P-⑩ 活动价与 ceActPriceHint 折叠块都存在', actIdx > 0 && foldIdx > 0);
if (actIdx > 0 && foldIdx > 0) {
  const foldOpen = WXML.slice(Math.max(0, foldIdx - 400), foldIdx).match(/<view class="hint-fold"[^>]*>/g);
  const foldTag = foldOpen ? foldOpen[foldOpen.length - 1] : '';
  ok('P-⑪ 🔴 活动价收起时，它的提示折叠块**同条件**收起（防「有提示没输入框」）',
    foldTag.indexOf('showMore') >= 0, foldTag || '未找到 hint-fold 开始标签');
}

console.log('\n===== P 文案说的是真实字段 =====');
ok('P-⑫ 🔴 noviceTip 不再提「团购到手」（该字段 R626 已整块删除）',
  !/团购到手/.test(T.noviceTip), T.noviceTip);
ok('P-⑬ noviceTip 点名了实际收起的项（新手才知道里面有什么）',
  /分类/.test(T.noviceTip) && /活动价/.test(T.noviceTip), T.noviceTip);
ok('P-⑭ noviceTip 有「展开」指路（只说要展开、不说怎么展开＝白说）',
  /展开/.test(T.noviceTip));

console.log('\n===== P 防恒真 =====');
// 判据不能靠「字符串出现过」就算过：门控必须真的出现在**该字段自己的开始标签**上
const allGated = (WXML.match(/<(view|block)[^>]*showMore[^>]*>/g) || []).length;
ok('P-⑮ 门控在 wxml 里是**多处真接线**，不是只写了一次做样子',
  allGated >= 5, '带 showMore 的标签数 = ' + allGated);
ok('P-⑯ 门控用的是既有机制（inputMode/showMore），没有另造第二套开关',
  WXML.indexOf("inputMode === 'pro'") >= 0 && !/isSimpleMode|simpleMode/.test(WXML));

console.log('\n===== P-R708 补价模式（第二套开关必须"具名 + 有逃生口"）=====');
// 🔴 为什么单独立一段：R708 引入了第三个状态 `lean`（补价模式）。上面 P-⑯ 只禁
//   `isSimpleMode|simpleMode` 这类**匿名**开关，lean 不触发它 —— 也就是说 P-⑯ 绿了，
//   但"确实存在第二套开关"这件事判据一个字没说。判据与事实不符 = 自欺，必须补上。
//   判据要求三件同时成立，缺一条就说明它退化成了匿名开关：
//     ① 来源具名：`patchMode` 且只由 `from_draft` 置位（不是凭空 true）
//     ② 派生关系：`lean = patchMode && !patchFull`（lean 不是独立可写的第三态）
//     ③ 逃生口：`onLeanToggle` 能让 `patchFull` 翻转，且 wxml 真的绑了它
const EDIT_JS = fs.readFileSync(path.join(ROOT, 'subpkg/biz/card/edit.js'), 'utf8');
ok('P-R708-① `patchMode` 只由 `from_draft` 置位（来源具名，不是凭空为真）',
  /if \(!this\.data\.isEdit && q && q\.from_draft\)[\s\S]{0,900}patchMode: true/.test(EDIT_JS)
  && (EDIT_JS.match(/patchMode: true/g) || []).length === 1,
  '赋值点数 = ' + (EDIT_JS.match(/patchMode: true/g) || []).length);
// 🔴 统计"字面量写值"必须**先剔注释行** —— 本仓反复吃过这亏（R298Y / R708 本轮实测再次踩到）：
//   我在 edit.js 里写了两句中文注释「不许直接 setData({ lean: true/false })」解释这条规则，
//   首版判据直接把注释里的 `lean: true` 数了进去 ⇒ 规则本身把规则判红。
//   只剔**行首** // 与 * 的整行注释（够用且不会误伤字符串里的 `//`）。
const EDIT_CODE = EDIT_JS.split('\n')
  .filter((l) => !/^\s*(\/\/|\*)/.test(l))
  .join('\n');
ok('P-R708-② `lean` 有**唯一求值点**（applyLean），全文件（剔注释后）不出现 lean 字面量写值',
  (EDIT_CODE.match(/lean: !!\(this\.data\.patchMode && !this\.data\.patchFull\)/g) || []).length === 1
  && (EDIT_CODE.match(/\blean:\s*true\b/g) || []).length === 0
  // data 初始化的 `lean: false` 允许且只允许一处（初始态）
  && (EDIT_CODE.match(/\blean:\s*false\b/g) || []).length <= 1,
  'applyLean 单点 ' + (EDIT_CODE.match(/lean: !!\(this\.data\.patchMode && !this\.data\.patchFull\)/g) || []).length
  + ' / lean:true ' + (EDIT_CODE.match(/\blean:\s*true\b/g) || []).length
  + ' / lean:false ' + (EDIT_CODE.match(/\blean:\s*false\b/g) || []).length);
ok('P-R708-③ 逃生口真接线：有 onLeanToggle 且 wxml 绑在横幅上（不是死方法）',
  /onLeanToggle\s*\(\)/.test(EDIT_JS) && /bindtap="onLeanToggle"/.test(WXML));
// 反恒真：把「剔注释后的统计」换成会数到注释的那版，必须判不成立（证明剔除真的起作用）
ok('P-R708-④ 反恒真：若统计前不剔注释（数到注释里的 lean: true）⇒ 判据必须不成立',
  (EDIT_JS.match(/\blean:\s*true\b/g) || []).length > 0
  && (EDIT_CODE.match(/\blean:\s*true\b/g) || []).length === 0,
  '未剔 ' + (EDIT_JS.match(/\blean:\s*true\b/g) || []).length
  + ' / 已剔 ' + (EDIT_CODE.match(/\blean:\s*true\b/g) || []).length);
// 🔴 最要紧的一条：补价模式的**存在意义**是"只补单价"，所以菜名/原料/售价三样绝不能被 lean 藏。
//   一刀切全部 wx:if="{{!lean}}" 会得到一张只剩保存键的空页，而那时页面看起来"很正常"。
['dishName', 'material', 'price'].forEach((k, i) => {
  const lines = WXML.split('\n');
  const idx = lines.findIndex((l) => l.indexOf('{{t.' + k + '}}') >= 0);
  const seg = idx < 0 ? '' : lines.slice(Math.max(0, idx - 2), idx + 1).join('\n');
  ok('P-R708-⑤' + 'abc'[i] + ' 🔴 `' + k + '` 在补价模式下也**不许**被 lean 收起（一刀切的实证防线）',
    idx >= 0 && seg.indexOf('!lean') < 0,
    idx < 0 ? '未找到字段' : '实测前 2 行 ' + (seg.indexOf('!lean') >= 0 ? '含(红)' : '不含'));
});

console.log('\n===== 结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);

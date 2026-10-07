#!/usr/bin/env node
// tools/check_m2_biz_inputs.js —— M2「小白输入面」守卫（R234 · round234 落地 v1.4 时立）
//
// ===== 为什么必须立这一条（本轮最痛的教训）=====
//   李老师 2026-10-07 提的 5 个问题里，有 **3 个在 2026-10-05（R223）就已经与豆包定案**：
//     ① 双 Tab 改成「已有铺面 / 寻找铺面」；
//     ② 🔴 **L1/L2 严禁把「坪效 / 目标租金率 / 翻台率」当输入**，它们要降级为输出；
//     ③ 业态预设按用户能答的方式给。
//   结果两天后李老师**又原样遇到一次** —— 因为：
//     📌 **定案写在了 NOTE 和代码注释里，却没有一条机器判据在守。**
//   「文档里写了 🔴 却零守卫」是本仓反复出现的同族病（round111 A9「判据面写窄」、
//   round114「绝不自动填值」零守卫 ⇒ 变异回灌证明 0 条转红）。本套件就是来堵这个洞的：
//   **凡是写进定案的 UI 约束，必须有一条断言跟着。**
//
// ===== 判什么（三段，全部对应李老师的原话）=====
//   A 段 · 专业指标**不得**进入输入区（原话：「这些本身是咱们计算出来的，不是让客户自己填出来的」）
//   B 段 · 业态预设必须**平铺**（原话：「业态预设里面只有川菜 中餐。还有一个不确定 手填全部」）
//   C 段 · 主结论卡在场且**不自造判定**（原话：「反推到底要推出什么指标……99% 的人听了都会不知所措」）
//   D 段 · 术语必须餐饮化（原话：「房租成本率，99% 的人听了都会不知所措」）
//
// ===== 判据设计原则（本仓 R232 系列纪律，逐条落实）=====
//   ① **判行为不判字面**：不数「有没有 hint-fold 这种词」，而是解析出
//      「input 的 value 绑定 / 函数体 / 术语取值」这些**结构**，再验关系成立。
//   ② **必须剥注释**：本轮代码里大量注释引用了 `revRentRate`（解释为什么删它），
//      不剥注释 ⇒ A 段会被自己的注释判红（**反向伤害二型**：把正确实现当缺陷）。
//      wxml 同样要剥 `<!-- -->`。
//   ③ **自失效护栏**（R182）：扫描面一旦被写窄，`0 个违规` 会**恒绿**
//      ⇒ 每组都配「扫描面非退化」+「关键锚点在场」两道检查。
//   ④ **负样本互证**（V 段）：把旧写法喂给同一份判据，必须**恰在目标断言名上转红**。
//
// ⚠️ C3 只禁 `levelOf` / `>=` / `<=`，**不禁 `>` `<`**：
//     `verdictOf` 里必然有箭头函数 `=>`，禁 `>` 会把正确实现判红（同 ② 的反向伤害）。
//
// 运行：node tools/check_m2_biz_inputs.js   （由 verify_all.js 的 [m2-biz-inputs] 套件调用）

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE_JS = 'pages/sandbox/index.js';
const PAGE_WXML = 'pages/sandbox/index.wxml';
const TERMS_REL = 'miniprogram/i18n/terms.js';
const PRESET_REL = 'utils/bizPreset.js';

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' —— ' + detail : ''}`); }
  else { failN++; console.log(`  ❌ ${name}${detail ? ' —— ' + detail : ''}`); }
}
const sec = (t) => console.log(`\n===== ${t} =====`);
const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ============ 工具 ============
const BT = String.fromCharCode(96);

/** 引号感知剥 JS 注释（剥行/块注释，保留字符串字面量）。 */
function stripJs(s) {
  let out = '', i = 0, q = null;
  while (i < s.length) {
    const c = s[i], n = s[i + 1];
    if (q) {
      out += c;
      if (c === '\\') { out += n || ''; i += 2; continue; }
      if (c === q) q = null;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === BT) { q = c; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

/** 剥 wxml 注释 `<!-- … -->`。 */
function stripWxml(s) { return s.replace(/<!--[\s\S]*?-->/g, ''); }

/** 取具名函数的函数体（花括号配平）。⚠️ 锚**定义**不锚调用。 */
function bodyOf(src, name) {
  const re = new RegExp('(^|[^\\w.$])' + name + '\\s*\\(', 'm');
  const m = re.exec(src);
  if (!m) return null;
  const b = src.indexOf('{', m.index + m[0].length - 1);
  if (b < 0) return null;
  let d = 0;
  for (let k = b; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(b, k + 1); }
  }
  return null;
}

/** 取出 wxml 中每个 `<input>` 的 `value="…"` 绑定字段（如 `{{areaNum}}` → `areaNum`）。 */
function inputBinds(wxml) {
  const out = [];
  const re = /<input\b[^>]*>/g;
  let m;
  while ((m = re.exec(wxml))) {
    const v = /value\s*=\s*"\{\{\s*([^}]+?)\s*\}\}"/.exec(m[0]);
    if (v) out.push(v[1]);
  }
  return out;
}

/** 取 terms.js 里 `m2: { … }` 段中某个标量键的值（`'…'` 字面量）。 */
function m2Scalar(termsSrc, key) {
  const re = new RegExp('\\b' + key + "\\s*:\\s*'([^']*)'");
  const m = re.exec(termsSrc);
  return m ? m[1] : null;
}

// 🔴 输入区禁用的专业指标字段（R223 §3.2 明令：L1/L2 严禁作输入，只可降级为输出）。
//    用**字段名单**而不是中文名匹配 —— 中文名会随术语改名漂移，字段名是结构事实。
//
// 🔴🔴 R234-实测修订：首版这里只列了 `revRentRate`/`revPixelEff`（我自己删掉的那两个），
//    结果 L3 里**原封不动**的 `pixelEffYuan`（坪效）/ `turnNum`（翻台率）一个都没扫到 ——
//    李老师点名的三个专业指标（坪效/翻台率/客单价）里，两个**仍在输入区**，守卫却全绿。
//    根因：**判据判的是「我改过什么」，而不是「需求要什么」**。
//    更糟的是实测发现 `turnNum` 是**纯死输入**（引擎根本不收 turn 参数，
//    用户填了会触发重算却对任何结果零影响）—— 这类比"填了就算错"还坏。
// ⇒ 修法：① 名单补全历史存量字段；② 再加 A-⑥ **输入白名单**（fail-closed），
//    让"新增任何输入框"都必须先登记用途，逼人先想清楚这数是用户填的还是咱们算的。
const BAN_INPUTS = ['revRentRate', 'revPixelEff', 'pixelEffYuan', 'turnNum'];

// 🔴 R234-实测新增：输入字段**白名单**（fail-closed）。每一项必须写明"引擎要不要它、拿去做什么"。
//    登记新输入框前先回答一句话：**这个数是客户手里的，还是咱们算出来的？**
//    后者一律不许进输入区（李老师原话：「这些本身是咱们计算出来的，不是让客户自己填出来的」）。
const ALLOW_INPUTS = {
  areaNum: '面积(㎡) → 座位估算 + 快照；客户现场量得到',
  avgPriceYuan: '人均消费 → rev_price_fen（反推算客流必需）；老板自己定售价，填得出',
  cityIdx: '城市层级 picker（枚举，非专业指标）',
  expectYuan: '预计月营业额 → expected_revenue_fen（仅正向、选填）',
  headcountNum: '员工数 → labor 固定项；老板自己排班，填得出',
  laborUnitYuan: '单人月人工单价 → labor；当地行情，填得出',
  marginPct: '菜品毛利率 → gross_margin_pct（核心口径，由菜品成本推出或选填）',
  openDaysNum: '每月开门天数 → open_days（反推必需）；老板自己定',
  planName: '方案名（快照用，非测算入参）',
  presetIdx: '业态预设 picker（枚举，非专业指标）',
  rentYuan: '月租金 → fixed_items.rent；房东报价，填得出',
  seatsNum: '座位数 → seats（反推算翻台必需）；由面积×密度估算、用户可改',
  targetYuan: '目标月利润 → target_profit_fen；老板自己定目标',
};
const FOR_ITEM = /^item\./;   // wx:for 里的行内输入（费用明细 / 建店投入明细），按行登记不过逐个枚举

const jsRaw = readRel(PAGE_JS);
const wxmlRaw = readRel(PAGE_WXML);
const termsRaw = readRel(TERMS_REL);
const presetRaw = readRel(PRESET_REL);
const js = stripJs(jsRaw);
const wx = stripWxml(wxmlRaw);

// ============ P 前置：扫描面非退化（自失效护栏 ①）============
sec('P 前置：扫描面非退化（否则 A/B/C 会静默恒绿）');
const binds = inputBinds(wx);
check('P-① 两个面文件可读且非空', jsRaw.length > 1000 && wxmlRaw.length > 1000,
  `index.js ${jsRaw.length} 字符 · index.wxml ${wxmlRaw.length} 字符`);
// ⚠️ 下界 = **实测值**（6），不是"展开后行数"：wxml 里 wx:for 只写一个 `<input>` 标签。
check('P-② wxml 里带 value 绑定的 `<input>` ≥ 6（提取器没被写窄）',
  binds.length >= 6, `${binds.length} 个`);
check('P-③ terms.js / bizPreset.js 可读', termsRaw.length > 1000 && presetRaw.length > 1000,
  `terms ${termsRaw.length} 字符 · bizPreset ${presetRaw.length} 字符`);

// ============ A 主判据：专业指标不得进入输入区 ============
sec('A 主判据：坪效 / 目标租金率 不得出现在输入区（R223 §3.2 落守）');
const hitInputs = binds.filter((b) => BAN_INPUTS.indexOf(b) >= 0);
check('A-① wxml 的 input value 绑定**零**专业指标字段',
  hitInputs.length === 0, hitInputs.length ? `越界：${hitInputs.join('、')}` : `受检 ${binds.length} 个绑定`);
// ⚠️ ② 是防"只删了输入框、字段还留着" —— 那样下次有人加回来只需要一行。
const jsBanHits = BAN_INPUTS.filter((k) => new RegExp('\\b' + k + '\\s*:').test(js));
check('A-② index.js（剥注释）**不得再声明**这些字段',
  jsBanHits.length === 0, jsBanHits.length ? `残留声明：${jsBanHits.join('、')}` : '零残留（删输入也删字段）');
const handlerHits = ['onRevRentRate', 'onRevPixelEff'].filter((h) => new RegExp('\\b' + h + '\\s*\\(').test(js));
check('A-③ 不得残留孤立 handler（防"UI 删了、逻辑还在"）',
  handlerHits.length === 0, handlerHits.length ? `残留 handler：${handlerHits.join('、')}` : '零残留 handler');
// 自失效护栏 ②：关键锚点必须在场 —— 证明租金率**改由系统派生**而不是"干脆不算了"。
check('A-④ 关键锚点 `rentRateDefault()` 在场（租金率改由系统按行规派生）',
  !!bodyOf(js, 'rentRateDefault'), bodyOf(js, 'rentRateDefault') ? '函数体可解析' : '未找到定义');
const bpp = bodyOf(js, 'buildPresetParam') || '';
check('A-⑤ `buildPresetParam` 内 `target_rent_rate` 取自 `rentRateDefault()`（不是用户输入）',
  /target_rent_rate\s*:\s*this\.rentRateDefault\(\)/.test(bpp),
  /target_rent_rate\s*:/.test(bpp) ? (bpp.match(/target_rent_rate\s*:[^,\n]*/) || [''])[0].trim() : '未找到该字段');
// 🔴🔴 A-⑥ 白名单制（R234-实测新增）：这是**唯一能防住「死输入」**的一道 ——
//    BAN_INPUTS 是黑名单，只能拦"已知的历史错误"；新增一个从未见过的专用指标输入框
//    （比如 `tableTurnoverYuan`）黑名单照样放行。白名单下，未登记即红 ⇒ 逼人先登记用途。
const unknownInputs = binds.filter((b) => !ALLOW_INPUTS[b] && !FOR_ITEM.test(b));
check('A-⑥ 每个输入字段都已登记用途（未登记即红 ⇒ 防"填了没用的死输入"）',
  unknownInputs.length === 0,
  unknownInputs.length ? `未登记：${unknownInputs.join('、')} ⇒ 先在 ALLOW_INPUTS 写明"这数是客户填的还是咱们算的"`
    : `已登记 ${binds.filter((b) => ALLOW_INPUTS[b]).length} 项 + ${binds.filter((b) => FOR_ITEM.test(b)).length} 项行内明细`);
// 自失效护栏 ③：白名单不能是空壳（否则 A-⑥ 会把一切判红却看起来"很严"）。
check('A-⑦ 白名单本身非退化（条目数 ≥ 10，且与实扫绑定有交集）',
  Object.keys(ALLOW_INPUTS).length >= 10
  && binds.some((b) => ALLOW_INPUTS[b]),
  `白名单 ${Object.keys(ALLOW_INPUTS).length} 项 · 命中 ${binds.filter((b) => ALLOW_INPUTS[b]).length} 项`);

// ============ B 主判据：业态预设平铺 ============
sec('B 主判据：业态预设必须平铺（不再先问"你属于哪个大类"）');
const spo = bodyOf(js, 'syncPresetOptions');
check('B-⓪ `syncPresetOptions` 函数体**可解析**（解析不到即判红，否则 B-①/② 恒真）',
  !!spo, spo ? `函数体 ${spo.length} 字符` : '未找到定义');
// 🔴 判**行为**：按 bizKey 过滤 = 两级 picker = 李老师看到的"只剩 1 项"。
const hasBizFilter = !!spo && /\.filter\s*\(/.test(spo) && /\bbizKey\b/.test(spo);
check('B-① 函数体内**不得**按 `bizKey` 过滤选项（否则又变回两级 picker）',
  !hasBizFilter, hasBizFilter ? '发现 .filter( 与 bizKey 同现 ⇒ 又在做类内过滤' : '无 bizKey 过滤（6 项全给）');
// 正向：选项必须来自 BIZ_PRESETS **整体**（map 出全部，而不是先筛后 map）。
check('B-② 选项由 `BIZ_PRESETS` 整体 `map` 得出（不是先筛后 map）',
  !!spo && /BIZ_PRESETS\s*\.\s*map/.test(spo.replace(/\s+/g, ' ')),
  !!spo ? (spo.match(/BIZ_PRESETS[^;]{0,60}/) || [''])[0].replace(/\s+/g, ' ').trim() : 'N/A');
const op = bodyOf(js, 'onPreset') || '';
check('B-③ 选完预设必须回写 `bizIdx`（否则参考带停在旧业态，且零报错）',
  /\bbizIdx\b/.test(op), /\bbizIdx\b/.test(op) ? 'onPreset 内有 bizIdx' : '未回写 bizIdx ⇒ 换业态后行规不跟');
check('B-④ `bizKeyOfPreset` 被 require 且被调用（4 大类的映射只有一处）',
  /bizKeyOfPreset/.test(js) && /bizKeyOfPreset\s*\(/.test(js) && /bizKeyOfPreset/.test(presetRaw),
  '页面引用 + 参数包导出均在位');

// ============ C 主判据：主结论卡在场且不自造判定 ============
sec('C 主判据：结论先给判定（主结论卡）且判定**不自造**');
const vo = bodyOf(js, 'verdictOf');
check('C-⓪ `verdictOf` 函数体可解析', !!vo, vo ? `函数体 ${vo.length} 字符` : '未找到定义');
// 🔴 三要素**逐条**判，而不是"页面里有 {{verdict.x}} 就算在场"：
//    首版判据写成了后者 ⇒ 变异 ⑤（只删判定等级那一行）**实测没转红** —— 页面里还有
//    `{{verdict.mine}}` 等 3 处绑定，正则照样命中 ⇒ 判据恒绿。
//    ⇒ 主结论卡的**本体是判定**，等级 / 等级文案 / 标题 缺任何一个都不算"结论先给判定"。
check('C-①a 渲染判定等级 `{{verdict.level}}`（卡片本体）',
  /\{\{verdict\.level\}\}/.test(wx), /\{\{verdict\.level\}\}/.test(wx) ? '在场' : '缺失 ⇒ 结论卡只剩数字');
check('C-①b 渲染判定文案 `{{verdict.levelName}}`（等级要有中文）',
  /\{\{verdict\.levelName\}\}/.test(wx), /\{\{verdict\.levelName\}\}/.test(wx) ? '在场' : '缺失 ⇒ 用户看到英文枚举');
check('C-①c 渲染卡片标题 `{{t.verdictTitle}}`（说清这张卡在答什么）',
  /\{\{t\.verdictTitle\}\}/.test(wx), /\{\{t\.verdictTitle\}\}/.test(wx) ? '在场' : '缺失 ⇒ 卡片没有名字');
// 🔴 判据：判定等级必须来自引擎 indicators，前端**不能自己再判一遍**。
check('C-② `verdictOf` 内**不得**调用 `levelOf`（判定不自造）',
  !!vo && !/\blevelOf\s*\(/.test(vo), !!vo && /\blevelOf\s*\(/.test(vo) ? '发现自造判定' : '零自造（只读引擎 level）');
check('C-③ `verdictOf` 内**不得**出现阈值比较（`>=` / `<=`）',
  !!vo && !/(>=|<=)/.test(vo), !!vo && /(>=|<=)/.test(vo) ? '发现阈值比较 ⇒ 又造了一份判据' : '零阈值比较');
check('C-④ `verdictOf` 读的是 rent 那一行（指标 key 锚定）',
  !!vo && /['"]rent['"]/.test(vo), !!vo ? '已锚 key=rent' : 'N/A');

// ============ D 主判据：术语餐饮化 ============
sec('D 主判据：结论与术语必须是餐饮人听得懂的话');
const RES_KEYS = ['resBreakMonthly', 'resBreakDaily', 'resTargetMonthly', 'resTargetDaily'];
const badRes = RES_KEYS.filter((k) => {
  const v = m2Scalar(termsRaw, k);
  return v == null || /营收/.test(v);
});
check('D-① 结论四项文案**不含**「营收」这类财务书面词',
  badRes.length === 0,
  badRes.length ? `仍含：${badRes.map((k) => k + '=' + m2Scalar(termsRaw, k)).join('、')}`
    : RES_KEYS.map((k) => m2Scalar(termsRaw, k)).join(' / '));
const tf = m2Scalar(termsRaw, 'tabForward'), tr = m2Scalar(termsRaw, 'tabReverse');
check('D-② Tab 名是「已有铺面 / 寻找铺面」（不得退回算法词）',
  tf === '已有铺面' && tr === '寻找铺面', `${tf} / ${tr}`);
// 🔴 「占比」没有宾语（占什么的比？）⇒ 必须带上"营业额"三个字。
// ⚠️ 必须**限定在 `indNames` 块内**取 —— `rent` 这个键名在 terms.js 里还有别的出处
//    （`fixedItems.rent='月房租（元）'` 等），全文件正则会抓到不相干的那一个
//    ⇒ 首版实测就误报了一次：**守卫红时先怀疑判据**，别急着改实现。
const indNamesBlock = (termsRaw.match(/\bindNames\s*:\s*\{[^}]*\}/) || [''])[0];
const rentName = (indNamesBlock.match(/\brent\s*:\s*'([^']*)'/) || [])[1] || '';
check('D-③ 房租指标名**带宾语**（不是光秃秃的「房租占比」）',
  !!indNamesBlock && rentName.indexOf('营业额') >= 0,
  indNamesBlock ? `indNames.rent = ${rentName}` : '未解析到 indNames 块（判据失效）⇒ 判红');

// ============ V 负样本互证（证明 A/B/C 不是恒绿）============
sec('V 负样本互证：旧写法喂给同一份判据，必须**转红**');
// V1：把专业指标塞回 input ⇒ A-① 必须红
const badWxml = '<input class="row-in" value="{{revRentRate}}" bindinput="onRevRentRate" />';
const v1Hit = inputBinds(stripWxml(badWxml)).filter((b) => BAN_INPUTS.indexOf(b) >= 0);
check('V-① 负样本（input 绑 revRentRate）会被 A-① 判红', v1Hit.length === 1,
  v1Hit.length === 1 ? `恰报 [${v1Hit.join(',')}]` : `未报（判据失效）=[${v1Hit.join(',')}]`);
// V2：两级 picker 写法 ⇒ B-① 必须红
const badSpo = 'syncPresetOptions() { const bizKey = this.data.t.bizTypes[this.data.bizIdx].key;'
  + ' const opts = BIZ_PRESETS.filter((p) => p.bizKey === bizKey).map((p) => p); }';
const v2Red = /\.filter\s*\(/.test(badSpo) && /\bbizKey\b/.test(badSpo);
check('V-② 负样本（按 bizKey 过滤）会被 B-① 判红', v2Red, v2Red ? '已报红' : '未报（判据失效）');
// V3：正样本（平铺）⇒ B-① 不得误报
const okSpo = 'syncPresetOptions() { const opts = BIZ_PRESETS.map((p) => ({ key: p.presetKey })); }';
const v3Red = /\.filter\s*\(/.test(okSpo) && /\bbizKey\b/.test(okSpo);
check('V-③ 正样本（BIZ_PRESETS 整体 map）**不误报**（防反向伤害）', !v3Red,
  v3Red ? '🔴 把正确实现判红了' : '未误报');
// V4：自造判定 ⇒ C-② 必须红
const badVo = 'verdictOf(list) { const lv = levelOf(pct, lo, hi, "cost"); return lv; }';
check('V-④ 负样本（verdictOf 内调 levelOf）会被 C-② 判红', /\blevelOf\s*\(/.test(badVo),
  /\blevelOf\s*\(/.test(badVo) ? '已报红' : '未报（判据失效）');
// 🔴 V5（R234-实测新增）：**历史存量**专业指标字段塞回 input ⇒ A-① 必须红。
//   首版没有这条负样本，所以"名单只覆盖我删过的字段"这个洞**一直没被发现** ——
//   负样本必须覆盖"我没想到的那一类"，否则它只是给已修的 bug 补一张合格证。
const v5Hit = inputBinds(stripWxml('<input class="row-in" value="{{pixelEffYuan}}" bindinput="onPixelEff" />'))
  .filter((b) => BAN_INPUTS.indexOf(b) >= 0);
check('V-⑤ 负样本（input 绑历史字段 pixelEffYuan）会被 A-① 判红', v5Hit.length === 1,
  v5Hit.length === 1 ? `恰报 [${v5Hit.join(',')}]` : `未报（判据失效）=[${v5Hit.join(',')}]`);
// V6：未登记的新字段 ⇒ A-⑥ 必须红（证明白名单真的是 fail-closed）
const v6Unknown = ['tableTurnoverYuan'].filter((b) => !ALLOW_INPUTS[b] && !FOR_ITEM.test(b));
check('V-⑥ 负样本（未登记的新字段 tableTurnoverYuan）会被 A-⑥ 判红', v6Unknown.length === 1,
  v6Unknown.length === 1 ? '已报红' : '未报（白名单失效）');
// V7：正样本（已登记的合法字段）⇒ A-⑥ **不得**误报（防反向伤害二型）
const v7Ok = ['seatsNum', 'avgPriceYuan', 'rentYuan'].filter((b) => !ALLOW_INPUTS[b]);
check('V-⑦ 正样本（已登记字段 seatsNum/avgPriceYuan/rentYuan）**不误报**', v7Ok.length === 0,
  v7Ok.length ? `🔴 把合法字段判红了：${v7Ok.join('、')}` : '未误报');

// ============ E 下界 ============
sec('E 下界：断言数不得被悄悄删掉');
// ⚠️ 阈值 = **实测值**（25）：写成"看起来合理"的整数会让它变成摆设；
//    每次增删断言都要跟这一行（由 `check_suite_assert_counts` 从外部再校一遍总数）。
check('E-① 断言总数 ≥ 25（首版实测 25 条：P3 + A5 + B5 + C5 + D3 + V4 + E1）',
  (pass + failN) >= 25, `实际 ${pass + failN} 条`);

console.log('\n===== M2 小白输入面守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);

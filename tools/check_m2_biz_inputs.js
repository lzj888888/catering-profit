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
  // ⚠️ R296 拍1：`laborUnitYuan`（员工月均工资）**输入框已删**（人工改「直接填总额」），
  //   此字段降级为**内部兜底**（选预设时带出、无 UI）—— 白名单条目保留（数据字段仍在）。
  laborUnitYuan: '（已无输入框）单人月人工单价 → labor 兜底；今由预设自动带出',
  // 🔴 R296 拍1/2/3（2026-10-14）：替换「每月固定支出」明细表的结构化固定成本输入。
  laborTotalYuan: '人工每月总额(元) → labor 固定项（不乘人数）；老板自己填实际工资合计',
  waterYuan: '水费(元/月) → 与电/气求和成 utility；有账单的填实数，没有留空走参考值',
  electricYuan: '电费(元/月) → 与电/气求和成 utility；有账单的填实数，没有留空走参考值',
  gasYuan: '燃气费(元/月) → 与电/气求和成 utility；有账单的填实数，没有留空走参考值',
  manageYuan: '管理费(元/月，选填) → manage 固定项；非加盟店留空 = 不评',
  marginPct: '菜品毛利率 → gross_margin_pct（核心口径，由菜品成本推出或选填）',
  openDaysNum: '每月开门天数 → 正向 valid_days / 反向 open_days（同一份用户输入，两个 Tab 共用）；老板自己定',
  planName: '方案名（快照用，非测算入参）',
  presetIdx: '业态预设 picker（枚举，非专业指标）',
  rentYuan: '月租金 → fixed_items.rent；房东报价，填得出',
  seatsPerTableNum: '单桌座位数（业态默认、用户可改）→ 与桌数相乘得 seats；属"用户输入的派生"，非外部基准',
  tablesNum: '桌数 → seats（= 桌数 × 单桌座位数，唯一换算点 = index.js::seatsNow）；老板站铺子里数得出',
  targetYuan: '目标月利润 → target_profit_fen；老板自己定目标',
  // 🔴 2026-10-12（round279d #12 多渠道毛利率）：以下 8 个均为「分渠道」用户输入框，统一走 onChannelInput，
  //   属用户手填/可改值（非参考值、非引擎推导注入），按本守卫纪律登记用途。
  'channel.takeawayRatio': '外卖营收占比(%) → 与团购占比一起折算综合毛利率；用户按门店实际外卖单量填',
  'channel.groupRatio': '团购营收占比(%) → 与外卖占比一起折算综合毛利率；用户按门店实际团购单量填',
  'channel.platformRate': '外卖平台抽成率(%) → 推导外卖毛利率（默认示例值 20%，用户可改/按后台校准）',
  'channel.packRate': '外卖包装/配送成本率(%) → 推导外卖毛利率（默认示例值 3%）',
  'channel.discountRate': '团购折扣率(%) → 推导团购毛利率（默认示例值 30%=7 折）',
  'channel.groupPlatformRate': '团购平台抽成率(%) → 推导团购毛利率（默认示例值 5%）',
  'channel.takeawayOverride': '外卖净毛利率手动覆盖(%) → 选填，覆盖推导值',
  'channel.groupOverride': '团购净毛利率手动覆盖(%) → 选填，覆盖推导值',
  // 🔴 R296b（渠道佣金改造）：新增「刷卡/扫码费率」输入（占**总流水**%），用户手填不可推导 ⇒ 登记。
  'channel.cardRate': '刷卡/扫码费率(%) → 直接进挂钩费率（占总流水%）；用户按收单机构费率填',
  // 🔴 2026-10-12（round279e · A 初始总投入回本）：非引擎入参，纯前端派生回本月数（复用 paybackCash 一次除法），
  //   用户手填的一次性总投入（含转让费/装修/设备/加盟）；引擎零改。
  'initialInvestYuan': '初始总投入(含转让费/装修/设备/加盟) → 纯前端派生回本月数，非引擎入参；用户手填',
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
// 🔴🔴 A-⑧（R237 新增）：引擎入参 `seats` 必须经**唯一换算点**得出。
//   R237 把输入口径由「座位数」改成「桌数」后，`seats` 由 `seatsNow() = 桌数 × 单桌座位数` 得出。
//   ⚠️ 这条红线的风险是**全静默**的：若有人图省事把 `seats: this.seatsNow()` 改回
//      `seats: Math.floor(Number(this.data.tablesNum))`（漏乘单桌座位数），
//      页面一切正常、引擎也照算 —— 只是**所有周转类结论都偏大**
//      （实测：5 桌时正确 3.70、漏乘 14.81，见 review/evidence/r237_m2_turn/recalc_anchors.js C-①）。
//   判据：`seats: <rhs>` 的右值**只允许两种形态**（白名单制）：
//     ① `this.seatsNow()` —— 唯一换算点（桌数 × 单桌座位数）
//     ② `<标识符>.seats`   —— **透传**上一层已构造好的 payload，不是新换算点
//   ⚠️ 形态 ② 是**判据自身的修正**，留痕在此：R237 首版判据只看「右边含不含 this.seatsNow()」，
//      把 `seats: p.seats`（转发 payload）误判成「第二处换算点」⇒ 直接判红。
//      这是**我方判据错**（R181i 纪律：守卫红先怀疑自己，别改代码迎合判据）。
//   反例（下列写法必须判红，见 §九变异回灌）：
//      `seats: Math.floor(Number(this.data.tablesNum))`（漏乘单桌座位数）
//      `seats: Number(this.data.seatsNum)`（残留旧字段名）
//      `seats: 20`（写死常量）
const seatsAssigns = (js.match(/\bseats\s*:[^,\n]*/g) || []).map((s) => s.trim());
const seatsRhs = seatsAssigns.map((s) => s.replace(/^seats\s*:\s*/, '').trim());
const seatsViaNow = seatsRhs.filter((r) => /^this\.seatsNow\(\)/.test(r));
const seatsViaPass = seatsRhs.filter((r) => /^[A-Za-z_$][\w$]*\.seats$/.test(r));
const badSeats = seatsRhs.filter((r) => seatsViaNow.indexOf(r) < 0 && seatsViaPass.indexOf(r) < 0);
// 🔴 R296-E：删除首页 reverse 死代码后，`seats:` 合法赋值由 ≥4 降为 2（buildPresetParam 内 `this.seatsNow()`
//   + onCalcPresetFwd 内 `p.seats` 透传）。自退化护栏同步下调（不因清理死代码而假红）；
//   核心红线不变 —— 任一右值不是「换算点 / 透传」即红，且必须至少保留 1 个换算点。
check('A-⑧ 🔴 `seats:` 右值只允许 `this.seatsNow()` 或透传 `<obj>.seats`（漏乘 / 写死 / 残留旧字段即红）',
  seatsAssigns.length >= 2 && seatsViaNow.length >= 1 && badSeats.length === 0,
  `受检 ${seatsAssigns.length} 处（换算 ${seatsViaNow.length} + 透传 ${seatsViaPass.length}）`
    + (badSeats.length ? ` ⇒ 越界：${badSeats.join(' | ')}` : '，全部合规'));

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
// 🔴 #7（round272）术语改名：主结论卡标题键由 `verdictTitle` 改为 `verdictHealthTitle`
//   （含义从「租金贵不贵」拓宽为「铺子健不健康」综合健康度）。terms.js 里 `verdictTitle` 已成孤儿键，
//   wxml 实际用的是 `verdictHealthTitle` ⇒ 判据须跟新键，否则恒红（判据过期，非代码回退）。
check('C-①c 渲染卡片标题 `{{t.verdictHealthTitle}}`（说清这张卡在答什么）',
  /\{\{t\.verdictHealthTitle\}\}/.test(wx), /\{\{t\.verdictHealthTitle\}\}/.test(wx) ? '在场' : '缺失 ⇒ 卡片没有名字');
// 🔴 判据：判定等级必须来自引擎 indicators，前端**不能自己再判一遍**。
check('C-② `verdictOf` 内**不得**调用 `levelOf`（判定不自造）',
  !!vo && !/\blevelOf\s*\(/.test(vo), !!vo && /\blevelOf\s*\(/.test(vo) ? '发现自造判定' : '零自造（只读引擎 level）');
check('C-③ `verdictOf` 内**不得**出现阈值比较（`>=` / `<=`）',
  !!vo && !/(>=|<=)/.test(vo), !!vo && /(>=|<=)/.test(vo) ? '发现阈值比较 ⇒ 又造了一份判据' : '零阈值比较');
// 🔴 #7（round272）设计变更：主结论由「单锚房租」改为「6 项指标里最差 level」综合健康度。
//   旧判据 C-④（必须含 'rent' 单键）已与当前实现对不上 ⇒ 更新为「必须按 worst-of-6 综合，不回退单指标」。
//   ⚠️ 这是**判据过期**不是代码回退：verdictOf 现在遍历全部 indicators 取最坏（index.js:1279-1297），正是 #7 要的。
//   鉴別力：若有人把 verdictOf 改回 `return {level:'good',…}`（永远绿、不看指标），`rank`/`worst` 任一缺失即红。
check('C-④ `verdictOf` 按「6 项里最差 level」综合判定（#7 综合健康度，不单锚 rent）',
  !!vo && /rank\s*[:=]/.test(vo) && /\bworst\b/.test(vo),
  !!vo ? (/rank\s*[:=]/.test(vo) && /\bworst\b/.test(vo) ? '已按 worst-of-6 综合' : '未见 rank/worst 逻辑 ⇒ 可能退回单指标') : 'N/A');

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
const v7Ok = ['tablesNum', 'seatsPerTableNum', 'avgPriceYuan', 'rentYuan'].filter((b) => !ALLOW_INPUTS[b]);
check('V-⑦ 正样本（已登记字段 tablesNum/seatsPerTableNum/avgPriceYuan/rentYuan）**不误报**', v7Ok.length === 0,
  v7Ok.length ? `🔴 把合法字段判红了：${v7Ok.join('、')}` : '未误报');
// V8（#7 配套）：把 verdictOf 退化成「永远绿、不看指标」喂给 C-④ 新判据，必须转红
//   ⇒ 证明 C-④ 不是假绿（否则"任意永远绿的实现"都会过）。
const badVo2 = 'verdictOf(list) { return { level: "good", levelName: "划算", note: "" }; }';
const v8Red = /rank\s*[:=]/.test(badVo2) && /\bworst\b/.test(badVo2);
check('V-⑧ 负样本（verdictOf 退化成永远绿、无 rank/worst）会被 C-④ 判红',
  !v8Red, v8Red ? '🔴 把退化实现漏过了' : '已报红（C-④ 非假绿）');

// ============ F · round273：A 区派生指标（每天来多少人 / 一天翻几台）============
sec('F · A 区派生指标 crowdOf：口径同源 + fail-closed');
// 🔴 为什么必须有这一段：round273 给「已有铺面」补齐了 round223 §3.1 定案的两项指标，
//   它们是**前端派生**（正向引擎根本不出这两个数）⇒ **没有引擎自测护着**，
//   口径一旦漂移（漏乘单桌座位数 / 改成分母 30 / 删掉 fail-closed）**没有任何东西会报错**。
//   ⇒ 用守卫钉死三件事：与反推同源可比、不给假数、只在 A 区渲染。
const crowdFn = (js.match(/crowdOf\s*\([^)]*\)\s*\{([\s\S]*?)\n  \}/) || [])[1] || '';
check('F-① 页面存在 `crowdOf(result)`（A 区客流/翻台的**唯一**派生处）',
  /crowdOf\s*\(/.test(js), crowdFn ? `抓到函数体 ${crowdFn.length} 字符` : '未抓到函数体');
check('F-② 每天来客 = 日均营业额 ÷ 人均消费（ceil，人不能是小数）',
  /breakPeople\s*=\s*Math\.ceil\(\s*bd\s*\/\s*price\s*\)/.test(crowdFn)
  && /targetPeople\s*=\s*Math\.ceil\(\s*td\s*\/\s*price\s*\)/.test(crowdFn),
  /bd\s*\/\s*price/.test(crowdFn) ? '除数=人均消费' : '🔴 除的不是人均消费');
check('F-③ 翻台 = 日均来客 ÷ 座位数（与反推 `月客流÷(座位×天数)` 同源 ⇒ 两 Tab 可比）',
  /turn\s*:[^;\n]*targetPeople\s*\/\s*seats/.test(crowdFn),
  /targetPeople\s*\/\s*seats/.test(crowdFn) ? '分子=日均来客、分母=座位数' : '🔴 口径已漂移');
check('F-④ fail-closed：人均消费 ≤0 或座位数 ≤0 ⇒ 返回 null（**不给假数**）',
  /!\s*\(price\s*>\s*0\)/.test(crowdFn) && /!\s*\(seats\s*>\s*0\)/.test(crowdFn) && /return null/.test(crowdFn),
  /return null/.test(crowdFn) ? '有 null 兜底' : '🔴 恒出数');
check('F-⑤ 只在「已有铺面」渲染（wxml 判 `mode === forward && crowd`）',
  /mode\s*===\s*['"]forward['"]\s*&&\s*crowd/.test(wx),
  /mode\s*===\s*['"]forward['"]\s*&&\s*crowd/.test(wx) ? '已限定 A 区' : '🔴 B 区也会渲染');
// 负样本（防假绿）：F-③ 必须能抓到「座位数漏乘桌数」这种**最易犯**的错
const badCrowd1 = 'crowdOf(r){const p=Number(this.data.avgPriceYuan);const s=Number(this.data.seatsPerTableNum);return {breakPeople:Math.ceil(Number(r.break_even_daily)/p),targetPeople:Math.ceil(Number(r.target_daily)/p),turn:Math.round((Math.ceil(Number(r.target_daily)/p)/s)*100)/100};}';
check('F-⑥ 负样本（座位数只取 seatsPerTableNum、**漏乘桌数**）会被 F-③ 判红',
  !/turn\s*:[^;\n]*targetPeople\s*\/\s*seats/.test(badCrowd1),
  /turn\s*:[^;\n]*targetPeople\s*\/\s*seats/.test(badCrowd1) ? '🔴 把错误实现漏过了' : '已报红');
// 负样本（防假绿）：删掉 fail-closed 恒出数 ⇒ F-④ 必须红
const badCrowd2 = 'crowdOf(r){const price=1;const seats=1;return {breakPeople:1,targetPeople:1,turn:1};}';
check('F-⑦ 负样本（删掉 fail-closed、恒出数）会被 F-④ 判红',
  !(/!\s*\(price\s*>\s*0\)/.test(badCrowd2)),
  /!\s*\(price\s*>\s*0\)/.test(badCrowd2) ? '🔴 把错误实现漏过了' : '已报红');

// ============ G · round276：L2「员工月均工资」必须是**活输入** + A 区坪效/人效口径 ============
sec('G · round276：L2 工资不是死输入 · A 区坪效/人效口径同源');
// 🔴 为什么必须立这一段：round276 李老师真机反馈「一个人每月工资多少——问的是员工的还是顾客的？」
//   顺着这条查出一个**静默错**：L2 那个输入框的值只写进 `data.laborUnitYuan`、
//   **从来没进过算式**（装配器恒读参数包常量）⇒ 老板把工资从 4500 改到 6000，
//   重算照跑、保本点**纹丝不动** —— 这种"改了没反应"比报错更伤信任，且**没有任何东西会报错**。
//   ⇒ 钉死两处：① 页面把值送进装配器；② 装配器**用户值优先、预设兜底**。
const bp = stripJs(presetRaw);
const asmFn = (bp.match(/function assembleItems\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/) || [])[1] || '';
const linBranch = (asmFn.match(/headcount_linear'\)[\s\S]{0,900}?\n\s*\}\s*else\s*if/)
  || asmFn.match(/headcount_linear'([\s\S]{0,900})/)) || [];
const linSrc = String(linBranch[1] || linBranch[0] || '');
check('G-① 页面把 L2「员工月均工资」送进装配器（input 带 laborUnitYuan ⇒ 不是死输入）',
  /laborUnitYuan:\s*Number\(this\.data\.laborUnitYuan\)/.test(js),
  /laborUnitYuan:/.test(js) ? '已送进 input' : '🔴 值只写进 data、从没进算式');
check('G-② 装配器 `headcount_linear` 分支：**用户值优先**、参数包只作兜底（≤0 才回落预设）',
  /const u\s*=\s*Number\(in_\.laborUnitYuan\)/.test(linSrc)
  && /u\s*>\s*0\s*\?\s*u\s*:/.test(linSrc),
  /in_\.laborUnitYuan/.test(linSrc) ? '用户值参与取值' : '🔴 恒读 params.laborUnitYuan（用户改了零影响）');
check('G-③ 兜底仍在（没填 / 非正数 ⇒ 回落参数包预设 ⇒ 既有锚点不漂）',
  /p\.params\s*&&\s*p\.params\.laborUnitYuan\s*\?\s*Number\(p\.params\.laborUnitYuan\.v\)\s*:\s*0/.test(linSrc),
  /p\.params\.laborUnitYuan/.test(linSrc) ? '预设兜底保留' : '🔴 兜底被删 ⇒ 没填就算 0 人工');
// 负样本（防假绿）：把装配器改回「恒读预设」—— 正是 round276 修的那个 bug 本身
const badAsm = "const unit = p.params && p.params.laborUnitYuan ? Number(p.params.laborUnitYuan.v) : 0;";
check('G-④ 负样本（装配器改回恒读参数包预设、无视用户输入）会被 G-② 判红',
  !(/const u\s*=\s*Number\(in_\.laborUnitYuan\)/.test(badAsm) && /u\s*>\s*0\s*\?\s*u\s*:/.test(badAsm)),
  /in_\.laborUnitYuan/.test(badAsm) ? '🔴 把错误实现漏过了' : '已报红');

// ── A 区坪效 / 人效（round223 §3.1 定案里**从来没建过**的两项）──
const effFn = (js.match(/effOf\s*\(\s*\)\s*\{([\s\S]*?)\n  \}/) || [])[1] || '';
check('G-⑤ 页面存在 `effOf()`（A 区坪效/人效的**唯一**派生处）',
  /effOf\s*\(/.test(js), effFn ? `抓到函数体 ${effFn.length} 字符` : '未抓到函数体');
check('G-⑥ 坪效 = 实际月营业额 ÷ 面积（分子必须是**已发生流水**，不是保本额）',
  /const rev\s*=\s*Number\(this\.data\.expectYuan\)/.test(effFn) && /rev\s*\/\s*area/.test(effFn),
  /this\.data\.expectYuan/.test(effFn) ? '分子=实际营业额' : '🔴 分子取错（算出来是保本坪效，不是实际坪效）');
check('G-⑦ 人效 = 实际月营业额 ÷ 员工人数',
  /const head\s*=\s*Number\(this\.data\.headcountNum\)/.test(effFn) && /rev\s*\/\s*head/.test(effFn),
  /rev\s*\/\s*head/.test(effFn) ? '分母=员工人数' : '🔴 人效口径已漂移');
check('G-⑧ fail-closed：没填实际月营业额 ⇒ 返回 null（**不给假数**）',
  /!\s*\(rev\s*>\s*0\)/.test(effFn) && /return null/.test(effFn),
  /return null/.test(effFn) ? '有 null 兜底' : '🔴 恒出数');
check('G-⑨ 只在「已有铺面」渲染（wxml 判 `mode === forward && eff`）',
  /mode\s*===\s*['"]forward['"]\s*&&\s*eff\b/.test(wx),
  /mode\s*===\s*['"]forward['"]\s*&&\s*eff\b/.test(wx) ? '已限定 A 区' : '🔴 B 区也会渲染');
// 负样本（防假绿）：拿保本营业额当分子 —— 老板要的是"我这店实际坪效"，不是"保本坪效"
const badEff = 'effOf(){const rev=Number(this.data.result.break_even_monthly);const area=Number(this.data.areaNum);return {rev:String(rev),pixel:String(Math.round(rev/area)),perHead:null};}';
check('G-⑩ 负样本（分子改成**保本营业额** + 删掉 fail-closed）会被 G-⑥/G-⑧ 判红',
  !(/const rev\s*=\s*Number\(this\.data\.expectYuan\)/.test(badEff) && /!\s*\(rev\s*>\s*0\)/.test(badEff)),
  /this\.data\.expectYuan/.test(badEff) ? '🔴 把错误实现漏过了' : '已报红');

// ============ H · round276：兜底品类「其他/通用餐饮」必须落到通用业态（不得静默回落 fastfood）============
sec('H · 兜底品类：选「都不是」⇒ 通用 other 业态（不静默错配 fastfood）');
// 🔴 为什么必须立这一段：李老师 2026-10-12 质疑"开的店不在 6 个预设里怎么选"。
//   抓 onPreset 函数体单独验「空值分支」—— 防止整体 js 上也命中（正常分支也置 bizIsOther）导致误判绿灯。
const onPresetSrc = (js.match(/onPreset\s*\(e\)\s*\{([\s\S]*?)\n  \}/) || [])[1] || '';
//   旧实现：兜底选项 key='' ⇒ `findPreset('')` 回退 `BIZ_PRESETS[0]`（快餐小面）⇒
//   选"都不是"实则按**快餐小面**的参数包 + 正餐业态带出指标，用户完全无感。
//   正确行为：兜底选项 key='other' ⇒ 走 `indicatorRef.BANDS.other`（4 类带的保守并集，标注"未细分行业"）。
const bpMod = (() => { try { return require(path.join(ROOT, 'utils/bizPreset.js')); } catch (e) { return null; } })();
check('H-① 兜底选项 key 是 other（不是空串；空串会静默回落 fastfood）',
  /const full\s*=\s*\[\{\s*key:\s*'other'/.test(js),
  /key:\s*'other'/.test(js) ? '兜底 key=other' : '🔴 兜底仍是空串 key（会静默错配）');
check('H-② onPreset 空值兜底也走 other（presetKey 置 other + bizIsOther 置真）',
  /presetKey:\s*'other'/.test(onPresetSrc) && /bizIsOther:\s*true/.test(onPresetSrc),
  /presetKey:\s*'other'/.test(onPresetSrc) ? '空值兜底=other' : '🔴 空值仍清成空串');
check('H-③ 装配入口 fallback 含 `findPreset(\'other\')`（绝不裸回退 BIZ_PRESETS[0]）',
  /findPreset\(this\.data\.presetKey\)\s*\|\|\s*findPreset\('other'\)\s*\|\|\s*BIZ_PRESETS\[0\]/.test(js),
  '装配 fallback 链路含 other');
check('H-④ BIZ_PRESETS 含 other 预设且 bizKey=other（通用业态有真实参数包，不是空壳）',
  !!bpMod && Array.isArray(bpMod.BIZ_PRESETS)
  && bpMod.BIZ_PRESETS.some((p) => p.presetKey === 'other' && p.bizKey === 'other'),
  bpMod ? `预设数 ${bpMod.BIZ_PRESETS.length}` : 'require 失败');
// 🔴 负样本（防假绿）：把 fallback 退化回旧式 `findPreset(x) || BIZ_PRESETS[0]`（正是静默错配的根），必须被 H-③ 判红
const badFb = 'const preset = findPreset(this.data.presetKey) || BIZ_PRESETS[0];';
check('H-⑤ 负样本（fallback 退化成裸 || BIZ_PRESETS[0]）会被 H-③ 判红',
  !/findPreset\(this\.data\.presetKey\)\s*\|\|\s*findPreset\('other'\)\s*\|\|\s*BIZ_PRESETS\[0\]/.test(badFb),
  /findPreset\('other'\)/.test(badFb) ? '🔴 把错误实现漏过了' : '已报红');

// ============ T 组（R339）：L1 标题里的数字必须等于实际输入行数 ============
//   为什么守：标题写「先答 5 个」，L1 实际只有 4 个输入框（面积/房租/人数/目标）——
//   老板照着数，数不出来，第一屏就失信。而这类"文案里的数字"最容易被增删输入项时漏改，
//   因为没有一条机器判据盯着它（同族病：定案写在注释里却没守卫）。
//   ⚠️ 切段必须**按行**切：`t.l1TitleRev` 含子串 `t.l1Title`，用 split 会切错段（本轮踩过，
//      切出 6 个字符的假段、rows 恒为 0 ⇒ 判据变成"永远 0 ≠ 5"的假红/假绿）。
sec('T L1 标题数字 ≡ 实际输入行数（R339）');
{
  const lines = wxmlRaw.split('\n');
  const si = lines.findIndex((l) => l.includes('t.l1Title'));
  const ei = lines.findIndex((l, i) => i > si && l.includes('t.l2Toggle'));
  const seg = (si >= 0 && ei > si) ? lines.slice(si, ei).join('\n') : '';
  const rows = (seg.match(/bindinput=/g) || []).length;
  check('T-① L1 段能定位且输入行 ≥ 4（下界，防切段失效变成恒真）',
    rows >= 4, '实际 ' + rows + ' 行（切片 ' + (si + 1) + '→' + ei + '）');

  const T2 = require('../miniprogram/i18n/terms.js').TERMS;
  ['l1Title', 'l1TitleRev'].forEach((k) => {
    const txt = String((T2.m2 && T2.m2[k]) || '');
    const m = txt.match(/([0-9]+)\s*[个项]/);
    const n = m ? Number(m[1]) : null;
    check('T-② ' + k + ' 里的数字 = L1 实际行数（' + rows + '）',
      n === rows, '文案「' + txt + '」里的数字是 ' + n);
  });
}

// ============ U 组（R341）：L1 三个输入项的语义补答 ============
//   为什么守：这三项在餐饮实务里都有歧义，不问清楚会**直接算错**——
//     · 面积：使用面积 vs 房本面积（差约 20% ⇒ 坪效错）
//     · 房租：含不含物业/取暖（直接进固定费用 ⇒ 保本错）
//     · 人数：含不含老板夫妻（人效分母错）
//   而"加一句提示"最容易在改版时被删掉，且删了不影响任何计算 —— 全靠人盯。
sec('U 输入项语义提示（R341）');
{
  const U = require('../miniprogram/i18n/terms.js').TERMS.m2;
  const keys = ['areaHint', 'rentHint', 'headcountHint', 'headcountHintRev'];

  const missing = keys.filter((k) => !String(U[k] || '').trim());
  check('U-① 四个语义提示键都存在且非空', missing.length === 0, '缺：' + missing.join('/'));

  const tooLong = keys.filter((k) => String(U[k] || '').length > 18);
  check('U-② 每条 ≤18 字（超过就不算"短提示"，应按分层线改折叠）', tooLong.length === 0,
    tooLong.map((k) => k + '=' + String(U[k]).length + '字').join(' / '));

  const n = (wxmlRaw.match(/class="row-hint"/g) || []).length;
  check('U-③ L1 里真的渲染了 3 条提示', n === 3, '实际 ' + n + ' 条');

  // 人数在两种模式下语义不同：已有店铺「含老板夫妻」、找店「打算请几个」
  // —— 只写一条会让另一个模式文不对题。
  check('U-④ 人数提示分正/反两套', /headcountHintRev/.test(wxmlRaw),
    'wxml 里的 headcountHintRev 出现 ' + (wxmlRaw.match(/headcountHintRev/g) || []).length + ' 次');
}

// ============ E 下界 ============
sec('E 下界：断言数不得被悄悄删掉');
// ⚠️ 阈值 = **实测值**（25）：写成"看起来合理"的整数会让它变成摆设；
//    每次增删断言都要跟这一行（由 `check_suite_assert_counts` 从外部再校一遍总数）。
check('E-① 断言总数 ≥ 30（25 首版 + H 组 5 条兜底品类回归）',
  (pass + failN) >= 30, `实际 ${pass + failN} 条`);

console.log('\n===== M2 小白输入面守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
process.exit(failN === 0 ? 0 : 1);

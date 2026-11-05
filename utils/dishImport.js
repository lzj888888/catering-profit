// utils/dishImport.js —— M3 P0-4 收银菜单批量导入（纯逻辑单源）
//
// 用途：把收银/Excel 里已有的「菜名/分类/售价」一键转成**草稿成本卡骨架**，并给每道菜算出
//   三色状态（绿=已核对 / 橙=用了默认值·估价 / 红=缺关键数据·成本不可信）。
//   「先全覆盖，再逐道变准」—— 老板不再手打菜名售价，只补主料的量价。
//
// 设计边界（方案 §4.1 / P0-4 行 180）：
//   ① 第一版**不做** 菜单图片识别 / 复杂 Excel / AI 自动猜配方（错了更难核对）。
//   ② 导入源 = 粘贴三列文本（菜名、分类、售价；分隔符容忍 制表/逗号/空格/顿号/斜杠）；
//      无收银接口时即此形态；真·POS 接口到位后只换「取数」一段，本模块判定逻辑不动。
//   ③ 草稿卡**复用 P0-2 品类模板**（`categoryPresets`）套默认出净率/损耗/调料(含油盐酱醋)/示例主料，
//      不预填真实主料价（红线 R138/R317）。
//   ④ 三色状态是**展示层只读判定**，不写库；真正成本可信度由老板补完主料价后翻绿。
//
// 🔴 单源纪律：分类→品类模板的匹配词表只在本文件一份；前端 import 页只读不抄。
const { CATEGORY_PRESETS, getCategoryPreset, CONDIMENT_NAME } = require('./categoryPresets.js');
const { isEstimatedCard } = require('./cardEst.js');

// 分类自由文本 → 品类 key 的匹配词表（单源）。命中第一个即返回；都不中返回 null（UI 退回让老板手选）。
// 覆盖别名与常见口语叫法，避免「热菜/炒菜/小炒」对不上「热炒荤菜」。
const CAT_KEYWORDS = {
  hot_meat: ['热炒', '炒菜', '荤菜', '炒肉', '小炒', '爆炒', '滑炒', '炒肉片', '回锅'],
  hot_veg: ['素菜', '炒素', '青菜', '蔬菜', '时蔬', '炒蔬', '炒时蔬'],
  braise: ['卤', '烧腊', '烧鹅', '叉烧', '卤味', '酱卤', '烤鸭', '酱肉', '腊味'],
  staple: ['面', '饭', '米', '粉', '面条', '炒饭', '馒头', '包子', '饺子', '饼', '粥'],
  soup: ['汤', '煲', '炖', '羹', '砂锅', '靓汤'],
  drink: ['饮', '奶茶', '咖啡', '果汁', '茶', '酒水', '汽水', '酸奶'],
  bbq_fry: ['烧烤', '炸', '烤串', '炸鸡', '薯条', '炸物', '煎', '铁板'],
  steam: ['蒸', '清蒸', '粉蒸', '蒸鱼', '蒸蛋'],
  cold: ['凉', '凉拌', '沙拉', '冷菜', '卤菜', '凉菜'],
  hotpot: ['火锅', '涮', '麻辣烫', '串串'],
  ricebowl: ['盖饭', '快餐', '套餐', '盒饭', '便当', '工作餐'],
};

// 把一行「菜名[,分类][,售价]」拆成结构化对象。分隔符容忍多种；各字段 trim。
// 返回 { name, category, priceYuan }；空行/无菜名返回 null（调用方跳过）。
function parseDishLine(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/\r/g, '').trim();
  if (!s) return null;
  // 分隔符：**有制表符就只按制表符切**（Excel/收银机复制出来的就是列分隔），
  //   否则退回「逗号/顿号/斜杠/竖线/空白」。
  // 🔴 为什么要先判制表符：Excel 复制的金额常带千分位 `1,280`，若同时接受逗号，
  //   这一格会被切成 `1` 与 `280` 两段 ⇒ 售价静默变成 **1 元**（毛利全部算错且零报错）。
  //   制表符场景下逗号留在格内，价格仍是 `1,280`，由下方「千分位」判定拦成提示（不猜数）。
  const delim = s.indexOf('\t') >= 0 ? /\t/ : /[,，、/｜|]|\s+/;
  const parts = s.split(delim).map((p) => p.trim()).filter((p) => p.length);
  if (!parts.length) return null;
  const name = parts[0];
  let category = '';
  let priceYuan = null;
  // 剩余片段里：能 parse 成数字的当售价，其余当分类（取最后一个分类片段）
  for (let i = 1; i < parts.length; i++) {
    const n = Number(parts[i]);
    if (parts[i] !== '' && !isNaN(n) && /^\d+(\.\d+)?$/.test(parts[i])) {
      if (priceYuan == null) priceYuan = n;
    } else {
      category = parts[i];
    }
  }
  return { name, category, priceYuan };
}

/**
 * 该行是否含**千分位**金额（`1,280` / `12,800`），需由调用方提示「请去掉逗号」。
 * 🔴 为什么只提示、不自动去逗号：`1,280` 也可能是「第 1 项、280 元」这种两列写法，
 *   自动改写等于替老板猜 —— 猜错就是**静默错价**。宁可让它红一次，也不替它编数。
 * @param {string} raw 原始行
 * @returns {boolean}
 */
function hasThousandsSeparator(raw) {
  const s = String(raw == null ? '' : raw);
  // \d{1,3},\d{3} 且后面不再接数字/逗号（避免把「1,2,3」这种三列误判成金额）
  return /(^|[^\d,])\d{1,3},\d{3}(?![\d,])/.test(s);
}

// 解析整段粘贴文本 → 菜品数组（跳过空行/无菜名行）。
function parseDishLines(text) {
  if (!text) return [];
  return String(text).split('\n')
    .map((l) => parseDishLine(l))
    .filter((x) => x && x.name);
}

// 分类自由文本 → 品类 key。**最长关键词优先**匹配（与词条书写顺序无关，对以后加词更稳）：
//   例如「咖喱鸡盖饭」同时含 staple 的「饭」(1字) 与 ricebowl 的「盖饭」(2字) ⇒ 取更长的「盖饭」→ ricebowl。
function matchCategory(catText) {
  if (!catText) return null;
  const t = String(catText).trim();
  let best = null;
  let bestLen = 0;
  for (const key of Object.keys(CAT_KEYWORDS)) {
    for (const kw of CAT_KEYWORDS[key]) {
      if (t.indexOf(kw) >= 0 && kw.length > bestLen) { best = key; bestLen = kw.length; }
    }
  }
  return best;
}

// 由「解析后的菜品 + 品类 key」生成草稿成本卡骨架（edit 页行形态，可直接送 saveCostCard）。
//   · 套品类默认：出净率/损耗/调料油火默认单价 + 示例主料（价格留空、isPreset=true）。
//   · 类型标记 is_draft=true（后端按此区别于正式卡；未补完不影响已补完卡先用）。
// 分类文本无法匹配模板时 catKey=null ⇒ 只给菜名+售价，调油火/主料交由老板手选（标记红/橙）。
function buildDraftCard(line, catKey) {
  const cat = catKey ? getCategoryPreset(catKey) : null;
  const lines = [];
  if (cat) {
    lines.push({
      input_type: 2, material_id: '', material_name: CONDIMENT_NAME,
      qty: '1', qty_unit: '份', price_unit: '份',
      unit_price_yuan: (cat.condiment_fen / 100).toFixed(2),
      yield_rate: '100', line_kind: 'main', isPreset: true,
      spec_hint: '', unit_warn: '',
    });
    for (const sl of (cat.sample_lines || [])) {
      lines.push({
        input_type: 2, material_id: '', material_name: sl.name,
        qty: String(sl.qty), qty_unit: sl.unit, price_unit: sl.unit,
        // 🔴 示例主料**故意不给价**：老板不填 ⇒ 成本只剩调料 ⇒ 毛利虚高。
        //   所以本模块**只产草稿给人补价**，不做「一键落库」（见 IMPORT_NO_AUTOSAVE 说明）。
        unit_price_yuan: '',
        yield_rate: String(cat.yield_rate), line_kind: 'main', isPreset: true,
        spec_hint: '', unit_warn: '',
      });
    }
  }
  return {
    name: line.name || '',
    category: cat ? cat.label : (line.category || ''),
    priceYuan: Number(line.priceYuan) || 0,
    lossRate: cat ? String(cat.loss_rate) : '',
    lines,
    is_draft: true,
    _catKey: catKey || null,
  };
}

// 三色状态（展示层只读判定，不写库）：
//   红 red    = 缺关键数据·成本不可信：无可用主材 或 无售价。
//   绿 green  = 已核对：有主材+有售价，且**没有**系统估行（老板已把所有估的都改/填了），且至少一道主材填了价。
//   橙 orange = 其余（有主材有售价，但仍含系统估默认值，待老板逐道变准）。
//
// 🔴 缺哪一项由 `draftIssues` 单点判定：导入页要用它拼「缺售价 / 品类没认出来」的提示，
//   若页面自己再判一次（`lines.some(...)`），两处迟早对不上（一处算调料行、一处不算）。
function draftIssues(card) {
  const lines = (card && card.lines) || [];
  // 三司会诊（2026-10-29）：调料行 line_kind 改为合法 'main'（规避引擎白名单硬拒），
  //   故「是否调料行」改用 material_name 判定（与 buildDraftCard 同单源 CONDIMENT_NAME）。
  const isCond = (l) => (l.material_name || '') === CONDIMENT_NAME;
  const hasMain = lines.some((l) => (l.material_name || '') && (l.qty || '') && !isCond(l));
  const hasPrice = Number(card && card.priceYuan) > 0;
  return { noMain: !hasMain, noPrice: !hasPrice };
}

function draftStatusOf(card) {
  const lines = (card && card.lines) || [];
  const isCond = (l) => (l.material_name || '') === CONDIMENT_NAME;
  const issues = draftIssues(card);
  if (issues.noMain || issues.noPrice) return 'red';
  if (!isEstimatedCard(lines)) {
    const anyMainPriced = lines.some((l) => !isCond(l) && Number(l.unit_price_yuan) > 0);
    if (anyMainPriced) return 'green';
  }
  return 'orange';
}

// 🔴 R566：草稿卡**不自动落库**的产品理由（导入页要原样告诉老板，别再"优化"成一键建卡）。
//   草稿的示例主料**没有价**（`unit_price_yuan:''`，红线 R138/R317 不许编价）。
//   若把这种草稿直接 saveCostCard：成本只剩「调料(含油盐酱醋)」≈0.3~0.5 元，
//   售价 28 元的菜会算出 **98% 毛利率** —— 老板以为"这道菜很赚"，比没建卡更危险
//   （假数字会进列表色带、毛利榜与 M2 诊断）。故：导入页只做「预填器」，落库必须由老板补完价后自己保存。
const IMPORT_NO_AUTOSAVE = '草稿只预填菜名/分类/售价与示例主料，主料价要你补；补完价再逐道保存，避免毛利率虚高。';

// 导入页 → 编辑页 传草稿的**本地暂存键**（单源：两页各写一遍字符串迟早拼错，且拼错是静默不预填）。
const DRAFT_PREFILL_KEY = 'DISH_IMPORT_DRAFT_ONE';

/**
 * 草稿卡 → 编辑页 `setData` 片段（唯一映射点，避免页面各写一遍字段名）。
 * 返回的 `lines` 已是编辑页行形态（含 picker 需要的 `qty_unit` / `price_unit`），
 * 页面只需 `commitLines(p.lines)`（由它补 `idx` 与单位下标）。
 * @param {object} draft buildDraftCard 的产物
 */
function prefillOf(draft) {
  const d = draft || {};
  const lines = (d.lines || []).map((l) => ({
    input_type: 2,
    material_id: '',
    material_name: l.material_name || '',
    qty: l.qty == null ? '' : String(l.qty),
    qty_unit: l.qty_unit || '克',
    price_unit: l.price_unit || l.qty_unit || '克',
    spec_hint: '',
    unit_warn: '',
    unit_price_yuan: l.unit_price_yuan == null ? '' : String(l.unit_price_yuan),
    yield_rate: l.yield_rate == null ? '100' : String(l.yield_rate),
    line_kind: 'main',
    isPreset: !!l.isPreset,
  }));
  return {
    name: d.name || '',
    priceYuan: Number(d.priceYuan) > 0 ? String(d.priceYuan) : '',
    category: d.category || '',
    catLabel: d.category || '',
    catKey: d._catKey || null,
    lossRate: d.lossRate == null ? '' : String(d.lossRate),
    lines,
  };
}

module.exports = { CAT_KEYWORDS, parseDishLine, parseDishLines, matchCategory, buildDraftCard, draftStatusOf, draftIssues, prefillOf, hasThousandsSeparator, IMPORT_NO_AUTOSAVE, DRAFT_PREFILL_KEY };
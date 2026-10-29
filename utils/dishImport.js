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
//   ③ 草稿卡**复用 P0-2 品类模板**（`categoryPresets`）套默认出净率/损耗/调料油火/示例主料，
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
  // 分隔符：制表、逗号（含全角）、空格、顿号、斜杠、竖线 —— 但菜名里也可能有「/」，故只取**前两个**分隔符切分
  const delim = /[\t,，、/｜|]|\s+/;
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
      input_type: 2, material_name: CONDIMENT_NAME,
      qty: '1', qty_unit: '份', price_unit: '份',
      unit_price_yuan: (cat.condiment_fen / 100).toFixed(2),
      yield_rate: '100', line_kind: 'main', isPreset: true,
    });
    for (const sl of (cat.sample_lines || [])) {
      lines.push({
        input_type: 2, material_name: sl.name, qty: String(sl.qty), qty_unit: sl.unit,
        yield_rate: String(cat.yield_rate), isPreset: true,
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
function draftStatusOf(card) {
  const lines = (card && card.lines) || [];
  // 三司会诊（2026-10-29）：调料行 line_kind 改为合法 'main'（规避引擎白名单硬拒），
  //   故「是否调料行」改用 material_name 判定（与 buildDraftCard 同单源 CONDIMENT_NAME）。
  const isCond = (l) => (l.material_name || '') === CONDIMENT_NAME;
  const hasMain = lines.some((l) => (l.material_name || '') && (l.qty || '') && !isCond(l));
  const hasPrice = Number(card && card.priceYuan) > 0;
  if (!hasMain || !hasPrice) return 'red';
  if (!isEstimatedCard(lines)) {
    const anyMainPriced = lines.some((l) => !isCond(l) && Number(l.unit_price_yuan) > 0);
    if (anyMainPriced) return 'green';
  }
  return 'orange';
}

module.exports = { CAT_KEYWORDS, parseDishLine, parseDishLines, matchCategory, buildDraftCard, draftStatusOf };

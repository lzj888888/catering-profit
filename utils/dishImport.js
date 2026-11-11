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
// R698（真实报表实测暴露）：整表粘贴必然带**表头行与合计行**，
//   它们有名字、有数字，旧实现会把「合计」当成一道菜建卡（豆包复现的美团
//   「菜品销售统计」12 行里就多出一张叫「合计」的卡）。
//   ⇒ 在解析最前端拦掉。用**精确匹配首片段**，不模糊包含：
//     菜名里恰好叫「合计」的概率极低，而模糊匹配会误杀「合计拼盘」这类真菜。
const NOISE_FIRST = ['合计', '小计', '总计', '汇总', '共计', '累计', '本页合计',
  'Total', 'TOTAL', '合计行', '总计金额'];
const COL_NAME = ['菜品名称', '菜名', '品名', '商品名称', '品项名称', '菜品名', '商品名'];
const COL_CAT = ['菜品分类', '菜品大类', '商品分类', '品项分类', '分类'];
const COL_PRICE = ['单价', '定价', '售价', '商品单价'];
// R700（真表实测暴露）：表头行判据必须与「列名别名」**同源**。
//   修前 HEADER_FIRST 是手写另一份名单，里面有「商品名称」却没有「商品名」——
//   而美团商品销量真表的表头恰好写「商品名」⇒ 表头行没被拦，被当成一道叫「商品名」的菜导进去。
//   ⇒ 改成由 COL_NAME 派生。以后再加列名别名，拦表头自动跟着生效，不会再漏。
const HEADER_FIRST = COL_NAME.concat(['菜品', '名称']);
function isNoiseLine(raw) {
  const s = String(raw == null ? '' : raw).replace(/\r/g, '').trim();
  if (!s) return true;
  const first = s.split(/\t|[,，、/｜|]|\s+/)[0].trim();
  return NOISE_FIRST.indexOf(first) >= 0 || HEADER_FIRST.indexOf(first) >= 0;
}

// R699（真实报表实测暴露，比合计行严重）：真实收银报表**菜名不在第一列**。
//   豆包联网检索到的官方帮助文档列序（有来源可核，见 review/evidence/r698_realforms/ 同名说明）：
//     美团管家：营业日期 / 菜品大类 / 菜品小类 / 菜品名称 / 销售数量 / 原价金额 / ...
//     银豹：操作 / 商品名称 / 商品条码 / 规格 / 单位 / 商品分类 / ... / 商品总售价 / 实收金额
//     天财商龙：品项编码 / 品项名称 / 品项分类 / 销售数量 / 应收金额 / ...
//   ⇒ 旧实现把第一列当菜名，整表粘贴后每道菜的名字都变成「2026-06-12」或「操作」，
//     真菜名被挤进分类列 —— 名字错了整张卡就废了，而页面看着"有 4 行数据"，零报错。
//   修法：先探测表头，按列名定位「菜名列 / 分类列 / 单价列」，不再假设位置。
//   ⚠️ 单价列只认「单价/定价/售价」这类**单价值**；
//     绝不把「原价金额 / 菜品收入金额 / 总金额」当单价 —— 那是金额合计，当单价会差出数量级。
//   （列名常量 COL_NAME / COL_CAT / COL_PRICE 统一定义在 isNoiseLine 之前，见上方「单源」说明）

function detectColumns(lines) {
  for (const raw of lines) {
    if (raw.indexOf('\t') < 0) continue;
    const parts = raw.split('\t').map(function (s) { return s.trim(); });
    const idx = function (names) {
      for (let i = 0; i < parts.length; i++) if (names.indexOf(parts[i]) >= 0) return i;
      return -1;
    };
    const nameIdx = idx(COL_NAME);
    if (nameIdx < 0) continue;
    return { nameIdx: nameIdx, catIdx: idx(COL_CAT), priceIdx: idx(COL_PRICE) };
  }
  return null;
}

// R702（P0-A）：粘贴内容**体检** —— 回答「这张表该不该解析」，而不是「能解析出多少」。
//
// 🔴 为什么必须有这一层（真表实测）：
//   老板把「单品关联套餐销售明细」整表粘进来，旧实现会**建出三张垃圾卡**：
//     名字 =「统计方式：【套餐明细】；营业」/「菜品编码」/「D001」
//   因为它的菜名列叫「单品名称」，不在 COL_NAME 里 ⇒ 定位不到 ⇒ 退回「第一列当菜名」，
//   而第一列是「菜品编码」。**页面显示"有 3 行数据"，零报错** —— 老板以为导入成功了。
//   同族的还有：美团「账单明细」第一列是结算id、淘宝账单第一列是结算日期。
//
//   而 `subpkg/biz/takeaway` 的统一导入器对套餐明细是**主动拒收**的（importSalesBill/index.js:206）。
//   两条链路行为不一致 ⇒ 从「建卡」入口进来的表没有保护。本函数就是补这一层。
//
// 判据 = 三类「这不是菜单」的签名，**不猜、直接说清楚是哪一类**：
//   ① combo_detail  表头含「套餐」+「单品名称」 ⇒ 拒收（套餐组分已在菜品销售统计里）
//   ② no_name_col   有表头但找不到菜名列 / 多数行第一列像编码或日期 ⇒ 拒收
//   ③ ok            其余一律放行（宁可放过，不可误杀 —— 老的三列粘贴必须不受影响）

// 套餐明细表的**表头签名**（Excel 里原文就叫这两列）。
// ⚠️ 这不是我们的术语值，是平台表格的列名 —— 所以集中成常量而不是散落字面量：
//    一来 page-terms 的 P3-1 不用为「外部列名」开口子，二来改名时只改这一处。
// 🔗 与云函数 `cloudfunctions/importSalesBill/service.js::detectDishShape` 的
//    `has('套餐') && has('单品名称')` 同源。云函数是独立部署单元，不能 require 本文件，
//    两份必须人工保持一致 —— 由 `utils/dishImport.selftest.js` 的 R702-⑤ 断言盯着。
const COMBO_SIGN = { set: '套餐', item: '单品名称' };

// 「像编码/日期，不像菜名」：纯 ASCII 数字串、日期串、字母前缀+数字。
// ⚠️ 含中文一票否决 —— 「3号套餐」「A区拼盘」是真菜名，不能当编码。
function looksLikeCode(s) {
  const v = String(s == null ? '' : s).trim();
  if (!v) return false;
  if (/[\u4e00-\u9fa5]/.test(v)) return false;
  if (/^\d{8}$/.test(v)) return true;                    // 20260910
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(v)) return true;   // 2026-09-10 / 2026.9.1
  if (/^[A-Za-z]{1,4}[-_]?\d{2,}$/.test(v)) return true; // D001 / SKU-001 / A123
  if (/^\d{6,}$/.test(v)) return true;                   // 条码
  return false;
}

function diagnosePaste(text) {
  const lines = String(text == null ? '' : text)
    .split('\n').map(function (l) { return l.replace(/\r/g, ''); })
    .filter(function (l) { return l.trim(); });
  const out = { kind: 'ok', rawLines: lines.length, codeN: 0, total: 0 };
  if (!lines.length) { out.kind = 'empty'; return out; }

  // ① 套餐明细：表头签名。只看前 5 行（真实表头常在标题/说明行之后）
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const cells = lines[i].split(/\t|[,，]/).map(function (s) { return s.trim(); });
    if (cells.indexOf(COMBO_SIGN.set) >= 0 && cells.indexOf(COMBO_SIGN.item) >= 0) {
      out.kind = 'combo_detail';
      return out;
    }
  }

  // ② 有表头却定位不到菜名列 —— 说明这张表的「名字」列叫别的名字
  const cols = detectColumns(lines);
  if (cols && cols.nameIdx < 0) { out.kind = 'no_name_col'; return out; }

  // ③ 没有可识别的表头，但多数行的第一列像编码/日期 ⇒ 第一列不是菜名
  //   阈值 0.6 + 至少 3 行：单行/双行不判，避免误杀「Coke」这类纯英文菜名偶发被当编码。
  if (!cols) {
    const firsts = lines
      .map(function (l) { return (l.split(/\t|[,，]/)[0] || '').trim(); })
      .filter(function (s) { return !!s; });
    const codeN = firsts.filter(looksLikeCode).length;
    out.codeN = codeN;
    out.total = firsts.length;
    if (firsts.length >= 3 && codeN / firsts.length >= 0.6) {
      out.kind = 'no_name_col';
      return out;
    }
  }
  return out;
}

function parseDishLine(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/\r/g, '').trim();
  if (!s || isNoiseLine(raw)) return null;   // R698：表头/合计行不当菜
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
  // priceYuan 在下方数字扫描后统一声明（R696：多数字时不猜）
  // 剩余片段里：能 parse 成数字的当售价，其余当分类（取最后一个分类片段）
  //
  // 🔴 R696（真实报表实测暴露）：**一行里出现多个数字时，不许取第一个当售价**。
  //
  //   原实现 `if (priceYuan == null) priceYuan = n;` —— 只取**第一个**数字。
  //   设计目标是「菜名 + 分类 + 售价」三列，那种情况下没毛病。
  //   但老板手里真实的是美团「菜品销售统计」这类**完整报表**，直接整表粘贴过来是
  //   最自然的操作，而它的列是「菜名 分类 销量 销售额 [单价]」——
  //     · `红烧肉 热菜 120 3600 30` ⇒ 旧实现取 120（**销量**）当售价，真单价 30 被丢掉
  //     · `宫保鸡丁 20 600`        ⇒ 旧实现取 20（销量），而 600 是销售额
  //   ⇒ 售价错 ⇒ 整张卡的毛利率全错，**而且不报错、不提示**（静默错价）。
  //
  //   修法：数字多于 1 个就**不猜**，售价留空并标记 ambiguous，交给页面提示去补。
  //   宁可他看到"售价没填"回去补一次，也不能替他挑一个数字 —— 挑错就是全盘错。
  //   （与 hasThousandsSeparator「宁可红一次，不替它编数」同一口径。）
  const nums = [];
  for (let i = 1; i < parts.length; i++) {
    const n = Number(parts[i]);
    if (parts[i] !== '' && !isNaN(n) && /^\d+(\.\d+)?$/.test(parts[i])) {
      nums.push(n);
    } else {
      category = parts[i];
    }
  }
  let priceYuan = null;
  let ambiguous = false;
  if (nums.length === 1) {
    priceYuan = nums[0];
  } else if (nums.length > 1) {
    ambiguous = true;   // 多个数字：不取任何一个，交给页面提示
  }
  return { name, category, priceYuan, ambiguous, ambNums: ambiguous ? nums : [] };
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
  // R699：有表头就按列名定位（真实报表 10+ 列、菜名常在第 2~5 列）；
  //   没有表头就退回「第一列是菜名」的老路径 ⇒ 现有三列粘贴行为完全不变。
  const all = String(text).split('\n')
    .map(function (l) { return l.replace(/\r/g, ''); })
    .filter(function (l) { return l.trim(); });
  const cols = detectColumns(all);
  // 🔴 R710（队列 #162）：这里曾经写 `cols.nameIdx > 0`，把「菜名恰好在第 1 列」的表排除在列定位之外。
  //   而 detectColumns 的契约是「找到了 COL_NAME 才返回对象」⇒ `cols` 非空本身就意味着 nameIdx ≥ 0，
  //   再拿 `> 0` 筛一遍，等于把**一半的真实报表**推回老路径。老路径完全不看表头，
  //   它只有「第一片段当菜名、第一个数字当售价」这一条启发式 ⇒ 两种静默错：
  //     ① 有「售价」列但在第 5 列 ⇒ 拿不到，还把销量/销售额全列成候选（ambiguous）；
  //     ② 只有「销量」没有「售价」⇒ 直接把**销量当售价**返回，且 ambiguous=false，
  //        界面看着一切正常 —— 这比 ambiguous 更坏，老板不会去核。
  //   ⚠️ 无表头时 cols 为 null，仍走老路径 ⇒ 三列粘贴的行为一字未变。
  if (cols) {
    const out = [];
    all.forEach(function (raw) {
      const p = raw.split('\t').map(function (s) { return s.trim(); });
      if (p.length <= cols.nameIdx) return;
      const name = p[cols.nameIdx] || '';
      if (!name || isNoiseLine(name)) return;
      const priceRaw = cols.priceIdx >= 0 ? (p[cols.priceIdx] || '') : '';
      out.push({
        name: name,
        category: cols.catIdx >= 0 ? (p[cols.catIdx] || '') : '',
        priceYuan: /^\d+(\.\d+)?$/.test(priceRaw) ? Number(priceRaw) : null,
        ambiguous: false,
        ambNums: [],
      });
    });
    return out;
  }
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

// 🔴 R711：**整批**的本地暂存键（R711 之前只有「一道菜的草稿」落盘，整批 rows 和粘贴原文
//   全躺在页面 data 里）。为什么必须落盘 —— 页面被销毁是**必现**路径，不是极端情况：
//   老板补了 5 道 → 想回 M3 看一眼别的 → 再点进来 ⇒ 页面重建 ⇒ text 和 rows 全空。
//   更坏的是重来一遍的代价不对称：已补完的 5 道**云端已经有卡**，可重新粘贴后每行都是
//   `saved:false`、看着像没做过 ⇒ 老板会再补一遍，同名的卡被重复建。
//   ⇒ saved 标记必须跟着整批一起活下来，这才是「不用重做」的关键，不只是省一次粘贴。
const BATCH_CACHE_KEY = 'DISH_IMPORT_BATCH';
// 批次有效期：7 天。不是为了省存储，是为了别让老板半年后进来看见一堆早已无关的菜名，
//   还得自己判断"这是什么时候的"。过期就静默丢弃（比弹一句「有旧数据要恢复吗」干净）。
const BATCH_TTL_MS = 7 * 24 * 3600 * 1000;

/**
 * 判断本地缓存能不能用来恢复。**纯函数**（时间由调用方传入）⇒ 可被门禁直接打。
 * fail-closed：任何结构不对就当没有，绝不半信半疑地恢复半张表。
 */
function isBatchFresh(cache, nowMs) {
  if (!cache || typeof cache !== 'object') return false;
  if (typeof cache.text !== 'string' || !cache.text) return false;
  if (!Array.isArray(cache.rows) || !cache.rows.length) return false;
  const ts = Number(cache.ts);
  if (!isFinite(ts) || ts <= 0) return false;
  const now = Number(nowMs);
  if (!isFinite(now)) return false;
  // 未来时间戳（改过系统时间/时钟漂移）也当过期：不然「7 天后」永远算不到。
  if (ts > now) return false;
  if (now - ts > BATCH_TTL_MS) return false;
  // 每一行至少得有名字和 draft 骨架，否则恢复出来是不能用的空壳
  return cache.rows.every(function (r) { return r && typeof r.name === 'string' && r.name && r.draft; });
}

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

module.exports = { CAT_KEYWORDS, isNoiseLine, detectColumns, diagnosePaste, looksLikeCode, COMBO_SIGN, parseDishLine, parseDishLines, matchCategory, buildDraftCard, draftStatusOf, draftIssues, prefillOf, hasThousandsSeparator, IMPORT_NO_AUTOSAVE, DRAFT_PREFILL_KEY, BATCH_CACHE_KEY, BATCH_TTL_MS, isBatchFresh };
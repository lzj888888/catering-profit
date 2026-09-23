// tools/check_data_contract.js —— 跨函数「数据契约」守卫（R97）
// 运行： node tools/check_data_contract.js
//
// 背景（2026-09-19 真云验证，一天内**两个同族缺陷**）：
//   ① **字段名分裂**：写端 `saveAsset` 落库 `value_fen`，读端 `calcAmortize::docToAsset` 只认 `total_value`
//      ⇒ 真云上摊销全程 `-504002`，而本地自测全绿（自测直接构造 `total_value`，不走真链路）。
//   ② **主键语义分裂**：`da.get(coll, id)` 走 `.doc(id).get()`（按 **`_id`** 查），
//      而 `_id` 由 `add()` 云端生成、**不等于** `asset_id`/`material_id`/`shop_id` 等业务主键
//      ⇒ 6 处调用点在真云一律 null（成本卡/资产编辑/物料编辑/店铺设置/导出 全不可用）。
//   共同点：**没有任何一个守卫在验「跨函数的字段契约」** —— 门禁 L 只验副本是否忠实（忠实反而复制缺陷）、
//   `check_requires` 只验符号是否存在（存在 ≠ 行为正确）、各函数 selftest 用 mock（mock 没有真云的 `_id` 语义）。
//
// 规则（四条，都只查**结构**，不查业务语义）：
//   C1 `_id` vs 业务主键：`common/dataAdapter.js` 的 `get()` 必须带**业务主键兜底**；
//      且兜底字段清单**不得含非唯一字段**（`card_code` —— 多版本模型下同 card_code 有多条，会取错版本）。
//   C2 同义字段双轨（DB 读取点）：定义同义字段组（现一组：资产原值 `total_value` / `value_fen`）。
//      凡**从 DB 文档变量**读取该语义字段的点（前缀 ∈ DB_VAR），若该文件**只读其中一个字段名**
//      且**无兼容写法** ⇒ 判红（写端落库只用一种名是合法的，本规则只管**读**）。
//   C3 契约层（响应体）命名：`getLedger` 的 `ok({...})` 出参 `inventory` 必须由**转换函数**产出，
//      不得裸透传 DB 文档（round103 实测：透传 camelCase + 前端照契约读 snake_case ⇒ 页面恒空）。
//   C4 可选入参不得以缺省值覆盖库内现值：`saveLedger` 的 `inventory?` 缺省 ⇒ **不动库存**
//      （round103 实测：缺省被读成全 0 并整体覆盖 ⇒ 保存一次就把盘点静默清零）。
//
//   C5 可选入参的缺省语义 —— **行为级**（require 真模块实跑，不绑源码写法）：缺省必须 == null（= 不动），
//      不得是 0；且非法金额（字符串 / 负数）必须被拒收。
//      round106 实测（同一处踩两个坑，静态判据都抓不到）：`f()` 的 allowZero 误传 true ⇒ 缺省变 0；
//      且漏回收 `f()` 返回的**错误对象**（它不是抛异常）⇒ 字符串 / 负数被静默放过并落进入参。
//
// 自失效护栏：S1 扫描面非空；S2 C2 的 DB 读取点**至少命中过一次**；S3 C3 的出参块必须解析得出（否则判红）；
//   S4 C5 能 require 到 saveLedger 校验模块；S5 C5 的基线用例本身必须合法（防整段空转恒绿）。
//
// 边界（明写，别高估）：
//   · C2 靠「变量名前缀」识别 DB 文档变量（`doc`/`r`/`hit`/`asset`/`material`/`exist`），
//     **换了变量名就会漏** —— 这是启发式，不是语义分析；S2 只保证"至少命中过"，不保证"没漏"。
//   · 真正的兜底仍是**真云链路验证**（`review/NOTE_2026-09-19_round39-realcloud-get.md`）。
(function () {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.resolve(__dirname, '..');
  const CF = path.join(ROOT, 'cloudfunctions');

  let pass = 0, failN = 0;
  const bad = [];
  function check(name, cond, detail) {
    if (cond) { pass++; console.log('✅ ' + name + (detail ? ' · ' + detail : '')); }
    else { failN++; bad.push(name + (detail ? ' · ' + detail : '')); console.log('❌ ' + name + (detail ? ' · ' + detail : '')); }
  }

  console.log('===== S · 自失效护栏 =====');
  check('S1 扫描面非空', fs.existsSync(CF), 'cloudfunctions/ 存在');

  // ---------- C1：`_id` vs 业务主键 ----------
  console.log('\n===== C1 · da.get 的业务主键兜底 =====');
  const DA = path.join(CF, 'common', 'dataAdapter.js');
  const daSrc = fs.existsSync(DA) ? fs.readFileSync(DA, 'utf8') : '';
  check('C1-1 dataAdapter.js 可读', !!daSrc, daSrc ? (daSrc.length + ' B') : '文件缺失');

  // 兜底 = 在 get() 里对业务主键字段做 where 查询（源码里出现「字段清单 + where」即视为有兜底）
  // ⚠️ 首版只查「源码里出现 BIZ_KEY_FIELDS 这个字符串」⇒ **清空数组也照样绿**（变异回灌当场抓到）。
  //   正确判据 = **解析出来的字段数 ≥ 3**（`id` + 至少两个业务主键）；字符串在位而字段为空 ⇒ 兜底形同虚设。
  const hasFallbackList = /BIZ_KEY_FIELDS\s*=|业务主键/.test(daSrc);
  // ⚠️ 正则要容得下 `[BIZ_KEY_FIELDS[i]]` 这种**带下标**的计算属性名（首版写成 `[A-Za-z_]+` ⇒ 漏匹配 ⇒ 假红）
  // ⚠️ 计算属性名是 `[BIZ_KEY_FIELDS[i]]` —— **末尾有两个 `]`**（`[i]` 一个 + 属性名括号一个），
  //    首版正则 `\[[^\]]+\]\s*:` 只吃一个 `]` ⇒ 匹配不上 ⇒ 假红。改成 `\]+` 容错。
  const hasWhereFallback = /where\(\{\s*\[[^\]]+\]+\s*:/.test(daSrc) || /where\(\{\s*\.\.\./.test(daSrc);
  check('C1-2 get() 带业务主键兜底字段清单', hasFallbackList,
    hasFallbackList ? 'BIZ_KEY_FIELDS 在位' : '未找到兜底字段清单（真云上 da.get(coll, 业务主键) 一律 null）');
  check('C1-3 get() 确实按兜底字段做 where 查询', hasWhereFallback,
    hasWhereFallback ? 'where 兜底在位' : '只有字段清单但没用于查询 ⇒ 兜底形同虚设');

  // 兜底字段不得含非唯一字段
  const NON_UNIQUE = ['card_code', 'month', 'name', 'category'];
  const m = /BIZ_KEY_FIELDS\s*=\s*\[([^\]]*)\]/.exec(daSrc);
  const fields = m ? (m[1].match(/'([^']+)'/g) || []).map((s) => s.replace(/'/g, '')) : [];
  const illegal = fields.filter((f) => NON_UNIQUE.includes(f));
  check('C1-2b 兜底字段清单非空（≥3：id + 至少两个业务主键）', fields.length >= 3,
    fields.length >= 3 ? ('字段数 = ' + fields.length) : ('字段数 = ' + fields.length + ' ⇒ 兜底形同虚设'));
  check('C1-4 兜底字段不含非唯一字段', illegal.length === 0 && fields.length >= 1,
    illegal.length ? ('含 ' + illegal.join(',') + ' ⇒ 会取错记录（多版本模型下同 card_code 有多条）')
      : ('字段 = [' + fields.join(', ') + ']'));

  // ---------- C2：同义字段双轨 ----------
  console.log('\n===== C2 · 同义字段在 DB 读取点必须兼容 =====');
  // 同义组：语义相同、历史上出现过分裂写法的字段名
  const SYN_GROUPS = [
    { name: '资产原值（分）', fields: ['total_value', 'value_fen'] },
  ];
  // DB 文档变量前缀 —— 只认 **`doc`**（即 `docToAsset` 这类「DB 文档 → 业务对象」的映射函数）。
  // ⚠️ 首版把 `r|hit|asset|material|exist` 也算进来 ⇒ **三处假红**（已核实全是误报）：
  //    · `calcAmortize/service.js` 的 `asset.total_value` = **docToAsset 映射后的干净对象**（内部契约，字段名统一）；
  //    · `saveAsset/validate.js` 的 `a.value_fen` = **wire 入参**（前端契约，与 DB 字段名无关）；
  //    ⇒ 只有 `doc.` 才是真正的「DB 文档」读取点。宁可漏（靠 S2 兜底），不可假红（假红会让人关掉守卫）。
  const DB_VAR = '(?:doc)';
  let c2Hits = 0;

  const fnDirs = fs.existsSync(CF)
    ? fs.readdirSync(CF, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'common' && e.name !== '_adminCore' && !e.name.startsWith('_'))
      .map((e) => e.name)
    : [];

  for (const dir of fnDirs) {
    const dirPath = path.join(CF, dir);
    const jsFiles = fs.readdirSync(dirPath)
      .filter((f) => f.endsWith('.js') && !f.includes('selftest') && !f.startsWith('cx_'));
    for (const f of jsFiles) {
      const rel = 'cloudfunctions/' + dir + '/' + f;
      const src = fs.readFileSync(path.join(dirPath, f), 'utf8');
      for (const g of SYN_GROUPS) {
        // 找出从 DB 变量读取的字段名
        const re = new RegExp('(?:^|[^\\w.])' + DB_VAR + '\\.(' + g.fields.join('|') + ')\\b', 'g');
        const found = new Set();
        let mm;
        while ((mm = re.exec(src)) !== null) found.add(mm[1]);
        if (found.size === 0) continue;
        c2Hits++;
        if (found.size === 1) {
          // 只读一种 ⇒ 必须有兼容写法：同行出现另一个字段名，或 `!= null ?` / `||` 兜底
          const only = [...found][0];
          const other = g.fields.find((x) => x !== only);
          const lines = src.split(/\r?\n/);
          const hasCompat = lines.some((l) =>
            (new RegExp('(?:^|[^\\w.])' + DB_VAR + '\\.' + only + '\\b').test(l))
            && (l.includes(other) || /\?\s*[^:]+:/.test(l) || /\|\|/.test(l)));
          check('C2 ' + rel + ' 读取「' + g.name + '」只用 ' + only + '，无 ' + other + ' 兼容', hasCompat,
            hasCompat ? '同行有兼容写法' : ('真云上若台账只存 ' + other + ' ⇒ 这里一读就空/就 throw。'
              + '修法：两个字段名都接受（参照 getAmortSchedule/index.js:32 的既有兼容写法）'));
        } else {
          console.log('   ↳ ' + rel + '「' + g.name + '」两字段名都读 ⇒ 兼容（正面样本）');
        }
      }
    }
  }

  check('S2 C2 的 DB 读取点至少命中过一次（防正则腐化）', c2Hits >= 1,
    c2Hits >= 1 ? ('命中 ' + c2Hits + ' 处') : '零命中 ⇒ 变量名前缀正则可能已腐，本规则无法自证有效');

  // ---------- C3：契约层（响应体）命名 —— `inventory` 不得裸透传 DB 文档 ----------
  console.log('\n===== C3 · getLedger 出参 inventory 必须经转换 =====');
  // 🔴 为什么需要它（round103，真机「点『去填库存盘点』原来填过的数字不出来」触发）：
  //   `getLedger` 的 `inventory` 出参在契约里是 snake_case（本仓 `10_云函数清单与接口契约.md` 第 42 行
  //   `inventory{opening_fen,purchase_fen,closing_fen}`），实现却把它从 DB 文档**原样透传**
  //   （落库是 camelCase `openingFen`）⇒ 前端**照契约**读 `opening_fen` 的页面永远读不到值。
  //   同一份响应里 `income_items` / `direct_consume_fen` 都过了 `toSnake`，**只漏这一个字段**。
  //   也正因为 C2 的 DB_VAR 前缀是**枚举**（只认 `doc`，且同义组只登记了资产原值一组）⇒ 此前扫不到。
  const GL = path.join(CF, 'getLedger', 'index.js');
  const glSrc = fs.existsSync(GL) ? fs.readFileSync(GL, 'utf8') : '';
  const okIdx = glSrc.indexOf('return ok({');
  const okBlk = okIdx >= 0 ? glSrc.slice(okIdx, glSrc.indexOf('});', okIdx) + 3) : '';
  check('S3 C3 的出参块可解析（防正则腐化）', okBlk.length > 0,
    okBlk.length > 0 ? (okBlk.length + ' B') : '未找到 `return ok({` 块 ⇒ fail-closed');
  const mInv = /inventory\s*:\s*([^,\n]+)/.exec(okBlk);
  let invExpr = mInv ? mInv[1].trim() : '';
  // 简写形态 `..., inventory,` 本身就是**裸透传**，必须同样纳入判定（否则漏判）
  if (!invExpr && /(?:^|[\s{])inventory\s*[,\n}]/.test(okBlk)) invExpr = 'inventory';
  // 判定：表达式本身是函数调用；或它绑定的标识符在本文件里由**函数调用**产出
  //   ⚠️ 判据要求 RHS **以标识符开头**（`= fn(`），不能用「RHS 含 `(`」——
  //      旧写法的 `= (acct && acct.inventory) || {...}` 含括号，会假绿（首版即踩）。
  let invConverted = false;
  if (invExpr) {
    if (invExpr.indexOf('(') >= 0) invConverted = true;
    else if (/^[A-Za-z_$][\w$]*$/.test(invExpr)) {
      invConverted = new RegExp('(?:const|let|var)\\s+' + invExpr + '\\s*=\\s*[A-Za-z_$][\\w$]*\\s*\\(').test(glSrc);
    }
  }
  check('C3-1 出参 inventory 经转换函数产出（禁裸透传 DB 文档）', invConverted,
    invExpr ? ('取值表达式 = ' + invExpr) : '未解析出出参 inventory ⇒ fail-closed');
  check('C3-2 getLedger 确实产出契约要求的 snake_case 库存字段', /opening_fen/.test(glSrc),
    /opening_fen/.test(glSrc) ? 'opening_fen 在位' : '未出现 opening_fen ⇒ 契约字段名未落地');

  // ---------- C4：可选入参不得以缺省值覆盖库内现值 ----------
  console.log('\n===== C4 · saveLedger 的 inventory? 缺省不得覆盖库存 =====');
  const SLV = path.join(CF, 'saveLedger', 'validate.js');
  const SLI = path.join(CF, 'saveLedger', 'index.js');
  const slvSrc = fs.existsSync(SLV) ? fs.readFileSync(SLV, 'utf8') : '';
  const sliSrc = fs.existsSync(SLI) ? fs.readFileSync(SLI, 'utf8') : '';
  check('C4-1 validate 的缺省初值为 null（= 未提供，而非全 0）', /let\s+inventory\s*=\s*null\s*;/.test(slvSrc),
    /let\s+inventory\s*=\s*null\s*;/.test(slvSrc) ? '缺省 = null' : '缺省被赋成具体对象 ⇒ 缺省即覆盖');
  check('C4-2 不得退回「缺省全 0 对象」的旧写法', !/let\s+inventory\s*=\s*\{\s*openingFen:\s*0/.test(slvSrc),
    '该写法会让可选入参缺省时把库存清零（round103 实测的真缺陷）');
  check('C4-3 落库侧按真值判断后才写库存字段', /if\s*\(\s*v\.inventory\s*\)\s*doc\.inventory\s*=\s*v\.inventory\s*;/.test(sliSrc),
    /if\s*\(\s*v\.inventory\s*\)\s*doc\.inventory\s*=\s*v\.inventory\s*;/.test(sliSrc)
      ? '条件写入在位' : '未找到条件写入 ⇒ 可能仍是无条件覆盖');
  check('C4-4 引擎用的是「本次值 or 库内现值」而不是缺失即 0',
    /const\s+effectiveInventory\s*=\s*v\.inventory\s*\|\|\s*existingInventory\s*;/.test(sliSrc),
    /const\s+effectiveInventory\s*=\s*v\.inventory\s*\|\|\s*existingInventory\s*;/.test(sliSrc)
      ? 'effectiveInventory 在位' : '未找到回退到库内现值的写法');

  // ---------- C5：可选入参的缺省语义（**行为级**） ----------
  console.log('\n===== C5 · saveLedger 可选入参缺省必须「不动」（require 真模块实跑）=====');
  // 为什么不写成静态正则：C4 那种「绑写法」的判据在本轮**两条真缺陷上都失明** ——
  //   ① `f(src.lump_sum_fen, 'x', true)` 与正确写法只差一个参数，正则很难只靠形态分辨；
  //   ② 漏掉 `if (x && x.error) return x;` 时，源码里该有的字符串全都在位 ⇒ 静态判据照样绿。
  //   实跑一次就能同时盖住两条，且与写法解耦。
  let c5 = null;
  try { c5 = require(path.join(CF, 'saveLedger', 'validate.js')).validateInput; } catch (e) { c5 = null; }
  check('S4 C5 能 require 到 saveLedger 校验模块（require 失败 ⇒ fail-closed）', typeof c5 === 'function',
    typeof c5 === 'function' ? '已加载' : ('require 失败：' + '模块不可加载'));
  if (typeof c5 === 'function') {
    const c5Base = () => ({
      shop_id: 's1', month: '2026-09',
      income_items: [{ category: 'dine_in', name: 'x', amount_fen: 100 }],
      expense_items: [{ category: 'labor', name: 'y', amount_fen: 50 }],
      direct_consume_fen: 10,
    });
    const okBase = c5(c5Base());
    check('S5 C5 基线用例本身合法（防整段空转、恒绿）', okBase.error === null, okBase.error || 'error = null');
    // round107 **C5 守点平移**：原守对象（saveLedger 的 `lump_sum_fen` 入参）**已退休** ——
    //   一次性投入改由服务端从台账（shop_amortize 里 mode='lump' 的行）求和，前端不再传标量。
    //   但「可选入参缺省必须『不动』、非法值不得静默放过」这条**纪律没退休**，它只是换了落点：
    //   现在最要紧的可变真相源是 saveAsset 的 `mode`（它决定这笔钱进哪张表）与**删除分支**。
    //   ⚠️ 三条仍全部**行为级**（require 真模块实跑），与 C4 的静态正则解耦。
    check('C5-1 saveLedger 的 lump_sum_fen **入参已退休**（出参不得再有该键 ⇒ 前端传了也不生效）',
      !('lumpSumFen' in okBase) && c5(Object.assign(c5Base(), { lump_sum_fen: 999 })).error === null,
      'lumpSumFen 键存在？' + ('lumpSumFen' in okBase));
    let c5a = null;
    try { c5a = require(path.join(CF, 'saveAsset', 'validate.js')).validateInput; } catch (e) { c5a = null; }
    const aBase = () => ({ shop_id: 's1', asset: { name: '装修', value_fen: 100, start_month: '2026-09', total_months: 12 } });
    const aWith = (patch) => c5a(Object.assign(aBase(), { asset: Object.assign(aBase().asset, patch) }));
    const mDefault = c5a(aBase());
    const mLump = aWith({ mode: 'lump' });
    const mJunk = aWith({ mode: 'whatever' });
    check('C5-2 saveAsset.mode 缺省语义：缺省/非法一律归 amort（老数据兼容），只有显式 \'lump\' 才判 lump',
      typeof c5a === 'function'
      && mDefault.error === null && mDefault.asset.mode === 'amort'
      && mLump.error === null && mLump.asset.mode === 'lump'
      && mJunk.error === null && mJunk.asset.mode === 'amort',
      '缺省=' + (mDefault.asset && mDefault.asset.mode) + ' / lump=' + (mLump.asset && mLump.asset.mode)
        + ' / 非法=' + (mJunk.asset && mJunk.asset.mode));
    const dOk = c5a({ shop_id: 's1', asset: { asset_id: 'a1', delete: true } });
    const dBad = c5a({ shop_id: 's1', asset: { delete: true } });
    check('C5-3 删除分支：只认 asset_id + delete:true；缺 asset_id 必须响亮拒收（不得静默当成新增）',
      typeof c5a === 'function' && dOk.error === null && dOk.remove === true && !!dBad.error,
      '合法删=' + (dOk.error || 'ok') + ' / 缺 id → ' + (dBad.error || '未拦'));
  }

  // ---------- C6：台账行级 mode 契约（**round107 新增**）----------
  console.log('\n===== C6 · 「一次性投入」改为台账行级 mode 后的契约（round107）=====');
  // 背景：round107 前，「一次性计入当月 / 按月摊销」是 **shop 级** `amortize_switch` 二选一 ——
  //   结构上排除了「本月既有一笔摊销、又有几笔小额一次算清」（李老师真机反馈否决）。
  //   现改为**台账行自带 mode**（shop_amortize 每行一个 mode），两类可共存。
  //   ⚠️ 这条契约的失败模式是**静默的**：任一处被改坏，某一类钱就不进利润表 —— 不报错、
  //      只是数字变小/变大（与 round103「库存静默清零」同族）。故三处各设一条判据，缺一不可：
  //        ① saveLedger 的一次性合计必须**从台账求和**（前端传什么都不能再影响它）；
  //        ② getAmortSchedule 必须把两类**分开返回**（否则摊销引擎会把「一次算清」也摊开，
  //           虽然 total_months=1 时数值恰好相同，但**口径归属错了**：它进的是另一个减项）；
  //        ③ 台账的增删改必须与 saveLedger **共用同一把归档锁**（否则账锁了、钱能从台账被挪走）。
  //   ⚠️ 判据只认语义锚点，**不绑变量名**（只改变量名不该红）。
  const sliSrc107 = fs.existsSync(SLI) ? fs.readFileSync(SLI, 'utf8') : '';
  const gasPath107 = path.join(CF, 'getAmortSchedule', 'index.js');
  const gasSrc107 = fs.existsSync(gasPath107) ? fs.readFileSync(gasPath107, 'utf8') : '';
  const saPath107 = path.join(CF, 'saveAsset', 'index.js');
  const saSrc107 = fs.existsSync(saPath107) ? fs.readFileSync(saPath107, 'utf8') : '';

  const c6Sum = /shop_amortize/.test(sliSrc107)
    && /mode === 'lump'/.test(sliSrc107)
    && /start_month === v\.month/.test(sliSrc107);
  check('C6-1 saveLedger 的一次性合计从台账（shop_amortize 且 mode=lump 且 start_month=本月）求和',
    c6Sum,
    c6Sum ? '台账求和在位' : '未找到台账求和 ⇒ 可能退回前端入参（前端传什么就记什么）');

  const c6Split = /mode !== 'lump'/.test(gasSrc107) && /mode === 'lump'/.test(gasSrc107)
    && /lumps:/.test(gasSrc107) && /lump_total_fen/.test(gasSrc107);
  check('C6-2 getAmortSchedule 分开返回 assets（摊销）/ lumps（一次算清）两类',
    c6Split,
    c6Split ? '两类已分开返回' : '未找到两张过滤腿 ⇒ 一次算清可能被混进摊销引擎');

  const c6Lock = /is_archive/.test(saSrc107) && /ARCHIVED_LOCKED/.test(saSrc107);
  check('C6-3 saveAsset 的台账增删改与 saveLedger 共用归档锁（is_archive ⇒ ARCHIVED_LOCKED）',
    c6Lock,
    c6Lock ? '归档锁在位' : '台账未受归档锁保护 ⇒ 账锁了仍能从台账挪钱');

  // ---------- C7：开关的「谁是真相源」契约（**round108 新增**）----------
  console.log('\n===== C7 · 开关值必须来自云函数出参（round108）=====');
  // 背景（2026-09-23 李老师真机）：摊销页「启用分期摊销」开关**关不上、自己弹回打开**。
  //   真因 = 该页从 `app.globalData.switches`（**前端缓存**）读开关，而缓存只在 getShopContext 时写一次；
  //   保存开关后没人刷新它 ⇒ 保存后重拉读回旧值（true）⇒ 开关自己弹回。**同族病：把缓存当真相源**。
  //   ⚠️ 本仓既有正确范式：录入页的库存开关读 `getLedger` 出参（服务端）、月度首页读 `d.switches || 缓存`。
  //     全仓**只有摊销页**把缓存当唯一来源 —— 故判据 ② 是「反向腿」：不许再出现那一行。
  //   判据三条腿（缺一不可）：
  //     ① getAmortSchedule 必须随本页数据返回服务端权威开关（渲染它的那次调用 = 唯一真相源）；
  //     ② 摊销页**不得**把 globalData 缓存当开关来源（否则缺陷原样复发）；
  //     ③ 开关的口径腿仍在（引擎里 `effectiveAmortizeFen` 带开关三元 ⇒ 关掉即归 0），
  //        行为级由 batch8b A9-⑰ 承担，这里只确认那条腿没被整段删掉（静态）。
  const gas108 = fs.readFileSync(path.join(CF, 'getAmortSchedule', 'index.js'), 'utf8');
  const c7Srv = /amortize_switch_on/.test(gas108)
    && /shop_switch/.test(gas108)
    && /amortize_switch/.test(gas108);
  check('C7-1 getAmortSchedule 随出参返回服务端权威开关（amortize_switch_on ← shop_switch.amortize_switch）',
    c7Srv,
    c7Srv ? '权威开关已在出参里' : '出参缺权威开关 ⇒ 页面只能去读前端缓存（= 缺陷复发）');

  const amoPath108 = path.join(ROOT, 'pages', 'month', 'amortize.js');
  const amo108 = fs.existsSync(amoPath108) ? fs.readFileSync(amoPath108, 'utf8') : '';
  // ⚠️ 必须**剔注释**再判（踩过）：页面里那句「不再读 app.globalData.switches」的**解释性注释**
  //   本身就是这串 token ⇒ 裸扫会把正确的修复判成缺陷（round107 的 batch8b A9-② 同款自伤）。
  const amo108Code = amo108.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const c7NoCache = amo108.length > 0
    && !/globalData\.switches/.test(amo108Code)
    && /d\.amortize_switch_on/.test(amo108Code);
  check('C7-2 摊销页的开关值取自云函数出参（且**不得**再出现 globalData.switches 读取）',
    c7NoCache,
    c7NoCache ? '页面只认服务端出参' : '页面仍在读前端缓存 ⇒ 保存后重拉会读回旧值、开关弹回');

  const engines108 = ['saveLedger/service.js', 'getLedger/service.js', 'calcMonthlyProfit/service.js'];
  const c7LegBad = engines108.filter((f) => {
    const src = fs.readFileSync(path.join(CF, f), 'utf8');
    return !/effectiveAmortizeFen\s*=\s*amortizeSwitchOn\s*\?/.test(src);
  });
  check('C7-3 三副本引擎都保留「关掉 ⇒ 摊销归 0」的口径腿（缺一即某条链路上开关形同虚设）',
    c7LegBad.length === 0,
    c7LegBad.length ? ('缺腿：' + c7LegBad.join(', ')) : '三副本均在位');

  console.log('\n===== 跨函数数据契约守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
  if (failN) bad.forEach((b) => console.log('   ❌ ' + b));
  process.exit(failN === 0 ? 0 : 1);
})();

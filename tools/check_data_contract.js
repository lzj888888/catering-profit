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
// 自失效护栏：S1 扫描面非空；S2 C2 的 DB 读取点**至少命中过一次**；S3 C3 的出参块必须解析得出（否则判红）。
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

  console.log('\n===== 跨函数数据契约守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
  if (failN) bad.forEach((b) => console.log('   ❌ ' + b));
  process.exit(failN === 0 ? 0 : 1);
})();

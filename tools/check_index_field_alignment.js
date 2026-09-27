// tools/check_index_field_alignment.js —— R157：**索引字段 ≡ 代码里真在用的字段**守卫
//
// 事故模型（本轮要防的**形态缺陷**）：
//   数据库索引建在**一个全树代码里根本不存在的字段**上 ⇒ 索引"看着有、实际从不用"。
//   本仓实证：`shop_cost_card_line` 的 `idx_line_card` 建在 `card_id`，
//   而生产写入/查询一律用 `cost_card_row_id`（写入 saveCostCard:298 / 查询 getCostCard:18、saveCostCard:59）
//   ⇒ **`card_id` 这个字段全树（除索引定义自身）零出现** ⇒ 每次按卡查配方明细都是**全集合扫描**，
//     随数据量线性恶化，最终撞云函数 20s 超时。
//   根因是「文档与代码各说各话」：v1.0 规范写 `card_id`，实现改成 `cost_card_row_id` 系
//   （v1.1:166 已把该不一致登记为"命名不一致·待裁决"），索引就跟着旧名成了化石。
//   ⇒ 与 R154「列表默认 100 条截断」同族：**判据存在但盲区**，且危害都不响亮（静默变慢/静默变少）。
//
// 判据（纯函数化 + 正负互证 + 反查真实单源 + 解析器自带钉死样本）：
//   L1 **化石索引**（主判据）：索引的每个字段名，必须在「云函数源码词表」里以**独立标识符**出现。
//      词表 = cloudfunctions/**/*.js（去行注释）抽出的全部标识符 —— 但**挖掉索引定义字面量本身**
//      （否则 `{card_id:1}` 会因定义行自证存在而**假绿**；挖不到即判红，fail-closed）。
//      ⚠️ 为什么不是"字段必须出现在该集合的 where/insert 调用点"：`version` / `is_deleted` /
//      `enabled` / `created_at` 这类字段合法地只出现在**属性访问**、**DataAdapter 自动注入**、
//      **种子数据**里（实测会误伤 6 条）⇒ 判据收窄到"这个字段名究竟存在不存在"，只抓真化石。
//   L2 **锚点精确对齐**：`shop_cost_card_line` 的索引字段集必须**恰好**是 {shop_id, cost_card_row_id}
//      —— 且**不得含 `card_id`**（本条是本轮修复的靶心，把"改回去"变成响亮转红）。
//   L3 **字段真在用**：`cost_card_row_id` 必须**同时**出现在写入点（`da.insert('shop_cost_card_line'`）
//      与查询点（`da.list/listAll('shop_cost_card_line'`）—— 证明 L2 的字段是活的，不是"换个名字继续死"。
//   S1~S3 自失效护栏（扫描面 / 索引条数 / 词表规模下界，防"扫了空集所以全绿"）
//   C1~C3 反恒真：喂「旧写法 {card_id:1}」必红；「正确写法」「等价的带引号字段名」必绿。
//
// ⚠️ 输出纪律（R145）：中间行不得出现「N 通过 / M 失败」字样（会被 suite-assert-counts 误当总口径）。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅ ' + m); pass++; };
const bad = (m) => { console.log('  ❌ ' + m); fail++; };

const SRC = path.join(ROOT, 'cloudfunctions/initDb/collections.js');
const CF = path.join(ROOT, 'cloudfunctions');
const SKIP_DIRS = new Set(['node_modules', '.git', '_bak_r70', '_qr_archive', '.inscode']);

function readOrNull(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } }
function stripComments(src) {
  return String(src || '').split(/\r?\n/).map((l) => l.replace(/(^|[^:"'`])\/\/[^\n]*$/, '$1')).join('\n');
}

// ============ 纯函数判据（可被反恒真样本直接调用） ============

// 取 `const <decl> = { ... }` 的**字面量文本**（自带引号/注释扫描，与 check_schema_sync 同思路）。
// 返回 null = 解析失败（调用方判红）。
function extractLiteral(src, decl) {
  const at = String(src || '').indexOf(decl);
  if (at < 0) return null;
  let j = at + decl.length;
  while (j < src.length && src[j] !== '[' && src[j] !== '{') j++;
  if (j >= src.length) return null;
  let depth = 0, quote = null, esc = false, lineC = false, blockC = false;
  for (let k = j; k < src.length; k++) {
    const c = src[k], n = src[k + 1];
    if (lineC) { if (c === '\n') lineC = false; continue; }
    if (blockC) { if (c === '*' && n === '/') { blockC = false; k++; } continue; }
    if (quote) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && n === '/') { lineC = true; k++; continue; }
    if (c === '/' && n === '*') { blockC = true; k++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '[' || c === '{' || c === '(') depth++;
    else if (c === ']' || c === '}' || c === ')') { depth--; if (depth === 0) return src.slice(j, k + 1); if (depth < 0) return null; }
  }
  return null;
}

// 判据 L1（纯函数）：给定索引清单 + 词表，返回**化石字段**清单。
//   indexes: { coll: [{name, keys:{f:1}}] }
//   vocab:   Set<string> —— 独立标识符
function fossilFields(indexes, vocab) {
  const out = [];
  for (const coll of Object.keys(indexes || {})) {
    for (const ix of (indexes[coll] || [])) {
      for (const fld of Object.keys(ix.keys || {})) {
        if (!vocab.has(fld)) out.push({ coll, name: ix.name, field: fld });
      }
    }
  }
  return out;
}

// 判据 L2（纯函数）：某集合的索引字段集（并集）
function indexFieldsOf(indexes, coll) {
  const s = new Set();
  for (const ix of ((indexes || {})[coll] || [])) for (const f of Object.keys(ix.keys || {})) s.add(f);
  return s;
}

// ============ 构建扫描面 ============
const collectionsSrc = readOrNull(SRC);

console.log('===== R157 · 索引字段 ≡ 代码实际字段守卫（化石索引） =====');

// ---------- 取单源索引定义 + 挖掉定义段（防自证假绿） ----------
let indexes = null;
let vocabSize = 0;
let scanFiles = 0;
let digOK = false;
{
  if (!collectionsSrc) {
    bad('L1 ' + path.relative(ROOT, SRC).replace(/\\/g, '/') + ' 读不到（索引单源缺失，fail-closed）');
  } else {
    const lit = extractLiteral(collectionsSrc, 'const INDEXES =');
    if (!lit) bad('L1 解析不到 `const INDEXES = { ... }` 字面量 ⇒ 判红（fail-closed，不许静默放行）');
    else {
      try {
        // eslint-disable-next-line no-new-func
        indexes = new Function('return (' + lit + ');')();
        digOK = true;
      } catch (e) {
        bad('L1 INDEXES 字面量求值失败：' + (e && e.message));
      }

      // 词表：cloudfunctions/**/*.js 的标识符（去注释）；collections.js 先挖掉 INDEXES 定义段
      const vocab = new Set();
      const addWords = (txt) => {
        const re = /[A-Za-z_][A-Za-z0-9_]*/g;
        let m;
        while ((m = re.exec(txt))) vocab.add(m[0]);
      };
      (function walk(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) { if (SKIP_DIRS.has(e.name)) continue; walk(p); continue; }
          if (!/\.js$/.test(e.name)) continue;
          let src = readOrNull(p);
          if (src == null) continue;
          src = stripComments(src);
          if (p === SRC && lit) src = src.split(lit).join(' ');   // 🔴 挖掉定义段本身
          scanFiles++;
          addWords(src);
        }
      })(CF);
      vocabSize = vocab.size;

      // 自失效护栏：词表规模
      if (vocabSize >= 500) ok('S3 云函数源码词表规模 ' + vocabSize + ' 个标识符 ≥ 500（防"扫了空集所以全绿"）');
      else bad('S3 词表仅 ' + vocabSize + ' 个标识符（< 500 ⇒ 扫描面异常或被写窄）');

      if (scanFiles >= 60) ok('S1 扫描面完整（' + scanFiles + ' 个云函数侧 .js，缩到 < 60 即转红）');
      else bad('S1 扫描面只有 ' + scanFiles + ' 个文件（< 60 ⇒ 路径变了或被写窄）');

      // ---------- L1 主判据：化石索引 ----------
      if (indexes) {
        const total = Object.keys(indexes).reduce((n, c) => n + indexes[c].length, 0);
        if (total >= 30) ok('S2 解析出索引 ' + total + ' 条（≥ 30；总数由 check_schema_sync S2 单独守，此处只防解析失败）');
        else bad('S2 只解析出 ' + total + ' 条索引（< 30 ⇒ 单源结构已变或解析被写窄）');

        const fossils = fossilFields(indexes, vocab);
        if (fossils.length === 0) {
          ok('L1 **无化石索引**：' + total + ' 条索引的每个字段都在云函数源码里以独立标识符出现（词表 ' + vocabSize + '）');
        } else {
          bad('L1 发现 ' + fossils.length + ' 个**化石索引字段**（字段名在云函数源码里零出现 ⇒ 该索引从未生效、查询走全表扫描）：\n     ' +
            fossils.slice(0, 8).map((f) => f.coll + '.' + f.name + ' ← ' + f.field).join('\n     '));
        }

        // ---------- L2 锚点精确对齐（本轮修复靶心） ----------
        const lineFields = indexes['shop_cost_card_line'] ? indexFieldsOf(indexes, 'shop_cost_card_line') : null;
        if (!lineFields || !lineFields.size) {
          bad('L2 shop_cost_card_line 没有索引定义 ⇒ 明细查询将全表扫描（本轮修复被删掉了）');
        } else {
          const want = ['shop_id', 'cost_card_row_id'];
          const missing = want.filter((f) => !lineFields.has(f));
          const extra = [...lineFields].filter((f) => !want.includes(f));
          if (missing.length === 0 && extra.length === 0) {
            ok('L2 shop_cost_card_line 索引字段 ≡ {shop_id, cost_card_row_id}（与生产写入/查询字段完全一致）');
          } else {
            bad('L2 shop_cost_card_line 索引字段不符：缺 [' + missing.join(', ') + '] / 多 [' + extra.join(', ') + ']');
          }
          if (lineFields.has('card_id')) bad('L2 索引里仍有 `card_id` —— 该字段全树除索引定义外零出现（化石），是本轮修复的靶心');
          else ok('L2 索引里已无 `card_id` 化石字段');
        }
      }

      // ---------- L3 字段真在用（写入点 + 查询点） ----------
      {
        const writeSrc = readOrNull(path.join(CF, 'saveCostCard/index.js'));
        const readSrc = readOrNull(path.join(CF, 'getCostCard/index.js'));
        const near = (src, anchor) => {
          if (src == null) return null;
          const flat = stripComments(src).replace(/\r?\n/g, ' ');
          const i = flat.indexOf(anchor);
          return i < 0 ? null : flat.slice(i, i + 400);
        };
        const wWin = near(writeSrc, "insert('shop_cost_card_line'");
        const rWin = near(readSrc, "list('shop_cost_card_line'");
        const wOK = !!(wWin && /cost_card_row_id\s*:/.test(wWin));
        const rOK = !!(rWin && /cost_card_row_id\s*:/.test(rWin));
        if (wOK) ok('L3 写入点带 `cost_card_row_id`（saveCostCard 的 da.insert(\'shop_cost_card_line\')）—— 字段是活的');
        else bad('L3 写入点找不到 `cost_card_row_id`（saveCostCard 没写这个字段？）⇒ L2 的字段可能是"换个名字继续死"');
        if (rOK) ok('L3 查询点带 `cost_card_row_id`（getCostCard 的 da.list(\'shop_cost_card_line\')）—— 索引确实会被用到');
        else bad('L3 查询点找不到 `cost_card_row_id`（getCostCard 没按它查？）⇒ 索引建了也没人用');
      }

      // ---------- C1~C3 反恒真 ----------
      const SHADOW_BAD = { shop_cost_card_line: [{ name: 'idx_line_card', keys: { card_id: 1 } }] };
      const SHADOW_GOOD = { shop_cost_card_line: [{ name: 'idx_line_row', keys: { shop_id: 1, cost_card_row_id: 1 } }] };
      const SHADOW_QUOTED = { shop_cost_card_line: [{ name: 'idx_line_row', keys: { 'shop_id': 1, 'cost_card_row_id': 1 } }] };
      const fBad = fossilFields(SHADOW_BAD, vocab);
      const fGood = fossilFields(SHADOW_GOOD, vocab);
      const fQuoted = fossilFields(SHADOW_QUOTED, vocab);
      if (fBad.length === 1 && fBad[0].field === 'card_id') ok('C1 影子样本「旧写法 keys:{card_id:1}」被判红 —— 判据有分辨力');
      else bad('C1 影子样本「旧写法」没被判红（得到 ' + JSON.stringify(fBad) + '）⇒ 判据无分辨力（假绿）');
      if (fGood.length === 0) ok('C2 影子样本「本轮正确写法」判绿（正常写法不受伤）');
      else bad('C2 影子样本「正确写法」被判红 ⇒ 判据过严（假红）：' + JSON.stringify(fGood));
      if (fQuoted.length === 0) ok('C3 等价改写（字段名带引号）仍判绿 ⇒ 判据判**字段名**不判书写形态');
      else bad('C3 等价改写被判红 ⇒ 判据在判字面而非行为：' + JSON.stringify(fQuoted));
    }
  }
}

console.log('');
console.log('===== 索引字段对齐守卫结果：' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail === 0 ? 0 : 1);

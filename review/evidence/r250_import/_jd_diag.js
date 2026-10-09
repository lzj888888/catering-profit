// R249-2 诊断：用**生产引擎**判定京东两表的分流结果
// 关键问题：`index.js` 先跑 detectDishMatrix（形态 A/B/C 优先）⇒ 京东表会不会被误判成菜品形态？
const path = require('path');
const fs = require('fs');
const Module = require('module');

const SVC = path.resolve('cloudfunctions/importSalesBill/service.js');
let svc = null, stubbed = false;
try { svc = require(SVC); } catch (e) {
  if (!/xlsx/.test(String(e.message || ''))) { console.error('require 失败:', e.message); process.exit(1); }
  const orig = Module._load;
  Module._load = function (req) { if (req === 'xlsx') return {}; return orig.apply(this, arguments); };
  svc = require(SVC); stubbed = true;
}
console.log('service.js 加载 =', !!svc, stubbed ? '(xlsx 空桩)' : '(真 xlsx)');
console.log('');

const RAW = JSON.parse(fs.readFileSync('_probe_tmp/_jd_matrix.json', 'utf8'));

for (const key of Object.keys(RAW)) {
  const item = RAW[key];
  console.log('=' .repeat(90));
  console.log('#', key, '|', item.file);
  const matrix = { sheets: item.sheets };

  // ① 分流判定：会不会被当成菜品形态？
  const dd = svc.detectDishMatrix(matrix);
  console.log('  ① detectDishMatrix ⇒ shape =', JSON.stringify(dd.shape), '| sheet =', JSON.stringify(dd.sheet));

  // ② 各 sheet 的表头与 detectPlatform
  for (const sn of Object.keys(matrix.sheets)) {
    const rows = matrix.sheets[sn].rows;
    const gi = svc.guessHeader(rows);
    const hdr = (rows[gi] || []).map((x) => String(x).trim());
    console.log('  sheet %s: guessHeader=%d  表头前12=%s', JSON.stringify(sn), gi, JSON.stringify(hdr.slice(0, 12)));
    console.log('     detectPlatform(hdr) ⇒ %s', JSON.stringify(svc.detectPlatform(hdr)));
    const shape = svc.detectDishShape(rows);
    console.log('     detectDishShape(rows) ⇒ %s', JSON.stringify(shape));
    // 形态 C 关键列名探测
    const joined = rows.slice(0, 4).map((r) => r.map((x) => String(x == null ? '' : x)).join('|')).join('\n');
    const hasSales = /销售额/.test(joined), hasQty = /销量/.test(joined), hasMode = /销售方式/.test(joined);
    console.log('     前4行是否含 销售额=%s 销量=%s 销售方式=%s', hasSales, hasQty, hasMode);
  }

  // ③ 按 index.js 的分支逻辑：先 shape，再看 platform
  if (dd.shape) {
    console.log('  ⇒ 走 【handleDishImport 菜品分支】shape =', dd.shape);
    console.log('     ⚠️ 该分支的 platform 来自用户 picker（v.platform），空则 checkGradeA 挂 SCHEMA_PLATFORM');
  } else {
    // 模拟 index.js 自动判定平台
    let platform = null;
    for (const name of Object.keys(matrix.sheets)) {
      const s = matrix.sheets[name];
      const hdr = (s.rows[svc.guessHeader(s.rows)] || []).map((x) => String(x).trim());
      const p = svc.detectPlatform(hdr);
      if (p) { platform = p; break; }
    }
    console.log('  ⇒ 走 【外卖账单分支】自动判定 platform =', JSON.stringify(platform));
    if (!platform || !svc.pickSheet(matrix.sheets, platform)) {
      console.log('     ❌ index.js 在此直接 fail：无法识别账单平台');
    } else {
      const parsed = svc.parseBillMatrix(matrix, { platform });
      const grade = svc.checkGradeA({ platform, shopId: 'shop_test', header: parsed.header, rows: parsed.rows, totals: parsed.totals }, svc.SALES_SCHEMA);
      console.log('     pickSheet ⇒', JSON.stringify(svc.pickSheet(matrix.sheets, platform)));
      console.log('     解析：rows=%d 行  totals=%s  months=%s  excluded=%s',
        parsed.rows.length, JSON.stringify(parsed.totals), JSON.stringify(parsed.months), JSON.stringify(parsed.excluded));
      console.log('     门禁：pass=%s  level=%s', grade.pass, grade.level);
      if (!grade.pass) console.log('     ❌ failures =', JSON.stringify(grade.failures, null, 0));
    }
  }
  console.log('');
}

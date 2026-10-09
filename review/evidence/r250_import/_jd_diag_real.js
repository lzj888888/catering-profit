// R249-2 诊断（真·生产路径）：真 SheetJS bufferToMatrix → 复刻 index.js 分流逻辑
// 上轮我用 openpyxl 矩阵 + 硬塞 platform ⇒ 正是「测试路径 ≠ 生产路径」，结论有误。本轮用真 xlsx 包。
const path = require('path');
const fs = require('fs');

const SVC = path.resolve('cloudfunctions/importSalesBill/service.js');
const svc = require(SVC);   // 真 xlsx（NODE_PATH 指向 workspace/node_modules）
console.log('service.js 加载 OK（真 xlsx）');
console.log('');

const BASE = 'C:/Users/lzj/xwechat_files/wxid_auezz32wau7v22_5514/msg/file/2026-10/';
const FILES = {
  jd_order: '208386489_对账单下载_20260930_耙三样耙牛肉_7647722_7647723_0.xlsx',
  jd_sku: '208386489_sku对账单下载_20260930_耙三样耙牛肉_7647724_7647725_0.xlsx',
  taobao_goods: '商品下载_20260907至20260913__5366951484_20261006213915236.xlsx',
};

for (const key of Object.keys(FILES)) {
  const fp = BASE + FILES[key];
  if (!fs.existsSync(fp)) { console.log('#', key, '文件不存在，跳过'); continue; }
  console.log('='.repeat(92));
  console.log('#', key, '|', FILES[key]);
  const buf = fs.readFileSync(fp);
  const matrix = svc.bufferToMatrix(buf);
  console.log('  bufferToMatrix ⇒ sheets =', JSON.stringify(Object.keys(matrix.sheets)));
  for (const sn of Object.keys(matrix.sheets)) {
    console.log('     %s : %d 行', JSON.stringify(sn), (matrix.sheets[sn].rows || []).length);
  }

  // ① index.js 第 5 步：先跑 detectDishMatrix
  const dd = svc.detectDishMatrix(matrix);
  console.log('  ① detectDishMatrix ⇒ shape =', JSON.stringify(dd.shape), '| sheet =', JSON.stringify(dd.sheet));
  if (dd.shape) {
    console.log('  ⇒ 走【菜品分支 handleDishImport】；platform 来自 picker（此处前端未传 ⇒ 空）');
    continue;
  }

  // ② index.js 第 6 步：自动判定平台（用 guessHeader 选表头）
  const names = Object.keys(matrix.sheets);
  let platform = null, hdrPicked = null, guessIdx = null;
  for (const name of names) {
    const s = matrix.sheets[name];
    const gi = svc.guessHeader(s.rows);
    const hdr = (s.rows[gi] || []).map((x) => String(x).trim());
    console.log('  sheet %s: guessHeader ⇒ 第 %d 行; 前 8 格 = %s', JSON.stringify(name), gi, JSON.stringify(hdr.slice(0, 8)));
    const p = svc.detectPlatform(hdr);
    console.log('     detectPlatform(该行) ⇒ %s', JSON.stringify(p));
    if (!hdrPicked) { hdrPicked = hdr; guessIdx = gi; }
    if (p) { platform = p; break; }
  }
  console.log('  ⇒ 自动判定 platform =', JSON.stringify(platform));

  if (!platform || !svc.pickSheet(matrix.sheets, platform)) {
    console.log('  ❌❌ index.js 在此 fail(INVALID_PARAM)：无法识别账单平台 ⇒ 前端 toastError');
    // 补证：把「把所有候选行都试一遍」的结果打出来 —— 说明本可识别
    const s0 = matrix.sheets[names[0]];
    for (let i = 0; i < Math.min(s0.rows.length, 5); i++) {
      const hdr = (s0.rows[i] || []).map((x) => String(x == null ? '' : x).trim());
      const p = svc.detectPlatform(hdr);
      if (p) console.log('     ⚠️ 但第 %d 行本可识别为 %s（前 5 格 = %s）', i, JSON.stringify(p), JSON.stringify(hdr.slice(0, 5)));
    }
    continue;
  }

  const parsed = svc.parseBillMatrix(matrix, { platform });
  const grade = svc.checkGradeA({ platform, shopId: 'shop_x', header: parsed.header, rows: parsed.rows, totals: parsed.totals }, svc.SALES_SCHEMA);
  console.log('  ✅ 走账单分支；pickSheet ⇒', JSON.stringify(svc.pickSheet(matrix.sheets, platform)));
  console.log('  parsed: rows=%d totals=%s excluded=%s', parsed.rows.length, JSON.stringify(parsed.totals), JSON.stringify(parsed.excluded));
  console.log('  grade: pass=%s failures=%s', grade.pass, JSON.stringify(grade.failures));
}

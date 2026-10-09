// R250 验证：平台自动判定（逐候选行试签名）在**真文件** + 仓内 fixture 上是否成立。
//   ⚠️ 本文件是**证据脚本**（归档用），不是门禁套件 ⇒ 未加 check_/verify_/selftest_/test_ 前缀
//      （面 B 正则 `(^|/)(check_|verify_|selftest_|test_)…` 未登记即判红）。
//   跑法（需真 xlsx）：NODE_PATH=<workspace>/node_modules node review/evidence/r250_import/_r250_verify.js
//
//   🔴 上一版有个**取数 bug**（已修）：镜像副本一致性只比 `matrix.sheets[names[0]]`
//      ⇒ 美团命中在**第二**个 sheet ⇒ 误报 `一致=false`。正解 = 直接比**矩阵级**入口
//      `detectPlatformInMatrix`（逐 sheet 扫描），与生产调用点同口径。
const path = require('path');
const fs = require('fs');
const svc = require(path.resolve('cloudfunctions/importSalesBill/service.js'));
const bp = require(path.resolve('utils/billParse.js'));

function run(label, matrix, expect) {
  console.log('='.repeat(88));
  console.log('#', label, '（' + expect + '）');
  const names = Object.keys(matrix.sheets);
  const hitSvc = svc.detectPlatformInMatrix(matrix);
  const hitBp = bp.detectPlatformInMatrix(matrix);
  const platform = hitSvc ? hitSvc.platform : null;
  console.log('  云端 service.js  detectPlatformInMatrix ⇒ %s', JSON.stringify(hitSvc));
  console.log('  镜像 utils/billParse.js detectPlatformInMatrix ⇒ %s', JSON.stringify(hitBp));
  console.log('  两副本行为一致 = %s', JSON.stringify(hitSvc) === JSON.stringify(hitBp));
  const okSheet = platform ? svc.pickSheet(matrix.sheets, platform) : null;
  console.log('  pickSheet ⇒', JSON.stringify(okSheet));
  if (!platform || !okSheet) {
    console.log('  → 无平台（本表按设计属**形态 C**：平台由用户在 picker 里选 ⇒ 这是**预期**，非缺陷）');
    return;
  }
  const parsed = svc.parseBillMatrix(matrix, { platform });
  const grade = svc.checkGradeA({ platform, shopId: 'shop_x', header: parsed.header, rows: parsed.rows, totals: parsed.totals }, svc.SALES_SCHEMA);
  console.log('  parsed: rows=%d totals=%s excluded=%s', parsed.rows.length, JSON.stringify(parsed.totals), JSON.stringify(parsed.excluded));
  console.log('  grade: pass=%s failures=%s', grade.pass, JSON.stringify(grade.failures));
}

const BASE = 'C:/Users/lzj/xwechat_files/wxid_auezz32wau7v22_5514/msg/file/2026-10/';
const reals = {
  '真·京东订单级（117 行 × 82 列）': ['208386489_对账单下载_20260930_耙三样耙牛肉_7647722_7647723_0.xlsx', '预期：命中 jd_order，headerRow=1，门禁 pass=true'],
  '真·京东 SKU 级（仅表头 1 行）': ['208386489_sku对账单下载_20260930_耙三样耙牛肉_7647724_7647725_0.xlsx', '预期：命中 jd_sku，rows=0，CHANNEL_EMPTY'],
  '真·淘宝闪购商品表': ['商品下载_20260907至20260913__5366951484_20261006213915236.xlsx', '预期：形态 C ⇒ 平台机器判不出（用户选）'],
};
for (const k of Object.keys(reals)) {
  const fp = BASE + reals[k][0];
  if (!fs.existsSync(fp)) { console.log('#', k, '(文件不在，跳过)'); continue; }
  run(k, svc.bufferToMatrix(fs.readFileSync(fp)), reals[k][1]);
}

// 仓内 fixture（回归：淘宝/美团没有两级表头 ⇒ 行为必须不变）
const JDR = path.join('review', 'evidence', 'r181l_stage1_import_feed', 'fixtures');
for (const f of ['jd_order_2026-09.matrix.json', 'jd_sku_sample.matrix.json', 'taobao_2026-08.matrix.json', 'meituan_2026-08.matrix.json']) {
  const p = path.join(JDR, f);
  if (!fs.existsSync(p)) { console.log('# fixture', f, '(不在)'); continue; }
  run('fixture ' + f, JSON.parse(fs.readFileSync(p, 'utf8')), '回归：不得与改前行为不同');
}

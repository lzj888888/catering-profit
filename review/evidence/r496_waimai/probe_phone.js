/**
 * R496 取证：手机端「最显眼的数」vs「真到手」，偏差有多大？
 * 全部数值来自本仓既有实证（README/NOTE/agg json），此处只做算数与等式校验，不引入新假设。
 */
const rows = [
  {
    platform: '美团 2026-08',
    phoneBig: 3166.20,          // 手机营业概览「优惠前总额」(= 商品总价3041.20 + 打包费125.00)
    phoneBigName: '优惠前总额(营业额)',
    subsidyM: 806.29,           // 商家对顾客活动补贴
    fee: 533.27,                // 平台服务费(佣金+配送)
    extra: 78.69,               // 广告76.41 + 保险2.28
    net: 1747.95,               // 账单金额 = 真到手
    src: 'review/NOTE_2026-09-29_round177_meituan_bill_reconcile.md',
  },
  {
    platform: '淘宝闪购 2026-08',
    phoneBig: 6585.08,          // 商品金额6418.08 + 打包费167.00
    phoneBigName: '优惠前总额(营业额)',
    subsidyM: 2069.70,          // 商家承担补贴
    fee: 735.73,                // 平台服务费
    extra: 0,
    net: 3779.65,               // 结算金额
    src: 'review/evidence/r161_waimai/agg_taobao_shangou_2026-08.json',
  },
  {
    platform: '京东秒送 2026-09',
    phoneBig: 1101.31,          // 订单原价
    phoneBigName: '订单原价(营业额)',
    subsidyM: 462.33,           // 商家承担补贴
    fee: 0,                     // 已含在分项列，见 README 勾稽
    extra: 83.31,               // 推广费62.23 + 保险11.08 + 余差
    net: 555.96,                // 应结金额(正向订单)
    src: 'review/evidence/r242_jd_bill/README.txt',
  },
  {
    platform: '京东手机概览 2025-07',
    phoneBig: 5634,             // 营业额
    phoneBigName: '营业额',
    subsidyM: null,
    fee: null,
    extra: null,
    net: 3163,                  // 收入 = 营业额 − 支出 2471
    src: 'review/evidence/r242_jd_bill/jd_app_overview_202507.jpg (OCR)',
  },
];

console.log('平台'.padEnd(22), '手机显眼数', '真到手', '虚高%', '等式校验');
for (const r of rows) {
  const over = ((r.phoneBig - r.net) / r.net) * 100;
  let eq = '-';
  if (r.subsidyM != null && r.fee != null && r.extra != null) {
    const back = r.phoneBig - r.subsidyM - r.fee - r.extra;
    eq = `${back.toFixed(2)} vs ${r.net.toFixed(2)} ${Math.abs(back - r.net) < 0.05 ? 'OK' : '差' + (back - r.net).toFixed(2)}`;
  }
  console.log(
    r.platform.padEnd(20),
    String(r.phoneBig).padStart(10),
    String(r.net).padStart(9),
    (over.toFixed(1) + '%').padStart(7),
    ' ', eq
  );
}
console.log('\n结论：照抄手机最显眼的「营业额/优惠前总额」，相对真到手虚高约 74%~98%（接近翻倍）。');

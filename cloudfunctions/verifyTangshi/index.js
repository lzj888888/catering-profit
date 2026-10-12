// cloudfunctions/verifyTangshi/index.js
// 一次性只读探针：统计 external_sales_daily 中 形态A（堂食）已落库行数 + 菜品收入合计。
// 用途：把「M3.33 导入 GUI 自报成功」转成「云库实读事实」（守「不采信工具自报口径」）。
// 服务端 admin 直读，不依赖 OPENID / 不触付费墙 / 不写任何集合 ⇒ 零污染、无需清理。
// 触发：mp.evaluate(() => wx.cloud.callFunction({ name:'verifyTangshi', data:{} }))
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async () => {
  const where = { platform: 'pos', biz_date: '2026-09-13', is_deleted: false };
  // 🔴 wx-server-sdk .get() 默认每页最多 100 条 ⇒ 必须用 .count() 取权威总数，
  //    并用 .limit(1000) 一次取全（265 < 1000）才能正确求和，否则会把 265 截断成 100。
  const cnt = await db.collection('external_sales_daily').where(where).count();
  const res = await db.collection('external_sales_daily').where(where).limit(1000).get();
  const rows = (res && res.data) || [];
  const count = (cnt && typeof cnt.total === 'number') ? cnt.total : rows.length;
  const sumFen = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const shopIds = [...new Set(rows.map((r) => r.shop_id))];
  const dishKeys = [...new Set(rows.map((r) => r.dish_key))];
  const seqs = rows
    .map((r) => {
      const m = String(r._id || '').match(/_(\d+)$/);
      return m ? Number(m[1]) : null;
    })
    .filter((x) => x !== null);
  return {
    ok: true,
    count,
    sumFen,
    sumYuan: +(sumFen / 100).toFixed(2),
    shopIds,
    distinctDishKeys: dishKeys.length,
    seqMin: seqs.length ? Math.min(...seqs) : null,
    seqMax: seqs.length ? Math.max(...seqs) : null,
    where,
  };
};

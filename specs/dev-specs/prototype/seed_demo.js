/**
 * =====================================================================
 *  🚫 生产环境部署禁令（运维纪律，非可选）
 *  本云函数（seedDemo）只允许部署到 DEV 环境，严禁部署到 prod。
 *  一旦误部署到生产并触发，会把整店「验收演示数据」写入真实业务库，
 *  污染真实用户数据，且 demo 店 entitlement 解锁会绕过 M1/M2/M3 配额。
 *  → 上线 checklist 必须明确：只部署 initDb 与业务云函数，seedDemo 永不进 prod。
 *  → 若云函数运行环境 env 非 dev 前缀，请立即删除本云函数。
 * =====================================================================
 *
 * seed_demo.js · 验收演示数据灌入云函数（部署为云函数 seedDemo，手动测试调用一次）
 *
 * 用途：把 verify_seed_data.js 已本地验证通过的 S1~S4 验收数据，翻译为集合记录插入 dev 环境，
 *       使《02_模拟测试数据集.md》22 项验收清单可「一键复现」，验收时无需手动造数。
 *
 * 与 init_db.js 关系：init_db 只建集合/索引/套餐种子；本函数在此之上灌「业务演示数据」。
 *       顺序：先跑 initDb（建库）→ 再跑 seedDemo（灌数据）。
 *
 * 隔离策略：所有数据归属一个固定的 demo 测试店（shop_id 带 `shop_seed_demo` 前缀），
 *       与真实用户数据完全隔离；entitlement 设为「已解锁（expire_at 远到期）」，
 *       解除 M1/M2/M3 免费配额限制，便于验收全额跑通（验收的是计算，不是配额 UI）。
 *       幂等：检测到 demo 店已有原料档案即跳过，可重复调用。
 *
 * 字段命名：本文件用 snake_case（与云函数/云库一致，见 core/10 §2.9 字段命名约定）。
 *       若最终 inscode 生成的集合字段名有出入，以 core/10 云函数契约为准微调即可。
 */

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 元 -> 分（整数）
const toFen = (yuan) => Math.round(yuan * 100);

// ===== demo 测试店固定标识 =====
const DEMO = {
  user_id: 'user_seed_demo',
  openid: 'openid_seed_demo',
  shop_id: 'shop_seed_demo',
  // 2099-12-31 到期，验收期视为永久解锁
  expire_at: new Date('2099-12-31T23:59:59Z').getTime(),
};

const DATA = require('./seed_data.js');

// 生成唯一 id（云库无自增，用 前缀+时间戳+随机）
function oid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// 批量插入并容忍部分失败
async function insertMany(coll, rows) {
  const out = [];
  for (const r of rows) {
    try { const res = await db.collection(coll).add({ data: r }); out.push(res._id || 'ok'); }
    catch (e) { /* 单条失败记日志不中断 */ console.error(`insert ${coll} failed:`, e.message); }
  }
  return out;
}

exports.main = async (event, context) => {
  const result = { steps: [], errors: [] };

  // ---------- 0. 建/取 demo 用户+店铺+权限（幂等）----------
  const uCnt = await db.collection('user').where({ user_id: DEMO.user_id }).count();
  if (uCnt.total === 0) {
    await db.collection('user').add({ data: { user_id: DEMO.user_id, openid: DEMO.openid, created_at: Date.now(), is_deleted: false } });
    await db.collection('shop').add({ data: { shop_id: DEMO.shop_id, user_id: DEMO.user_id, name: '验收演示店', created_at: Date.now(), is_deleted: false } });
    await db.collection('shop_entitlement').add({ data: { user_id: DEMO.user_id, shop_id: DEMO.shop_id, expire_at: DEMO.expire_at, created_at: Date.now() } });
    result.steps.push('demo user/shop/entitlement 已建');
  } else {
    // 确保 entitlement 解锁，避免验收被配额卡住
    await db.collection('shop_entitlement').where({ user_id: DEMO.user_id }).update({ data: { expire_at: DEMO.expire_at } });
    result.steps.push('demo 已存在，刷新 entitlement 解锁');
  }

  // ---------- 幂等守卫：已灌过则跳过 ----------
  const matCnt = await db.collection('shop_material').where({ shop_id: DEMO.shop_id }).count();
  if (matCnt.total > 0) {
    result.steps.push('检测到 demo 店已有原料档案，视为已灌入，直接返回');
    return result;
  }

  const now = Date.now();

  // ============ S3：原料档案（11 条）============
  const matRows = DATA.S3.materials.map((m) => ({
    id: oid('mat'),
    shop_id: DEMO.shop_id,
    name: m.name,
    brand_spec: '',
    purchase_unit: m.unit,
    purchase_price: toFen(m.priceYuan),
    convert_factor: m.conv,
    yield_rate: m.yield,
    is_virtual: false,
    created_at: now, updated_at: now,
    is_deleted: false, delete_at: 0,
  }));
  // 红油底料保存后自动生成的虚拟原料（is_virtual=true，单位份，单价=单份半成品成本）
  const hongyou = DATA.S3.cards.hongyou;
  matRows.push({
    id: oid('mat'), shop_id: DEMO.shop_id,
    name: hongyou.virtual.name, brand_spec: '',
    purchase_unit: hongyou.virtual.unit,
    purchase_price: toFen(hongyou.virtual.priceYuan),
    convert_factor: hongyou.virtual.conv, // 份：换算系数=1
    yield_rate: 100,
    is_virtual: true,
    created_at: now, updated_at: now, is_deleted: false, delete_at: 0,
  });
  await insertMany('shop_material', matRows);
  result.steps.push(`shop_material 插入 ${matRows.length} 条`);

  // 建成本卡 + 明细行（统一处理）
  async function seedCard(card, cardIdPrefix, lines) {
    const cardId = `${cardIdPrefix}_${DEMO.shop_id}`;
    const rowId = oid('card');
    const totalFen = toFen(card.expected.total !== undefined ? card.expected.total
      : (card.mode === 'batch' ? card.expected.perShare : card.expected.total));
    await db.collection('shop_cost_card').add({
      data: {
        id: rowId, card_id: cardId, version: 1, shop_id: DEMO.shop_id,
        name: card.name, category: card.category, tags: '',
        calc_mode: card.mode === 'batch' ? 2 : 1,
        batch_output: card.mode === 'batch' ? card.batchShares : 0,
        loss_rate: card.lossPct, aux_cost: toFen(card.auxYuan),
        price_list: toFen(card.saleYuan || 0), price_promo: 0,
        total_cost: totalFen, is_latest: true, parent_card_id: '',
        created_by: DEMO.user_id, created_at: now, is_deleted: false, delete_at: 0,
      },
    });
    const lineRows = lines.map((it, i) => ({
      id: oid('line'), cost_card_row_id: rowId, material_id: '',
      material_name: it.name, brand_spec: '',
      purchase_unit: (it.name === '红油底料') ? '份' : 'g',
      purchase_price: 0, convert_factor: (it.name === '红油底料') ? 1 : 500,
      yield_rate: 100, net_unit_cost: it.netCost,
      quantity: it.amount,
      line_net_cost: toFen(it.amount * it.netCost),
      input_type: 1, sort_order: i + 1,
    }));
    await insertMany('shop_cost_card_line', lineRows);
    return { cardId, rowId };
  }

  // 宫保鸡丁（单份）
  await seedCard(DATA.S3.cards.gongbao, 'card_gongbao', DATA.S3.cards.gongbao.items);
  // 红油底料（批量预制）+ 自动虚拟原料已入 shop_material
  await seedCard(DATA.S3.cards.hongyou, 'card_hongyou', DATA.S3.cards.hongyou.items);
  // 麻辣香锅（单份，引用红油底料虚拟原料 1 份@4.48）
  await seedCard(DATA.S3.cards.mala, 'card_mala', DATA.S3.cards.mala.items);
  result.steps.push('shop_cost_card + shop_cost_card_line 插入 3 张卡（宫保鸡丁/红油底料/麻辣香锅）');

  // ============ S4：选址盈利沙盘（1 个方案）============
  await db.collection('shop_sandbox').add({
    data: {
      id: oid('sb'), shop_id: DEMO.shop_id,
      scheme_name: DATA.S4.schemeName,
      include_amort: DATA.S4.includeAmort, sim_amort_yuan: toFen(DATA.S4.simAmortYuan),
      rent_yuan: toFen(DATA.S4.rentYuan), property_yuan: toFen(DATA.S4.propertyYuan),
      labor_yuan: toFen(DATA.S4.laborYuan), other_yuan: toFen(DATA.S4.otherYuan),
      var_food_pct: DATA.S4.varFoodPct, var_mkt_pct: DATA.S4.varMktPct, var_other_pct: DATA.S4.varOtherPct,
      target_profit_yuan: toFen(DATA.S4.targetProfitYuan),
      is_deleted: false, created_at: now,
    },
  });
  result.steps.push('shop_sandbox 插入 1 个方案（A 铺面选址测试）');

  // ============ S2/S2b：摊销资产（5 条）============
  const amortRows = [...DATA.S2.amortAssets, ...DATA.S2b.assets].map((a) => ({
    id: oid('amort'), shop_id: DEMO.shop_id,
    name: a.name, total_value: toFen(a.valueYuan),
    start_month: a.startMonth, total_months: a.totalMonths,
    terminate_month: a.terminateMonth || '',
    monthly_amount: toFen(a.valueYuan / a.totalMonths),
    end_month: '', residual_loss: 0, is_deleted: false, created_at: now,
  }));
  await insertMany('shop_amortize', amortRows);
  result.steps.push(`shop_amortize 插入 ${amortRows.length} 条（S2 主 3 + S2b 边界 2）`);

  // ============ S1/S2：月度收入/费用/账/库存 ============
  async function seedMonth(s, inventoryOn) {
    const incRows = s.incomes.map((it, i) => ({
      id: oid('inc'), shop_id: DEMO.shop_id, month: s.month,
      cat: it.cat, sub: it.sub, amount_fen: toFen(it.amountYuan), is_deleted: false,
    }));
    const expRows = s.expenses.map((it, i) => ({
      id: oid('exp'), shop_id: DEMO.shop_id, month: s.month,
      cat: it.cat, sub: it.sub, amount_fen: toFen(it.amountYuan), is_deleted: false,
    }));
    await insertMany('shop_monthly_income', incRows);
    await insertMany('shop_monthly_expense', expRows);

    const incomeFen = s.incomes.reduce((sum, it) => sum + toFen(it.amountYuan), 0);
    const expenseFen = s.expenses.reduce((sum, it) => sum + toFen(it.amountYuan), 0);
    const account = {
      id: oid('acc'), shop_id: DEMO.shop_id, month: s.month,
      income_total_fen: incomeFen, expense_total_fen: expenseFen,
      direct_cost_fen: toFen(s.directCostYuan),
      inventory_on: inventoryOn, amort_on: !!s.amortYuan,
      is_archive: false, is_deleted: false, created_at: now,
    };
    await db.collection('shop_monthly_account').add({ data: account });

    if (inventoryOn) {
      await db.collection('shop_inventory').add({
        data: {
          id: oid('inv'), shop_id: DEMO.shop_id, month: s.month,
          begin_fen: toFen(s.beginInvYuan), purchase_fen: toFen(s.purchaseYuan),
          end_fen: toFen(s.endInvYuan),
          real_cost_fen: toFen(s.beginInvYuan + s.purchaseYuan - s.endInvYuan),
          is_deleted: false, created_at: now,
        },
      });
    }
  }
  await seedMonth(DATA.S1, false); // 2026-07 库存关
  await seedMonth(DATA.S2, true);  // 2026-08 库存开
  result.steps.push('shop_monthly_income/expense/account(+inventory) 插入 2026-07 与 2026-08');

  result.steps.push('✅ 验收演示数据灌入完成（dev 环境，demo 店隔离）');
  return result;
};

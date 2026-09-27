// R156 容量测算（干净版）：菜品成本卡版本历史
// 字段抄自 cloudfunctions/saveCostCard/index.js 实际落库对象
const B = (o) => Buffer.byteLength(JSON.stringify(o), 'utf8');
const now = 1785000000000;
const shopId = 'shop_xxxxxxxxxxxxxxxx', cardCode = 'cc_xxxxxxxxxxxxxxxx', cardRowId = 'xxxxxxxxxxxxxxxxxxxxxxxx';

const cardDoc = {
  _id: cardRowId, card_code: cardCode, version: 12, shop_id: shopId,
  calc_status: 'calculated', name: '宫保鸡丁（大份）', category: '热菜', tags: '招牌,高毛利',
  calc_mode: 1, batch_output: null, loss_rate: 5, aux_cost: 120, price_list: 2800,
  price_promo: 0, total_cost: 975, material_total_fen: 855, gross_profit_fen: 1825,
  gross_margin_pct: 65.18, reverse_price_fen: 1393, parent_card_id: '',
  created_by: 'user_xxxxxxxxxxxxxxxx', client_request_id: 'scc_1785000000000_abcd',
  specs_json: '[{"spec_key":"s1","name":"大份","coef":1.5,"price_fen":3800},{"spec_key":"s2","name":"小份","coef":0.7,"price_fen":2000}]',
  created_at: now, updated_at: now, is_deleted: false,
};
const lineDoc = {
  _id: 'yyyyyyyyyyyyyyyyyyyyyyyy', cost_card_row_id: cardRowId, card_code: cardCode,
  card_version: 12, shop_id: shopId, material_id: 'mm_xxxxxxxxxxxxxxxx',
  material_name: '鸡胸肉（冷冻）', quantity: 250, net_unit_cost: 1560,
  brand_spec: '正大 2kg', purchase_unit: '件', purchase_price: 3900, convert_factor: 2000,
  yield_rate: 95, line_net_cost: 390, input_type: 1, line_kind: 'main',
  group_name: '主料', sort_order: 3, created_at: now, updated_at: now, is_deleted: false,
};

const CARD_B = B(cardDoc), LINE_B = B(lineDoc), L = 10;
const MB = 1048576, GB = 1073741824;
const pad = (s, n) => String(s).padStart(n);

console.log('=== 单记录字节（JSON/UTF-8；BSON 同量级）===');
console.log('shop_cost_card       一行 = ' + CARD_B + ' B');
console.log('shop_cost_card_line  一行 = ' + LINE_B + ' B');
console.log('一次保存（1 卡 + ' + L + ' 行） = ' + (CARD_B + L * LINE_B) + ' B ≈ ' +
  ((CARD_B + L * LINE_B) / 1024).toFixed(1) + ' KB，写操作 ' + (1 + L) + ' 次');

console.log('\n=== 撞「1000 条查询上限」（common/dataAdapter.js:17 LIST_LIMIT）===');
[20, 50, 200, 2000].forEach((cards) => {
  console.log('单店 ' + pad(cards, 4) + ' 张卡 ⇒ 每卡平均 ' + pad((1000 / cards).toFixed(1), 6) +
    ' 个版本就撞顶（1000 行）' + (1000 / cards < 1 ? '  🔴 每卡 1 版就已超' : ''));
});

console.log('\n=== 单店容量（免费档 20 张卡）===');
[10, 50, 100, 500].forEach((V) => {
  const cr = 20 * V, lr = cr * L, bytes = cr * CARD_B + lr * LINE_B;
  console.log('每卡 ' + pad(V, 4) + ' 版 ⇒ 主表 ' + pad(cr, 6) + ' 行 + 明细 ' + pad(lr, 7) +
    ' 行 = ' + pad((bytes / MB).toFixed(1), 7) + ' MB' + (cr > 1000 ? '  🔴 列表已截断' : ''));
});

console.log('\n=== 1 万用户（1 万店）情景 ===');
[['轻度', 10, 5], ['中度', 20, 20], ['重度', 20, 100]].forEach(([label, cards, V]) => {
  const cr = 10000 * cards * V, lr = cr * L, bytes = cr * CARD_B + lr * LINE_B;
  console.log(label + '  每店 ' + pad(cards, 2) + ' 卡 × 每卡 ' + pad(V, 3) + ' 版 ⇒ 主表 ' +
    pad(cr, 9) + ' 行 / 明细 ' + pad(lr, 10) + ' 行 = ' + pad((bytes / GB).toFixed(1), 7) + ' GB');
});

console.log('\n=== 读写次数（官方配额·基础版：读 5 万/天、写 3 万/天）===');
console.log('一次保存成本卡     = 1 + ' + L + ' = ' + (1 + L) + ' 次写');
console.log('一次开菜品卡列表   = 1 + K 次读（K=卡数；20 张 ⇒ 21 次）');
console.log('一次看某卡版本历史 = 1 + V 次读（V=版本数；200 版 ⇒ 201 次）');
const dau = 1000;
const rd = dau * 3 * 21, wr = dau * 2 * 11;
console.log('日活 ' + dau + '（人均开列表 3 次 + 存 2 道菜）⇒ 读 ' + rd.toLocaleString() +
  ' 次/天（超 ' + (rd / 50000).toFixed(2) + ' 倍）、写 ' + wr.toLocaleString() +
  ' 次/天（额度内，占 ' + (wr / 30000 * 100).toFixed(0) + '%）');

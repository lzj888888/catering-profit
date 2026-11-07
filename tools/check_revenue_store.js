// tools/check_revenue_store.js —— 营收落库守卫（R619，第 249 套件）
//
// 落库一旦错就是**静默错账**：老板看不出来，下次打开还以为是对的。
// 所以这里不判"代码写了什么"，而是**桩一个 db 真跑落库逻辑**，看行为对不对。
//
// 守四件事：
//   A 结构面：集合与索引登记齐全（缺了云端建不出来，写入直接报错）
//   B 行为面：幂等 / 需确认 / 确认后换版本 / 跨月互不影响
//   C 红线面：不碰 M1（shop_monthly_income / incomeItems）、不硬封账
//   D 接线面：读库分支在下载文件之前（否则读库因为缺 fileID 直接失败）
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const P = (rel) => path.join(ROOT, rel);

let pass = 0;
let failN = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name + (detail ? ' ｜ ' + detail : '')); }
  else { failN++; console.log('❌ ' + name + (detail ? ' ｜ ' + detail : '')); }
}
function sec(t) { console.log('\n===== ' + t + ' ====='); }

// 🔴 判源码关键词前**必须剥注释**：本轮真踩过 —— 我在注释里写了「不碰 shop_monthly_income」，
//   结果 C-① 判据被自己的注释击中；头部注释里的 `cloud.downloadFile` 又把 D-① 的位置判反。
//   同族教训见 R616「注释里斜杠+星号吞掉代码」：**注释也是文本，判据若不剥注释就会咬自己**。
function stripComments(s) {
  return String(s)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const STORE_SRC = fs.readFileSync(P('cloudfunctions/importSalesBill/revenueStore.js'), 'utf8');
const IDX_SRC = fs.readFileSync(P('cloudfunctions/importSalesBill/index.js'), 'utf8');
const COLL_JS = require(P('cloudfunctions/initDb/collections.js'));
const Store = require(P('cloudfunctions/importSalesBill/revenueStore.js'));

// ============ 最小 db 桩：只支持落库代码实际用到的那几个链式方法 ============
// opts.failFirstAdd ⇒ 首次 add 抛 502005（模拟「集合还没建」）
// opts.failGet      ⇒ 所有 get 抛 502005（模拟「集合不存在时读库」）
function mockDb(opts) {
  const o = opts || {};
  let addFails = o.failFirstAdd ? 1 : 0;
  const created = [];
  const rows = [];
  let seq = 0;
  const err502005 = () => {
    const e = new Error('database collection not exists');
    e.errCode = -502005;
    e.errMsg = 'collection not exists. [ResourceNotFound] Db or Table not exist: revenue_batch';
    return e;
  };
  const match = (w) => (row) => Object.keys(w || {}).every((k) => row[k] === w[k]);
  const coll = {
    where(w) {
      this._w = w;
      return this;
    },
    orderBy() { return this; },
    limit() { return this; },
    field() { return this; },
    async get() {
      if (o.failGet) throw err502005();
      const f = match(this._w);
      const out = rows.filter(f).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      this._w = null;
      return { data: out };
    },
    async add({ data }) {
      if (addFails > 0) { addFails--; throw err502005(); }
      seq++;
      const id = 'id' + seq;
      rows.push(Object.assign({ _id: id }, data));
      return { _id: id };
    },
    doc(id) {
      return {
        async update({ data }) {
          const r = rows.find((x) => x._id === id);
          if (r) Object.assign(r, data);
          return { stats: { updated: r ? 1 : 0 } };
        },
      };
    },
  };
  const db = {
    collection: () => coll,
    createCollection: async (name) => { created.push(name); },
  };
  return { db, rows, created, size: () => rows.length };
}

// 造一份最小可用的解析结果（只放落库会用到的字段）
function mkResult(totalYuan, dayCount, month) {
  return {
    revenueM1: { totalYuan, totalFen: Math.round(totalYuan * 100) },
    cashInflow: { totalYuan: totalYuan * 0.9 },
    coverage: { ok: true, month, dayCount, monthDays: 30 },
    shifts: new Array(dayCount * 2).fill(0).map(() => ({})),
  };
}

const UID = 'u1';
const SID = 's1';

// ============ A 结构面 ============
sec('A 结构面（集合与索引）');

ok('A-① revenue_batch 已登记进建库单源（没登记 ⇒ 云端建不出来，写入直接报错）',
  COLL_JS.COLLECTIONS.indexOf('revenue_batch') >= 0);

const idx = COLL_JS.INDEXES.revenue_batch || [];
ok('A-② 索引两条齐备（按「店+月+active」查当前版、按「店+文件md5」判重复）',
  idx.length === 2, JSON.stringify(idx.map((x) => x.name)));

ok('A-③ 两条索引都含 user_id + shop_id + status（多店隔离与只查 active 的前提）',
  idx.every((x) => x.keys.user_id === 1 && x.keys.shop_id === 1 && x.keys.status === 1));

ok('A-④ 索引**不得**带 unique（同月允许多个 superseded 历史版本，唯一性由代码保证）',
  idx.every((x) => x.unique !== true));

ok('A-⑤ 有口径版本号（口径一变，旧数据能被识别出来，不会混着算）',
  typeof Store.CALIBER_VERSION === 'string' && Store.CALIBER_VERSION.length > 0,
  'caliber=' + Store.CALIBER_VERSION);

// ============ B 行为面（桩 db 真跑）============
sec('B 行为面（桩 db 真跑落库）');

(async () => {
  // B-1 首次落库
  let m = mockDb();
  const r1 = await Store.commit({
    db: m.db, userId: UID, shopId: SID, fileMd5: 'aaa',
    fileName: '九月表.xlsx', result: mkResult(64547.08, 13, '2026-09'),
  });
  ok('B-① 首次导入 ⇒ created，落 1 条', r1.ok && r1.mode === 'created' && m.size() === 1,
    'mode=' + r1.mode + ' rows=' + m.size());

  ok('B-② 落库内容带齐隔离与追溯字段（user/shop/month/file_md5/status/caliber/created_at）',
    (() => {
      const d = m.rows[0];
      return d.user_id === UID && d.shop_id === SID && d.month === '2026-09'
        && d.file_md5 === 'aaa' && d.status === 'active'
        && !!d.caliber_version && !!d.created_at && d.result && d.coverage;
    })());

  // B-3 同一份文件再导一次 ⇒ 幂等，不新增
  const r2 = await Store.commit({
    db: m.db, userId: UID, shopId: SID, fileMd5: 'aaa',
    fileName: '九月表.xlsx', result: mkResult(64547.08, 13, '2026-09'),
  });
  ok('B-③ 🔴 同一份文件重复导入 ⇒ duplicate，库行数不变（老板点两次不会出两条）',
    r2.ok && r2.mode === 'duplicate' && m.size() === 1,
    'mode=' + r2.mode + ' rows=' + m.size());

  // B-4 同月换文件、未确认 ⇒ 只给差异，不写
  const r3 = await Store.commit({
    db: m.db, userId: UID, shopId: SID, fileMd5: 'bbb',
    fileName: '九月表(5).xlsx', result: mkResult(65000, 14, '2026-09'),
  });
  ok('B-④ 🔴 同月换文件但没确认 ⇒ need_confirm，**一行都不写**（不静默覆盖）',
    r3.ok && r3.mode === 'need_confirm' && m.size() === 1,
    'mode=' + r3.mode + ' rows=' + m.size());

  ok('B-⑤ 差异摘要给的是具体数（原总额/新总额/差额/天数变化），不是一句「数据有变化」',
    r3.diff && r3.diff.oldTotalYuan === 64547.08 && r3.diff.newTotalYuan === 65000
    && Math.abs(r3.diff.totalDeltaYuan - 452.92) < 0.005 && r3.diff.dayDelta === 1,
    JSON.stringify(r3.diff));

  // B-6 确认后才换版本
  const r4 = await Store.commit({
    db: m.db, userId: UID, shopId: SID, fileMd5: 'bbb',
    fileName: '九月表(5).xlsx', result: mkResult(65000, 14, '2026-09'), confirm: true,
  });
  const act = m.rows.filter((x) => x.status === 'active');
  const sup = m.rows.filter((x) => x.status === 'superseded');
  ok('B-⑥ 🔴 确认后 ⇒ 新版本 active，旧版本降级 superseded（版本保留，不物理覆盖）',
    r4.ok && r4.mode === 'replaced' && m.size() === 2 && act.length === 1 && sup.length === 1,
    'rows=' + m.size() + ' active=' + act.length + ' superseded=' + sup.length);

  ok('B-⑦ 旧版本指得出被谁取代（superseded_by 指向新 id，追溯链不断）',
    sup[0] && sup[0].superseded_by === act[0]._id,
    'superseded_by=' + (sup[0] && sup[0].superseded_by));

  ok('B-⑧ 换版本后，active 的总额是新那份（读库读到的必须是新数）',
    act[0] && act[0].total_yuan === 65000, 'active.total=' + (act[0] && act[0].total_yuan));

  // B-9 跨月互不影响
  const r5 = await Store.commit({
    db: m.db, userId: UID, shopId: SID, fileMd5: 'ccc',
    fileName: '八月表.xlsx', result: mkResult(4224.33, 28, '2026-08'),
  });
  ok('B-⑨ 不同月份互不干扰（各月各一条 active，导上个月不会把本月顶掉）',
    r5.mode === 'created' && m.rows.filter((x) => x.status === 'active').length === 2,
    'active=' + m.rows.filter((x) => x.status === 'active').length);

  // B-10 多店隔离
  const r6 = await Store.commit({
    db: m.db, userId: UID, shopId: 's2', fileMd5: 'aaa',
    fileName: '另一家店.xlsx', result: mkResult(1000, 5, '2026-09'),
  });
  ok('B-⑩ 同账号另一家店同一份文件 ⇒ 不算重复（隔离靠 shop_id，不会串店）',
    r6.ok && r6.mode === 'created' && m.size() === 4, 'mode=' + r6.mode + ' rows=' + m.size());

  // B-11 读库：带月 / 不带月
  const gotM = await Store.getActive({ db: m.db, userId: UID, shopId: SID, month: '2026-09' });
  const gotAny = await Store.getActive({ db: m.db, userId: UID, shopId: SID, month: '' });
  ok('B-⑪ 按月份读得到当月 active', gotM && gotM.month === '2026-09' && gotM.result.revenueM1.totalYuan === 65000,
    gotM ? gotM.month + '/' + gotM.result.revenueM1.totalYuan : 'null');

  ok('B-⑫ 🔴 不带月份时取**最近一次**导入（页面一进来就要有东西看，不能让老板先选月）',
    gotAny && !!gotAny.batch_id, gotAny ? gotAny.month : 'null');

  ok('B-⑬ 读库只返回 active（superseded 的历史版本不能盖住当前数）',
    gotM && gotM.batch_id === act[0]._id);

  const gotNone = await Store.getActive({ db: mockDb().db, userId: UID, shopId: SID, month: '2026-01' });
  ok('B-⑭ 库里没有 ⇒ 返回 null（页面据此显示上传入口，不显示空结果）', gotNone === null);

  // B-15 没有月份的表拒绝落库
  const bad = await Store.commit({
    db: mockDb().db, userId: UID, shopId: SID, fileMd5: 'zzz',
    result: { coverage: { ok: false, month: '' }, revenueM1: {}, shifts: [] },
  });
  ok('B-⑮ 表里没有可识别日期 ⇒ 拒绝落库（不能落一条月份为空的脏数据）',
    bad.ok === false && bad.reason === 'no_month', JSON.stringify(bad));

  // 集合自愈：云函数 CLI 调不动函数，老板也不该为了用个功能去控制台建集合
  const m2 = mockDb({ failFirstAdd: true });
  const r7 = await Store.commit({
    db: m2.db, userId: UID, shopId: SID, fileMd5: 'ddd',
    fileName: '首次导入.xlsx', result: mkResult(1000, 5, '2026-07'),
  });
  ok('B-⑯ 🔴 集合还没建时自愈：首次写入报 502005 ⇒ 自动建集合并重写成功（老板不用去控制台）',
    r7.ok && r7.mode === 'created' && m2.size() === 1
    && m2.created.indexOf('revenue_batch') >= 0,
    'mode=' + r7.mode + ' rows=' + m2.size() + ' created=' + JSON.stringify(m2.created));

  const got3 = await Store.getActive({ db: mockDb({ failGet: true }).db, userId: UID, shopId: SID, month: '' });
  ok('B-⑰ 🔴 集合不存在时读库返回 null（页面显示上传入口，而不是「加载失败」）',
    got3 === null);

  ok('B-⑱ 自愈只认「集合不存在」这一个错误码，别的错照抛（不能把权限错/网络错吞成空数据）',
    (() => {
      const s = stripComments(STORE_SRC);
      return /502005/.test(s) && /throw e/.test(s);
    })());

  // ============ C 红线面 ============
  sec('C 红线面（不碰 M1 / 不硬封账）');

  ok('C-① 🔴 落库模块**不碰** M1 月度账（剥注释后不得出现 shop_monthly_income / incomeItems）',
    (() => {
      const s = stripComments(STORE_SRC);
      return s.indexOf('shop_monthly_income') < 0 && s.indexOf('incomeItems') < 0;
    })());

  ok('C-② 🔴 不硬封账（不得出现归档月拒写逻辑 —— 平台 9 月结算 8 月单是正常业务）',
    !/ARCHIVED|归档.*拒|is_archived.*throw/.test(stripComments(STORE_SRC)),
    '出现归档拦截=' + /ARCHIVED|归档.*拒/.test(stripComments(STORE_SRC)));

  ok('C-③ 写入只落在 revenue_batch 一张表（不散落到别的集合）',
    (() => {
      const hits = stripComments(STORE_SRC).match(/collection\(([^)]*)\)/g) || [];
      return hits.length > 0 && hits.every((x) => /COLL/.test(x));
    })(),
    (stripComments(STORE_SRC).match(/collection\(([^)]*)\)/g) || []).join(','));

  ok('C-④ 金额以「分」落库（total_fen 是整数，避免浮点误差累积）',
    STORE_SRC.indexOf('total_fen') >= 0 && STORE_SRC.indexOf('totalFen') >= 0);

  // ============ D 接线面 ============
  sec('D 接线面（云端顺序与前端契约）');

  const IDX_CODE = stripComments(IDX_SRC);
  const posGet = IDX_CODE.indexOf("event.action === 'revenue_get'");
  const posDown = IDX_CODE.indexOf('cloud.downloadFile');
  ok('D-① 🔴 读库分支在「下载文件」之前（放后面会因缺 fileID 直接失败）',
    posGet > 0 && posDown > 0 && posGet < posDown, 'get@' + posGet + ' download@' + posDown);

  ok('D-② 读库回传与上传回传**同形状**（前端 buildView 不用写两套，少一处必然分叉）',
    IDX_SRC.indexOf('revenueM1: rd.revenueM1') > 0 && IDX_SRC.indexOf('bridge: rd.bridge') > 0);

  ok('D-③ 落库默认关闭（commit 不传 = 只读，与 R616 行为一致，向后兼容）',
    /commit === true/.test(IDX_SRC) && !/commit !== false/.test(IDX_SRC));

  ok('D-④ 换文件必须显式 confirm 才覆盖（不能只凭 commit 就顶掉已存在的数据）',
    /confirm === true/.test(IDX_SRC));

  const PAGE = fs.readFileSync(P('subpkg/biz/revenue/index.js'), 'utf8');
  ok('D-⑤ 页面进来自动读库（不用老板再点一次）',
    /onLoad\(\)[\s\S]{0,200}loadStored\(\)/.test(PAGE));

  ok('D-⑥ 页面上传时带 commit: true（否则导了也存不住）',
    /commit:\s*true/.test(PAGE));

  ok('D-⑦ 页面把「这数哪天导的」显示出来（来源可见，不是凭空冒出来的数）',
    /srcNote/.test(PAGE) && fs.readFileSync(P('subpkg/biz/revenue/index.wxml'), 'utf8').indexOf('{{srcNote}}') > 0);

  ok('D-⑧ 页面不自己拼 month（月份以云端解析出的业务日期为准，防前端传错月）',
    PAGE.indexOf("month:") < 0 || /revenue_get'[\s\S]{0,80}month/.test(PAGE) === false);

  console.log('\n===== 营收落库守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
  process.exit(failN === 0 ? 0 : 1);
})();

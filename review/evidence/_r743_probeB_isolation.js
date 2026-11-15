#!/usr/bin/env node
// _r743_probeB_isolation.js —— R743 独立审计探针 B：店铺隔离 / 幂等 / 归档锁 / 归档副作用 / 导出判据
// 只读：fs.readFileSync + require 纯函数 + mock db 演示，绝不修改任何现有文件。
// 运行： node review/evidence/_r743_probeB_isolation.js
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..', '..');
const F = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(F(p), 'utf8');

const R = [];
const ck = (name, pass, detail) => { R.push({ name, pass: !!pass, detail: detail || '' }); };
console.log('==== R743 · 探针B · 隔离 / 幂等 / 归档锁 / 副作用 / 导出判据 ====\n');

// ===================== 0. mock db（复刻 wx-server-sdk 最小形状） =====================
function makeDb(docs) {
  return {
    collection(coll) {
      const rows = docs[coll] || (docs[coll] = []);
      const self = {
        doc(id) {
          return {
            async get() {
              const hit = rows.find((r) => r._id === id);
              if (!hit) throw new Error('DOC_NOT_FOUND');
              return { data: hit };
            },
            async update({ data }) {
              const hit = rows.find((r) => r._id === id);
              if (hit) Object.assign(hit, data);
              return { stats: { updated: hit ? 1 : 0 } };
            },
            async remove() { return { stats: { removed: 0 } }; },
          };
        },
        where(cond) {
          const hit = rows.filter((r) => Object.keys(cond).every((k) => r[k] === cond[k]));
          return {
            limit() { return this; },
            skip() { return this; },
            async get() { return { data: hit }; },
            async remove() { return { stats: { removed: hit.length } }; },
            async count() { return { total: hit.length }; },
          };
        },
        async add({ data }) { rows.push(Object.assign({ _id: 'auto_' + rows.length }, data)); return { _id: rows[rows.length - 1]._id }; },
      };
      return self;
    },
  };
}

// ===================== 1. 店铺隔离：da.get 是否带 shop_id =====================
console.log('【表1 · 店铺隔离：da.get 按 asset_id 直取（真跑 mock）】');
const { makeAdapter } = require(F('cloudfunctions/common/dataAdapter.js'));
const idem = require(F('cloudfunctions/common/idempotency.js'));
const auth = require(F('cloudfunctions/common/auth.js'));

const DB = makeDb({
  shop: [
    { _id: 'docA', id: 'shopA', shop_id: 'shopA', user_id: 'userA', is_deleted: false, name: 'A店' },
    { _id: 'docB', id: 'shopB', shop_id: 'shopB', user_id: 'userB', is_deleted: false, name: 'B店' },
  ],
  shop_amortize: [
    { _id: 'rowA', asset_id: 'amort_A1', id: 'amort_A1', shop_id: 'shopA', value_fen: 12000000, start_month: '2026-01', total_months: 36, mode: 'amort', is_deleted: false },
    { _id: 'rowB', asset_id: 'amort_B1', id: 'amort_B1', shop_id: 'shopB', value_fen: 6000000, start_month: '2026-01', total_months: 24, mode: 'amort', is_deleted: false },
  ],
  shop_monthly_account: [
    { _id: 'accB', shop_id: 'shopB', month: '2026-05', is_archive: true, amortize_fen: 250000, is_deleted: false },
  ],
  audit_log: [],
});
const da = makeAdapter(DB);

(async () => {
  // 调用方身份 = A 店老板，但 asset_id 传的是 B 店资产
  const owner = await auth.assertShopOwner(DB, 'shopA', 'userA');
  console.log(`  assertShopOwner(shopA,userA).error = ${owner.error}  （只校验 shop.user_id，不接触 asset_id）`);
  const got = await da.get('shop_amortize', 'amort_B1');
  console.log(`  da.get('shop_amortize','amort_B1') 命中 = ${!!got}  shop_id = ${got && got.shop_id}  _id = ${got && got._id}`);
  ck('B-1 da.get 按 asset_id 直取能读到【别店】资产（无 shop_id 条件）',
    !!got && got.shop_id === 'shopB', `读到 shop_id=${got && got.shop_id}`);

  // 模拟 saveAsset 编辑分支的写：doc(exist._id).update(patch) —— patch 不含 shop_id
  const patch = { name: '被跨店篡改', value_fen: 1, start_month: '2026-01', total_months: 36, mode: 'amort', is_deleted: false };
  await DB.collection('shop_amortize').doc(got._id).update({ data: patch });
  const after = DB.collection('shop_amortize') && (await da.get('shop_amortize', 'amort_B1'));
  console.log(`  直写 doc(rowB).update(patch) 后：name=${after.name}  value_fen=${after.value_fen}  shop_id=${after.shop_id}（仍属 B 店）`);
  ck('B-2 doc(_id).update() 能跨店改写别店资产（金额被改成 1 分）',
    after.name === '被跨店篡改' && after.value_fen === 1 && after.shop_id === 'shopB',
    `value_fen=${after.value_fen}`);

  // 归档锁查的是【调用方 shopId=A】的月度账 ⇒ B 店已归档 2026-05 根本不在扫描面里
  const accA = await da.list('shop_monthly_account', { shop_id: 'shopA' });
  const accB = await da.list('shop_monthly_account', { shop_id: 'shopB' });
  console.log(`  amortArchiveLocked 扫描面 = da.list('shop_monthly_account',{shop_id:'shopA'}) ⇒ ${(accA.data || []).length} 行；B 店归档月 ${(accB.data || []).length} 行不在其中`);
  ck('B-3 归档锁只按调用方 shopId 查账，别店已归档月挡不住跨店改写',
    (accA.data || []).length === 0 && (accB.data || []).length === 1,
    `A=${(accA.data || []).length} B=${(accB.data || []).length}`);

  // 列出全仓 shop_amortize 读取点是否带 shop_id（静态）
  console.log('\n【表2 · 全仓 shop_amortize 读取点 shop_id 取证】');
  const READ_POINTS = [
    ['getLedger/index.js:129',      'cloudfunctions/getLedger/index.js',        /da\.list\('shop_amortize',\s*\{\s*shop_id:\s*shopId\s*\}\)/],
    ['saveLedger/index.js:102',     'cloudfunctions/saveLedger/index.js',       /da\.list\('shop_amortize',\s*\{\s*shop_id:\s*shopId\s*\}\)/],
    ['getAmortSchedule/index.js:90','cloudfunctions/getAmortSchedule/index.js',  /da\.list\('shop_amortize',\s*\{\s*shop_id:\s*shopId\s*\}\)/],
    ['exportData/index.js:410',     'cloudfunctions/exportData/index.js',       /da\.list\('shop_amortize',\s*\{\s*shop_id:\s*shopId\s*\}\)/],
    ['calcAmortize/index.js:41',    'cloudfunctions/calcAmortize/index.js',     /da\.list\('shop_amortize',\s*\{\s*shop_id:\s*shopId\s*\}\)/],
  ];
  for (const [tag, rel, re] of READ_POINTS) {
    const ok = re.test(read(rel));
    console.log(`  ${tag.padEnd(34)} 带 {shop_id:shopId} = ${ok}`);
    ck('B-4 ' + tag + ' da.list 带 shop_id 隔离', ok, `ok=${ok}`);
  }
  const saIdx = read('cloudfunctions/saveAsset/index.js');
  const daGetNoShop = /da\.get\('shop_amortize',\s*v\.asset\.asset_id\)/.test(saIdx) && /da\.get\('shop_amortize',\s*a\.asset_id\)/.test(saIdx);
  const docWrite = /db\.collection\('shop_amortize'\)\.doc\(exist\._id \|\|/.test(saIdx);
  console.log(`  saveAsset/index.js:91,106      da.get(...,asset_id) 不带 shop_id = ${daGetNoShop}`);
  console.log(`  saveAsset/index.js:101,124     db.collection(...).doc(_id).update 不带 shop_id = ${docWrite}`);
  ck('B-5 saveAsset 存在按 id 直取 + doc(_id) 直写的无隔离路径（对应 B-1/B-2）',
    daGetNoShop && docWrite, `daGet=${daGetNoShop} docWrite=${docWrite}`);

  // ===================== 2. 幂等：client_request_id 可选？空值行为 =====================
  console.log('\n【表3 · 幂等：client_request_id 可选 / 空值行为（真跑）】');
  const keyEmpty = idem.shopKey('shopA', '');
  const keyFull = idem.shopKey('shopA', 'req_1');
  const priorEmpty = await idem.findPriorResult(DB, 'shopA', '');
  const priorFull = await idem.findPriorResult(DB, 'shopA', 'req_1');
  console.log(`  shopKey('shopA','')    = '${keyEmpty}'`);
  console.log(`  shopKey('shopA','req_1')= '${keyFull}'`);
  console.log(`  findPriorResult(db,'shopA','')    = ${priorEmpty}`);
  console.log(`  findPriorResult(db,'shopA','req_1')= ${priorFull}`);
  ck('B-6 空 client_request_id ⇒ shopKey="" ⇒ findPriorResult 直接 return null（不做幂等）',
    keyEmpty === '' && priorEmpty === null, `key='${keyEmpty}' prior=${priorEmpty}`);
  const vaSrc = read('cloudfunctions/saveAsset/validate.js');
  const optionalCrid = /client_request_id:\s*src\.client_request_id \|\| ''/.test(vaSrc);
  console.log(`  saveAsset/validate.js:26,80  client_request_id 缺省 '' = ${optionalCrid}（可选，非必填）`);
  ck('B-7 client_request_id 是可选入参（validate 缺省补空串，不报 INVALID_PARAM）', optionalCrid, `optional=${optionalCrid}`);

  // 新增分支是否有业务键查重？+ DB 唯一索引？
  const addBranchNoDedupe = /const assetId = genId\('amort_'\);[\s\S]{0,600}await da\.insert\('shop_amortize'/.test(saIdx)
    && !/where\(\{[^}]*name[^}]*\}\)/.test(saIdx);
  const coll = read('cloudfunctions/initDb/collections.js');
  const amortIdxBlock = (() => {
    const i = coll.indexOf('shop_amortize: [');
    const j = coll.indexOf('],', i);
    return coll.slice(i, j + 2);
  })();
  const hasUnique = /unique:\s*true/.test(amortIdxBlock);
  console.log(`  saveAsset 新增分支：genId + insert，无业务键查重 = ${addBranchNoDedupe}`);
  console.log(`  initDb/collections.js:137-139 shop_amortize 索引块 = ${amortIdxBlock.replace(/\s+/g, ' ').trim()}`);
  console.log(`  该集合含 unique:true 索引 = ${hasUnique}`);
  ck('B-8 新增分支无任何业务键查重（每次 genId+insert ⇒ 重复提交生成两行）', addBranchNoDedupe, `noDedupe=${addBranchNoDedupe}`);
  ck('B-9 shop_amortize 无任何唯一索引防重复（仅 idx_amort_shop 非唯一）', !hasUnique, `hasUnique=${hasUnique}`);

  // ===================== 3. 归档锁：decideArchiveLock 真值表 =====================
  console.log('\n【表4 · decideArchiveLock 真值表（真跑 saveAsset/service.js）】');
  const S = require(F('cloudfunctions/saveAsset/service.js'));
  const LOCK_CASES = [
    ['新增 amort',            null,       null,       'amort', '2026-03'],
    ['新增 lump',             null,       null,       'lump',  '2026-03'],
    ['编辑 amort→改起摊月向前', 'amort', '2026-06', 'amort', '2026-03'],
    ['编辑 amort→改起摊月向后', 'amort', '2026-03', 'amort', '2026-08'],
    ['编辑 amort→lump',      'amort',  '2026-03', 'lump',  '2026-09'],
    ['编辑 lump→amort',       'lump',   '2026-03', 'amort', '2026-07'],
    ['编辑仅改 terminate_month（start 不变）', 'amort', '2026-01', 'amort', '2026-01'],
  ];
  for (const [tag, em, es, nm, ns] of LOCK_CASES) {
    const p = S.decideArchiveLock(em, es, nm, ns);
    console.log(`  ${tag.padEnd(34)} => lumpMonths=${JSON.stringify(p.lumpMonths).padEnd(16)} amortStart='${p.amortStart}'`);
  }
  const backward = S.decideArchiveLock('amort', '2026-03', 'amort', '2026-08');
  const forward = S.decideArchiveLock('amort', '2026-06', 'amort', '2026-03');
  ck('B-10 改起摊月向后 ⇒ amortStart 取 min(旧,新)=旧起摊月，旧区间被覆盖',
    backward.amortStart === '2026-03', `amortStart=${backward.amortStart}`);
  ck('B-11 改起摊月向前 ⇒ amortStart=新起摊月（更早），新区间被覆盖',
    forward.amortStart === '2026-03', `amortStart=${forward.amortStart}`);
  const modeMix = S.decideArchiveLock('amort', '2026-03', 'lump', '2026-09');
  ck('B-12 amort→lump 两侧都锁（旧区间 + 新 lump 单月）',
    modeMix.amortStart === '2026-03' && modeMix.lumpMonths.indexOf('2026-09') >= 0,
    JSON.stringify(modeMix));

  // amortArchiveLocked 判据复现（源码 index.js:44）
  const ARCHIVED = ['2026-01', '2026-02', '2026-05', '2026-10'];
  const lockHit = (start) => ARCHIVED.find((m) => m >= String(start)) || null;
  console.log(`  已归档月=${JSON.stringify(ARCHIVED)}`);
  console.log(`  改 terminate_month 但 start='2026-01' 不变 ⇒ 区间锁判据 '>=2026-01' 命中 '${lockHit('2026-01')}' ⇒ 拒`);
  ck('B-13 terminate_month 变更被「区间锁 >= start」间接覆盖（start 不变即命中已归档月）',
    lockHit('2026-01') === '2026-01', `hit=${lockHit('2026-01')}`);
  // 三条写路径是否真接 decideArchiveLock/applyLockPlan
  const addWired = /const addPlan = S\.decideArchiveLock\(null, null, a\.mode, a\.start_month\)[\s\S]{0,300}applyLockPlan\(da, shopId, addPlan/.test(saIdx);
  const editWired = /const editPlan = S\.decideArchiveLock\(exist\.mode, exist\.start_month, a\.mode, a\.start_month\)[\s\S]{0,300}applyLockPlan\(da, shopId, editPlan/.test(saIdx);
  const delWired = /if \(v\.remove\)[\s\S]{0,900}decideArchiveLock/.test(saIdx);
  console.log(`  新增路径接 applyLockPlan = ${addWired}`);
  console.log(`  编辑路径接 applyLockPlan = ${editWired}`);
  console.log(`  删除路径接 decideArchiveLock/applyLockPlan = ${delWired}（删除是手写 if/else 另一套）`);
  ck('B-14 新增/编辑两条路径真接上了 decideArchiveLock+applyLockPlan', addWired && editWired, `add=${addWired} edit=${editWired}`);
  ck('B-15 删除路径【未】复用 decideArchiveLock/applyLockPlan（手写等价分支，功能近似但非同一套）',
    !delWired, `delWired=${delWired}`);

  // ===================== 4. archiveMonth 副作用 / 全仓写点 =====================
  console.log('\n【表5 · 归档副作用：shop_monthly_account 写入点】');
  const amSrc = read('cloudfunctions/archiveMonth/index.js');
  const amNoInsert = !/da\.insert\(|\.add\(/.test(amSrc);
  const amFailClosed = /if \(!acct\)[\s\S]{0,300}RESOURCE_NOT_FOUND/.test(amSrc);
  const amOnlyFlag = /data:\s*\{\s*is_archive:\s*v\.archive,\s*archived_at:/.test(amSrc);
  console.log(`  archiveMonth: 无 insert/add = ${amNoInsert}  缺账 fail-closed = ${amFailClosed}  只翻转归档标记 = ${amOnlyFlag}`);
  ck('B-16 archiveMonth R741 fail-closed 成立：缺账不建账、只 UPDATE 归档标记', amNoInsert && amFailClosed && amOnlyFlag,
    `noInsert=${amNoInsert} failClosed=${amFailClosed} onlyFlag=${amOnlyFlag}`);
  const cmSrc = read('cloudfunctions/clearMonth/index.js');
  const cmArchReject = /if \(acct\.is_archive\)[\s\S]{0,200}ARCHIVED_LOCKED/.test(cmSrc);
  console.log(`  clearMonth: 归档月拒清空 = ${cmArchReject}`);
  ck('B-17 clearMonth 拒绝清空已归档月（不改已归档数）', cmArchReject, `reject=${cmArchReject}`);
  // saveLedger 7 天宽限补录（设计内，非缺陷）
  const slSrc = read('cloudfunctions/saveLedger/index.js');
  const grace = /GRACE_DAYS_MS = 7 \* 24 \* 3600 \* 1000/.test(slSrc) && /archiveOverride && withinGrace/.test(slSrc);
  console.log(`  saveLedger 7天宽限补录（archive_override 二次确认，设计内）= ${grace}`);
  ck('B-18 saveLedger 唯一会重写归档月数字的路径是 7 天宽限补录（显式二次确认，设计内非缺陷）', grace, `grace=${grace}`);

  // ===================== 5. exportData 差异行判据漏报 =====================
  console.log('\n【表6 · exportData/index.js:297 差异行判据真值表（真跑）】');
  const expSrc = read('cloudfunctions/exportData/index.js');
  const judgeSrc = /amort !== amortLedger && amortLedger > 0/.test(expSrc);
  console.log(`  源码判据 = \"amort !== amortLedger && amortLedger > 0\" 存在 = ${judgeSrc}`);
  const judge = (amort, amortLedger) => amort !== amortLedger && amortLedger > 0;
  const COMBOS = [
    [433333, 433333, '未归档月：两者恒等，不插差异行（正确）', false],
    [0,      433333, '归档旧口径封 0，台账现有应摊 ⇒ 报（正确）', true],
    [433333, 0,      '归档落库有值，台账现算 0（资产已删/改期）⇒ 应报但漏报', true],
    [-5000,  0,      '落库冻结值为负（脏数据），台账现算 0 ⇒ 应报但漏报', true],
    [-5000,  433333, '落库负值，台账有应摊 ⇒ 报（正确）', true],
    [0,      0,      '两者皆 0，不插（正确）', false],
  ];
  const missList = [];
  for (const [amort, ledger, desc, shouldReport] of COMBOS) {
    const reported = judge(amort, ledger);
    const miss = shouldReport && !reported;
    if (miss) missList.push(`amort=${amort},amortLedger=${ledger}`);
    console.log(`  amort=${String(amort).padStart(7)} amortLedger=${String(ledger).padStart(7)}  判据=${String(reported).padEnd(5)} 应报=${shouldReport}  ${miss ? '❌漏报' : 'OK'}  ${desc}`);
  }
  ck('B-19 判据漏报「台账应收额=0 但落库计入额≠0」及「落库为负且台账=0」两类漂移',
    missList.length === 2, `漏报组合=${missList.join(' / ')}`);
  // 同源性：未归档月 exportData 与 getLedger 是否都从台账重算+归档月读落库
  const expFromLedger = /const amort = isArchiveRow \? nz\(row\.amortize_fen\) : amortLedger;/.test(expSrc);
  const glFromLedger = /const amortizeFen = isArchiveNow\s*\?\s*\(\(acct && acct\.amortize_fen\) \|\| 0\)\s*:\s*amortizeTotalForMonth\(amortRows, v\.month\);/.test(read('cloudfunctions/getLedger/index.js'));
  console.log(`  exportData 未归档月重算/归档月读落库 = ${expFromLedger}；getLedger 同口径 = ${glFromLedger}`);
  ck('B-20 导出件摊销取数与 getLedger 同源（未归档月台账重算 / 归档月落库快照）',
    expFromLedger && glFromLedger, `exp=${expFromLedger} gl=${glFromLedger}`);

  // ===================== 汇总 =====================
  const pass = R.filter((r) => r.pass).length;
  console.log('\n==== 断言汇总 ====');
  for (const r of R) console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`);
  console.log(`\n合计 ${pass}/${R.length} PASS（注：B-1/B-2/B-3/B-6/B-8/B-9/B-15/B-19 的 PASS 表示「缺陷存在/被复现」，非「无问题」）`);
  process.exitCode = pass === R.length ? 0 : 1;
})().catch((e) => { console.error('探针异常:', e); process.exitCode = 2; });

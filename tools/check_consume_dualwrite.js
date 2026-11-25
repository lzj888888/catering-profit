#!/usr/bin/env node
// tools/check_consume_dualwrite.js —— R757 交叉审计固化的「双写一致性」守卫
//
// 为什么必须有：
//   2026-11-25 模拟器 6/6 只证明「正常路径能通」，豆包独立审 + 反面时序实测
//   一打就出三个真丢数据洞（水位线未更新 / 字段级覆盖 / 防抖中断）。
//   这三个都属于「改一行就会复发」的类型——现有门禁只测纯函数、测不到页面级时序。
//   本守卫在 node 内桩 wx，require **真实页面源码**真跑，钉住这三条。
//
// 取证层级：L2 页面桩（页面源码真跑，依赖全桩）。不替代真机渲染。
// 来源：review/evidence/r758_cross_audit/{_probe.js,_probe_fields.js}
// 运行：node tools/check_consume_dualwrite.js

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'subpkg/tools/recon/index.js');
const STORE = path.join(ROOT, 'utils/consumeStore.js');

let pass = 0, failN = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  → ' + detail : '')); }
  else { failN++; console.log('  ❌ ' + name + (detail ? '  → ' + detail : '')); }
}
const sec = (t) => console.log('\n===== ' + t + ' =====');
const src = fs.readFileSync(PAGE, 'utf8');

// ===================================================================
// A. 源码级：三个修复点都还在
// ===================================================================
sec('A 三个修复点的源码锚点');
const onNs = /onNonsales\(e\)\s*\{[\s\S]*?\n  \}/.exec(src);
const onMat = /onMatQty\(e\)\s*\{[\s\S]*?\n  \}/.exec(src);
const pushFn = /async pushToCloud\(month\)\s*\{[\s\S]*?\n  \}/.exec(src);
check('A-① onNonsales 写本地时推高水位线（防被云端旧值覆盖）',
  !!onNs && onNs[0].indexOf('markLocalNew') >= 0);
check('A-② onMatQty 写本地时推高水位线',
  !!onMat && onMat[0].indexOf('markLocalNew') >= 0);
check('A-③ pushToCloud 上传前读云端做字段级合并',
  !!pushFn && /loadCloud\(/.test(pushFn[0]));
check('A-④ pushToCloud 合并时不用空数组/0 覆盖云端已有字段',
  !!pushFn && /if \(!\(nonsales > 0\)\)/.test(pushFn[0]) && /if \(!items\.length\)/.test(pushFn[0]));
check('A-⑤ onHide/onUnload 补发挂起的防抖上传',
  src.indexOf('onHide()') >= 0 && /onHide\(\)[\s\S]{0,260}pushToCloud/.test(src)
  && src.indexOf('onUnload()') >= 0);

// ===================================================================
// B. 页面桩：反面时序真跑（本地新值 vs 云端旧值）
// ===================================================================
sec('B 反面时序真跑（require 真实页面源码）');

function makePage(store) {
  let cfg = null;
  const saved = {
    Page: global.Page, getApp: global.getApp, wx: global.wx,
  };
  global.Page = (c) => { cfg = c; };
  global.getApp = () => ({ globalData: { shop_id: 'shop_test' } });
  global.wx = {
    getStorageSync: (k) => (k in store ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = v; },
    removeStorageSync: (k) => { delete store[k]; },
    getStorageInfoSync: () => ({ keys: Object.keys(store) }),
    showToast: () => {}, navigateTo: () => {},
    // 静默云函数：calc 真跑时会并发调 getLedger/getCostCard/getDishReview/getMaterial，
    // 桩掉它们的网络错误输出，免得污染守卫输出（桩的是 IO，不桩算法）
    cloud: { callFunction: () => Promise.resolve({ result: { code: 'SUCCESS', data: {} } }) },
  };
  // 页面已经 require 过（A 组读源码时没有 require），这里用真路径加载
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
  const p = Object.assign({}, cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data));
  p.setData = function (patch) { for (const k in patch) this.data[k] = patch[k]; };
  p.data.months = ['2026-11', '2026-10'];
  p.data.curMonth = '2026-11';
  return { p, saved };
}
function restore(saved) {
  global.Page = saved.Page;
  global.getApp = saved.getApp;
  global.wx = saved.wx;
  delete require.cache[require.resolve(PAGE)];
}

const sm = require(STORE);
const origLoad = sm.loadCloud;
const origSave = sm.saveCloud;

// 桩云端：旧版本（t=100），本地由 onNonsales 填新值（t=现在）
const storeB = {};
const { p: pB, saved: savedB } = makePage(storeB);
const keyNs = 'nonsales_2026-11_shop_shop_test';
const keyAt = 'consume_sync_at_2026-11_shop_shop_test';
sm.loadCloud = async () => ({ v: 1, month: '2026-11', nonsalesFen: 8000, items: [], updatedAt: 100 });
pB.onNonsales({ detail: { value: '200' } });
const watermark = Number(storeB[keyAt]) || 0;
check('B-① 填 200 元后水位线被推高（> 云端旧值 t=100）', watermark > 100, String(watermark));
check('B-② 本地确实写入 20000 分', storeB[keyNs] === 20000, String(storeB[keyNs]));
let threwB = null;
try { pB.syncFromCloud('2026-11'); } catch (e) { threwB = e; }

// 下一 tick 检查同步结果
setTimeout(() => {
  check('B-③ 🔴 本地新值保住（不被云端旧值覆盖）', storeB[keyNs] === 20000,
    storeB[keyNs] === 20000 ? '200 元保住' : '被旧值 ' + storeB[keyNs] + ' 覆盖');
  check('B-④ syncFromCloud 真跑不抛异常', threwB === null, threwB && threwB.message);
  restore(savedB);

  // ===================================================================
  // C. 字段级覆盖：设备B只填员工餐，不能清空设备A的原料盘点
  // ===================================================================
  sec('C 字段级覆盖真跑（设备A的 items 不能被设备B清空）');
  const storeC = {};
  const { p: pC, saved: savedC } = makePage(storeC);
  storeC[keyNs] = 8000;   // 设备B：只填员工餐，本地无 matinv
  const cloudItems = [{ material_id: 'm_beef', opening_qty: 5, purchase_qty: 95, closing_qty: 8, purchase_amount_fen: 171000 }];
  let sent = null;
  sm.loadCloud = async () => ({ v: 1, month: '2026-11', nonsalesFen: 8000, items: cloudItems, updatedAt: 1000 });
  sm.saveCloud = async (sid, month, payload) => { sent = payload; return { ok: true }; };
  pC.pushToCloud('2026-11');

  setTimeout(() => {
    check('C-① 上传的 payload 保留云端已有原料数据（items 未被清空）',
      !!sent && sent.items.length === 1, sent ? ('items=' + sent.items.length) : '没捕获到 payload');
    check('C-② 员工餐金额仍用本地新值（8000 分）', !!sent && sent.nonsalesFen === 8000,
      sent ? String(sent.nonsalesFen) : '—');
    restore(savedC);
    sm.loadCloud = origLoad;
    sm.saveCloud = origSave;

    // ===================================================================
    // D. 反恒真（变异回灌）：把三个修复点逐个去掉，判据必须转红
    // ===================================================================
    sec('D 反恒真（证明 A 组判据不是恒真）');
    const mut1 = src.replace('this.markLocalNew(this.data.curMonth);', '');
    const mOnNs = /onNonsales\(e\)\s*\{[\s\S]*?\n  \}/.exec(mut1);
    check('D-① 删掉 markLocalNew 后 A-① 必须转红',
      mut1 !== src && !!mOnNs && mOnNs[0].indexOf('markLocalNew') < 0);

    // 变异字段合并：把 "if (!items.length) items = ..." 删掉，A-④ 必须转红
    const mut2 = src.replace('if (!items.length) items = Array.isArray(cloud.items) ? cloud.items : [];', '');
    check('D-② 删掉字段合并后 A-④ 必须转红',
      mut2 !== src && !/if \(!items\.length\)/.test(mut2));

    // 变异 onHide：把补发语句删掉，A-⑤ 必须转红
    const mut3 = src.replace(/onHide\(\)\s*\{[\s\S]*?\n  \}/, 'onHide() { }');
    check('D-③ 删掉 onHide 补发后 A-⑤ 必须转红',
      mut3 !== src && !/onHide\(\)[\s\S]{0,260}pushToCloud/.test(mut3));

    console.log('\n===== 双写一致性守卫结果：' + pass + ' 通过 / ' + failN + ' 失败 =====');
    process.exit(failN === 0 ? 0 : 1);
  }, 250);
}, 300);

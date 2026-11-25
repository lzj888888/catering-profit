// review/evidence/r758_cross_audit/_probe_fields.js —— 交叉审计：字段级覆盖丢失
// 豆包 Q4-1：设备A填原料盘点 → 云端有 items；设备B只填员工餐（本地无 matinv）
//            → B 的 push 组装 items=[] → **把 A 的原料数据清空**
// 运行： node review/evidence/r758_cross_audit/_probe_fields.js

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..');

let pass = 0, failN = 0;
function probe(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name + (detail ? '  → ' + detail : '')); }
  else { failN++; console.log('  🔴 ' + name + (detail ? '  → ' + detail : '')); }
}

console.log('===== 交叉审计 D：字段级覆盖（豆包 Q4-1）=====');

// 静态判据：pushToCloud 组装 payload 前是否读了云端做合并？
const src = fs.readFileSync(path.join(ROOT, 'subpkg/tools/recon/index.js'), 'utf8');
const fn = /pushToCloud\(month\)\s*\{[\s\S]*?\n  \}/.exec(src);
const readsCloud = !!fn && /loadCloud\(/.test(fn[0]);
// 注意：syncFromCloud 里也有 loadCloud，所以只取 pushToCloud 函数体判断
probe('D-① pushToCloud 上传前读云端做字段级合并（否则会清空别的字段）', readsCloud,
  readsCloud ? '已读云端' : '未读 —— 本地缺的字段会被空数组/0 覆盖掉');

// 源码里的 payload 组装：是不是只用本地？
const usesOnlyLocal = !!fn && /payloadOf\(month,\s*this\.loadNonsales\(month\),\s*this\.matItemsOf\(month\)\)/.test(fn[0]);
probe('D-② 修复后：payload 不再只用本地两栏（否则会清空云端其他字段）', !usesOnlyLocal,
  usesOnlyLocal ? '仍是纯本地 ❌' : '已含云端补齐 ✅');

// 实测：设备B本地只有 nonsales，设备A的 items 在云端
{
  const store = {};
  let cfg = null;
  global.Page = (c) => { cfg = c; };
  global.getApp = () => ({ globalData: { shop_id: 'shop_test' } });
  global.wx = {
    getStorageSync: (k) => (k in store ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = v; },
    removeStorageSync: (k) => { delete store[k]; },
    getStorageInfoSync: () => ({ keys: Object.keys(store) }),
    showToast: () => {}, navigateTo: () => {}, cloud: {},
  };
  require(path.join(ROOT, 'subpkg/tools/recon/index.js'));
  const p = Object.assign({}, cfg);
  p.data = JSON.parse(JSON.stringify(cfg.data));
  p.setData = function (patch) { for (const k in patch) this.data[k] = patch[k]; };
  p.data.curMonth = '2026-11';

  // 设备B本地：只填了员工餐 80 元，没有原料盘点
  store['nonsales_2026-11_shop_shop_test'] = 8000;
  // 设备A在云端留下的原料盘点（B 本地看不到）
  const cloudItems = [{ material_id: 'm_beef', opening_qty: 5, purchase_qty: 95, closing_qty: 8, purchase_amount_fen: 171000 }];

  // 桩 store.saveCloud 捕获真正要上传的 payload；桩 loadCloud 返回 A 的数据
  const sm = require(path.join(ROOT, 'utils/consumeStore.js'));
  const origSave = sm.saveCloud, origLoad = sm.loadCloud;
  let sent = null;
  sm.saveCloud = async (sid, month, payload) => { sent = payload; return { ok: true }; };
  sm.loadCloud = async () => ({ v: 1, month: '2026-11', nonsalesFen: 8000, items: cloudItems, updatedAt: 1000 });

  p.pushToCloud('2026-11');

  setTimeout(() => {
    console.log('  云端原有 items = ' + cloudItems.length + ' 行（设备A填的牛肉）');
    console.log('  设备B准备上传 payload.items = ' + (sent ? sent.items.length : 'null') + ' 行');
    probe('D-③ 实测：上传的 payload 保留了云端已有的原料数据',
      !!sent && sent.items.length === 1,
      sent ? ('items=' + sent.items.length) : '没捕获到 payload');

    sm.saveCloud = origSave; sm.loadCloud = origLoad;
    console.log('\n==== 字段级覆盖审计：' + pass + ' 通过 / ' + failN + ' 不吻合 ====');
    process.exit(failN === 0 ? 0 : 1);
  }, 200);
}
